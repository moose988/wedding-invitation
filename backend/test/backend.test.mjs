import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import sharp from 'sharp';
import { parse } from 'yaml';
import { compress, createBackupHandler } from '../src/backup.mjs';
import { LIMITS, hasJpegEnd, jpegSize, parseImageKey, signGuestToken, validBucketId, verifyGuestToken } from '../src/lib.mjs';
import { createClients } from '../src/clients.mjs';
import { createFiles } from '../src/files.mjs';
import { createPurgeInvoker } from '../src/invoke.mjs';
import { createDemoSweep, createAdminSweep, purgeTombstone } from '../src/purge.mjs';
import { BUCKET_SIZES_GB, DEMO_EXPIRY_HOURS, bytesForGb, estimatePhotos, overdueInfo } from '../src/sizes.mjs';
import { classify, createStore } from '../src/store.mjs';
import { CUSTOMER, FakeDynamo, SECRET, counterTotals, details, fakeFiles, harness, jpeg, pages } from './helpers.mjs';

async function ready(h, body) {
  const created = await h.createBucket(body); assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;
  const a = (await h.call('POST', `/b/${id}/guest`)).body, b = (await h.call('POST', `/b/${id}/guest`)).body;
  return { id, a, b };
}
async function commitOne(h, token, id, pid, image, thumb, extra = {}, commitBody = {}) {
  const grant = await h.upload(token, id, pid, image, thumb, extra);
  assert.equal(grant.status, 200, JSON.stringify(grant.body));
  return h.call('POST', `/b/${id}/photos/${pid}/commit`, { token, body: { uploadId: grant.body.uploadId, ...commitBody } });
}

const s3Message = (key, eventTime) => ({ messageId: key, body: JSON.stringify({ Records: [{ eventTime, s3: { object: { key: encodeURIComponent(key).replaceAll('%2F', '/') } } }] }) });

// ---------- tokens and JPEG ----------
test('guest tokens verify and reject tampering or expiry', () => {
  const token = signGuestToken(SECRET, 'b1', 'c1', 1000);
  assert.deepEqual(verifyGuestToken(SECRET, token, 2000), { bucketId: 'b1', contributorId: 'c1' });
  assert.equal(verifyGuestToken('y'.repeat(40), token, 2000), null);
  assert.equal(verifyGuestToken(SECRET, token.slice(0, -2) + 'AA', 2000), null);
  assert.equal(verifyGuestToken(SECRET, token, 1000 + (LIMITS.guestTokenSeconds + 5) * 1000), null);
});
test('jpegSize reads real JPEGs and rejects other formats', async () => {
  assert.deepEqual(jpegSize(await jpeg(321, 123)), { width: 321, height: 123 });
  assert.equal(jpegSize(await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).png().toBuffer()), null);
  assert.equal(jpegSize(Buffer.from('not an image')), null);
});

// ---------- sizes ----------
test('sizes and the photo estimate', () => {
  assert.deepEqual(BUCKET_SIZES_GB, [15, 20, 25, 30, 35, 40, 45, 50]);
  assert.equal(bytesForGb(15), 15 * 1024 ** 3);
  assert.deepEqual(BUCKET_SIZES_GB.map(estimatePhotos), [4096, 5461, 6826, 8192, 9557, 10922, 12288, 13653]);
  assert.equal(estimatePhotos(1), 273);
});
test('size is admin-selected from the allowed list and validated', async () => {
  const h = harness();
  for (const gb of [undefined, 10, 17, 55, '15', 15.5]) assert.equal((await h.createBucket({ gb })).status, 400, String(gb));
  const made = await h.createBucket({ gb: 25 }); assert.equal(made.status, 201); assert.equal(made.body.limitBytes, 25 * 1024 ** 3);
  const id = made.body.id, totals = () => counterTotals(h.dynamo, id);
  assert.equal(totals().free + totals().bytes, 25 * 1024 ** 3);
  assert.equal((await h.call('PUT', `/b/${id}/size`, { token: 'customer-token', body: { gb: 50 } })).status, 403);
  assert.equal((await h.call('PUT', `/b/${id}/size`, { token: 'admin-token', body: { gb: 16 } })).status, 400);
  const bigger = await h.call('PUT', `/b/${id}/size`, { token: 'admin-token', body: { gb: 50 } });
  assert.equal(bigger.body.limitBytes, 50 * 1024 ** 3); assert.equal(totals().free, 50 * 1024 ** 3);
  const smaller = await h.call('PUT', `/b/${id}/size`, { token: 'admin-token', body: { gb: 15 } });
  assert.equal(smaller.body.limitGb, 15); assert.equal(totals().free, 15 * 1024 ** 3);
});
test('size cannot shrink below what is stored', async () => {
  const h = harness(); const { id } = await ready(h, { gb: 20 });
  let used = 16 * 1024 ** 3; // simulate 16 GB in use without storing that much
  for (const s of h.dynamo.dump().filter(i => i.pk === `BUCKET#${id}` && i.sk.startsWith('COUNTER#'))) { const spend = Math.min(used, s.free); used -= spend; h.dynamo.put({ ...s, free: s.free - spend, bytes: spend }); }
  const small = await h.call('PUT', `/b/${id}/size`, { token: 'admin-token', body: { gb: 15 } });
  assert.equal(small.status, 409); assert.equal(small.body.code, 'SIZE_BELOW_USAGE');
  const t = counterTotals(h.dynamo, id); assert.equal(t.free + t.bytes, 20 * 1024 ** 3);
  assert.equal((await h.call('PUT', `/b/${id}/size`, { token: 'admin-token', body: { gb: 45 } })).body.limitGb, 45);
  const big = counterTotals(h.dynamo, id); assert.equal(big.free + big.bytes, 45 * 1024 ** 3);
});
test('overdue is derived from the event date and only shown to admins', async () => {
  assert.equal(overdueInfo('2026-11-01', Date.parse('2026-11-04T00:00:00Z')).overdue, false);
  assert.equal(overdueInfo('2026-11-01', Date.parse('2026-11-04T00:00:01Z')).overdue, true);
  let now = Date.parse('2026-12-05T00:00:00Z');
  const h = harness({ clock: () => now }); const { id } = await ready(h);
  const admin = await h.call('GET', `/b/${id}`, { token: 'admin-token' });
  assert.equal(admin.body.overdue, true); assert.equal(admin.body.overdueAt, Date.parse('2026-12-04T00:00:00Z'));
  assert.equal((await h.call('GET', `/b/${id}`, { token: 'customer-token' })).body.overdue, undefined);
  now += 400 * 86400000; // a year on it is still only a flag
  await createDemoSweep({ store: h.store, files: h.files, now: () => now })();
  await createAdminSweep({ store: h.store, files: h.files })();
  assert.equal((await h.call('GET', `/b/${id}`, { token: 'admin-token' })).status, 200);
});

// ---------- creating and isolation ----------
test('only admins create buckets; ids are server-generated and every create is a new bucket', async () => {
  const h = harness();
  assert.equal((await h.call('POST', '/owner/create', { body: { ...details, gb: 15 } })).status, 401);
  assert.equal((await h.createBucket({}, 'customer-token')).status, 403);
  assert.equal((await h.createBucket({ date: '2026-02-31' })).status, 400);
  assert.equal((await h.createBucket({ owners: 'nope' })).status, 400);
  assert.equal((await h.createBucket({ owners: ['bad uid!'] })).status, 400);
  const one = await h.createBucket({ id: 'client-chosen', bucketId: 'client-chosen' }), two = await h.createBucket();
  assert.equal(one.status, 201); assert.equal(two.status, 201);
  assert.notEqual(one.body.id, two.body.id); assert.match(one.body.id, /^b-[a-f0-9]{32}$/);
  assert.equal((await h.call('GET', `/b/${one.body.id}/public`)).body.name, details.name);
  assert.equal((await h.call('GET', '/b/other/public')).status, 404);
  assert.equal((await h.call('GET', '/b/BAD!ID/public')).status, 404);
});
test('two buckets share no photos, counters, settings or objects', async () => {
  const h = harness(); const one = await ready(h), two = await ready(h, { gb: 30, owners: ['other-uid'] });
  const image = await jpeg(), thumb = await jpeg(60, 40);
  assert.equal((await commitOne(h, one.a.token, one.id, 'same-id', image, thumb)).status, 200);
  assert.equal((await commitOne(h, two.a.token, two.id, 'same-id', image, thumb)).status, 200);
  assert.equal((await commitOne(h, two.a.token, two.id, 'second', image, thumb)).status, 200);
  assert.equal(counterTotals(h.dynamo, one.id).photos, 1); assert.equal(counterTotals(h.dynamo, two.id).photos, 2);
  await h.call('POST', `/b/${one.id}/pause`, { token: 'customer-token', body: { paused: true } });
  assert.equal((await h.call('GET', `/b/${one.id}/public`)).body.paused, true);
  assert.equal((await h.call('GET', `/b/${two.id}/public`)).body.paused, false);
  const keys = [...h.files.photos.keys()];
  assert.ok(keys.every(k => k.startsWith(`buckets/${one.id}/`) || k.startsWith(`buckets/${two.id}/`) || k.startsWith(`incoming/${one.id}/`) || k.startsWith(`incoming/${two.id}/`)));
  assert.ok(h.dynamo.dump().every(i => i.pk === `BUCKET#${one.id}` || i.pk === `BUCKET#${two.id}`));
});
test('a guest token works only on its own bucket', async () => {
  const h = harness(); const one = await ready(h), two = await ready(h);
  const image = await jpeg(), thumb = await jpeg(60, 40);
  await commitOne(h, one.a.token, one.id, 'p1', image, thumb);
  for (const [m, path, body] of [['GET', `/b/${two.id}/photos`], ['POST', `/b/${two.id}/uploads`, { photoId: 'x', size: 10, thumbSize: 10 }], ['GET', `/b/${two.id}/photos/p1/url`], ['DELETE', `/b/${two.id}/photos/p1`], ['POST', `/b/${two.id}/photos/p1/commit`, { uploadId: 'a'.repeat(32) }]]) {
    const r = await h.call(m, path, { token: one.a.token, body });
    assert.equal(r.status, 401, `${m} ${path}`); assert.equal(r.body.code, 'TOKEN_WRONG_BUCKET');
  }
  assert.equal((await h.call('GET', '/owner/list', { token: one.a.token })).status, 403);
  // A guest of this bucket still cannot reach another guest's photo or owner routes.
  assert.equal((await h.call('GET', `/b/${one.id}/photos/p1/url`, { token: one.b.token })).status, 404);
  assert.equal((await h.call('GET', `/b/${one.id}`, { token: one.a.token })).status, 403);
  assert.equal((await h.call('PUT', `/b/${one.id}/size`, { token: one.a.token, body: { gb: 50 } })).status, 403);
});
test('a page cursor cannot read another bucket or another guest', async () => {
  const h = harness(); const one = await ready(h), two = await ready(h);
  const image = await jpeg(), thumb = await jpeg(60, 40);
  for (const pid of ['p1', 'p2', 'p3']) await commitOne(h, one.a.token, one.id, pid, image, thumb);
  await commitOne(h, two.a.token, two.id, 'z1', image, thumb);
  const first = await h.call('GET', `/b/${one.id}/photos`, { token: one.a.token, query: { limit: '1' } });
  assert.ok(first.body.nextCursor);
  const across = await h.call('GET', `/b/${two.id}/photos`, { token: two.a.token, query: { cursor: first.body.nextCursor } });
  assert.ok(across.status === 200 ? across.body.items.every(p => p.bucketId === two.id) : across.status === 400);
  const forged = Buffer.from(JSON.stringify({ pk: `BUCKET#${one.id}`, sk: 'PHOTO#p1' })).toString('base64url');
  assert.equal((await h.call('GET', `/b/${two.id}/photos`, { token: 'admin-token', query: { cursor: forged } })).status, 400);
  assert.equal((await h.call('GET', `/b/${two.id}/photos`, { token: 'admin-token', query: { cursor: '!!!' } })).status, 400);
  assert.equal((await h.call('GET', `/b/${two.id}/photos`, { token: 'admin-token', query: { limit: '9999' } })).status, 400);
});

// ---------- authorization ----------
test('owners are checked per bucket; strangers and other owners get nothing', async () => {
  const h = harness(); const { id } = await ready(h);
  const other = await h.createBucket({ owners: ['other-uid'] });
  assert.equal((await h.call('GET', `/b/${id}`, { token: 'customer-token' })).body.name, details.name);
  assert.equal((await h.call('GET', `/b/${other.body.id}`, { token: 'customer-token' })).status, 403);
  assert.equal((await h.call('GET', `/b/${id}`, { token: 'stranger-token' })).status, 403);
  assert.equal((await h.call('GET', `/b/${id}/photos`, { token: 'stranger-token' })).status, 403);
  assert.equal((await h.call('PATCH', `/b/${id}`, { token: 'stranger-token', body: { name: 'x' } })).status, 403);
  assert.equal((await h.call('GET', `/b/${id}`, { token: 'bad-token' })).status, 401);
  assert.equal((await h.call('GET', `/b/${id}`, { token: 'admin-token' })).status, 200);
  assert.equal((await h.call('GET', `/b/${id}`, { token: 'customer-token' })).body.owners, undefined);
  assert.equal((await h.call('PATCH', `/b/${id}`, { token: 'customer-token', body: { name: 'Renamed', limitBytes: 1, owners: ['stranger'], demo: true } })).body.name, 'Renamed');
  const after = await h.call('GET', `/b/${id}`, { token: 'admin-token' });
  assert.deepEqual(after.body.owners, [CUSTOMER]); assert.equal(after.body.limitBytes, 15 * 1024 ** 3); assert.equal(after.body.demo, false);
});
test('owner list returns only your buckets, admins see all, and it pages', async () => {
  const h = harness(); const ids = [];
  for (let i = 0; i < 5; i++) ids.push((await h.createBucket({ owners: i < 3 ? [CUSTOMER] : ['other-uid'] })).body.id);
  const mine = await pages(h.call, '/owner/list', { token: 'customer-token', query: { limit: '2' } });
  assert.deepEqual(mine.map(b => b.id).sort(), ids.slice(0, 3).sort());
  assert.deepEqual((await pages(h.call, '/owner/list', { token: 'stranger-token' })), []);
  assert.equal((await pages(h.call, '/owner/list', { token: 'admin-token', query: { limit: '2' } })).length, 5);
  assert.equal((await pages(h.call, '/owner/list', { token: 'admin-token', query: { uid: 'other-uid' } })).length, 2);
  assert.equal((await h.call('GET', '/owner/list', { token: 'customer-token', query: { uid: 'other-uid' } })).status, 403);
});
test('admins link and unlink owners; a customer can hold several buckets', async () => {
  const h = harness(); const one = (await h.createBucket({ owners: [] })).body.id, two = (await h.createBucket({ owners: [] })).body.id;
  assert.equal((await h.call('POST', `/b/${one}/owners`, { token: 'customer-token', body: { uid: CUSTOMER } })).status, 403);
  assert.equal((await h.call('POST', `/b/${one}/owners`, { token: 'admin-token', body: { uid: 'bad uid' } })).status, 400);
  for (const id of [one, two]) assert.deepEqual((await h.call('POST', `/b/${id}/owners`, { token: 'admin-token', body: { uid: CUSTOMER } })).body.owners, [CUSTOMER]);
  await h.call('POST', `/b/${one}/owners`, { token: 'admin-token', body: { uid: CUSTOMER } }); // idempotent
  assert.equal((await pages(h.call, '/owner/list', { token: 'customer-token' })).length, 2);
  assert.equal((await h.call('DELETE', `/b/${one}/owners/${CUSTOMER}`, { token: 'customer-token' })).status, 403);
  assert.deepEqual((await h.call('DELETE', `/b/${one}/owners/${CUSTOMER}`, { token: 'admin-token' })).body.owners, []);
  assert.equal((await h.call('GET', `/b/${one}`, { token: 'customer-token' })).status, 403);
  assert.deepEqual((await pages(h.call, '/owner/list', { token: 'customer-token' })).map(b => b.id), [two]);
});

// ---------- uploads ----------
test('upload, idempotent commit, guests isolated, owner view, guest delete', async () => {
  const h = harness(); const { id, a, b } = await ready(h);
  const image = await jpeg(), thumb = await jpeg(200, 150), bytes = image.length + thumb.length;
  const grant = await h.upload(a.token, id, 'p1', image, thumb);
  const commit = await h.call('POST', `/b/${id}/photos/p1/commit`, { token: a.token, body: { uploadId: grant.body.uploadId, name: 'Amelia' } });
  assert.equal(commit.status, 200); assert.equal(commit.body.revision, 1); assert.equal(commit.body.size, image.length);
  const again = await h.call('POST', `/b/${id}/photos/p1/commit`, { token: a.token, body: { uploadId: grant.body.uploadId } });
  assert.equal(again.status, 200); assert.equal(counterTotals(h.dynamo, id).bytes, bytes);
  assert.equal((await h.upload(a.token, id, 'p1', image, thumb)).body.exists.id, 'p1'); // lost-response retry is idempotent
  const list = await h.call('GET', `/b/${id}/photos`, { token: a.token });
  assert.equal(list.body.items.length, 1); assert.equal(list.body.items[0].backupState, undefined); assert.equal(list.body.nextCursor, null);
  assert.equal((await h.call('GET', `/b/${id}/photos`, { token: b.token })).body.items.length, 0);
  assert.equal((await h.call('GET', `/b/${id}/photos`, { token: b.token, query: { contributor: a.contributorId } })).body.items.length, 0, 'a guest cannot ask for another contributor');
  assert.equal((await h.call('GET', `/b/${id}/photos/p1/url`, { token: b.token, query: { kind: 'image' } })).status, 404);
  assert.equal((await h.call('DELETE', `/b/${id}/photos/p1`, { token: b.token })).status, 404);
  const owner = await h.call('GET', `/b/${id}/photos`, { token: 'customer-token', query: { contributor: a.contributorId } });
  assert.equal(owner.body.items[0].backupState, 'pending');
  assert.equal((await h.call('GET', `/b/${id}/photos`, { token: 'stranger-token' })).status, 403);
  assert.match((await h.call('GET', `/b/${id}/photos/p1/url`, { token: a.token, query: { kind: 'thumb' } })).body.url, /\.thumb$/);
  assert.equal((await h.call('DELETE', `/b/${id}/photos/p1`, { token: a.token })).status, 204);
  assert.equal(counterTotals(h.dynamo, id).bytes, 0);
});
test('commit validates with HEAD and ranged reads, never the whole file', async () => {
  const h = harness(); const { id, a } = await ready(h);
  const large = { buffer: await jpeg(1000, 800), size: LIMITS.fileBytes };
  assert.equal(h.files.read, undefined);
  assert.equal((await commitOne(h, a.token, id, 'big', large, await jpeg(60, 40))).status, 200);
  assert.ok(h.files.ranges.length && h.files.ranges.every(n => n <= LIMITS.headerProbeBytes));
  assert.equal(counterTotals(h.dynamo, id).bytes > LIMITS.fileBytes, true);
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).png().toBuffer();
  assert.equal((await commitOne(h, a.token, id, 'p2', png, await jpeg(50, 50))).status, 400);
  assert.equal((await commitOne(h, a.token, id, 'p3', await jpeg(3000, 100), await jpeg(50, 50))).status, 400);
  assert.equal((await commitOne(h, a.token, id, 'p4', await jpeg(), await jpeg(700, 700))).status, 400, 'oversized thumbnail');
  const oversize = await h.upload(a.token, id, 'p5', await jpeg(), await jpeg(50, 50));
  h.files.store(`incoming/${id}/p5/${oversize.body.uploadId}.jpg`, await jpeg(), LIMITS.fileBytes + 1);
  assert.equal((await h.call('POST', `/b/${id}/photos/p5/commit`, { token: a.token, body: { uploadId: oversize.body.uploadId } })).status, 400);
  assert.equal((await h.call('POST', `/b/${id}/photos/p6/commit`, { token: a.token, body: { uploadId: 'a'.repeat(32) } })).status, 400);
  assert.equal(counterTotals(h.dynamo, id).photos, 1);
});
test('a JPEG with long metadata before its frame gets a second, larger read', async () => {
  const h = harness(); const { id, a } = await ready(h);
  const plain = await jpeg(), chunk = Buffer.alloc(65535 + 2, 0); chunk[0] = 0xff; chunk[1] = 0xe2; chunk.writeUInt16BE(65535, 2);
  const padded = Buffer.concat([plain.subarray(0, 2), chunk, chunk, chunk, plain.subarray(2)]);
  assert.equal((await commitOne(h, a.token, id, 'meta', padded, await jpeg(60, 40))).status, 200);
  assert.ok(h.files.ranges.includes(Math.min(LIMITS.headerMaxBytes, padded.length)));
});
test('parallel commits of the same upload make one photo and keep its files', async () => {
  const h = harness({ dynamo: new FakeDynamo({ hold: () => 3 }) }); const { id, a } = await ready(h);
  const image = await jpeg(), thumb = await jpeg(60, 40), grant = await h.upload(a.token, id, 'p1', image, thumb);
  const results = await Promise.all(Array.from({ length: 6 }, () => h.call('POST', `/b/${id}/photos/p1/commit`, { token: a.token, body: { uploadId: grant.body.uploadId } })));
  assert.deepEqual([...new Set(results.map(r => r.status))], [200], JSON.stringify(results.map(r => r.body)));
  assert.equal(counterTotals(h.dynamo, id).photos, 1); assert.equal(counterTotals(h.dynamo, id).bytes, image.length + thumb.length);
  assert.ok(h.files.current(`buckets/${id}/photos/p1/${grant.body.uploadId}.jpg`), 'a losing retry must not delete the winner’s files');
});
test('pause blocks new photos but allows edits; replace needs the current revision', async () => {
  const h = harness(); const { id, a } = await ready(h);
  const image = await jpeg(), thumb = await jpeg(100, 80);
  await commitOne(h, a.token, id, 'p1', image, thumb);
  assert.equal((await h.call('POST', `/b/${id}/pause`, { token: 'customer-token', body: { paused: true } })).body.paused, true);
  assert.equal((await h.upload(a.token, id, 'p9', image, thumb)).status, 403);
  const next = await jpeg(900, 700, '#36c');
  const replace = await h.upload(a.token, id, 'p1', next, thumb, { replace: true });
  assert.equal((await h.call('POST', `/b/${id}/photos/p1/commit`, { token: a.token, body: { uploadId: replace.body.uploadId, expectedRevision: 7 } })).status, 409);
  const ok = await h.call('POST', `/b/${id}/photos/p1/commit`, { token: a.token, body: { uploadId: replace.body.uploadId, expectedRevision: 1 } });
  assert.equal(ok.body.revision, 2); assert.equal(counterTotals(h.dynamo, id).bytes, next.length + thumb.length);
  assert.equal(counterTotals(h.dynamo, id).photos, 1);
});
test('pause holds at commit too, when the grant was issued before the pause', async () => {
  const h = harness(); const { id, a } = await ready(h);
  const image = await jpeg(), thumb = await jpeg(60, 40), grant = await h.upload(a.token, id, 'p1', image, thumb);
  await h.call('POST', `/b/${id}/pause`, { token: 'customer-token', body: { paused: true } });
  const r = await h.call('POST', `/b/${id}/photos/p1/commit`, { token: a.token, body: { uploadId: grant.body.uploadId } });
  assert.equal(r.status, 403); assert.equal(r.body.code, 'UPLOADS_PAUSED');
  // Stale META in front of the commit: the shard state alone must still refuse it.
  const stale = createStore({ client: h.dynamo, table: 'test' });
  await assert.rejects(stale.commitPhoto({ bucketId: id, shards: 32, stamp: 1, previous: null, photo: { id: 'p2', contributorId: 'c', bytes: 10, createdAt: 1, revision: 1, backupState: 'pending' } }), e => e.reason === 'paused');
});
test('the cap holds at presign and at commit, and frees up after a delete', async () => {
  const h = harness(); const { id, a } = await ready(h);
  const image = await jpeg(), thumb = await jpeg(50, 50), limit = 15 * 1024 ** 3;
  await commitOne(h, a.token, id, 'p1', image, thumb);
  // Spend all remaining allowance except 10 bytes.
  const shards = h.dynamo.dump().filter(i => i.pk === `BUCKET#${id}` && i.sk.startsWith('COUNTER#'));
  let spare = 10; for (const s of shards) { const keep = Math.min(spare, s.free); spare -= keep; h.dynamo.put({ ...s, bytes: (s.bytes || 0) + s.free - keep, free: keep }); }
  assert.equal(counterTotals(h.dynamo, id).free, 10);
  const denied = await h.upload(a.token, id, 'p2', image, thumb); assert.equal(denied.status, 507); assert.equal(denied.body.code, 'BUCKET_FULL');
  assert.equal(counterTotals(h.dynamo, id).free + counterTotals(h.dynamo, id).bytes, limit);
  assert.equal((await h.call('DELETE', `/b/${id}/photos/p1`, { token: a.token })).status, 204);
  assert.equal((await commitOne(h, a.token, id, 'p3', image, thumb)).status, 200);
  assert.equal(counterTotals(h.dynamo, id).free + counterTotals(h.dynamo, id).bytes, limit);
});
test('spare allowance scattered over shards still pays for a photo', async () => {
  const h = harness(); const { id, a } = await ready(h, { demo: true, gb: undefined });
  const image = { buffer: await jpeg(), size: 20 * 1024 ** 2 }, thumb = await jpeg(60, 40);
  const shards = h.dynamo.dump().filter(i => i.pk === `BUCKET#${id}` && i.sk.startsWith('COUNTER#'));
  // Each shard keeps 8 MB, no single shard can pay for 20 MB, yet 32 MB is free in total.
  for (const s of shards) h.dynamo.put({ ...s, bytes: s.free - 8 * 1024 ** 2, free: 8 * 1024 ** 2 });
  assert.equal((await commitOne(h, a.token, id, 'p1', image, thumb)).status, 200);
  const t = counterTotals(h.dynamo, id); assert.equal(t.free + t.bytes, 1024 ** 3); assert.ok(t.minFree >= 0);
});

// ---------- delete rules ----------
const committed = async (h, id, a, pid = 'p1') => {
  const image = await jpeg(), thumb = await jpeg(60, 40), g = await h.upload(a.token, id, pid, image, thumb), uid = g.body.uploadId;
  assert.equal((await h.call('POST', `/b/${id}/photos/${pid}/commit`, { token: a.token, body: { uploadId: uid, name: 'Amelia' } })).status, 200);
  return { uid, image, thumb, imageKey: `buckets/${id}/photos/${pid}/${uid}.jpg`, thumbKey: `buckets/${id}/photos/${pid}/${uid}.thumb`, backupKey: `buckets/${id}/backup/${pid}/${uid}.jpg`, deletedId: `${pid}.${uid}` };
};
const backupAll = (h, keys, encode) => createBackupHandler({ store: h.store, files: h.files, ...(encode ? { encode } : {}) })({ Records: keys.map(k => s3Message(k)) });
const records = (h, id, prefix) => h.dynamo.dump().filter(i => i.pk === `BUCKET#${id}` && i.sk.startsWith(prefix));
const FIVE_MIN = 5 * 60 * 1000;

test('rule 1: a guest deleting their photo purges everything at once and leaves no trash', async () => {
  let now = 1_800_000_000_000;
  const h = harness({ clock: () => now }); const { id, a } = await ready(h), p = await committed(h, id, a);
  await backupAll(h, [p.imageKey]);
  assert.ok(h.files.currentBackup(p.backupKey));
  assert.equal((await h.call('DELETE', `/b/${id}/photos/p1`, { token: a.token })).status, 204);
  for (const key of [p.imageKey, p.thumbKey, `incoming/${id}/p1/${p.uid}.jpg`, `incoming/${id}/p1/${p.uid}.thumb`]) assert.equal(h.files.photos.has(key), false, key);
  assert.equal(h.files.backups.has(p.backupKey), false);
  assert.equal([...h.files.photos.keys()].filter(k => k.includes('/p1/')).length, 0);
  const t = counterTotals(h.dynamo, id); assert.equal(t.bytes, 0); assert.equal(t.photos, 0); assert.equal(t.backupBytes, 0);
  assert.equal(records(h, id, 'PHOTO#').length, 0); assert.equal(records(h, id, 'DELETED#').length, 0); assert.equal(records(h, id, 'TRASH#').length, 0);
  assert.equal((await h.call('GET', `/b/${id}/deleted`, { token: 'admin-token' })).body.items.length, 0);
  assert.equal((await h.call('DELETE', `/b/${id}/photos/p1`, { token: a.token })).status, 204, 'idempotent');
  // Only the internal tombstone remains, it holds no name or contributor, and the sweep clears it.
  const [tomb] = records(h, id, 'TOMB#'); assert.deepEqual(Object.keys(tomb).sort(), ['gsi2pk', 'gsi2sk', 'pk', 'sk']);
  const sweep = createAdminSweep({ store: h.store, files: h.files, now: () => now });
  assert.equal((await sweep({})).photos, 0, 'not before the grace period');
  now += FIVE_MIN + 1; assert.equal((await sweep({})).photos, 1);
  assert.equal(records(h, id, 'TOMB#').length, 0);
});
test('rule 1: a guest replacing a photo purges the old one the same way', async () => {
  const h = harness(); const { id, a } = await ready(h), p = await committed(h, id, a);
  await backupAll(h, [p.imageKey]);
  const next = await jpeg(900, 700), thumb = await jpeg(60, 40), g = await h.upload(a.token, id, 'p1', next, thumb, { replace: true });
  assert.equal((await h.call('POST', `/b/${id}/photos/p1/commit`, { token: a.token, body: { uploadId: g.body.uploadId, expectedRevision: 1 } })).status, 200);
  for (const key of [p.imageKey, p.thumbKey, `incoming/${id}/p1/${p.uid}.jpg`]) assert.equal(h.files.photos.has(key), false, key);
  assert.equal(h.files.backups.has(p.backupKey), false);
  assert.ok(h.files.current(`buckets/${id}/photos/p1/${g.body.uploadId}.jpg`));
  assert.equal(records(h, id, 'DELETED#').length, 0);
  const t = counterTotals(h.dynamo, id); assert.equal(t.bytes, next.length + thumb.length); assert.equal(t.backupBytes, 0);
});
test('a failed first purge is finished by the sweep, and the guest still sees it gone', async () => {
  let now = 1_800_000_000_000;
  const h = harness({ clock: () => now }); const { id, a } = await ready(h), p = await committed(h, id, a);
  await backupAll(h, [p.imageKey]);
  const real = h.files.purgeKeys; h.files.purgeKeys = async () => { throw Object.assign(new Error('down'), { name: 'SlowDown' }); };
  assert.equal((await h.call('DELETE', `/b/${id}/photos/p1`, { token: a.token })).status, 204);
  h.files.purgeKeys = real;
  assert.equal((await h.call('GET', `/b/${id}/photos`, { token: a.token })).body.items.length, 0);
  assert.ok(h.files.photos.has(p.imageKey));
  now += FIVE_MIN + 1; await createAdminSweep({ store: h.store, files: h.files, now: () => now })({});
  assert.equal(h.files.photos.has(p.imageKey), false); assert.equal(h.files.backups.has(p.backupKey), false);
});
test('race: a guest delete during a running backup leaves no backup copy', async () => {
  let now = 1_800_000_000_000;
  const h = harness({ clock: () => now }); const { id, a } = await ready(h), p = await committed(h, id, a);
  const encode = async buffer => { const out = await compress(buffer); assert.equal((await h.call('DELETE', `/b/${id}/photos/p1`, { token: a.token })).status, 204); return out; };
  assert.deepEqual((await backupAll(h, [p.imageKey], encode)).batchItemFailures, []);
  assert.equal(h.files.backups.has(p.backupKey), false, 'no version of the late copy survives');
  assert.equal(counterTotals(h.dynamo, id).backupBytes, 0);
  // If the function died right after its upload, the copy landed after every purge: the tombstone's sweep removes it.
  h.files.putBackup(p.backupKey, Buffer.from('late')); assert.ok(h.files.backups.has(p.backupKey));
  now += FIVE_MIN + 1; await createAdminSweep({ store: h.store, files: h.files, now: () => now })({});
  assert.equal(h.files.backups.has(p.backupKey), false);
  // And redelivering the message writes nothing.
  assert.deepEqual((await backupAll(h, [p.imageKey])).batchItemFailures, []);
  assert.equal(h.files.backups.has(p.backupKey), false);
});
test('rules 2 and 3: owner and admin deletes hide the photo, release quota, write an audit record, keep the backup', async () => {
  let now = 1_800_000_000_000;
  const h = harness({ clock: () => now }); const { id, a } = await ready(h);
  const p1 = await committed(h, id, a, 'p1'), p2 = await committed(h, id, a, 'p2');
  await backupAll(h, [p1.imageKey, p2.imageKey]);
  const backupBytes = counterTotals(h.dynamo, id).backupBytes; assert.ok(backupBytes > 0);
  assert.equal((await h.call('DELETE', `/b/${id}/photos/p1`, { token: 'customer-token' })).status, 204);
  assert.equal((await h.call('DELETE', `/b/${id}/photos/p2`, { token: 'admin-token' })).status, 204);
  assert.equal((await h.call('GET', `/b/${id}/photos`, { token: 'customer-token' })).body.items.length, 0);
  assert.equal((await h.call('GET', `/b/${id}/photos`, { token: a.token })).body.items.length, 0);
  assert.equal((await h.call('GET', `/b/${id}/photos/p1/url`, { token: 'customer-token' })).status, 404);
  const t = counterTotals(h.dynamo, id); assert.equal(t.bytes, 0); assert.equal(t.photos, 0); assert.equal(t.backupBytes, backupBytes);
  assert.equal(h.files.current(p1.imageKey), null, 'original hidden');
  assert.ok(h.files.photos.get(p1.imageKey).some(v => !v.marker));
  assert.ok(h.files.current(p1.thumbKey), 'thumbnail stays for a restore');
  assert.ok(h.files.currentBackup(p1.backupKey)); assert.ok(h.files.currentBackup(p2.backupKey));
  assert.equal(records(h, id, 'TOMB#').length, 0);
  const list = await h.call('GET', `/b/${id}/deleted`, { token: 'admin-token', query: { limit: '1' } });
  assert.equal(list.body.items.length, 1); assert.ok(list.body.nextCursor);
  const all = await pages(h.call, `/b/${id}/deleted`, { token: 'admin-token' }), byId = Object.fromEntries(all.map(r => [r.photoId, r]));
  assert.deepEqual([byId.p1.photoId, byId.p1.name, byId.p1.contributorId, byId.p1.actorUid, byId.p1.actorRole, byId.p1.deletedAt], ['p1', 'Amelia', a.contributorId, CUSTOMER, 'owner', now]);
  assert.deepEqual([byId.p2.actorUid, byId.p2.actorRole, byId.p2.restorable], ['admin-uid', 'admin', true]);
  // Nothing expires these: no TTL on the record, and a very long time later it is all still there.
  assert.equal(records(h, id, 'DELETED#').every(r => r.ttl === undefined), true);
  now += 400 * 86400000;
  await createAdminSweep({ store: h.store, files: h.files, now: () => now })({}); await createDemoSweep({ store: h.store, files: h.files, now: () => now })({});
  assert.ok(h.files.currentBackup(p1.backupKey)); assert.equal(records(h, id, 'DELETED#').length, 2);
});
test('customers and guests cannot read deleted records or restore', async () => {
  const h = harness(); const { id, a } = await ready(h), p = await committed(h, id, a);
  await backupAll(h, [p.imageKey]); await h.call('DELETE', `/b/${id}/photos/p1`, { token: 'customer-token' });
  for (const token of ['customer-token', 'stranger-token', a.token]) {
    assert.equal((await h.call('GET', `/b/${id}/deleted`, { token })).status, 403, token);
    assert.equal((await h.call('POST', `/b/${id}/deleted/${p.deletedId}/restore`, { token })).status, 403, token);
  }
  assert.equal((await h.call('POST', `/b/${id}/deleted/nonsense/restore`, { token: 'admin-token' })).status, 400);
  assert.equal((await h.call('POST', `/b/${id}/deleted/p9.${'a'.repeat(32)}/restore`, { token: 'admin-token' })).status, 404);
  assert.equal((await h.call('GET', `/b/${id}/trash`, { token: 'admin-token' })).status, 404, 'the old route is gone');
});
test('restore brings back the quality-80 backup copy, charges quota, and keeps the audit trail', async () => {
  const h = harness(); const { id, a } = await ready(h), p = await committed(h, id, a);
  await backupAll(h, [p.imageKey]);
  const copy = h.files.currentBackup(p.backupKey);
  await h.call('DELETE', `/b/${id}/photos/p1`, { token: 'customer-token' });
  const back = await h.call('POST', `/b/${id}/deleted/${p.deletedId}/restore`, { token: 'admin-token' });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.equal(back.body.restoredFromBackup, true); assert.equal(back.body.size, copy.size); assert.equal(back.body.revision, 2); assert.equal(back.body.backupState, 'done');
  assert.deepEqual(h.files.current(p.imageKey).body, copy.body, 'the photo is now the backup copy');
  assert.ok(h.files.currentBackup(p.backupKey), 'the backup stays');
  assert.equal(counterTotals(h.dynamo, id).bytes, copy.size + p.thumb.length); assert.equal(counterTotals(h.dynamo, id).photos, 1);
  assert.equal((await h.call('GET', `/b/${id}/photos`, { token: a.token })).body.items[0].size, copy.size);
  assert.equal((await h.call('POST', `/b/${id}/deleted/${p.deletedId}/restore`, { token: 'admin-token' })).body.code, 'ALREADY_RESTORED');
  let [rec] = await pages(h.call, `/b/${id}/deleted`, { token: 'admin-token' });
  assert.equal(rec.restoredBy, 'admin-uid'); assert.equal(rec.restorable, false);
  // The copy event from the restore must not hide or re-back-up anything.
  assert.deepEqual((await backupAll(h, [p.imageKey])).batchItemFailures, []); assert.ok(h.files.current(p.imageKey));
  // Delete again: the earlier delete stays in the record.
  await h.call('DELETE', `/b/${id}/photos/p1`, { token: 'customer-token' });
  [rec] = await pages(h.call, `/b/${id}/deleted`, { token: 'admin-token' });
  assert.equal(rec.restorable, true); assert.equal(rec.earlier.length, 1); assert.equal(rec.earlier[0].restoredBy, 'admin-uid');
  await h.call('POST', `/b/${id}/deleted/${p.deletedId}/restore`, { token: 'admin-token' });
  // A guest then deleting the restored photo erases it fully, audit record and backup too (rule 1).
  assert.equal((await h.call('DELETE', `/b/${id}/photos/p1`, { token: a.token })).status, 204);
  assert.equal(h.files.backups.has(p.backupKey), false); assert.equal(records(h, id, 'DELETED#').length, 0);
});
test('restore refuses when the bucket has no room or a newer photo holds the id', async () => {
  const h = harness(); const { id, a } = await ready(h), p = await committed(h, id, a);
  await backupAll(h, [p.imageKey]); await h.call('DELETE', `/b/${id}/photos/p1`, { token: 'customer-token' });
  const newer = await committed(h, id, a, 'p1');
  assert.equal((await h.call('POST', `/b/${id}/deleted/${p.deletedId}/restore`, { token: 'admin-token' })).body.code, 'PHOTO_EXISTS');
  await h.call('DELETE', `/b/${id}/photos/p1`, { token: a.token }); assert.ok(newer);
  for (const s of records(h, id, 'COUNTER#')) h.dynamo.put({ ...s, bytes: (s.bytes || 0) + s.free, free: 0 });
  const full = await h.call('POST', `/b/${id}/deleted/${p.deletedId}/restore`, { token: 'admin-token' });
  assert.equal(full.status, 507);
  assert.equal(h.files.current(p.imageKey), null, 'still hidden');
});
test('race: an owner delete before the backup exists keeps the original until it does', async () => {
  let now = 1_800_000_000_000;
  const h = harness({ clock: () => now }); const { id, a } = await ready(h), p = await committed(h, id, a);
  assert.equal((await h.call('DELETE', `/b/${id}/photos/p1`, { token: 'customer-token' })).status, 204);
  assert.ok(h.files.current(p.imageKey), 'the only copy is not hidden');
  assert.equal(counterTotals(h.dynamo, id).bytes, 0, 'quota released all the same');
  assert.equal((await h.call('GET', `/b/${id}/photos`, { token: 'customer-token' })).body.items.length, 0);
  let [rec] = await pages(h.call, `/b/${id}/deleted`, { token: 'admin-token' });
  assert.equal(rec.backupState, 'pending'); assert.equal(rec.restorable, false);
  assert.equal((await h.call('POST', `/b/${id}/deleted/${p.deletedId}/restore`, { token: 'admin-token' })).body.code, 'BACKUP_NOT_READY');
  assert.equal((await h.call('GET', `/b/${id}/backups`, { token: 'admin-token' })).body.unbacked, 1);
  assert.deepEqual((await createBackupHandler({ store: h.store, files: h.files, now: () => now })({ Records: [s3Message(p.imageKey)] })).batchItemFailures, []);
  assert.ok(h.files.currentBackup(p.backupKey)); assert.equal(h.files.current(p.imageKey), null, 'hidden once the backup exists');
  [rec] = await pages(h.call, `/b/${id}/deleted`, { token: 'admin-token' }); assert.equal(rec.backupState, 'done');
  assert.equal((await h.call('GET', `/b/${id}/backups`, { token: 'admin-token' })).body.unbacked, 0);
  assert.ok(counterTotals(h.dynamo, id).backupBytes > 0);
  assert.equal((await h.call('POST', `/b/${id}/deleted/${p.deletedId}/restore`, { token: 'admin-token' })).body.code, 'BACKUP_NOT_READY', 'waits out the run that hides the original');
  now += 131 * 1000;
  assert.equal((await h.call('POST', `/b/${id}/deleted/${p.deletedId}/restore`, { token: 'admin-token' })).status, 200);
  assert.ok(h.files.current(p.imageKey));
});
test('race: an owner delete during a running backup keeps the copy and then hides the original', async () => {
  const h = harness(); const { id, a } = await ready(h), p = await committed(h, id, a);
  const encode = async buffer => { const out = await compress(buffer); assert.equal((await h.call('DELETE', `/b/${id}/photos/p1`, { token: 'customer-token' })).status, 204); return out; };
  assert.deepEqual((await backupAll(h, [p.imageKey], encode)).batchItemFailures, []);
  assert.ok(h.files.currentBackup(p.backupKey)); assert.equal(h.files.current(p.imageKey), null);
  const [rec] = await pages(h.call, `/b/${id}/deleted`, { token: 'admin-token' }); assert.equal(rec.backupState, 'done');
  assert.ok(counterTotals(h.dynamo, id).backupBytes > 0);
  assert.equal((await h.call('GET', `/b/${id}/backups`, { token: 'admin-token' })).body.unbacked, 0);
});
test('race: an owner delete on a failed backup keeps the original and can be re-driven', async () => {
  const h = harness(); const { id, a } = await ready(h), p = await committed(h, id, a);
  const failed = await backupAll(h, [p.imageKey], async () => { throw new Error('boom'); });
  assert.equal(failed.batchItemFailures.length, 1);
  await h.call('DELETE', `/b/${id}/photos/p1`, { token: 'customer-token' });
  assert.ok(h.files.current(p.imageKey));
  assert.deepEqual((await h.call('GET', `/b/${id}/backups`, { token: 'admin-token' })).body.failed, 1);
  assert.equal((await backupAll(h, [p.imageKey], async () => { throw new Error('boom'); })).batchItemFailures.length, 1);
  assert.ok(h.files.current(p.imageKey), 'a further failure still loses nothing');
  const re = await h.call('POST', `/b/${id}/backups/redrive`, { token: 'admin-token', body: {} });
  assert.equal(re.body.queued, 1); assert.deepEqual(h.files.touched, [p.imageKey]);
  assert.deepEqual((await backupAll(h, [p.imageKey])).batchItemFailures, []);
  assert.ok(h.files.currentBackup(p.backupKey)); assert.equal(h.files.current(p.imageKey), null);
});
test('rule 4: bucket deletion and demo expiry do remove retained backups and records', async () => {
  let now = 1_800_000_000_000;
  const h = harness({ clock: () => now }); const { id, a } = await ready(h), p = await committed(h, id, a);
  await backupAll(h, [p.imageKey]); await h.call('DELETE', `/b/${id}/photos/p1`, { token: 'customer-token' });
  await h.call('DELETE', `/b/${id}`, { token: 'admin-token', query: { confirm: id } });
  await createAdminSweep({ store: h.store, files: h.files, now: () => now })({});
  assert.equal(h.files.backups.has(p.backupKey), false); assert.equal(h.dynamo.dump().filter(i => i.pk === `BUCKET#${id}`).length, 0);
  const demo = (await h.createBucket({ demo: true, gb: undefined })).body.id, guest = (await h.call('POST', `/b/${demo}/guest`)).body, d = await committed(h, demo, guest);
  await backupAll(h, [d.imageKey]); await h.call('DELETE', `/b/${demo}/photos/p1`, { token: 'customer-token' });
  assert.ok(h.files.backups.has(d.backupKey));
  now += 24 * 3600 * 1000;
  assert.equal((await createDemoSweep({ store: h.store, files: h.files, now: () => now })({})).purged, 1);
  assert.equal(h.files.backups.has(d.backupKey), false); assert.equal(h.dynamo.dump().filter(i => i.pk === `BUCKET#${demo}`).length, 0);
});

// ---------- backups ----------
test('backups are quality 80, same pixel dimensions, no downscale', async () => {
  const noisy = await sharp(Buffer.alloc(2400 * 1800 * 3).map((_, i) => (i * 7919) % 256), { raw: { width: 2400, height: 1800, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
  const out = await compress(noisy), meta = await sharp(out).metadata();
  assert.deepEqual([meta.width, meta.height], [2400, 1800]);
  assert.deepEqual(out, await sharp(noisy).jpeg({ quality: 80, mozjpeg: true }).toBuffer());
});
test('backup state is recorded per photo, countable and re-drivable; nothing is skipped', async () => {
  const h = harness(); const { id, a } = await ready(h);
  const image = await jpeg(), thumb = await jpeg(60, 40), keys = [];
  for (const pid of ['p1', 'p2', 'p3']) { const g = await h.upload(a.token, id, pid, image, thumb); await h.call('POST', `/b/${id}/photos/${pid}/commit`, { token: a.token, body: { uploadId: g.body.uploadId } }); keys.push(`buckets/${id}/photos/${pid}/${g.body.uploadId}.jpg`); }
  assert.deepEqual(h.files.events.filter(k => k.endsWith('.jpg')).sort(), [...keys].sort());
  const status = async () => (await h.call('GET', `/b/${id}/backups`, { token: 'admin-token' })).body;
  assert.deepEqual(await status(), { pending: 3, failed: 0, unbacked: 3, photoCount: 3, backupBytes: 0 });
  assert.equal((await h.call('GET', `/b/${id}/backups`, { token: 'customer-token' })).status, 403);
  let broken = true;
  const encode = async buffer => { if (broken) throw new Error('boom'); return compress(buffer); };
  const backup = createBackupHandler({ store: h.store, files: h.files, encode });
  const failed = await backup({ Records: [s3Message(keys[0])] });
  assert.deepEqual(failed.batchItemFailures, [{ itemIdentifier: keys[0] }]);
  assert.deepEqual(await status(), { pending: 2, failed: 1, unbacked: 3, photoCount: 3, backupBytes: 0 });
  broken = false;
  assert.deepEqual((await backup({ Records: keys.slice(1).map(k => s3Message(k)) })).batchItemFailures, []);
  assert.equal((await status()).unbacked, 1);
  const redrive = await h.call('POST', `/b/${id}/backups/redrive`, { token: 'admin-token', body: {} });
  assert.equal(redrive.body.queued, 1); assert.deepEqual(h.files.touched, [keys[0]]);
  assert.deepEqual((await backup({ Records: [s3Message(keys[0])] })).batchItemFailures, []);
  const end = await status(); assert.equal(end.unbacked, 0); assert.ok(end.backupBytes > 0);
  const before = end.backupBytes, versions = h.files.backups.get(keys[0].replace('/photos/', '/backup/')).length;
  assert.deepEqual((await backup({ Records: [s3Message(keys[0])] })).batchItemFailures, [], 'redelivery is a no-op');
  assert.equal((await status()).backupBytes, before); assert.equal(h.files.backups.get(keys[0].replace('/photos/', '/backup/')).length, versions);
});
test('backup event racing its commit is retried, later orphans are dropped, S3 test events ignored', async () => {
  const h = harness(); const { id } = await ready(h); let now = 1_800_000_000_000;
  const backup = createBackupHandler({ store: h.store, files: h.files, now: () => now });
  const key = `buckets/${id}/photos/ghost/${'a'.repeat(32)}.jpg`, at = new Date(now).toISOString();
  assert.equal((await backup({ Records: [s3Message(key, at)] })).batchItemFailures.length, 1);
  now += 16 * 60 * 1000;
  assert.equal((await backup({ Records: [s3Message(key, at)] })).batchItemFailures.length, 0);
  assert.equal((await backup({ Records: [{ messageId: 't', body: JSON.stringify({ Service: 'Amazon S3', Event: 's3:TestEvent' }) }] })).batchItemFailures.length, 0);
  assert.equal((await backup({ Records: [{ messageId: 'x', body: 'not json' }] })).batchItemFailures.length, 1);
  assert.equal(parseImageKey(`buckets/${id}/photos/p/${'a'.repeat(32)}.thumb`), null);
  assert.equal(parseImageKey(`incoming/${id}/p/${'a'.repeat(32)}.jpg`), null);
});
test('parallel restores: one wins, the photo stays visible and its image stays current', async () => {
  for (let run = 0; run < 5; run++) {
    const h = harness({ dynamo: new FakeDynamo({ hold: () => 2 + Math.random() * 3 }) }); const { id, a } = await ready(h), p = await committed(h, id, a);
    await backupAll(h, [p.imageKey]); await h.call('DELETE', `/b/${id}/photos/p1`, { token: 'customer-token' });
    const results = await Promise.all(Array.from({ length: 4 }, () => h.call('POST', `/b/${id}/deleted/${p.deletedId}/restore`, { token: 'admin-token' })));
    assert.equal(results.filter(r => r.status === 200).length, 1, JSON.stringify(results.map(r => r.status)));
    assert.ok(results.every(r => r.status === 200 || r.status === 409), JSON.stringify(results.map(r => r.body)));
    assert.ok(h.files.current(p.imageKey), 'a losing restore must not hide the winner');
    assert.equal(counterTotals(h.dynamo, id).photos, 1);
    assert.equal((await h.call('GET', `/b/${id}/photos/p1/url`, { token: a.token })).status, 200);
  }
});
test('a restore refused because the bucket is full leaves the original hidden and logs a failed hide', async () => {
  const h = harness(); const { id, a } = await ready(h), p = await committed(h, id, a);
  await backupAll(h, [p.imageKey]); await h.call('DELETE', `/b/${id}/photos/p1`, { token: 'customer-token' });
  const real = h.store.restorePhoto; h.store.restorePhoto = async () => { throw Object.assign(new Error('c'), { conflict: true, reason: 'full' }); };
  const remove = h.files.remove; h.files.remove = async () => { throw Object.assign(new Error('x'), { name: 'SlowDown' }); };
  const lines = [], log = console.error; console.error = line => lines.push(line);
  try { assert.equal((await h.call('POST', `/b/${id}/deleted/${p.deletedId}/restore`, { token: 'admin-token' })).status, 507); }
  finally { console.error = log; h.files.remove = remove; h.store.restorePhoto = real; }
  assert.ok(lines.some(l => l.includes('hideRestoredCopy') && l.includes('SlowDown')), lines.join());
});
test('PhotoPurge takes only a tombstone id, and refuses without a tombstone or while something owns the upload', async () => {
  const h = harness(); const { id, a } = await ready(h), p = await committed(h, id, a);
  await backupAll(h, [p.imageKey]);
  const purge = tombstoneId => purgeTombstone({ store: h.store, files: h.files, tombstoneId });
  for (const bad of ['', 'x', `${id}/p1`, `../${id}/p1.${p.uid}`, `${id}/a/b.${p.uid}`, undefined]) await assert.rejects(purge(bad), /Invalid/, String(bad));
  assert.equal((await purge(`${id}/p1.${p.uid}`)).reason, 'no-tombstone');
  assert.ok(h.files.current(p.imageKey)); assert.ok(h.files.currentBackup(p.backupKey));
  // A forged tombstone beside a live photo, then beside an audit record: still nothing is purged.
  h.dynamo.put({ pk: `BUCKET#${id}`, sk: `TOMB#p1.${p.uid}` });
  assert.equal((await purge(`${id}/p1.${p.uid}`)).reason, 'still-owned');
  await h.call('DELETE', `/b/${id}/photos/p1`, { token: 'customer-token' });
  assert.equal((await purge(`${id}/p1.${p.uid}`)).reason, 'still-owned');
  assert.ok(h.files.currentBackup(p.backupKey));
  for (const file of ['handler.mjs', 'index.mjs']) assert.ok(!/purgeKeys|\.purge\(/.test(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')), `${file} cannot purge directly`);
});
test('the API invokes PhotoPurge synchronously with only the tombstone id, correctly signed', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE', AWS_SECRET_ACCESS_KEY: 'dummysecret', AWS_SESSION_TOKEN: 'dummytoken' });
  try {
    const calls = []; let response = { status: 200, headers: new Headers(), text: async () => '{"purged":true}' };
    const invoke = createPurgeInvoker({ functionName: 'pbs-purge', region: 'eu-north-1', fetchImpl: async (url, init) => { calls.push({ url, init }); return response; } });
    assert.deepEqual(await invoke('b-1/p1.a'), { purged: true });
    const { url, init } = calls[0];
    assert.equal(url, 'https://lambda.eu-north-1.amazonaws.com/2015-03-31/functions/pbs-purge/invocations');
    assert.deepEqual(JSON.parse(init.body), { tombstoneId: 'b-1/p1.a' });
    assert.equal(init.headers['x-amz-invocation-type'], 'RequestResponse');
    assert.equal(init.headers['x-amz-security-token'], 'dummytoken');
    assert.ok(init.signal, 'has a timeout');
    // Recompute the signature by hand from the SigV4 steps, independently of the signing library.
    const auth = init.headers.authorization, [, date, region, service, signedHeaders, signature] = auth.match(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request, SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/);
    assert.deepEqual([region, service], ['eu-north-1', 'lambda']);
    const list = signedHeaders.split(';'), sha = v => createHash('sha256').update(v).digest('hex'), hmac = (k, v) => createHmac('sha256', k).update(v).digest();
    for (const name of ['host', 'x-amz-date', 'x-amz-invocation-type', 'x-amz-security-token']) assert.ok(list.includes(name), name);
    const get = name => (name === 'host' ? 'lambda.eu-north-1.amazonaws.com' : init.headers[name]);
    const canonical = ['POST', '/2015-03-31/functions/pbs-purge/invocations', '', ...list.map(n => `${n}:${get(n)}`), '', signedHeaders, init.headers['x-amz-content-sha256'] || sha(init.body)].join('\n');
    const toSign = ['AWS4-HMAC-SHA256', get('x-amz-date'), `${date}/${region}/${service}/aws4_request`, sha(canonical)].join('\n');
    const key = hmac(hmac(hmac(hmac('AWS4dummysecret', date), region), service), 'aws4_request');
    assert.equal(createHmac('sha256', key).update(toSign).digest('hex'), signature);
    response = { status: 200, headers: new Headers({ 'x-amz-function-error': 'Unhandled' }), text: async () => 'boom' };
    await assert.rejects(invoke('b-1/p1.a'), /failed/);
    response = { status: 403, headers: new Headers(), text: async () => 'denied' };
    await assert.rejects(invoke('b-1/p1.a'), /403/);
  } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }
});
test('real presigner: upload and download URLs carry no checksum', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { AWS_REGION: 'eu-north-1', AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE', AWS_SECRET_ACCESS_KEY: 'dummysecret' });
  try {
    const { s3, backupS3 } = createClients({ BACKUP_REGION: 'eu-west-1' });
    const files = createFiles({ s3, bucket: 'pbs-test', backupS3, backupBucket: 'pbs-test-backup' });
    const put = await files.presignPut(`incoming/b-${'a'.repeat(32)}/p1/${'b'.repeat(32)}.jpg`, 1234), url = new URL(put.url);
    assert.ok(!/x-amz-checksum|x-amz-sdk-checksum/i.test(put.url), put.url);
    assert.ok(url.searchParams.get('X-Amz-SignedHeaders').includes('content-length'), 'size stays signed');
    assert.ok(url.searchParams.get('X-Amz-SignedHeaders').includes('content-type'));
    assert.equal(url.searchParams.get('X-Amz-Expires'), '600');
    assert.ok(!/x-amz-checksum/i.test(await files.presignGet('buckets/x/photos/p/a.jpg')));
  } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }
});
test('backup counts: per bucket for the UI, and failed across all buckets for admins', async () => {
  const h = harness(); const one = await ready(h), two = await ready(h);
  const p1 = await committed(h, one.id, one.a, 'p1'), p2 = await committed(h, one.id, one.a, 'p2'), p3 = await committed(h, two.id, two.a, 'p1');
  const boom = async () => { throw new Error('boom'); }, overview = async () => (await h.call('GET', '/admin/backups', { token: 'admin-token' })).body;
  assert.deepEqual(await overview(), { failed: 0, buckets: [] });
  await backupAll(h, [p1.imageKey, p2.imageKey, p3.imageKey], boom);
  const seen = await overview(); assert.equal(seen.failed, 3);
  assert.deepEqual(seen.buckets.sort((x, y) => y.failed - x.failed), [{ bucketId: one.id, failed: 2 }, { bucketId: two.id, failed: 1 }]);
  for (const token of ['customer-token', 'stranger-token', one.a.token]) assert.equal((await h.call('GET', '/admin/backups', { token })).status, 403);
  assert.equal((await h.call('GET', '/admin/backups')).status, 401);
  assert.equal((await h.call('POST', '/admin/backups', { token: 'admin-token' })).status, 404);
  assert.deepEqual((await h.call('GET', `/b/${one.id}/backups`, { token: 'admin-token' })).body.failed, 2);
  // A failed photo the customer deletes still counts; a backup that succeeds, or a guest delete, clears it.
  await h.call('DELETE', `/b/${one.id}/photos/p1`, { token: 'customer-token' });
  assert.equal((await overview()).failed, 3);
  await backupAll(h, [p1.imageKey]);
  assert.equal((await overview()).failed, 2);
  await h.call('DELETE', `/b/${two.id}/photos/p1`, { token: two.a.token });
  assert.deepEqual(await overview(), { failed: 1, buckets: [{ bucketId: one.id, failed: 1 }] });
});

// ---------- AWS load test fixes ----------
test('D3: S3 SlowDown and bodiless 503s answer 503 BUSY with Retry-After, never 500', async () => {
  for (const failure of [{ name: 'SlowDown', $metadata: { httpStatusCode: 503 } }, { name: 'UnknownError', $metadata: { httpStatusCode: 503 } }, { name: 'InternalError', $metadata: { httpStatusCode: 500 } }]) {
    const slow = { send: async () => { throw Object.assign(new Error('slow'), failure); } };
    const real = createFiles({ s3: slow, bucket: 'b', backupS3: slow, backupBucket: 'k' });
    await assert.rejects(real.head('x'), e => e.busy === true, failure.name);
    await assert.rejects(real.purgeKeys('backups', ['x']), e => e.busy === true);
    const files = { ...fakeFiles() }; const h = harness({ files }); const { id, a } = await ready(h);
    const grant = await h.upload(a.token, id, 'p1', await jpeg(), await jpeg(60, 40));
    files.head = real.head;
    const r = await h.call('POST', `/b/${id}/photos/p1/commit`, { token: a.token, body: { uploadId: grant.body.uploadId } });
    assert.equal(r.status, 503, failure.name); assert.equal(r.body.code, 'BUSY'); assert.equal(r.headers['retry-after'], '1');
  }
  const missing = { send: async () => { throw Object.assign(new Error('nf'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } }); } };
  assert.equal(await createFiles({ s3: missing, bucket: 'b', backupS3: missing, backupBucket: 'k' }).head('x'), null, 'a missing key is still just missing');
});
test('D4: replacing a photo whose backup finishes at that moment keeps backupBytes exact', async () => {
  const h = harness(); const { id, a } = await ready(h), p = await committed(h, id, a);
  const next = await jpeg(900, 700), thumb = await jpeg(60, 40), g = await h.upload(a.token, id, 'p1', next, thumb, { replace: true });
  const real = h.store.commitPhoto; let raced = false;
  h.store.commitPhoto = async args => { if (!raced) { raced = true; await backupAll(h, [p.imageKey]); assert.ok(counterTotals(h.dynamo, id).backupBytes > 0); } return real(args); };
  const r = await h.call('POST', `/b/${id}/photos/p1/commit`, { token: a.token, body: { uploadId: g.body.uploadId, expectedRevision: 1 } });
  h.store.commitPhoto = real;
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.revision, 2);
  const t = counterTotals(h.dynamo, id); assert.equal(t.backupBytes, 0, 'the old backup was subtracted'); assert.equal(t.bytes, next.length + thumb.length);
  assert.equal(h.files.backups.has(p.backupKey), false);
});
test('D5: copies from a refused commit are swept, but never a photo that a parallel retry committed', async () => {
  let now = 1_800_000_000_000;
  const h = harness({ clock: () => now }); const { id, a } = await ready(h);
  const image = await jpeg(), thumb = await jpeg(60, 40), sweep = createAdminSweep({ store: h.store, files: h.files, now: () => now });
  const refuse = async (pid) => {
    const g = await h.upload(a.token, id, pid, image, thumb);
    const real = h.store.commitPhoto; h.store.commitPhoto = async () => { throw Object.assign(new Error('c'), { conflict: true, reason: 'full' }); };
    const r = await h.call('POST', `/b/${id}/photos/${pid}/commit`, { token: a.token, body: { uploadId: g.body.uploadId } });
    h.store.commitPhoto = real; assert.equal(r.status, 507);
    return { g, key: `buckets/${id}/photos/${pid}/${g.body.uploadId}.jpg` };
  };
  const orphan = await refuse('o1');
  assert.ok(h.files.current(orphan.key)); assert.equal(records(h, id, 'TOMB#').length, 1);
  // Its backup event is dropped at once instead of being retried for 15 minutes.
  assert.deepEqual((await createBackupHandler({ store: h.store, files: h.files, now: () => now })({ Records: [s3Message(orphan.key, new Date(now).toISOString())] })).batchItemFailures, []);
  // A parallel retry of the same upload that then succeeds keeps its files and photo.
  const kept = await refuse('k1');
  assert.equal((await h.call('POST', `/b/${id}/photos/k1/commit`, { token: a.token, body: { uploadId: kept.g.body.uploadId } })).status, 200);
  now += FIVE_MIN + 1;
  const result = await sweep({}); assert.equal(result.photos, 2);
  assert.equal(h.files.photos.has(orphan.key), false, 'orphan copies removed');
  assert.ok(h.files.current(kept.key), 'the committed photo keeps its file');
  assert.equal((await h.call('GET', `/b/${id}/photos/k1/url`, { token: a.token })).status, 200);
  assert.equal(records(h, id, 'TOMB#').length, 0);
});
test('D10: a JPEG with a valid header but a truncated body is refused; trailing zero padding is fine', async () => {
  const h = harness(); const { id, a } = await ready(h), whole = await jpeg(1000, 800, '#3a7');
  const cut = whole.subarray(0, Math.floor(whole.length * 0.6));
  const r = await commitOne(h, a.token, id, 'cut', cut, await jpeg(60, 40));
  assert.equal(r.status, 400); assert.equal(r.body.code, 'INVALID_PHOTO'); assert.match(r.body.error, /did not upload completely/);
  assert.equal((await commitOne(h, a.token, id, 'thumbcut', whole, (await jpeg(60, 40)).subarray(0, 200))).status, 400);
  assert.equal((await commitOne(h, a.token, id, 'padded', Buffer.concat([whole, Buffer.alloc(10)]), await jpeg(60, 40))).status, 200);
  assert.equal(hasJpegEnd(Buffer.from([0xff, 0xd9])), true); assert.equal(hasJpegEnd(Buffer.from([0xff])), false); assert.equal(hasJpegEnd(Buffer.alloc(8)), false);
  assert.equal(counterTotals(h.dynamo, id).photos, 1);
});

// ---------- uploader names ----------
test('uploader names on: guests name themselves when joining or uploading; owners see names', async () => {
  const h = harness(); const made = await h.createBucket(), id = made.body.id;
  assert.equal(made.body.showUploaderNames, true, 'on by default');
  assert.equal((await h.call('GET', `/b/${id}/public`)).body.showUploaderNames, true);
  const amelia = (await h.call('POST', `/b/${id}/guest`, { body: { name: '  Amelia\u0007 Rose  ' } })).body;
  assert.equal(amelia.name, 'Amelia Rose');
  const long = (await h.call('POST', `/b/${id}/guest`, { body: { name: 'x'.repeat(60) } })).body;
  assert.equal(long.name.length, 40);
  assert.equal((await h.call('POST', `/b/${id}/guest`, { body: { name: 42 } })).status, 400);
  const quiet = (await h.call('POST', `/b/${id}/guest`)).body; assert.equal(quiet.name, undefined);
  const image = await jpeg(), thumb = await jpeg(60, 40);
  assert.equal((await commitOne(h, amelia.token, id, 'a1', image, thumb)).body.name, 'Amelia Rose', 'the join name is used');
  assert.equal((await commitOne(h, quiet.token, id, 'q1', image, thumb, {}, { name: 'Omar' })).body.name, 'Omar', 'or a name sent with the upload');
  assert.equal((await commitOne(h, quiet.token, id, 'q2', image, thumb)).body.name, 'Omar', 'which is remembered for that guest');
  const owner = await pages(h.call, `/b/${id}/photos`, { token: 'customer-token' });
  assert.deepEqual(owner.map(p => p.name).sort(), ['Amelia Rose', 'Omar', 'Omar']);
  assert.ok(owner.every(p => typeof p.contributorId === 'string'));
  assert.equal((await h.call('GET', `/b/${id}/photos`, { token: 'customer-token', query: { contributor: quiet.contributorId } })).body.items.length, 2);
});
test('uploader names off: customers get no names and nothing that tells contributors apart; admins and guests still do', async () => {
  const h = harness(); const made = await h.createBucket({ showUploaderNames: false }), id = made.body.id;
  assert.equal(made.body.showUploaderNames, false);
  assert.equal((await h.createBucket({ showUploaderNames: 'no' })).status, 400);
  assert.equal((await h.call('GET', `/b/${id}/public`)).body.showUploaderNames, false, 'the guest page knows not to ask');
  const g = (await h.call('POST', `/b/${id}/guest`, { body: { name: 'Layla' } })).body;
  await commitOne(h, g.token, id, 'p1', await jpeg(), await jpeg(60, 40));
  const customer = await h.call('GET', `/b/${id}/photos`, { token: 'customer-token' }), text = JSON.stringify(customer.body);
  assert.equal(customer.body.items.length, 1);
  assert.ok(!('name' in customer.body.items[0]) && !('contributorId' in customer.body.items[0]));
  assert.ok(!text.includes('Layla') && !text.includes(g.contributorId), text);
  const filtered = await h.call('GET', `/b/${id}/photos`, { token: 'customer-token', query: { contributor: g.contributorId } });
  assert.equal(filtered.status, 403); assert.equal(filtered.body.code, 'NAMES_HIDDEN');
  const admin = await h.call('GET', `/b/${id}/photos`, { token: 'admin-token' });
  assert.equal(admin.body.items[0].name, 'Layla'); assert.equal(admin.body.items[0].contributorId, g.contributorId);
  assert.equal((await h.call('GET', `/b/${id}/photos`, { token: g.token })).body.items[0].name, 'Layla', 'the guest sees their own');
  // Only an admin can switch it, through PATCH.
  const tried = await h.call('PATCH', `/b/${id}`, { token: 'customer-token', body: { showUploaderNames: true } });
  assert.equal(tried.status, 403); assert.equal((await h.call('GET', `/b/${id}/public`)).body.showUploaderNames, false);
  assert.equal((await h.call('PATCH', `/b/${id}`, { token: 'admin-token', body: { showUploaderNames: 'yes' } })).status, 400);
  assert.equal((await h.call('PATCH', `/b/${id}`, { token: 'customer-token', body: { name: 'Renamed' } })).status, 200, 'customers still edit details');
  assert.equal((await h.call('PATCH', `/b/${id}`, { token: 'admin-token', body: { showUploaderNames: true } })).body.showUploaderNames, true);
  assert.equal((await h.call('GET', `/b/${id}/photos`, { token: 'customer-token' })).body.items[0].name, 'Layla');
});

// ---------- event songs ----------
const mp3Frame = (fill = 0) => { const f = Buffer.alloc(417, fill); f[0] = 0xff; f[1] = 0xfb; f[2] = 0x90; f[3] = 0x00; return f; }; // MPEG1 Layer III, 128 kbps, 44.1 kHz
const mp3 = (frames = 6) => Buffer.concat(Array.from({ length: frames }, () => mp3Frame()));
async function songUpload(h, eventId, bytes, token = 'admin-token') {
  const grant = await h.call('POST', `/events/${encodeURIComponent(eventId)}/song/uploads`, { token, body: { size: bytes.length } });
  if (grant.status !== 200) return { grant };
  h.files.store(`audio/${eventId}/${grant.body.uploadId}.mp3`, bytes);
  return { grant, commit: await h.call('POST', `/events/${encodeURIComponent(eventId)}/song/commit`, { token, body: { uploadId: grant.body.uploadId } }) };
}
test('event songs: admin-only upload with MP3 checks, public short-lived URL, replace and delete purge', async () => {
  const h = harness(), ev = 'AbC123xyzEvent0000001';
  assert.equal((await h.call('GET', `/events/${ev}/song`)).body.code, 'NO_SONG');
  for (const token of ['customer-token', undefined]) assert.equal((await h.call('POST', `/events/${ev}/song/uploads`, { token, body: { size: 10 } })).status, token ? 403 : 401);
  for (const bad of ['..', '__x__', 'a'.repeat(129), 'a%2Fb', 'a%01b']) assert.equal((await h.call('GET', `/events/${bad}/song`)).body.code, 'INVALID_EVENT', bad);
  assert.equal((await h.call('POST', `/events/${ev}/song/uploads`, { token: 'admin-token', body: { size: 15 * 1024 * 1024 + 1 } })).body.code, 'INVALID_AUDIO');
  const grant = await h.call('POST', `/events/${ev}/song/uploads`, { token: 'admin-token', body: { size: 1000 } });
  assert.match(grant.body.upload.url, new RegExp(`^put://audio/${ev}/[a-f0-9]{32}\\.mp3$`)); assert.equal(grant.body.upload.headers['content-type'], 'audio/mpeg');
  // Not MP3, or a single frame header followed by junk: refused.
  assert.equal((await songUpload(h, ev, await jpeg())).commit.body.code, 'INVALID_AUDIO');
  assert.equal((await songUpload(h, ev, Buffer.concat([mp3Frame(), Buffer.alloc(500, 7)]))).commit.body.code, 'INVALID_AUDIO');
  const first = await songUpload(h, ev, mp3());
  assert.equal(first.commit.status, 200, JSON.stringify(first.commit.body));
  const firstKey = `audio/${ev}/${first.grant.body.uploadId}.mp3`;
  assert.equal([...h.files.photos.keys()].filter(k => k.startsWith(`audio/${ev}/`)).length, 1, 'refused uploads were purged with the commit');
  assert.equal((await h.call('POST', `/events/${ev}/song/commit`, { token: 'admin-token', body: { uploadId: first.grant.body.uploadId } })).status, 200, 'idempotent');
  const played = await h.call('GET', `/events/${ev}/song`);
  assert.equal(played.status, 200); assert.equal(played.body.url, `get://${firstKey}#audio/mpeg`);
  assert.match(played.headers['cache-control'], /^public, max-age=300$/); assert.ok(played.body.expiresAt > Date.now() + 300000, 'the URL outlives the cache');
  // An ID3 tag before the frames is skipped.
  const tag = Buffer.alloc(10 + 300); tag.write('ID3', 0, 'latin1'); tag[3] = 4; tag[9] = 300 & 0x7f; tag[8] = 300 >> 7;
  const second = await songUpload(h, ev, Buffer.concat([tag, mp3()]));
  assert.equal(second.commit.status, 200, JSON.stringify(second.commit.body));
  assert.equal(h.files.photos.has(firstKey), false, 'replacing deletes the old song');
  assert.match((await h.call('GET', `/events/${ev}/song`)).body.url, new RegExp(second.grant.body.uploadId));
  assert.equal((await h.call('DELETE', `/events/${ev}/song`, { token: 'customer-token' })).status, 403);
  assert.equal((await h.call('DELETE', `/events/${ev}/song`, { token: 'admin-token' })).status, 204);
  assert.equal((await h.call('GET', `/events/${ev}/song`)).body.code, 'NO_SONG');
  assert.equal([...h.files.photos.keys()].filter(k => k.startsWith('audio/')).length, 0);
  // Deleting the event purges its song too, and touches no other event.
  await songUpload(h, ev, mp3()); await songUpload(h, 'other-event', mp3());
  assert.equal((await h.call('DELETE', `/events/${ev}`, { token: 'admin-token' })).status, 204);
  assert.equal((await h.call('GET', `/events/${ev}/song`)).status, 404);
  assert.equal((await h.call('GET', '/events/other-event/song')).status, 200);
});

// ---------- demos ----------
test('demo buckets: 1 GB fixed, 24 h, rejected by the API once expired, even before cleanup', async () => {
  let now = 1_800_000_000_000;
  const h = harness({ clock: () => now });
  assert.equal((await h.createBucket({ demo: true, gb: 15 })).status, 400);
  assert.equal((await h.createBucket({ demo: 'yes' })).status, 400);
  const made = await h.createBucket({ demo: true, gb: undefined });
  assert.equal(made.status, 201); assert.match(made.body.id, /^demo-[a-f0-9]{32}$/);
  assert.equal(made.body.limitBytes, 1024 ** 3); assert.equal(made.body.expiresAt, now + 24 * 3600 * 1000); assert.equal(made.body.demo, true);
  const id = made.body.id, guest = (await h.call('POST', `/b/${id}/guest`)).body;
  assert.equal(counterTotals(h.dynamo, id).shardCount, 4);
  assert.equal((await h.call('PUT', `/b/${id}/size`, { token: 'admin-token', body: { gb: 15 } })).status, 409);
  await commitOne(h, guest.token, id, 'p1', await jpeg(), await jpeg(60, 40));
  now += 24 * 3600 * 1000;
  for (const [m, path, token] of [['GET', `/b/${id}/public`], ['POST', `/b/${id}/guest`], ['GET', `/b/${id}/photos`, guest.token], ['POST', `/b/${id}/uploads`, guest.token], ['GET', `/b/${id}`, 'customer-token'], ['GET', `/b/${id}`, 'admin-token'], ['GET', `/b/${id}/photos/p1/url`, 'customer-token']]) {
    const r = await h.call(m, path, { token, body: m === 'POST' ? { photoId: 'p2', size: 5, thumbSize: 5 } : undefined });
    assert.equal(r.status, 410, `${m} ${path}`); assert.equal(r.body.code, 'BUCKET_EXPIRED');
  }
  assert.deepEqual(await pages(h.call, '/owner/list', { token: 'customer-token' }), []);
  assert.equal((await pages(h.call, '/owner/list', { token: 'admin-token' }))[0].expired, true);
  assert.ok(h.dynamo.dump().some(i => i.pk === `BUCKET#${id}`), 'not yet cleaned');
});
test('demo sweep removes objects, versions, backups and records, and is resumable and idempotent', async () => {
  let now = 1_800_000_000_000;
  const h = harness({ clock: () => now });
  const demo = (await h.createBucket({ demo: true, gb: undefined })).body.id, young = (await h.createBucket({ demo: true, gb: undefined })).body.id;
  const guest = (await h.call('POST', `/b/${demo}/guest`)).body, image = await jpeg(), thumb = await jpeg(60, 40);
  for (const pid of ['p1', 'p2', 'p3']) await commitOne(h, guest.token, demo, pid, image, thumb);
  await h.call('DELETE', `/b/${demo}/photos/p1`, { token: guest.token }); // a delete marker and a version to purge too
  const keep = await h.upload(guest.token, demo, 'unfinished', image, thumb);
  assert.equal(keep.status, 200);
  await createBackupHandler({ store: h.store, files: h.files })({ Records: [...h.files.events.filter(k => k.includes('/photos/p2/') && k.endsWith('.jpg')).map(k => s3Message(k))] });
  assert.ok([...h.files.backups.keys()].length);
  const later = now + 72 * 3600000; h.dynamo.put({ ...h.dynamo.dump().find(i => i.pk === `BUCKET#${young}` && i.sk === 'META'), expiresAt: later, gsi2sk: `${later}#${young}` });
  now += 24 * 3600 * 1000;
  const sweep = createDemoSweep({ store: h.store, files: h.files, now: () => now });
  // Run out of time partway: nothing is lost, the record survives and the next run finishes.
  let left = 2; const partial = await sweep({}, { getRemainingTimeInMillis: () => (left-- > 0 ? 60000 : 1000) });
  assert.equal(partial.purged, 0); assert.equal(partial.unfinished, 1);
  assert.equal(h.dynamo.dump().find(i => i.pk === `BUCKET#${demo}` && i.sk === 'META').status, 'deleting');
  assert.equal(counterTotals(h.dynamo, demo).shardCount, 4);
  const done = await sweep({});
  assert.equal(done.purged, 1);
  assert.equal([...h.files.photos.keys()].filter(k => k.includes(demo)).length, 0);
  assert.equal([...h.files.backups.keys()].filter(k => k.includes(demo)).length, 0);
  assert.equal(h.dynamo.dump().filter(i => i.pk === `BUCKET#${demo}`).length, 0);
  assert.equal((await sweep({})).purged, 0, 'a third run finds nothing');
  assert.equal((await h.call('GET', `/b/${demo}/public`)).status, 404);
  assert.ok(h.dynamo.dump().some(i => i.pk === `BUCKET#${young}` && i.sk === 'META'), 'an unexpired demo is left alone');
});
test('the demo sweep cannot touch a non-demo bucket, whatever the index says', async () => {
  let now = 1_800_000_000_000;
  const h = harness({ clock: () => now });
  const real = (await h.createBucket({ gb: 15 })).body.id, guest = (await h.call('POST', `/b/${real}/guest`)).body;
  await commitOne(h, guest.token, real, 'p1', await jpeg(), await jpeg(60, 40));
  const liar = (await h.createBucket({ demo: true, gb: undefined })).body.id; // right id shape, but the record says it is not a demo
  const edit = (id, change) => { const meta = h.dynamo.dump().find(i => i.pk === `BUCKET#${id}` && i.sk === 'META'); h.dynamo.put({ ...meta, ...change }); };
  edit(liar, { demo: false }); edit(real, { demo: true, expiresAt: 1, gsi2pk: 'DEMO', gsi2sk: `${'0'.repeat(13)}#${real}` }); // poison the real bucket: even with demo=true its id is not demo-*
  now += 90 * 86400000;
  const snapshot = () => JSON.stringify([h.dynamo.dump().filter(i => !i.sk.startsWith('RATE#')).map(i => [i.pk, i.sk, i.status]), [...h.files.photos.keys()]]);
  const before = snapshot();
  const touched = [];
  const guarded = { ...h.files, purge: (t, p, f) => { touched.push(p); return h.files.purge(t, p, f); } };
  const result = await createDemoSweep({ store: h.store, files: guarded, now: () => now })({});
  assert.equal(result.purged, 0); assert.equal(result.refused, 2);
  assert.deepEqual(touched, []); assert.equal(snapshot(), before);
  // Even if the index is ignored and the real id handed in directly by a faulty store, the id test refuses it.
  const forced = { ...h.store, listExpiredDemos: async () => ({ ids: [real], nextCursor: null }), markDeleting: async () => assert.fail('must not mark'), deleteItems: async () => assert.fail('must not delete') };
  assert.equal((await createDemoSweep({ store: forced, files: guarded, now: () => now })({})).refused, 1);
  assert.deepEqual(touched, []);
});

test('the admin picks the demo lifetime at creation; rejection and the sweep follow the stored expiresAt', async () => {
  let now = 1_800_000_000_000;
  const h = harness({ clock: () => now }), demo = body => h.createBucket({ demo: true, gb: undefined, ...body });
  assert.deepEqual(DEMO_EXPIRY_HOURS, [6, 12, 24, 48, 72, 168]);
  for (const hours of DEMO_EXPIRY_HOURS) { const made = await demo({ expiresInHours: hours }); assert.equal(made.status, 201); assert.equal(made.body.expiresAt, now + hours * 3600000); assert.equal(made.body.limitBytes, 1024 ** 3); }
  assert.equal((await demo()).body.expiresAt, now + 24 * 3600000, 'default');
  for (const bad of [0, 1, 7, 24.5, 169, -6, '24', null, true, [24]]) { const r = await demo({ expiresInHours: bad }); assert.equal(r.status, 400, String(bad)); assert.equal(r.body.code, 'INVALID_EXPIRY'); }
  assert.equal((await h.createBucket({ expiresInHours: 24 })).status, 400, 'a non-demo bucket never expires');
  const short = (await demo({ expiresInHours: 6 })).body.id, long = (await demo({ expiresInHours: 168 })).body.id;
  const sweep = createDemoSweep({ store: h.store, files: h.files, now: () => now });
  now += 6 * 3600000 - 1;
  assert.equal((await h.call('GET', `/b/${short}/public`)).status, 200);
  now += 1;
  assert.equal((await h.call('GET', `/b/${short}/public`)).status, 410);
  await sweep({});
  assert.equal(h.dynamo.dump().filter(i => i.pk === `BUCKET#${short}`).length, 0);
  assert.equal((await h.call('GET', `/b/${long}/public`)).status, 200, 'a longer demo is still there');
  now += 162 * 3600000 - 1;
  await sweep({});
  assert.equal((await h.call('GET', `/b/${long}/public`)).status, 200);
  now += 1;
  assert.equal((await h.call('GET', `/b/${long}/public`)).status, 410);
  await sweep({});
  assert.equal(h.dynamo.dump().filter(i => i.pk === `BUCKET#${long}`).length, 0);
});

// ---------- admin deletion ----------
test('only an admin deletes a bucket; it closes at once and the sweep purges it', async () => {
  const h = harness(); const { id, a } = await ready(h); const other = await ready(h);
  const image = await jpeg(), thumb = await jpeg(60, 40), g = await h.upload(a.token, id, 'p1', image, thumb);
  await h.call('POST', `/b/${id}/photos/p1/commit`, { token: a.token, body: { uploadId: g.body.uploadId } });
  await commitOne(h, other.a.token, other.id, 'p1', image, thumb);
  await createBackupHandler({ store: h.store, files: h.files })({ Records: [s3Message(`buckets/${id}/photos/p1/${g.body.uploadId}.jpg`)] });
  const late = await h.upload(a.token, id, 'p2', image, thumb);
  assert.equal((await h.call('DELETE', `/b/${id}`, { token: 'customer-token', query: { confirm: id } })).status, 403);
  assert.equal((await h.call('DELETE', `/b/${id}`, { token: a.token, query: { confirm: id } })).status, 403);
  assert.equal((await h.call('DELETE', `/b/${id}`, { token: 'admin-token' })).status, 400);
  assert.equal((await h.call('DELETE', `/b/${id}`, { token: 'admin-token', query: { confirm: other.id } })).status, 400);
  const gone = await h.call('DELETE', `/b/${id}`, { token: 'admin-token', query: { confirm: id } });
  assert.equal(gone.status, 202); assert.equal(gone.body.status, 'deleting');
  assert.equal((await h.call('DELETE', `/b/${id}`, { token: 'admin-token', query: { confirm: id } })).status, 202, 'idempotent');
  assert.equal((await h.call('GET', `/b/${id}/public`)).status, 404);
  assert.equal((await h.call('POST', `/b/${id}/guest`)).status, 404);
  assert.equal((await h.call('GET', `/b/${id}`, { token: 'customer-token' })).status, 404);
  assert.deepEqual((await pages(h.call, '/owner/list', { token: 'customer-token' })).map(b => b.id), [other.id]);
  await assert.rejects(h.store.commitPhoto({ bucketId: id, shards: 32, stamp: 1, previous: null, photo: { id: 'p2', uploadId: late.body.uploadId, contributorId: 'c', bytes: 10, createdAt: 1, revision: 1, backupState: 'pending' } }), e => e.reason === 'closed', 'a commit already past the front door is refused');
  const swept = await createAdminSweep({ store: h.store, files: h.files })({});
  assert.equal(swept.purged, 1);
  assert.equal(h.dynamo.dump().filter(i => i.pk === `BUCKET#${id}`).length, 0);
  assert.equal([...h.files.photos.keys()].filter(k => k.includes(id)).length, 0); assert.equal([...h.files.backups.keys()].filter(k => k.includes(id)).length, 0);
  assert.equal((await h.call('GET', `/b/${other.id}/photos`, { token: 'customer-token' })).body.items.length, 1, 'the other bucket is untouched');
  assert.ok([...h.files.photos.keys()].some(k => k.includes(other.id)));
  assert.equal((await h.call('DELETE', `/b/${id}`, { token: 'admin-token', query: { confirm: id } })).status, 404);
});
test('the admin sweep refuses anything not marked deleting by the API', async () => {
  const h = harness(); const { id } = await ready(h);
  const meta = h.dynamo.dump().find(i => i.pk === `BUCKET#${id}` && i.sk === 'META');
  h.dynamo.put({ ...meta, gsi2pk: 'PURGE', gsi2sk: `0#${id}` });
  assert.equal((await createAdminSweep({ store: h.store, files: h.files })({})).refused, 1);
  assert.ok(h.dynamo.dump().some(i => i.pk === `BUCKET#${id}` && i.sk === 'META'));
});

// ---------- freeze ----------
test('only the main admin can freeze one bucket; everyone else gets a friendly 503; other buckets carry on', async () => {
  const h = harness(); const { id, a } = await ready(h), other = await ready(h);
  assert.equal((await h.call('POST', `/b/${id}/freeze`, { token: 'customer-token', body: { frozen: true } })).status, 403);
  assert.equal((await h.call('POST', `/b/${id}/freeze`, { token: 'stranger-token', body: { frozen: true } })).status, 403);
  assert.equal((await h.call('POST', `/b/${id}/freeze`, { token: a.token, body: { frozen: true } })).status, 403);
  assert.equal((await h.call('GET', `/b/${id}`, { token: 'admin-token' })).body.canFreeze, true);
  assert.equal((await h.call('GET', `/b/${id}`, { token: 'customer-token' })).body.canFreeze, false);
  const frozen = await h.call('POST', `/b/${id}/freeze`, { token: 'admin-token', body: { frozen: true } });
  assert.equal(frozen.status, 200); assert.equal(frozen.body.frozen, true);
  for (const [method, path, token] of [['GET', `/b/${id}/public`], ['POST', `/b/${id}/guest`], ['GET', `/b/${id}/photos`, a.token], ['GET', `/b/${id}`, 'customer-token'], ['POST', `/b/${id}/freeze`, 'customer-token']]) {
    const r = await h.call(method, path, { token, body: { frozen: false } });
    assert.equal(r.status, 503, `${method} ${path}`); assert.match(r.body.error, /paused until the event/); assert.equal(r.body.code, 'BUCKET_FROZEN');
  }
  assert.equal((await h.call('GET', `/b/${other.id}/public`)).status, 200);
  assert.equal((await h.call('GET', `/b/${id}`, { token: 'admin-token' })).body.frozen, true);
  assert.equal((await h.call('GET', `/b/${id}/photos`, { token: 'admin-token' })).status, 503);
  const resumed = await h.call('POST', `/b/${id}/freeze`, { token: 'admin-token', body: { frozen: false } });
  assert.equal(resumed.body.frozen, false);
  assert.equal((await h.call('GET', `/b/${id}/public`)).status, 200);
  assert.equal((await h.call('GET', `/b/${id}/photos`, { token: a.token })).status, 200);
});

// ---------- rate limiting ----------
test('guest token minting is bounded per address and per bucket, with Retry-After', async () => {
  const now = 1_800_000_000_000;
  const h = harness({ clock: () => now, mintPerBucket: 5, mintPerIp: 3 }); const made = await h.createBucket(), id = made.body.id;
  for (let i = 0; i < 3; i++) assert.equal((await h.call('POST', `/b/${id}/guest`, { ip: '1.1.1.1' })).status, 200);
  const blocked = await h.call('POST', `/b/${id}/guest`, { ip: '1.1.1.1' });
  assert.equal(blocked.status, 429); assert.equal(blocked.body.code, 'RATE_LIMITED'); assert.ok(Number(blocked.headers['retry-after']) > 0);
  for (let i = 0; i < 2; i++) assert.equal((await h.call('POST', `/b/${id}/guest`, { ip: `2.2.2.${i}` })).status, 200);
  assert.equal((await h.call('POST', `/b/${id}/guest`, { ip: '3.3.3.3' })).status, 429, 'bucket window used up');
  const rate = h.dynamo.dump().filter(i => i.sk.startsWith('RATE#'));
  assert.ok(rate.every(i => i.ttl > now / 1000)); assert.ok(rate.every(i => !i.sk.includes('1.1.1.1')), 'no raw addresses stored');
  const other = (await h.createBucket()).body.id;
  assert.equal((await h.call('POST', `/b/${other}/guest`, { ip: '1.1.1.1' })).status, 200, 'another bucket has its own window');
  assert.equal((await h.call('POST', '/b/nosuchbucket/guest', { ip: '4.4.4.4' })).status, 404);
  assert.equal(h.dynamo.dump().filter(i => i.pk === 'BUCKET#nosuchbucket').length, 0, 'unknown ids cost no writes');
});

// ---------- errors ----------
test('every error uses the same envelope; conflicts and throttles never become a 500', async () => {
  const h = harness();
  const bad = await h.call('GET', '/nope'); assert.equal(bad.status, 404); assert.deepEqual(Object.keys(bad.body).sort(), ['code', 'error']);
  assert.equal((await h.call('PUT', '/owner/list', { token: 'admin-token' })).status, 404);
  const array = await h.handler({ requestContext: { http: { method: 'POST' } }, rawPath: '/owner/create', headers: { authorization: 'Bearer admin-token' }, body: '[1]' });
  assert.equal(array.statusCode, 400);
  assert.equal((await h.handler({ requestContext: { http: { method: 'POST' } }, rawPath: '/owner/create', headers: {}, body: '{oops' })).statusCode, 400);
  assert.equal((await h.handler({ requestContext: { http: { method: 'POST' } }, rawPath: '/owner/create', headers: {}, body: 'x'.repeat(65 * 1024) })).statusCode, 413);
  const cancelled = reasons => Object.assign(new Error('c'), { name: 'TransactionCanceledException', CancellationReasons: reasons.map(Code => ({ Code })) });
  assert.equal(classify(cancelled(['None', 'TransactionConflict'])).busy, true);
  assert.equal(classify(cancelled(['None', 'ThrottlingError'])).busy, true);
  assert.deepEqual(classify(cancelled(['None', 'ConditionalCheckFailed'])).failed, [1]);
  assert.equal(classify(Object.assign(new Error('c'), { name: 'TransactionConflictException' })).busy, true);
  assert.equal(classify(Object.assign(new Error('c'), { name: 'ConditionalCheckFailedException' })).conflict, true);
  // An always-conflicting table: a commit must answer 503 BUSY with Retry-After, never 500.
  const stuck = harness({ dynamo: new FakeDynamo() }); const { id, a } = await ready(stuck);
  const image = await jpeg(), thumb = await jpeg(60, 40), grant = await stuck.upload(a.token, id, 'p1', image, thumb);
  stuck.dynamo.conflictRate = 1;
  const r = await stuck.call('POST', `/b/${id}/photos/p1/commit`, { token: a.token, body: { uploadId: grant.body.uploadId } });
  assert.equal(r.status, 503); assert.equal(r.body.code, 'BUSY'); assert.equal(r.headers['retry-after'], '1');
  stuck.dynamo.conflictRate = 0;
  assert.equal((await stuck.call('POST', `/b/${id}/photos/p1/commit`, { token: a.token, body: { uploadId: grant.body.uploadId } })).status, 200, 'the same request succeeds once the table is free');
  assert.equal(counterTotals(stuck.dynamo, id).photos, 1);
});
test('bucket id rules keep real ids away from the demo prefix', () => {
  assert.equal(validBucketId('demo-' + 'a'.repeat(32)), true);
  assert.equal(validBucketId('demo-party'), false);
  assert.equal(validBucketId('b-' + 'a'.repeat(32)), true);
  assert.equal(validBucketId('my-wedding'), false, 'the legacy id form is gone');
  for (const bad of ['', 'A', '../x', 'a/b', 'x'.repeat(31), null]) assert.equal(validBucketId(bad), false, String(bad));
});

// ---------- templates ----------
const tags = ['Ref', 'GetAtt', 'Sub', 'If', 'Equals', 'Not'].map(tag => [{ tag: `!${tag}`, resolve: v => v }, { tag: `!${tag}`, collection: 'seq', resolve: v => v }]).flat();
const template = name => parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'), { customTags: tags });
const statements = fn => fn.Properties.Policies.flatMap(p => p.Statement || []);
test('template protects data: Retain, PITR, versioning, private buckets, TTL, indexes', () => {
  const t = template('template.yaml').Resources;
  for (const name of ['Table', 'PhotoBucket', 'GuestTokenSecret']) { assert.equal(t[name].DeletionPolicy, 'RetainExceptOnCreate', name); assert.equal(t[name].UpdateReplacePolicy, 'Retain', name); }
  assert.equal(t.Table.Properties.DeletionProtectionEnabled, undefined, 'it would make a failed first create unable to roll back');
  assert.equal(t.GuestTokenSecret.Properties.Name, undefined, 'a fixed secret name stays reserved for days after a rollback');
  const deploy = readFileSync(new URL('../deploy.sh', import.meta.url), 'utf8');
  assert.match(deploy, /update-table .*--deletion-protection-enabled/); assert.match(deploy, /ROLLBACK_COMPLETE/);
  assert.ok(deploy.indexOf('--deletion-protection-enabled') > deploy.lastIndexOf('cloudformation deploy'), 'protection after the deploy');
  assert.equal(t.Table.Properties.PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled, true);
  assert.deepEqual(t.Table.Properties.GlobalSecondaryIndexes.map(g => g.IndexName), ['GSI1', 'GSI2', 'GSI3', 'GSI4']);
  assert.equal(t.Table.Properties.TimeToLiveSpecification.AttributeName, 'ttl');
  assert.equal(t.PhotoBucket.Properties.VersioningConfiguration.Status, 'Enabled');
  assert.equal(t.PhotoBucket.Properties.PublicAccessBlockConfiguration.BlockPublicPolicy, true);
  const rules = t.PhotoBucket.Properties.LifecycleConfiguration.Rules, versions = rules.find(r => r.Id === 'expire-old-versions');
  assert.equal(versions.NoncurrentVersionExpiration.NoncurrentDays, 30);
  assert.equal(rules.find(r => r.Id === 'expire-unfinished-uploads').Prefix, 'incoming/');
  const backup = template('backup.yaml').Resources.BackupBucket;
  assert.equal(backup.DeletionPolicy, 'RetainExceptOnCreate'); assert.equal(backup.UpdateReplacePolicy, 'Retain');
  assert.equal(backup.Properties.VersioningConfiguration.Status, 'Enabled');
  assert.equal(backup.Properties.PublicAccessBlockConfiguration.BlockPublicAcls, true);
  for (const rule of backup.Properties.LifecycleConfiguration.Rules) assert.deepEqual(Object.keys(rule).sort(), ['AbortIncompleteMultipartUpload', 'Id', 'Status'], 'nothing may expire a backup');
});
test('template wires backups through SQS with a DLQ, and notifies only on committed copies', () => {
  const t = template('template.yaml').Resources;
  const note = t.PhotoBucket.Properties.NotificationConfiguration.QueueConfigurations[0];
  assert.equal(note.Event, 's3:ObjectCreated:Copy');
  assert.deepEqual(note.Filter.S3Key.Rules, [{ Name: 'prefix', Value: 'buckets/' }, { Name: 'suffix', Value: '.jpg' }]);
  assert.ok(t.BackupQueue.Properties.RedrivePolicy.maxReceiveCount >= 3);
  assert.ok(t.BackupQueue.Properties.DelaySeconds > 0);
  assert.ok(t.BackupQueue.Properties.VisibilityTimeout >= 6 * t.BackupFunction.Properties.Timeout);
  const source = t.BackupFunction.Properties.Events.Queue.Properties;
  assert.deepEqual(source.FunctionResponseTypes, ['ReportBatchItemFailures']);
  assert.equal(t.BackupDlqAlarm.Properties.Threshold, 0);
});
test('IAM: the demo sweep reaches demo keys only; the API and backup roles have the delete rights their rules need', () => {
  const t = template('template.yaml').Resources, demo = statements(t.DemoSweepFunction);
  const flat = value => JSON.stringify(value);
  assert.equal(t.DemoSweepFunction.Properties.Handler, 'src/sweep.demoHandler');
  assert.equal(t.DemoSweepFunction.Properties.Events.Schedule.Properties.Schedule, 'rate(15 minutes)');
  for (const s of demo) {
    assert.ok(!flat(s.Action).includes('Scan') && !flat(s.Action).includes('*'), flat(s.Action));
    const text = flat(s);
    if (flat(s.Action).includes('s3:Delete')) { assert.ok(flat(s.Resource).includes('buckets/demo-*') && flat(s.Resource).includes('incoming/demo-*')); assert.ok(!/buckets\/\*|incoming\/\*|\/\*"/.test(flat(s.Resource)), flat(s.Resource)); }
    if (flat(s.Action).includes('ListBucketVersions')) assert.deepEqual(s.Condition.StringLike['s3:prefix'], ['buckets/demo-*', 'incoming/demo-*']);
    if (flat(s.Action).includes('dynamodb:')) assert.ok(text.includes('dynamodb:LeadingKeys'), text);
  }
  const leading = demo.flatMap(s => s.Condition?.['ForAllValues:StringLike']?.['dynamodb:LeadingKeys'] || []);
  assert.deepEqual(leading.sort(), ['BUCKET#demo-*', 'DEMO']);
  assert.equal(t.DemoSweepFunction.Properties.Policies.some(p => p.DynamoDBCrudPolicy), false);
  const api = flat(statements(t.ApiFunction));
  assert.ok(!api.includes('s3:*'));
  const apiVersionRights = statements(t.ApiFunction).filter(st => flat(st.Action).includes('Version'));
  assert.deepEqual(apiVersionRights.map(st => flat(st.Resource)).sort(), ['"arn:aws:s3:::pbs-${Stage}-${AWS::AccountId}-${AWS::Region}"', '"arn:aws:s3:::pbs-${Stage}-${AWS::AccountId}-${AWS::Region}/audio/*"'], 'the API can delete song versions only, never photo or backup versions');
  assert.deepEqual(apiVersionRights.find(st => flat(st.Action).includes('ListBucketVersions')).Condition.StringLike['s3:prefix'], ['audio/*']);
  assert.ok(api.includes('lambda:InvokeFunction'));
  const purge = statements(t.PhotoPurgeFunction), deletes = purge.find(st => flat(st.Action).includes('DeleteObjectVersion'));
  assert.equal(t.PhotoPurgeFunction.Properties.Handler, 'src/photo-purge.handler');
  assert.deepEqual(deletes.Action, ['s3:DeleteObjectVersion']);
  for (const arn of ['/buckets/*/photos/*', '/incoming/*', '/buckets/*/backup/*']) assert.ok(flat(deletes.Resource).includes(arn), arn);
  assert.equal(deletes.Resource.length, 3, 'nothing wider');
  assert.deepEqual(purge.find(st => flat(st.Action).includes('dynamodb')).Action, ['dynamodb:GetItem'], 'read-only on the table');
  const backupDelete = statements(t.BackupFunction).find(st => flat(st.Action).includes('DeleteObjectVersion'));
  assert.ok(flat(backupDelete.Resource).includes('buckets/*/backup/*'));
  assert.ok(flat(statements(t.AdminSweepFunction)).includes('DeleteObjectVersion'));
  assert.equal(t.AdminSweepFunction.Properties.Handler, 'src/sweep.adminHandler');
});
test('alarms and access logs exist, and every alarm notifies the required topic', () => {
  const doc = template('template.yaml'), t = doc.Resources;
  assert.equal(doc.Parameters.AlarmTopicArn.Default, undefined, 'required'); assert.ok(doc.Parameters.AlarmTopicArn.AllowedPattern);
  const alarms = Object.entries(t).filter(([, r]) => r.Type === 'AWS::CloudWatch::Alarm');
  assert.deepEqual(alarms.map(([n]) => n).sort(), ['Api429Alarm', 'Api5xxAlarm', 'ApiFunctionThrottleAlarm', 'BackupDlqAlarm', 'PhotoPurgeVolumeAlarm']);
  for (const [name, alarm] of alarms) assert.ok(JSON.stringify(alarm.Properties.AlarmActions).includes('AlarmTopicArn'), name);
  const format = t.Api.Properties.AccessLogSettings.Format;
  assert.ok(format.includes('$context.status') && format.includes('$context.requestId'));
  assert.ok(!/authorization|querystring|\$context\.identity\.(?!sourceIp\b)/i.test(format), 'no tokens or query strings in logs; the source address is the only identity field');
  assert.ok(t.ApiAccessLogs.Properties.RetentionInDays <= 30);
  const deploy = readFileSync(new URL('../deploy.sh', import.meta.url), 'utf8');
  assert.ok(deploy.includes('AlarmTopicArn="$ALARM_TOPIC"')); assert.match(deploy, /\[ \$# -ge 5 \]/);
});
test('API throttling leaves room for 200 devices across several buckets and limits minting by route', () => {
  const t = template('template.yaml');
  assert.equal(t.Parameters.ApiRateLimit.Default, 1500); assert.equal(t.Parameters.ApiBurstLimit.Default, 3000);
  assert.equal(t.Resources.PhotoPurgeFunction.Properties.ReservedConcurrentExecutions, 20);
  assert.equal(t.Resources.ApiFunction.Properties.ReservedConcurrentExecutions, undefined, 'the API is not reserved');
  assert.ok(t.Resources.Api.Properties.RouteSettings['POST /b/{bucketId}/guest'].ThrottlingRateLimit < t.Parameters.ApiRateLimit.Default);
  assert.equal(t.Resources.ApiFunction.Properties.Events.GuestMint.Properties.Path, '/b/{bucketId}/guest');
  const env = t.Resources.ApiFunction.Properties.Environment.Variables;
  assert.equal(env.OWNER_UIDS, undefined); assert.equal(env.EVENT_ID, undefined); assert.ok(env.ADMIN_UIDS);
  assert.equal(t.Parameters.EventId, undefined); assert.equal(t.Parameters.GuestTokenSecret, undefined);
  assert.equal(t.Resources.GuestTokenSecret.DeletionPolicy, 'RetainExceptOnCreate');
});
test('no trace of the old fixed-event shape remains in the code', () => {
  for (const file of ['handler.mjs', 'store.mjs', 'backup.mjs', 'index.mjs']) {
    const text = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.ok(!/EVENT_ID|OWNER_UIDS|usableBytes|backupBytes: 9|env\.EVENT/.test(text), file);
  }
});

test('the owner gallery pages newest first across the whole bucket, shows the real total, and new uploads lead page one', async () => {
  let t = 1_700_000_000_000; const h = harness({ clock: () => t }); const { id, a } = await ready(h);
  const image = await jpeg(), thumb = await jpeg(60, 40), made = [];
  // Random photo ids, so id order and upload order disagree, as with real job ids.
  for (let n = 0; n < 25; n++) {
    const pid = `p${createHash('sha1').update(String(n)).digest('hex').slice(0, 12)}`; t += 1000;
    const g = await h.upload(a.token, id, pid, image, thumb);
    assert.equal((await h.call('POST', `/b/${id}/photos/${pid}/commit`, { token: a.token, body: { uploadId: g.body.uploadId } })).status, 200);
    made.push(pid);
  }
  const first = await h.call('GET', `/b/${id}/photos`, { token: 'customer-token', query: { limit: '10' } });
  assert.equal(first.status, 200); assert.equal(first.body.total, 25);
  assert.deepEqual(first.body.items.map(p => p.id), made.slice(-10).reverse(), 'page one holds the ten newest, newest first');
  const all = []; let cursor;
  do { const r = await h.call('GET', `/b/${id}/photos`, { token: 'customer-token', query: { limit: '10', ...(cursor ? { cursor } : {}) } }); all.push(...r.body.items.map(p => p.id)); cursor = r.body.nextCursor; assert.equal(r.body.total === undefined, Boolean(all.length > 10), 'total only on page one'); } while (cursor);
  assert.deepEqual(all, [...made].reverse(), 'every photo once, in upload order');
  const oldest = await h.call('GET', `/b/${id}/photos`, { token: 'customer-token', query: { limit: '5', order: 'oldest' } });
  assert.deepEqual(oldest.body.items.map(p => p.id), made.slice(0, 5));
  t += 1000; const g = await h.upload(a.token, id, 'newest-one', image, thumb);
  await h.call('POST', `/b/${id}/photos/newest-one/commit`, { token: a.token, body: { uploadId: g.body.uploadId } });
  const again = await h.call('GET', `/b/${id}/photos`, { token: 'customer-token', query: { limit: '10' } });
  assert.equal(again.body.items[0].id, 'newest-one'); assert.equal(again.body.total, 26);
  assert.equal((await h.call('GET', `/b/${id}/photos`, { token: 'customer-token', query: { order: 'random' } })).status, 400);
  const mine = await h.call('GET', `/b/${id}/photos`, { token: a.token, query: { limit: '3' } });
  assert.equal(mine.body.items[0].id, 'newest-one', 'guests also see their newest first'); assert.equal(mine.body.total, undefined, 'guests get no bucket total');
});

test('only admins can move a bucket date, so customers cannot clear the overdue flag', async () => {
  const h = harness(); const { body } = await h.createBucket({ date: '2026-01-10' }); const id = body.id;
  const moved = await h.call('PATCH', `/b/${id}`, { token: 'customer-token', body: { date: '2030-01-01' } });
  assert.equal(moved.status, 403); assert.equal(moved.body.code, 'ADMIN_ONLY');
  assert.equal((await h.call('PATCH', `/b/${id}`, { token: 'customer-token', body: { name: 'Renamed by couple', date: '2026-01-10' } })).status, 200, 'other details and an unchanged date are fine');
  assert.equal((await h.call('PATCH', `/b/${id}`, { token: 'admin-token', body: { date: '2026-02-01' } })).status, 200);
  assert.equal((await h.call('GET', `/b/${id}`, { token: 'admin-token' })).body.date, '2026-02-01');
});
