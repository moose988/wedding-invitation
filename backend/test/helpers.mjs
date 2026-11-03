// In-memory stand-ins for DynamoDB and S3. The real store.mjs runs against FakeDynamo: expressions are parsed and
// evaluated, so a wrong condition or an unaliased attribute fails here instead of in AWS. Transactions hold item locks
// for a simulated latency, so overlapping writers get real TransactionCanceledException/TransactionConflict behaviour.
import sharp from 'sharp';
import { createHandler } from '../src/handler.mjs';
import { purgeTombstone } from '../src/purge.mjs';
import { createStore } from '../src/store.mjs';

const tokenize = text => text.match(/#\w+|:\w+|<>|<=|>=|[=<>(),]|[A-Za-z_]\w*/g) || [];
function parseCondition(text, ctx) {
  const t = tokenize(text); let i = 0;
  const operand = () => {
    const tok = t[i++];
    if (tok?.startsWith('#')) return { path: name(tok, ctx) };
    if (tok?.startsWith(':')) return { value: value(tok, ctx) };
    throw validation(`bad operand ${tok} in ${text}`);
  };
  const primary = () => {
    if (t[i] === '(') { i += 1; const e = or(); i += 1; return e; }
    if (t[i]?.toUpperCase() === 'NOT') { i += 1; const e = primary(); return item => !e(item); }
    if (['attribute_exists', 'attribute_not_exists', 'begins_with'].includes(t[i])) {
      const fn = t[i]; i += 2; const a = operand(); let b; if (t[i] === ',') { i += 1; b = operand(); } i += 1;
      if (fn === 'attribute_exists') return item => item?.[a.path] !== undefined;
      if (fn === 'attribute_not_exists') return item => item?.[a.path] === undefined;
      return item => typeof item?.[a.path] === 'string' && item[a.path].startsWith(b.value);
    }
    if (t[i] && !t[i].startsWith('#') && !t[i].startsWith(':')) throw validation(`unaliased attribute ${t[i]} in ${text}`);
    const left = operand(), op = t[i++], right = operand();
    const read = (o, item) => (o.path ? item?.[o.path] : o.value);
    return item => {
      const l = read(left, item), r = read(right, item);
      if (op === '<>') return l !== r;
      if (l === undefined || r === undefined) return false;
      if (op === '=') return l === r;
      if (op === '<') return l < r; if (op === '<=') return l <= r; if (op === '>') return l > r; if (op === '>=') return l >= r;
      throw validation(`bad operator ${op}`);
    };
  };
  const and = () => { let e = primary(); while (t[i]?.toUpperCase() === 'AND') { i += 1; const l = e, r = primary(); e = item => l(item) && r(item); } return e; };
  const or = () => { let e = and(); while (t[i]?.toUpperCase() === 'OR') { i += 1; const l = e, r = and(); e = item => l(item) || r(item); } return e; };
  const out = or();
  if (i !== t.length) throw validation(`trailing tokens in ${text}`);
  return out;
}
const validation = message => Object.assign(new Error(message), { name: 'ValidationException' });
const name = (token, ctx) => { ctx.usedNames.add(token); const n = ctx.names?.[token]; if (!n) throw validation(`missing name ${token}`); return n; };
const value = (token, ctx) => { ctx.usedValues.add(token); if (!ctx.values || !(token in ctx.values)) throw validation(`missing value ${token}`); return ctx.values[token]; };
function parseUpdate(text, ctx) {
  const ops = [], parts = text.split(/\b(SET|ADD|REMOVE|DELETE)\b/).slice(1);
  for (let p = 0; p < parts.length; p += 2) {
    const kind = parts[p];
    for (const clause of parts[p + 1].split(',').map(s => s.trim()).filter(Boolean)) {
      const t = tokenize(clause);
      if (!t[0].startsWith('#')) throw validation(`unaliased attribute ${t[0]} in ${text}`);
      if (kind === 'SET') { const n = name(t[0], ctx), v = value(t[2], ctx); ops.push(item => { item[n] = v; }); }
      if (kind === 'ADD') { const n = name(t[0], ctx), v = value(t[1], ctx); ops.push(item => { if (v instanceof Set) item[n] = new Set([...(item[n] || []), ...v]); else item[n] = (item[n] ?? 0) + v; }); }
      if (kind === 'DELETE') { const n = name(t[0], ctx), v = value(t[1], ctx); ops.push(item => { if (!item[n]) return; const left = [...item[n]].filter(x => !v.has(x)); if (left.length) item[n] = new Set(left); else delete item[n]; }); }
      if (kind === 'REMOVE') { const n = name(t[0], ctx); ops.push(item => { delete item[n]; }); }
    }
  }
  return item => ops.forEach(op => op(item));
}
const context = input => ({ names: input.ExpressionAttributeNames, values: input.ExpressionAttributeValues, usedNames: new Set(), usedValues: new Set() });
function closeContext(ctx) { // DynamoDB rejects names and values an expression does not use
  for (const k of Object.keys(ctx.names || {})) if (!ctx.usedNames.has(k)) throw validation(`unused name ${k}`);
  for (const k of Object.keys(ctx.values || {})) if (!ctx.usedValues.has(k)) throw validation(`unused value ${k}`);
}
const copy = item => { if (!item) return item; const out = {}; for (const [k, v] of Object.entries(item)) if (v !== undefined) out[k] = v instanceof Set ? new Set(v) : v; return out; };
const id = key => `${key.pk}\u0000${key.sk}`;
const sortOn = field => (a, b) => (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : a.pk < b.pk ? -1 : a.pk > b.pk ? 1 : a.sk < b.sk ? -1 : a.sk > b.sk ? 1 : 0);
function checkItem(item) {
  for (const [k, v] of Object.entries(item)) {
    if (v instanceof Set && !v.size) throw validation(`empty set ${k}`);
    if (['gsi1pk', 'gsi1sk', 'gsi2pk', 'gsi2sk', 'gsi3pk', 'gsi3sk', 'pk', 'sk'].includes(k) && (typeof v !== 'string' || !v)) throw validation(`bad key ${k}`);
  }
}

export class FakeDynamo {
  constructor({ latency = () => 0, hold = () => 0, conflictRate = 0, random = Math.random } = {}) {
    Object.assign(this, { items: new Map(), locks: new Set(), latency, hold, conflictRate, random, stats: { transactions: 0, conflicts: 0, conditionFailures: 0, sends: 0 } });
  }
  async wait(ms) { if (ms > 0) await new Promise(r => setTimeout(r, ms)); else await new Promise(r => setImmediate(r)); }
  put(item) { this.items.set(id(item), copy(item)); }
  dump() { return [...this.items.values()].map(copy); }
  async send(command) {
    this.stats.sends += 1;
    const kind = command.constructor.name, input = command.input;
    await this.wait(this.latency());
    if (kind === 'GetCommand') return { Item: copy(this.items.get(id(input.Key))) };
    if (kind === 'BatchGetCommand') { const [[table, { Keys }]] = Object.entries(input.RequestItems); return { Responses: { [table]: Keys.map(k => copy(this.items.get(id(k)))).filter(Boolean) }, UnprocessedKeys: {} }; }
    if (kind === 'BatchWriteCommand') { const [[table, list]] = Object.entries(input.RequestItems); if (list.length > 25) throw validation('batch too big'); const [first, ...rest] = list; if (first) this.items.delete(id(first.DeleteRequest.Key)); return { UnprocessedItems: rest.length ? { [table]: rest } : {} }; }
    if (kind === 'QueryCommand') return this.query(input);
    if (kind === 'TransactWriteCommand') return this.transact(input);
    if (kind === 'PutCommand' || kind === 'UpdateCommand' || kind === 'DeleteCommand') {
      const key = input.Key || { pk: input.Item.pk, sk: input.Item.sk };
      if (this.locks.has(id(key))) throw Object.assign(new Error('in tx'), { name: 'TransactionConflictException' });
      const apply = this.prepare(kind.replace('Command', ''), input);
      if (!apply.check()) { this.stats.conditionFailures += 1; throw Object.assign(new Error('failed'), { name: 'ConditionalCheckFailedException' }); }
      return { Attributes: apply.run() };
    }
    throw new Error(`Fake does not support ${kind}`);
  }
  prepare(kind, input) {
    const key = input.Key || { pk: input.Item.pk, sk: input.Item.sk }, ctx = context(input);
    const cond = input.ConditionExpression ? parseCondition(input.ConditionExpression, ctx) : () => true;
    const update = kind === 'Update' ? parseUpdate(input.UpdateExpression, ctx) : null;
    closeContext(ctx);
    return {
      key,
      check: () => cond(this.items.get(id(key))),
      run: () => {
        if (kind === 'Put') { checkItem(input.Item); this.items.set(id(key), copy(input.Item)); return undefined; }
        if (kind === 'Delete') { this.items.delete(id(key)); return undefined; }
        const item = copy(this.items.get(id(key))) || { ...key }; update(item); checkItem(item); this.items.set(id(key), item);
        return input.ReturnValues === 'ALL_NEW' ? copy(item) : undefined;
      },
    };
  }
  async transact({ TransactItems }) {
    if (TransactItems.length > 100) throw validation('too many transaction items');
    this.stats.transactions += 1;
    const ops = TransactItems.map(entry => { const [kind, input] = Object.entries(entry)[0]; return this.prepare(kind, input); });
    if (new Set(ops.map(o => id(o.key))).size !== ops.length) throw validation('Transaction request cannot include multiple operations on one item');
    const cancel = reasons => Object.assign(new Error('cancelled'), { name: 'TransactionCanceledException', CancellationReasons: reasons });
    const clash = ops.findIndex(o => this.locks.has(id(o.key)));
    const injected = this.random() < this.conflictRate;
    if (clash >= 0 || injected) { this.stats.conflicts += 1; throw cancel(ops.map((_, i) => ({ Code: i === (clash >= 0 ? clash : 0) ? 'TransactionConflict' : 'None' }))); }
    ops.forEach(o => this.locks.add(id(o.key)));
    try {
      await this.wait(this.hold());
      const failed = ops.map(o => !o.check());
      if (failed.some(Boolean)) { this.stats.conditionFailures += 1; throw cancel(failed.map(f => ({ Code: f ? 'ConditionalCheckFailed' : 'None' }))); }
      ops.forEach(o => o.run());
      return {};
    } finally { ops.forEach(o => this.locks.delete(id(o.key))); }
  }
  query(input) {
    const ctx = context(input), matches = parseCondition(input.KeyConditionExpression, ctx);
    for (const token of tokenize(input.ProjectionExpression || '')) if (token.startsWith('#')) name(token, ctx);
    closeContext(ctx);
    const field = input.IndexName === 'GSI1' ? 'gsi1sk' : input.IndexName === 'GSI2' ? 'gsi2sk' : input.IndexName === 'GSI3' ? 'gsi3sk' : 'sk';
    const hash = input.IndexName === 'GSI1' ? 'gsi1pk' : input.IndexName === 'GSI2' ? 'gsi2pk' : input.IndexName === 'GSI3' ? 'gsi3pk' : 'pk';
    let rows = [...this.items.values()].filter(i => i[hash] !== undefined && i[field] !== undefined && matches(i)).sort(sortOn(field));
    if (input.ScanIndexForward === false) rows.reverse();
    if (input.ExclusiveStartKey) {
      const s = input.ExclusiveStartKey; if (s[hash] !== rows[0]?.[hash] && rows.length) throw validation('start key outside query boundaries');
      const at = rows.findIndex(r => r.pk === s.pk && r.sk === s.sk);
      rows = at >= 0 ? rows.slice(at + 1) : rows.filter(r => (input.ScanIndexForward === false ? sortOn(field)(r, s) < 0 : sortOn(field)(r, s) > 0));
    }
    const limited = input.Limit ? rows.slice(0, input.Limit) : rows;
    const last = input.Limit && limited.length === input.Limit ? limited.at(-1) : null;
    const lek = last ? (input.IndexName ? { [hash]: last[hash], [field]: last[field], pk: last.pk, sk: last.sk } : { pk: last.pk, sk: last.sk }) : undefined;
    if (input.Select === 'COUNT') return { Count: limited.length, LastEvaluatedKey: lek };
    return { Items: limited.map(copy), LastEvaluatedKey: lek };
  }
}

// S3 with versioning: a plain delete only adds a delete marker; purge removes versions. Objects can claim a large size
// while holding only a small header, so 20 MB uploads cost nothing to simulate.
export function fakeFiles() {
  const photos = new Map(), backups = new Map(), events = [], touched = [], ranges = [];
  const current = (map, key) => { const v = map.get(key)?.at(-1); return v && !v.marker ? v : null; };
  const add = (map, key, entry) => { if (!map.has(key)) map.set(key, []); map.get(key).push(entry); };
  const files = {
    photos, backups, events, touched, ranges, current: key => current(photos, key), currentBackup: key => current(backups, key),
    store: (key, buffer, size = buffer.length) => add(photos, key, { body: buffer, size }),
    presignPut: async (key, size) => ({ url: `put://${key}`, headers: {}, size }),
    presignGet: async (key, options) => `get://${key}${options?.contentType ? `#${options.contentType}` : ''}`,
    presignPutAudio: async (key, size) => ({ url: `put://${key}`, headers: { 'content-type': 'audio/mpeg' }, size }),
    purgeAudio: async (prefix, keep) => { if (!/^audio\/[^/]+\/$/.test(prefix)) throw new Error('bad prefix'); for (const k of [...photos.keys()]) if (k.startsWith(prefix) && k !== keep) photos.delete(k); },
    head: async key => { const v = current(photos, key); return v ? { size: v.size } : null; },
    readRange: async (key, length, start = 0) => { ranges.push(length); const v = current(photos, key); return v ? v.body.subarray(start, start + length) : null; },
    readTail: async (key, length) => { const v = current(photos, key); return v ? v.body.subarray(Math.max(0, v.body.length - length)) : null; },
    readFull: async key => current(photos, key)?.body || null,
    copy: async (from, to) => { const v = current(photos, from); if (!v) return false; add(photos, to, { ...v }); events.push(to); return true; },
    touch: async key => { const v = current(photos, key); if (v) { add(photos, key, { ...v }); events.push(key); touched.push(key); } },
    restoreFromBackup: async (backupKey, imageKey) => { const v = current(backups, backupKey); if (!v) return false; add(photos, imageKey, { ...v }); events.push(imageKey); return true; },
    putBackup: async (key, body) => add(backups, key, { body, size: body.length }),
    remove: async keys => { keys.filter(Boolean).forEach(k => add(photos, k, { marker: true })); },
    purgeKeys: async (target, keys) => { const map = target === 'backups' ? backups : photos; keys.forEach(k => map.delete(k)); },
    purge: async (target, prefix, hasTime = () => true) => {
      if (!/^(buckets|incoming)\/[a-z0-9-]+\/$/.test(prefix)) throw new Error('bad prefix');
      const map = target === 'backups' ? backups : photos;
      for (const key of [...map.keys()].filter(k => k.startsWith(prefix))) { if (!hasTime()) return false; map.delete(key); }
      return true;
    },
  };
  return files;
}

export const jpeg = (w = 800, h = 600, color = '#c33') => sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg({ quality: 90 }).toBuffer();
export const SECRET = 'x'.repeat(40), ADMIN = 'admin-uid', CUSTOMER = 'customer-uid', details = { name: 'Test Event', date: '2026-12-01', location: 'Amman' };

export function harness({ dynamo = new FakeDynamo(), clock, mintPerBucket, mintPerIp, files = fakeFiles() } = {}) {
  const now = clock || Date.now;
  const store = createStore({ client: dynamo, table: 'test' });
  const tokens = { 'admin-token': ADMIN, 'customer-token': CUSTOMER, 'other-token': 'other-uid', 'stranger-token': 'stranger' };
  const handler = createHandler({ store, files, purgePhotoFiles: tombstoneId => purgeTombstone({ store, files, tombstoneId }), secret: SECRET, adminUids: [ADMIN], now, mintPerBucket, mintPerIp, verifyOwner: async t => { if (!tokens[t]) throw new Error('bad'); return tokens[t]; } });
  const call = async (method, path, { token, body, query, ip } = {}) => {
    const r = await handler({ requestContext: { http: { method, sourceIp: ip } }, rawPath: path, queryStringParameters: query, headers: token ? { authorization: `Bearer ${token}` } : {}, body: body && JSON.stringify(body) });
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null, headers: r.headers };
  };
  const put = async (grant, pid, bid, image, thumb) => {
    files.store(`incoming/${bid}/${pid}/${grant.uploadId}.jpg`, Buffer.isBuffer(image) ? image : image.buffer, Buffer.isBuffer(image) ? image.length : image.size);
    files.store(`incoming/${bid}/${pid}/${grant.uploadId}.thumb`, thumb);
  };
  const upload = async (token, bid, pid, image, thumb, extra = {}) => {
    const grant = await call('POST', `/b/${bid}/uploads`, { token, body: { photoId: pid, size: image.size || image.length, thumbSize: thumb.length, ...extra } });
    if (grant.status === 200 && !grant.body.exists) await put(grant.body, pid, bid, image, thumb);
    return grant;
  };
  const createBucket = async (body = {}, token = 'admin-token') => (await call('POST', '/owner/create', { token, body: { ...details, gb: 15, owners: [CUSTOMER], ...body } }));
  return { dynamo, files, store, handler, call, upload, createBucket };
}
export const pages = async (call, path, options = {}) => {
  const items = []; let cursor;
  do {
    const r = await call('GET', path, { ...options, query: { ...options.query, ...(cursor ? { cursor } : {}) } });
    if (r.status !== 200) throw new Error(`${path} returned ${r.status}: ${JSON.stringify(r.body)}`);
    items.push(...r.body.items); cursor = r.body.nextCursor;
  } while (cursor);
  return items;
};
export function counterTotals(dynamo, bucketId) {
  const shards = dynamo.dump().filter(i => i.pk === `BUCKET#${bucketId}` && i.sk.startsWith('COUNTER#'));
  const sum = f => shards.reduce((t, s) => t + (s[f] || 0), 0);
  return { free: sum('free'), bytes: sum('bytes'), photos: sum('photos'), backupBytes: sum('backupBytes'), minFree: Math.min(...shards.map(s => s.free)), shardCount: shards.length };
}
