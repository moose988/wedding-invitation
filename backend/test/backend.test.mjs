import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import sharp from 'sharp';
import { parse } from 'yaml';
import { compress } from '../src/backup.mjs';
import { createHandler } from '../src/handler.mjs';
import { LIMITS, jpegSize, signGuestToken, verifyGuestToken } from '../src/lib.mjs';

const jpeg = (w = 800, h = 600, color = '#c33') => sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg({ quality: 90 }).toBuffer();
const SECRET = 'x'.repeat(40), EVENT = 'evt-one', OWNER = 'owner-uid';

function harness() {
  const db = { meta: null, photos: new Map() }, objects = new Map(), backups = new Set();
  const conflict = () => Object.assign(new Error('c'), { conflict: true });
  const store = {
    getMeta: async () => db.meta && { ...db.meta },
    createMeta: async m => { if (db.meta) throw conflict(); db.meta = { ...m }; },
    updateMeta: async f => Object.assign(db.meta, f),
    listPhotos: async () => [...db.photos.values()],
    getPhoto: async id => db.photos.get(id),
    async commitPhoto({ photo, previous, delta, cap }) {
      if (previous ? db.photos.get(photo.id)?.revision !== previous.revision : db.photos.has(photo.id)) throw conflict();
      if (db.meta.totalBytes > cap - delta || (!previous && db.meta.paused)) throw conflict();
      db.meta.totalBytes += delta; db.photos.set(photo.id, photo);
    },
    async removePhoto(photo) { db.meta.totalBytes -= photo.size; db.photos.delete(photo.id); },
  };
  const files = {
    presignPut: async (key, size) => ({ url: `put://${key}`, headers: {}, size }),
    presignGet: async key => `get://${key}`,
    read: async key => objects.get(key) || null,
    copy: async (from, to) => objects.set(to, objects.get(from)),
    remove: async (keys, bk = []) => { keys.forEach(k => objects.delete(k)); bk.forEach(k => backups.add(k)); },
  };
  const handler = createHandler({ store, files, secret: SECRET, eventId: EVENT, ownerUids: [OWNER, 'customer-uid'], adminUids: [OWNER], verifyOwner: async t => (t === 'owner-token' ? OWNER : t === 'customer-token' ? 'customer-uid' : t === 'stranger-token' ? 'stranger' : (() => { throw new Error('bad'); })()) });
  const call = async (method, path, { token, body, query } = {}) => {
    const r = await handler({ requestContext: { http: { method } }, rawPath: path, queryStringParameters: query, headers: token ? { authorization: `Bearer ${token}` } : {}, body: body && JSON.stringify(body) });
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
  };
  const upload = async (token, pid, image, thumb, extra = {}) => {
    const grant = await call('POST', `/b/${EVENT}/uploads`, { token, body: { photoId: pid, size: image.length, thumbSize: thumb.length, ...extra } });
    if (grant.status !== 200 || grant.body.exists) return grant;
    objects.set(`incoming/${pid}/${grant.body.uploadId}.jpg`, image); objects.set(`incoming/${pid}/${grant.body.uploadId}.thumb.jpg`, thumb);
    return grant;
  };
  return { db, objects, backups, call, upload };
}
const details = { name: 'Test Event', date: '2026-12-01', location: 'Amman' };
async function ready(h) {
  assert.equal((await h.call('POST', '/owner/create', { token: 'owner-token', body: details })).status, 201);
  const a = (await h.call('POST', `/b/${EVENT}/guest`)).body, b = (await h.call('POST', `/b/${EVENT}/guest`)).body;
  return { a, b };
}

test('guest tokens verify and reject tampering or expiry', () => {
  const token = signGuestToken(SECRET, EVENT, 'c1', 1000);
  assert.deepEqual(verifyGuestToken(SECRET, token, 2000), { bucketId: EVENT, contributorId: 'c1' });
  assert.equal(verifyGuestToken('y'.repeat(40), token, 2000), null);
  assert.equal(verifyGuestToken(SECRET, token.slice(0, -2) + 'AA', 2000), null);
  assert.equal(verifyGuestToken(SECRET, token, 1000 + (LIMITS.guestTokenSeconds + 5) * 1000), null);
});

test('jpegSize reads real JPEGs and rejects other formats', async () => {
  assert.deepEqual(jpegSize(await jpeg(321, 123)), { width: 321, height: 123 });
  assert.equal(jpegSize(await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).png().toBuffer()), null);
  assert.equal(jpegSize(Buffer.from('not an image')), null);
});

test('limits are 15 GB usable and 9 GB backup', () => {
  assert.equal(LIMITS.usableBytes, 15 * 1024 ** 3); assert.equal(LIMITS.backupBytes, 9 * 1024 ** 3);
});

test('only an allow-listed host can create the event, once', async () => {
  const h = harness();
  assert.equal((await h.call('POST', '/owner/create', { body: details })).status, 401);
  assert.equal((await h.call('POST', '/owner/create', { token: 'stranger-token', body: details })).status, 403);
  assert.equal((await h.call('POST', '/owner/create', { token: 'owner-token', body: { ...details, date: '2026-02-31' } })).status, 400);
  assert.equal((await h.call('POST', '/owner/create', { token: 'owner-token', body: details })).status, 201);
  assert.equal((await h.call('POST', '/owner/create', { token: 'owner-token', body: details })).status, 200);
  assert.equal((await h.call('GET', `/b/${EVENT}/public`)).body.name, details.name);
  assert.equal((await h.call('GET', '/b/other/public')).status, 404);
});

test('upload, commit, isolation between guests, owner view and delete', async () => {
  const h = harness(); const { a, b } = await ready(h);
  const image = await jpeg(), thumb = await jpeg(200, 150);
  const grant = await h.upload(a.token, 'p1', image, thumb);
  const commit = await h.call('POST', `/b/${EVENT}/photos/p1/commit`, { token: a.token, body: { uploadId: grant.body.uploadId, name: 'Amelia' } });
  assert.equal(commit.status, 200); assert.equal(commit.body.revision, 1);
  const again = await h.call('POST', `/b/${EVENT}/photos/p1/commit`, { token: a.token, body: { uploadId: grant.body.uploadId } });
  assert.equal(again.status, 200); assert.equal(h.db.photos.size, 1); assert.equal(h.db.meta.totalBytes, image.length);
  assert.equal((await h.upload(a.token, 'p1', image, thumb)).body.exists.id, 'p1'); // lost-response retry is idempotent
  assert.equal((await h.call('GET', `/b/${EVENT}/photos`, { token: a.token })).body.length, 1);
  assert.equal((await h.call('GET', `/b/${EVENT}/photos`, { token: b.token })).body.length, 0);
  assert.equal((await h.call('GET', `/b/${EVENT}/photos/p1/url`, { token: b.token, query: { kind: 'image' } })).status, 404);
  assert.equal((await h.call('DELETE', `/b/${EVENT}/photos/p1`, { token: b.token })).status, 404);
  assert.equal((await h.call('GET', `/b/${EVENT}/photos`, { token: 'owner-token' })).body.length, 1);
  assert.equal((await h.call('GET', `/b/${EVENT}/photos`, { token: 'stranger-token' })).status, 403);
  assert.match((await h.call('GET', `/b/${EVENT}/photos/p1/url`, { token: a.token, query: { kind: 'thumb' } })).body.url, /\.thumb\.jpg$/);
  assert.equal((await h.call('DELETE', `/b/${EVENT}/photos/p1`, { token: a.token })).status, 204);
  assert.equal(h.db.meta.totalBytes, 0); assert.equal([...h.objects.keys()].filter(k => k.startsWith('photos/')).length, 0);
});

test('commit rejects non-JPEG bytes and oversized dimensions', async () => {
  const h = harness(); const { a } = await ready(h);
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).png().toBuffer();
  const bad = await h.upload(a.token, 'p2', png, await jpeg(50, 50));
  assert.equal((await h.call('POST', `/b/${EVENT}/photos/p2/commit`, { token: a.token, body: { uploadId: bad.body.uploadId } })).status, 400);
  const huge = await h.upload(a.token, 'p3', await jpeg(3000, 100), await jpeg(50, 50));
  assert.equal((await h.call('POST', `/b/${EVENT}/photos/p3/commit`, { token: a.token, body: { uploadId: huge.body.uploadId } })).status, 400);
  assert.equal(h.db.photos.size, 0);
});

test('pause blocks new photos but allows edits; replace needs the current revision', async () => {
  const h = harness(); const { a } = await ready(h);
  const image = await jpeg(), thumb = await jpeg(100, 80);
  const first = await h.upload(a.token, 'p1', image, thumb);
  await h.call('POST', `/b/${EVENT}/photos/p1/commit`, { token: a.token, body: { uploadId: first.body.uploadId } });
  assert.equal((await h.call('POST', `/b/${EVENT}/pause`, { token: 'owner-token', body: { paused: true } })).body.paused, true);
  assert.equal((await h.upload(a.token, 'p9', image, thumb)).status, 403);
  const next = await jpeg(900, 700, '#36c');
  const replace = await h.upload(a.token, 'p1', next, thumb, { replace: true });
  assert.equal((await h.call('POST', `/b/${EVENT}/photos/p1/commit`, { token: a.token, body: { uploadId: replace.body.uploadId, expectedRevision: 7 } })).status, 409);
  const ok = await h.call('POST', `/b/${EVENT}/photos/p1/commit`, { token: a.token, body: { uploadId: replace.body.uploadId, expectedRevision: 1 } });
  assert.equal(ok.body.revision, 2); assert.equal(h.db.meta.totalBytes, next.length);
});

test('uploads stop at the 15 GB event limit', async () => {
  const h = harness(); const { a } = await ready(h);
  h.db.meta.totalBytes = LIMITS.usableBytes - 10;
  const image = await jpeg(), thumb = await jpeg(50, 50);
  assert.equal((await h.upload(a.token, 'p1', image, thumb)).status, 507);
});

test('backups are smaller and capped at 1600px', async () => {
  const noisy = await sharp(Buffer.alloc(2400 * 1800 * 3).map((_, i) => (i * 7919) % 256), { raw: { width: 2400, height: 1800, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
  const small = await compress(noisy), meta = await sharp(small).metadata();
  assert.ok(small.length < noisy.length / 2, `${small.length} vs ${noisy.length}`);
  assert.equal(Math.max(meta.width, meta.height), 1600);
});

test('templates define PITR, versioning, private buckets and backup wiring', () => {
  const tags = ['Ref', 'GetAtt', 'Sub'].map(tag => ({ tag: `!${tag}`, resolve: v => v }));
  const event = parse(readFileSync(new URL('../event.yaml', import.meta.url), 'utf8'), { customTags: tags });
  assert.equal(event.Resources.Table.Properties.PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled, true);
  assert.equal(event.Resources.PhotoBucket.Properties.VersioningConfiguration.Status, 'Enabled');
  assert.equal(event.Resources.PhotoBucket.Properties.PublicAccessBlockConfiguration.BlockPublicPolicy, true);
  assert.ok(event.Resources.PhotoBucket.Properties.NotificationConfiguration.LambdaConfigurations.length);
  const backup = parse(readFileSync(new URL('../backup.yaml', import.meta.url), 'utf8'), { customTags: tags });
  assert.equal(backup.Resources.BackupBucket.Properties.PublicAccessBlockConfiguration.BlockPublicAcls, true);
});

test('the customer account can manage this event too, strangers still cannot', async () => {
  const h = harness(); const { a } = await ready(h);
  assert.equal((await h.call('GET', '/owner/list', { token: 'customer-token' })).body.length, 1);
  assert.equal((await h.call('GET', `/b/${EVENT}`, { token: 'customer-token' })).body.name, details.name);
  assert.equal((await h.call('PATCH', `/b/${EVENT}`, { token: 'customer-token', body: { name: 'Renamed' } })).body.name, 'Renamed');
  const image = await jpeg(), thumb = await jpeg(60, 40);
  const g = await h.upload(a.token, 'p1', image, thumb);
  await h.call('POST', `/b/${EVENT}/photos/p1/commit`, { token: a.token, body: { uploadId: g.body.uploadId } });
  assert.equal((await h.call('GET', `/b/${EVENT}/photos`, { token: 'customer-token' })).body.length, 1);
  assert.equal((await h.call('POST', `/b/${EVENT}/pause`, { token: 'customer-token', body: { paused: true } })).body.paused, true);
  assert.equal((await h.call('DELETE', `/b/${EVENT}/photos/p1`, { token: 'customer-token' })).status, 204);
  assert.equal((await h.call('GET', '/owner/list', { token: 'stranger-token' })).status, 403);
  assert.equal((await h.call('PATCH', `/b/${EVENT}`, { token: 'stranger-token', body: { name: 'x' } })).status, 403);
});

test('only the main admin can pause the whole event; paused means everyone else gets a friendly 503', async () => {
  const h = harness(); const { a } = await ready(h);
  assert.equal((await h.call('POST', `/b/${EVENT}/freeze`, { token: 'customer-token', body: { frozen: true } })).status, 403);
  assert.equal((await h.call('POST', `/b/${EVENT}/freeze`, { token: 'stranger-token', body: { frozen: true } })).status, 403);
  assert.equal((await h.call('POST', `/b/${EVENT}/freeze`, { token: a.token, body: { frozen: true } })).status, 403);
  assert.equal((await h.call('GET', `/b/${EVENT}`, { token: 'owner-token' })).body.canFreeze, true);
  assert.equal((await h.call('GET', `/b/${EVENT}`, { token: 'customer-token' })).body.canFreeze, false);
  const frozen = await h.call('POST', `/b/${EVENT}/freeze`, { token: 'owner-token', body: { frozen: true } });
  assert.equal(frozen.status, 200); assert.equal(frozen.body.frozen, true);
  for (const [method, path, token] of [['GET', `/b/${EVENT}/public`], ['POST', `/b/${EVENT}/guest`], ['GET', `/b/${EVENT}/photos`, a.token], ['GET', `/b/${EVENT}`, 'customer-token'], ['GET', '/owner/list', 'customer-token'], ['POST', `/b/${EVENT}/freeze`, 'customer-token']]) {
    const r = await h.call(method, path, { token, body: { frozen: false } });
    assert.equal(r.status, 503, `${method} ${path}`); assert.match(r.body.error, /paused until the event/);
  }
  assert.equal((await h.call('GET', `/b/${EVENT}`, { token: 'owner-token' })).body.frozen, true);
  assert.equal((await h.call('GET', `/b/${EVENT}/photos`, { token: 'owner-token' })).status, 503);
  const resumed = await h.call('POST', `/b/${EVENT}/freeze`, { token: 'owner-token', body: { frozen: false } });
  assert.equal(resumed.body.frozen, false);
  assert.equal((await h.call('GET', `/b/${EVENT}/public`)).status, 200);
  assert.equal((await h.call('GET', `/b/${EVENT}/photos`, { token: a.token })).status, 200);
});
