import { BatchGetCommand, BatchWriteCommand, DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

// Single table, every item partitioned by bucket:
//   BUCKET#<id> / META            settings, owners set. Never written by a photo commit.
//   BUCKET#<id> / COUNTER#<nn>    byte counter shard: free, bytes, photos, backupBytes, state.
//   BUCKET#<id> / PHOTO#<pid>     visible photo.
//   BUCKET#<id> / DELETED#<pid>.<u> audit record of a photo an owner or admin deleted. Kept until the bucket goes.
//   BUCKET#<id> / TOMB#<pid>.<u>  short-lived marker of a guest's permanent delete, so the sweep can repeat the purge.
//   BUCKET#<id> / OWNER#<uid>     owner edge, one per owner, so GSI1 can list a uid's buckets.
//   BUCKET#<id> / RATE#...        guest-token rate windows, removed by TTL.
// GSI1 (all attributes): OWNER#<uid> and ALL list buckets; BUCKET#<id>#C#<contributor> lists one guest's photos.
// GSI2 (sparse): DEMO lists demos by expiry; PURGE lists buckets an admin deleted; PHOTOPURGE lists tombstones by due
// time; BACKUP#<id> lists photos without a backup yet, deleted ones included.
// GSI3 (sparse, keys only): FAILED lists every failed backup across all buckets.
//
// The size cap: limitBytes = sum(free) + sum(bytes), always. Each shard holds an allowance and spends it under the
// condition free >= delta inside the commit transaction, so the cap cannot be exceeded at all, by any number of writers.
export const SHARDS = 32, DEMO_SHARDS = 4, TOMB_GRACE_MS = 5 * 60 * 1000;
const pk = id => `BUCKET#${id}`;
const metaKey = id => ({ pk: pk(id), sk: 'META' });
const shardKey = (id, n) => ({ pk: pk(id), sk: `COUNTER#${String(n).padStart(2, '0')}` });
const photoKey = (id, pid) => ({ pk: pk(id), sk: `PHOTO#${pid}` });
const stamp13 = t => String(t).padStart(13, '0');
const HIDDEN = new Set(['pk', 'sk', 'gsi1pk', 'gsi1sk', 'gsi2pk', 'gsi2sk', 'gsi3pk', 'gsi3sk', 'gsi4pk', 'gsi4sk', 'ttl']);
const strip = item => { if (!item) return item; const out = {}; for (const [k, v] of Object.entries(item)) if (!HIDDEN.has(k)) out[k] = v instanceof Set ? [...v] : v; return out; };
// Every attribute is aliased as #name, so reserved words can never break an expression.
const names = (...parts) => { const used = [...new Set(parts.filter(Boolean).join(' ').match(/#\w+/g) || [])]; return used.length ? Object.fromEntries(used.map(t => [t, t.slice(1)])) : undefined; };

const BUSY_NAMES = new Set(['ProvisionedThroughputExceededException', 'ThrottlingException', 'RequestLimitExceeded', 'TransactionInProgressException', 'TransactionConflictException', 'InternalServerError', 'ServiceUnavailable']);
const BUSY_REASONS = new Set(['TransactionConflict', 'ProvisionedThroughputExceeded', 'ThrottlingError', 'RequestLimitExceeded', 'TransactionInProgress']);
const conflict = (error, failed = [], reason) => Object.assign(new Error('conflict'), { conflict: true, failed, reason, cause: error });
const busy = error => Object.assign(new Error('busy'), { busy: true, cause: error });
// TransactionConflict means another writer held the item right now, so it is retried. It is never a client error.
export function classify(error) {
  if (error?.name === 'ConditionalCheckFailedException') return conflict(error);
  if (BUSY_NAMES.has(error?.name)) return busy(error);
  if (error?.name === 'TransactionCanceledException') {
    const reasons = error.CancellationReasons || [];
    const failed = reasons.flatMap((r, i) => (r.Code === 'ConditionalCheckFailed' ? [i] : []));
    if (failed.length) return conflict(error, failed);
    if (reasons.some(r => BUSY_REASONS.has(r.Code))) return busy(error);
  }
  return error;
}

const failedKeys = (bucketId, photo) => ({ gsi3pk: 'FAILED', gsi3sk: `${bucketId}#${stamp13(photo.createdAt)}#${photo.id}` });
const unbackedKeys = (bucketId, photo) => (photo.backupState === 'done' ? {} : { gsi2pk: `BACKUP#${bucketId}`, gsi2sk: `${photo.backupState || 'pending'}#${stamp13(photo.createdAt)}#${photo.id}`, ...(photo.backupState === 'failed' ? failedKeys(bucketId, photo) : {}) });
export function photoItem(bucketId, photo) {
  return { ...photoKey(bucketId, photo.id), ...photo, gsi1pk: `${pk(bucketId)}#C#${photo.contributorId}`, gsi1sk: `${stamp13(photo.createdAt)}#${photo.id}`, gsi4pk: `${pk(bucketId)}#P`, gsi4sk: `${stamp13(photo.createdAt)}#${photo.id}`, ...unbackedKeys(bucketId, photo) };
}
// All items of a new bucket. The opening balance is split evenly between shards.
export function bucketItems(meta, { usedBytes = 0, photoCount = 0, backupBytes = 0 } = {}) {
  const { bucketId: id, owners = [], shards, limitBytes } = meta, listKey = `${stamp13(meta.createdAt)}#${id}`;
  const free = limitBytes - usedBytes, each = Math.floor(free / shards);
  const state = meta.frozen || meta.status === 'deleting' ? 'closed' : meta.paused ? 'paused' : 'open';
  const { owners: _drop, ...rest } = meta;
  return [
    { ...metaKey(id), ...rest, ...(owners.length ? { owners: new Set(owners) } : {}), gsi1pk: 'ALL', gsi1sk: listKey, ...(meta.demo ? { gsi2pk: 'DEMO', gsi2sk: `${stamp13(meta.expiresAt)}#${id}` } : {}) },
    ...Array.from({ length: shards }, (_, n) => ({ ...shardKey(id, n), free: each + (n === 0 ? free - each * shards : 0), bytes: n === 0 ? usedBytes : 0, photos: n === 0 ? photoCount : 0, backupBytes: n === 0 ? backupBytes : 0, state })),
    ...owners.map(uid => ownerEdge(id, uid, listKey)),
  ];
}
const ownerEdge = (id, uid, listKey) => ({ pk: pk(id), sk: `OWNER#${uid}`, uid, gsi1pk: `OWNER#${uid}`, gsi1sk: listKey });
const stateOf = m => (m.frozen || m.status === 'deleting' ? 'closed' : m.paused ? 'paused' : 'open');
const encodeCursor = (lek, fixed) => { if (!lek) return null; const rest = { ...lek }; for (const k of Object.keys(fixed)) delete rest[k]; return Buffer.from(JSON.stringify(rest)).toString('base64url'); };
// A cursor only ever carries the position. The partition is re-applied here, so no cursor can read another bucket.
function decodeCursor(cursor, fixed, allowed, check = () => true) {
  if (!cursor) return undefined;
  const bad = () => Object.assign(new Error('bad cursor'), { invalidCursor: true });
  let parsed;
  try { parsed = JSON.parse(Buffer.from(String(cursor), 'base64url').toString()); } catch { throw bad(); }
  if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length !== allowed.length) throw bad();
  for (const k of allowed) if (typeof parsed[k] !== 'string' || !parsed[k] || parsed[k].length > 400) throw bad();
  if (!check(parsed)) throw bad();
  return { ...parsed, ...fixed };
}

export function createStore({ client, table, random = Math.random, sleep = ms => new Promise(r => setTimeout(r, ms)), attempts = 10 }) {
  // Full jitter: writers that collided once must not collide again on the same schedule.
  const backoff = attempt => sleep(random() * Math.min(400, 20 * 2 ** attempt));
  const once = async command => { try { return await client.send(command); } catch (error) { throw classify(error); } };
  async function send(command) {
    for (let attempt = 0; ; attempt++) {
      try { return await once(command); }
      catch (error) { if (!error.busy || attempt >= attempts - 1) throw error; await backoff(attempt); }
    }
  }
  const pickShard = count => Math.floor(random() * count);

  async function readCounters(id, { consistent = false } = {}) {
    const items = []; let ExclusiveStartKey;
    do {
      const page = await send(new QueryCommand({ TableName: table, KeyConditionExpression: '#pk = :p AND begins_with(#sk, :c)', ExpressionAttributeNames: names('#pk #sk'), ExpressionAttributeValues: { ':p': pk(id), ':c': 'COUNTER#' }, ConsistentRead: consistent, ExclusiveStartKey }));
      items.push(...page.Items); ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    const sum = field => items.reduce((total, s) => total + (s[field] || 0), 0);
    return { freeBytes: sum('free'), usedBytes: sum('bytes'), photoCount: sum('photos'), backupBytes: sum('backupBytes'), state: items.some(s => s.state === 'closed') ? 'closed' : items.some(s => s.state === 'paused') ? 'paused' : 'open', shards: items.map(s => ({ n: Number(s.sk.slice(8)), free: s.free })) };
  }
  const shardUpdate = (id, n, { delta = 0, photos = 0, backup = 0, allow = 'any' }) => {
    const conds = ['attribute_exists(#pk)'], values = { ':d': delta, ':f': 0 - delta, ':n': photos, ':b': backup };
    if (delta > 0) conds.push('#free >= :d');
    if (allow === 'open') { conds.push('#state = :open'); values[':open'] = 'open'; }
    if (allow === 'live') { conds.push('#state <> :closed'); values[':closed'] = 'closed'; }
    const ConditionExpression = conds.join(' AND '), UpdateExpression = 'ADD #free :f, #bytes :d, #photos :n, #backupBytes :b';
    return { TableName: table, Key: shardKey(id, n), UpdateExpression, ConditionExpression, ExpressionAttributeNames: names(ConditionExpression, UpdateExpression), ExpressionAttributeValues: values };
  };
  // Move spare allowance into one shard when no single shard can pay. Only happens near the cap.
  async function consolidate(id, shards, need) {
    const sorted = [...shards].sort((a, b) => b.free - a.free), [target, ...donors] = sorted;
    let short = need - target.free; const moves = [];
    for (const d of donors) { if (short <= 0) break; const take = Math.min(d.free, short); if (take > 0) { moves.push({ n: d.n, take }); short -= take; } }
    if (short > 0 || !moves.length) return;
    const change = (n, amount, guard) => ({ Update: { TableName: table, Key: shardKey(id, n), UpdateExpression: 'ADD #free :a', ExpressionAttributeNames: { '#free': 'free' }, ExpressionAttributeValues: { ':a': amount, ...(guard ? { ':g': guard } : {}) }, ...(guard ? { ConditionExpression: '#free >= :g' } : {}) } });
    await once(new TransactWriteCommand({ TransactItems: [change(target.n, moves.reduce((t, m) => t + m.take, 0)), ...moves.map(m => change(m.n, 0 - m.take, m.take))] })).catch(error => { if (!error.conflict && !error.busy) throw error; });
  }
  // Runs items + one shard update as a transaction. Each try picks another shard, which is what makes contention fade.
  // A failed shard condition is explained from the counters: closed, paused, truly full, or spare bytes elsewhere.
  async function withShard(id, shardCount, charge, items) {
    const at = items.length; let shard = pickShard(shardCount);
    for (let attempt = 0; attempt < attempts; attempt++) {
      try { await once(new TransactWriteCommand({ TransactItems: [...items, { Update: shardUpdate(id, shard, charge) }] })); return; }
      catch (error) {
        if (error.busy) { await backoff(attempt); shard = pickShard(shardCount); continue; }
        if (!error.conflict) throw error;
        if (error.failed.some(i => i !== at)) throw conflict(error, error.failed, 'item');
        const c = await readCounters(id, { consistent: true });
        if (!c.shards.length) throw conflict(error, error.failed, 'gone');
        if (c.state === 'closed' && charge.allow !== 'any') throw conflict(error, error.failed, 'closed');
        if (c.state === 'paused' && charge.allow === 'open') throw conflict(error, error.failed, 'paused');
        const delta = charge.delta || 0;
        if (delta > 0 && c.freeBytes < delta) throw conflict(error, error.failed, 'full');
        const able = c.shards.filter(s => s.free >= delta);
        if (able.length) shard = able[pickShard(able.length)].n;
        else { await consolidate(id, c.shards, delta); await backoff(attempt); }
      }
    }
    throw busy(new Error('transaction retries exhausted'));
  }
  // A tombstone outlives any backup already running (function timeout 120 s), so the sweep's second purge catches a late copy.
  const tombItem = (id, photo, stamp) => { const tombId = `${photo.id}.${photo.uploadId}`; return { pk: pk(id), sk: `TOMB#${tombId}`, gsi2pk: 'PHOTOPURGE', gsi2sk: `${stamp13(stamp + TOMB_GRACE_MS)}#${id}#${tombId}` }; };
  const deletedKey = (id, deletedId) => ({ pk: pk(id), sk: `DELETED#${deletedId}` });
  const removeLive = photo => ({ TableName: table, Key: photoKey(photo.bucketId, photo.id), ConditionExpression: '#revision = :r AND #backupState = :s', ExpressionAttributeNames: { '#revision': 'revision', '#backupState': 'backupState' }, ExpressionAttributeValues: { ':r': photo.revision, ':s': photo.backupState } });
  async function query({ keyExpr, values, index, limit, cursor, fixed, allowed, check, forward = true, consistent = false, project }) {
    const start = decodeCursor(cursor, fixed, allowed, check);
    try {
      const page = await send(new QueryCommand({ TableName: table, ...(index ? { IndexName: index } : {}), KeyConditionExpression: keyExpr, ExpressionAttributeNames: names(keyExpr, project), ExpressionAttributeValues: values, Limit: limit, ExclusiveStartKey: start, ScanIndexForward: forward, ConsistentRead: index ? undefined : consistent, ...(project ? { ProjectionExpression: project } : {}) }));
      return { items: page.Items, nextCursor: encodeCursor(page.LastEvaluatedKey, fixed) };
    } catch (error) { if (cursor && error?.name === 'ValidationException') throw Object.assign(new Error('bad cursor'), { invalidCursor: true }); throw error; }
  }
  const setFields = (Key, fields, extraCond) => {
    const list = Object.keys(fields), UpdateExpression = 'SET ' + list.map(n => `#${n} = :${n}`).join(', ');
    const ConditionExpression = ['attribute_exists(#pk)', extraCond].filter(Boolean).join(' AND ');
    return { TableName: table, Key, UpdateExpression, ConditionExpression, ExpressionAttributeNames: names(UpdateExpression, ConditionExpression), ExpressionAttributeValues: { ...Object.fromEntries(list.map(n => [`:${n}`, fields[n]])), ...(extraCond?.includes(':deleting') ? { ':deleting': 'deleting' } : {}) }, ReturnValues: 'ALL_NEW' };
  };
  // Flip every shard one by one, not in one transaction: a 32-item transaction would lose to live commits again and
  // again at peak. The caller's response is only sent after all flips finished, so "paused" is true once it returns.
  const setShardStates = (id, count, state) => Promise.all(Array.from({ length: count }, (_, n) => send(new UpdateCommand({ TableName: table, Key: shardKey(id, n), UpdateExpression: 'SET #state = :s', ConditionExpression: 'attribute_exists(#pk)', ExpressionAttributeNames: names('#state #pk'), ExpressionAttributeValues: { ':s': state } })).catch(error => { if (!error.conflict) throw error; })));

  return {
    readCounters,
    async getMeta(id, { consistent = false } = {}) { const { Item } = await send(new GetCommand({ TableName: table, Key: metaKey(id), ConsistentRead: consistent })); return strip(Item); },
    async getMetas(ids) {
      if (!ids.length) return [];
      const found = new Map(); let Keys = ids.map(metaKey);
      for (let attempt = 0; Keys?.length; attempt++) {
        const { Responses, UnprocessedKeys } = await send(new BatchGetCommand({ RequestItems: { [table]: { Keys, ConsistentRead: true } } }));
        for (const item of Responses?.[table] || []) found.set(item.bucketId, strip(item));
        Keys = UnprocessedKeys?.[table]?.Keys;
        if (Keys?.length) { if (attempt >= attempts) throw busy(new Error('batch get')); await backoff(attempt); }
      }
      return ids.map(id => found.get(id)).filter(Boolean);
    },
    createBucket: meta => send(new TransactWriteCommand({ TransactItems: bucketItems(meta).map((Item, i) => ({ Put: { TableName: table, Item, ...(i === 0 ? { ConditionExpression: 'attribute_not_exists(#pk)', ExpressionAttributeNames: { '#pk': 'pk' } } : {}) } })) })),
    async updateMeta(id, fields) { const { Attributes } = await send(new UpdateCommand(setFields(metaKey(id), fields, '#status <> :deleting'))); return strip(Attributes); },
    // Pause and freeze: META for readers, then every shard so the commit transaction sees it without touching META.
    async setState(id, fields) {
      const { Attributes } = await send(new UpdateCommand(setFields(metaKey(id), fields, '#status <> :deleting')));
      await setShardStates(id, Attributes.shards, stateOf(Attributes));
      return strip(Attributes);
    },
    // Keeps limit = sum(free) + sum(bytes): the difference goes in or out of shard allowances in the same transaction.
    async setLimit(id, meta, limitBytes, limitGb, stamp) {
      for (let attempt = 0; attempt < attempts; attempt++) {
        const c = await readCounters(id, { consistent: true }), delta = limitBytes - meta.limitBytes;
        if (delta < 0 && c.freeBytes < -delta) throw conflict(null, [], 'below');
        const sorted = [...c.shards].sort((a, b) => (delta > 0 ? a.free - b.free : b.free - a.free)); const moves = [];
        if (delta > 0) { const parts = sorted.slice(0, 4), each = Math.floor(delta / parts.length); parts.forEach((s, i) => moves.push({ n: s.n, amount: each + (i === 0 ? delta - each * parts.length : 0) })); }
        else { let left = -delta; for (const s of sorted) { if (left <= 0) break; const take = Math.min(s.free, left); if (take > 0) { moves.push({ n: s.n, amount: 0 - take, guard: take }); left -= take; } } }
        const metaCond = '#limitBytes = :old AND #status <> :deleting', metaSet = 'SET #limitBytes = :new, #limitGb = :gb, #updatedAt = :t';
        try {
          await once(new TransactWriteCommand({ TransactItems: [
            { Update: { TableName: table, Key: metaKey(id), UpdateExpression: metaSet, ConditionExpression: metaCond, ExpressionAttributeNames: names(metaSet, metaCond), ExpressionAttributeValues: { ':old': meta.limitBytes, ':new': limitBytes, ':gb': limitGb, ':t': stamp, ':deleting': 'deleting' } } },
            ...moves.map(m => ({ Update: { TableName: table, Key: shardKey(id, m.n), UpdateExpression: 'ADD #free :a', ConditionExpression: m.guard ? '#free >= :g' : 'attribute_exists(#free)', ExpressionAttributeNames: { '#free': 'free' }, ExpressionAttributeValues: { ':a': m.amount, ...(m.guard ? { ':g': m.guard } : {}) } } })),
          ] }));
          return strip((await send(new GetCommand({ TableName: table, Key: metaKey(id), ConsistentRead: true }))).Item);
        } catch (error) { if (!error.busy && !error.conflict) throw error; if (error.conflict && error.failed.includes(0)) throw conflict(error, error.failed, 'stale'); await backoff(attempt); }
      }
      throw busy(new Error('set limit retries exhausted'));
    },
    addOwner(id, meta, uid, stamp) {
      const u = 'ADD #owners :o SET #updatedAt = :t', c = 'attribute_exists(#pk) AND #status <> :deleting';
      return send(new TransactWriteCommand({ TransactItems: [
        { Update: { TableName: table, Key: metaKey(id), UpdateExpression: u, ConditionExpression: c, ExpressionAttributeNames: names(u, c), ExpressionAttributeValues: { ':o': new Set([uid]), ':t': stamp, ':deleting': 'deleting' } } },
        { Put: { TableName: table, Item: ownerEdge(id, uid, `${stamp13(meta.createdAt)}#${id}`) } },
      ] }));
    },
    removeOwner(id, uid, stamp) {
      const u = 'DELETE #owners :o SET #updatedAt = :t', c = 'attribute_exists(#pk) AND #status <> :deleting';
      return send(new TransactWriteCommand({ TransactItems: [
        { Update: { TableName: table, Key: metaKey(id), UpdateExpression: u, ConditionExpression: c, ExpressionAttributeNames: names(u, c), ExpressionAttributeValues: { ':o': new Set([uid]), ':t': stamp, ':deleting': 'deleting' } } },
        { Delete: { TableName: table, Key: { pk: pk(id), sk: `OWNER#${uid}` } } },
      ] }));
    },
    // GSI1: one uid's buckets, or all of them for an admin (uid null), newest first.
    async listBuckets({ uid, limit, cursor }) {
      const fixed = { gsi1pk: uid ? `OWNER#${uid}` : 'ALL' };
      const page = await query({ index: 'GSI1', keyExpr: '#gsi1pk = :p', values: { ':p': fixed.gsi1pk }, limit, cursor, fixed, allowed: ['gsi1sk', 'pk', 'sk'], check: k => k.pk.startsWith('BUCKET#'), forward: false });
      return { ids: page.items.map(i => i.pk.slice(7)), nextCursor: page.nextCursor };
    },
    async getPhoto(id, pid) { const { Item } = await send(new GetCommand({ TableName: table, Key: photoKey(id, pid), ConsistentRead: true })); return strip(Item); },
    // Upload time order, newest first unless oldest is asked for: by contributor through GSI1, the whole bucket through
    // GSI4. Nothing is read and then filtered in memory. GSIs are eventually consistent, so a new photo can take a moment.
    async listPhotos(id, { contributorId, limit, cursor, order = 'newest' }) {
      const forward = order === 'oldest';
      const page = contributorId
        ? await query({ index: 'GSI1', keyExpr: '#gsi1pk = :p', values: { ':p': `${pk(id)}#C#${contributorId}` }, limit, cursor, forward, fixed: { gsi1pk: `${pk(id)}#C#${contributorId}`, pk: pk(id) }, allowed: ['gsi1sk', 'sk'], check: k => k.sk.startsWith('PHOTO#') })
        : await query({ index: 'GSI4', keyExpr: '#gsi4pk = :p', values: { ':p': `${pk(id)}#P` }, limit, cursor, forward, fixed: { gsi4pk: `${pk(id)}#P`, pk: pk(id) }, allowed: ['gsi4sk', 'sk'], check: k => k.sk.startsWith('PHOTO#') });
      return { items: page.items.map(strip), nextCursor: page.nextCursor };
    },
    async commitPhoto({ bucketId: id, shards, photo, previous, stamp }) {
      // Checking backupState too keeps backupBytes exact: if the old photo's backup finished meanwhile, its size is re-read.
      const put = { TableName: table, Item: photoItem(id, photo), ConditionExpression: previous ? '#revision = :prev AND #backupState = :bs' : 'attribute_not_exists(#sk)', ExpressionAttributeNames: previous ? { '#revision': 'revision', '#backupState': 'backupState' } : { '#sk': 'sk' }, ...(previous ? { ExpressionAttributeValues: { ':prev': previous.revision, ':bs': previous.backupState } } : {}) };
      const items = [{ Put: put }];
      if (previous) {
        items.push({ Put: { TableName: table, Item: tombItem(id, previous, stamp) } });
        if (previous.restoredFromBackup) items.push({ Delete: { TableName: table, Key: deletedKey(id, `${previous.id}.${previous.uploadId}`) } });
      }
      const charge = { delta: photo.bytes - (previous?.bytes || 0), photos: previous ? 0 : 1, backup: 0 - (previous?.backupSize || 0), allow: previous ? 'live' : 'open' };
      await withShard(id, shards, charge, items);
    },
    // Rule for guests: the record goes and the quota is released in one transaction, with a tombstone so the file purge
    // that follows can be repeated. No other trace stays, not even an audit record from an earlier owner delete.
    purgePhoto: ({ bucketId: id, shards, photo, stamp }) => withShard(id, shards, { delta: 0 - photo.bytes, photos: -1, backup: 0 - (photo.backupSize || 0) }, [
      { Delete: removeLive(photo) },
      { Put: { TableName: table, Item: tombItem(id, photo, stamp) } },
      ...(photo.restoredFromBackup ? [{ Delete: { TableName: table, Key: deletedKey(id, `${photo.id}.${photo.uploadId}`) } }] : []),
    ]),
    // Rule for owners and admins: hidden and quota released, the audit record takes its place, the backup stays counted.
    // A record still unbacked stays in the BACKUP# index, so its backup can finish and be re-driven.
    hidePhoto({ bucketId: id, shards, photo, actor, stamp, earlier }) {
      const deletedId = `${photo.id}.${photo.uploadId}`, { updatedAt, ...rest } = photo;
      const Item = { ...deletedKey(id, deletedId), ...rest, deletedId, actorUid: actor.uid, actorRole: actor.isAdmin ? 'admin' : 'owner', deletedAt: stamp, ...(earlier?.length ? { earlier } : {}), ...unbackedKeys(id, photo) };
      return withShard(id, shards, { delta: 0 - photo.bytes, photos: -1 }, [{ Delete: removeLive(photo) }, { Put: { TableName: table, Item } }]);
    },
    async listDeleted(id, { limit, cursor }) {
      const page = await query({ keyExpr: '#pk = :p AND begins_with(#sk, :s)', values: { ':p': pk(id), ':s': 'DELETED#' }, limit, cursor, fixed: { pk: pk(id) }, allowed: ['sk'], check: k => k.sk.startsWith('DELETED#'), consistent: true });
      return { items: page.items.map(strip), nextCursor: page.nextCursor };
    },
    async getDeleted(id, deletedId) { const { Item } = await send(new GetCommand({ TableName: table, Key: deletedKey(id, deletedId), ConsistentRead: true })); return strip(Item); },
    // The photo comes back as its quality-80 backup. The record stays as the audit trail, marked restored.
    restorePhoto({ bucketId: id, shards, deleted, actor, stamp }) {
      const { deletedId, deletedAt, actorUid, actorRole, earlier, restoredAt, restoredBy, lateBackupAt, ...photo } = deleted;
      const bytes = photo.backupSize + (photo.thumbSize || 0), u = 'SET #restoredAt = :t, #restoredBy = :by', c = 'attribute_exists(#sk) AND attribute_not_exists(#restoredAt)';
      return withShard(id, shards, { delta: bytes, photos: 1, allow: 'live' }, [
        { Update: { TableName: table, Key: deletedKey(id, deletedId), UpdateExpression: u, ConditionExpression: c, ExpressionAttributeNames: names(u, c), ExpressionAttributeValues: { ':t': stamp, ':by': actor.uid } } },
        { Put: { TableName: table, Item: photoItem(id, { ...photo, size: photo.backupSize, bytes, restoredFromBackup: true, revision: photo.revision + 1, updatedAt: stamp }), ConditionExpression: 'attribute_not_exists(#sk)', ExpressionAttributeNames: { '#sk': 'sk' } } },
      ]);
    },
    // The transaction only records a backup if the photo still points at the file that was backed up.
    // deletedId set means the owner deleted the photo before its backup finished: the record is that audit record.
    recordBackup({ bucketId: id, shards, photoId, deletedId, imageKey, backupKey, backupSize, stamp }) {
      const u = `SET #backupKey = :k, #backupSize = :s, #backupState = :done, #backupAt = :t${deletedId ? ', #lateBackupAt = :t' : ''} REMOVE #gsi2pk, #gsi2sk, #gsi3pk, #gsi3sk, #backupError`, c = '#imageKey = :i AND #backupState <> :done';
      return withShard(id, shards, { backup: backupSize }, [{ Update: { TableName: table, Key: deletedId ? deletedKey(id, deletedId) : photoKey(id, photoId), UpdateExpression: u, ConditionExpression: c, ExpressionAttributeNames: names(u, c), ExpressionAttributeValues: { ':k': backupKey, ':s': backupSize, ':done': 'done', ':t': stamp, ':i': imageKey } } }]);
    },
    async markBackupFailed({ bucketId: id, photo, deletedId, reason }) {
      const u = 'SET #backupState = :f, #backupError = :e, #gsi2sk = :g, #gsi3pk = :gp, #gsi3sk = :gs ADD #backupAttempts :one', c = '#imageKey = :i AND #backupState <> :done';
      await send(new UpdateCommand({ TableName: table, Key: deletedId ? deletedKey(id, deletedId) : photoKey(id, photo.id), UpdateExpression: u, ConditionExpression: c, ExpressionAttributeNames: names(u, c), ExpressionAttributeValues: { ':f': 'failed', ':e': String(reason).slice(0, 200), ':g': `failed#${stamp13(photo.createdAt)}#${photo.id}`, ':gp': 'FAILED', ':gs': failedKeys(id, photo).gsi3sk, ':one': 1, ':i': photo.imageKey, ':done': 'done' } })).catch(error => { if (!error.conflict) throw error; });
    },
    async backupCounts(id) {
      const count = async state => {
        let total = 0, ExclusiveStartKey;
        do {
          const page = await send(new QueryCommand({ TableName: table, IndexName: 'GSI2', KeyConditionExpression: '#gsi2pk = :p AND begins_with(#gsi2sk, :s)', ExpressionAttributeNames: names('#gsi2pk #gsi2sk'), ExpressionAttributeValues: { ':p': `BACKUP#${id}`, ':s': `${state}#` }, Select: 'COUNT', ExclusiveStartKey }));
          total += page.Count; ExclusiveStartKey = page.LastEvaluatedKey;
        } while (ExclusiveStartKey);
        return total;
      };
      const [pending, failed] = await Promise.all([count('pending'), count('failed')]);
      return { pending, failed, unbacked: pending + failed };
    },
    // Platform-wide, for the admin overview. Failed backups are few, so reading them all is cheap. No expired row is possible: purges delete them.
    async failedBackupCounts() {
      const byBucket = new Map(); let ExclusiveStartKey;
      do {
        const page = await send(new QueryCommand({ TableName: table, IndexName: 'GSI3', KeyConditionExpression: '#gsi3pk = :p', ExpressionAttributeNames: names('#gsi3pk'), ExpressionAttributeValues: { ':p': 'FAILED' }, ExclusiveStartKey }));
        for (const item of page.Items) { const id = item.pk.slice(7); byBucket.set(id, (byBucket.get(id) || 0) + 1); }
        ExclusiveStartKey = page.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return { failed: [...byBucket.values()].reduce((a, b) => a + b, 0), buckets: [...byBucket].map(([bucketId, failed]) => ({ bucketId, failed })) };
    },
    async listUnbacked(id, { limit, cursor }) {
      const fixed = { gsi2pk: `BACKUP#${id}`, pk: pk(id) };
      const page = await query({ index: 'GSI2', keyExpr: '#gsi2pk = :p', values: { ':p': fixed.gsi2pk }, limit, cursor, fixed, allowed: ['gsi2sk', 'sk'], check: k => /^(PHOTO|DELETED)#/.test(k.sk) });
      return { items: page.items.map(i => ({ imageKey: i.imageKey })), nextCursor: page.nextCursor };
    },
    // Fixed-window counter. Over the limit raises a conflict; the handler turns that into 429.
    rateHit({ bucketId: id, key, max, windowMs, now }) {
      const windowStart = Math.floor(now / windowMs) * windowMs, c = 'attribute_not_exists(#n) OR #n < :max', u = 'ADD #n :one SET #ttl = :ttl';
      return send(new UpdateCommand({ TableName: table, Key: { pk: pk(id), sk: `RATE#${key}#${windowStart}` }, UpdateExpression: u, ConditionExpression: c, ExpressionAttributeNames: names(u, c), ExpressionAttributeValues: { ':one': 1, ':max': max, ':ttl': Math.floor((windowStart + windowMs) / 1000) + 3600 } }));
    },
    // Guest display names, one item per contributor in the bucket's partition, so a bucket purge removes them too.
    async getContributorName(id, contributorId) { const { Item } = await send(new GetCommand({ TableName: table, Key: { pk: pk(id), sk: `CONTRIB#${contributorId}` }, ConsistentRead: true })); return Item?.name; },
    setContributorName: (id, contributorId, name, stamp) => send(new PutCommand({ TableName: table, Item: { pk: pk(id), sk: `CONTRIB#${contributorId}`, name, updatedAt: stamp } })),
    // Event songs: one record per Firestore event id, outside any bucket.
    async getSong(eventId) { const { Item } = await send(new GetCommand({ TableName: table, Key: { pk: `EVENT#${eventId}`, sk: 'SONG' }, ConsistentRead: true })); return strip(Item); },
    putSong: song => send(new PutCommand({ TableName: table, Item: { pk: `EVENT#${song.eventId}`, sk: 'SONG', ...song } })),
    deleteSong: eventId => send(new DeleteCommand({ TableName: table, Key: { pk: `EVENT#${eventId}`, sk: 'SONG' } })),
    // --- Used by the sweeps only ---
    async markDeleting(id, meta, { stamp, by, queue }) {
      const fields = { status: 'deleting', deleteRequestedAt: meta.deleteRequestedAt || stamp, updatedAt: stamp, ...(by ? { deleteRequestedBy: by } : {}), ...(queue ? { gsi2pk: 'PURGE', gsi2sk: `${stamp13(stamp)}#${id}` } : {}) };
      const { Attributes } = await send(new UpdateCommand(setFields(metaKey(id), fields)));
      await setShardStates(id, Attributes.shards, 'closed');
      return strip(Attributes);
    },
    async listExpiredDemos({ now, limit = 100, cursor }) {
      const fixed = { gsi2pk: 'DEMO' };
      const page = await query({ index: 'GSI2', keyExpr: '#gsi2pk = :p AND #gsi2sk <= :t', values: { ':p': 'DEMO', ':t': `${stamp13(now)}~` }, limit, cursor, fixed, allowed: ['gsi2sk', 'pk', 'sk'] });
      return { ids: page.items.map(i => i.pk.slice(7)), nextCursor: page.nextCursor };
    },
    async listPurgeQueue({ limit = 100, cursor }) {
      const fixed = { gsi2pk: 'PURGE' };
      const page = await query({ index: 'GSI2', keyExpr: '#gsi2pk = :p', values: { ':p': 'PURGE' }, limit, cursor, fixed, allowed: ['gsi2sk', 'pk', 'sk'] });
      return { ids: page.items.map(i => i.pk.slice(7)), nextCursor: page.nextCursor };
    },
    // Also used for copies left by a refused commit: the sweep removes them unless some photo or record owns the upload by then.
    addTombstone: (id, photo, stamp) => send(new PutCommand({ TableName: table, Item: tombItem(id, photo, stamp) })),
    async getTombstone(id, tombId) { const { Item } = await send(new GetCommand({ TableName: table, Key: { pk: pk(id), sk: `TOMB#${tombId}` }, ConsistentRead: true })); return Item; },
    async listDueTombstones({ now, limit = 100, cursor }) {
      const fixed = { gsi2pk: 'PHOTOPURGE' };
      const page = await query({ index: 'GSI2', keyExpr: '#gsi2pk = :p AND #gsi2sk <= :t', values: { ':p': 'PHOTOPURGE', ':t': `${stamp13(now)}~` }, limit, cursor, fixed, allowed: ['gsi2sk', 'pk', 'sk'] });
      return { items: page.items.map(i => { const [photoId, uploadId] = i.sk.slice(5).split('.'); return { tombstoneId: `${i.pk.slice(7)}/${photoId}.${uploadId}`, bucketId: i.pk.slice(7), key: { pk: i.pk, sk: i.sk } }; }), nextCursor: page.nextCursor };
    },
    async listBucketItems(id, cursor) {
      const page = await query({ keyExpr: '#pk = :p', values: { ':p': pk(id) }, limit: 1000, cursor, fixed: { pk: pk(id) }, allowed: ['sk'], consistent: true, project: '#pk, #sk' });
      return { keys: page.items.filter(i => i.sk !== 'META').map(({ pk: p, sk }) => ({ pk: p, sk })), nextCursor: page.nextCursor };
    },
    async deleteItems(keys) {
      for (let i = 0; i < keys.length; i += 25) {
        let RequestItems = { [table]: keys.slice(i, i + 25).map(Key => ({ DeleteRequest: { Key } })) };
        for (let attempt = 0, left = RequestItems[table].length; RequestItems?.[table]?.length; attempt++) {
          ({ UnprocessedItems: RequestItems } = await send(new BatchWriteCommand({ RequestItems })));
          const now = RequestItems?.[table]?.length || 0;
          if (now < left) { attempt = -1; left = now; continue; } // progress, so the retry budget starts over
          if (now) { if (attempt >= attempts) throw busy(new Error('batch write')); await backoff(attempt); }
        }
      }
    },
    deleteMeta: id => send(new DeleteCommand({ TableName: table, Key: metaKey(id) })),
  };
}
