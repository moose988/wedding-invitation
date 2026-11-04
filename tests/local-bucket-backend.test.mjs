// Emulator-mode Photo Bucket backend: the guard that keeps it off the live API, and one full multi-role run
// through a real HTTP server with the same routes the browser uses. No Firebase or AWS is needed here.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { API_URL } from '../photo-bucket/config.js';
import { API_PREFIX, STORAGE_ROUTE, bucketApiTarget, createLocalBucketBackend } from '../scripts/local-bucket-backend.mjs';
import { jpeg } from '../backend/test/helpers.mjs';

test('emulator mode never targets the configured live Photo Bucket API', () => {
  assert.ok(API_URL, 'a live API URL is configured, so the guard is meaningful');
  const local = bucketApiTarget({ emulatorMode: true, liveApiUrl: API_URL });
  assert.deepEqual(local, { kind: 'local' });
  assert.ok(!JSON.stringify(local).includes(new URL(API_URL).host));
  assert.deepEqual(bucketApiTarget({ emulatorMode: false, liveApiUrl: API_URL }), { kind: 'live', url: API_URL }, 'npm run dev is unchanged');
  const server = readFileSync(new URL('../scripts/dev-server.mjs', import.meta.url), 'utf8');
  assert.match(server, /if \(emulatorMode\) return send\(res, 500, "Refusing to proxy/, 'the proxy itself refuses in emulator mode');
  assert.match(server, /process\.env\.PHOTO_BUCKET_API_URL = `http:\/\/\$\{host\}:\$\{port\}\/__photo_bucket_api`/, 'api/ functions use the local backend');
  assert.match(server, /isLoopback\(req\.socket\.remoteAddress\)/);
  assert.match(readFileSync(new URL('../.gitignore', import.meta.url), 'utf8'), /^\/\.local-buckets\/$/m);
  const backend = readFileSync(new URL('../scripts/local-bucket-backend.mjs', import.meta.url), 'utf8');
  assert.ok(!/\bfetch\(|https?:\/\/(?!\$\{)/.test(backend.replace(/^\/\/.*$/gm, '')), 'the local backend makes no outbound calls');
});

async function start(dir, admins) {
  let origin;
  const server = createServer((req, res) => backend.handle(req, res, new URL(req.url, origin)));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  const tokens = { 'admin-token': 'admin-uid', 'customer-token': 'customer-uid' };
  const backend = await createLocalBucketBackend({ dir, origin, sweepEveryMs: 0, verifyOwner: async t => { if (!tokens[t]) throw new Error('bad'); return tokens[t]; }, listAdminUids: async () => [...admins] });
  const api = async (method, p, { token, body } = {}) => {
    const r = await fetch(`${origin}${API_PREFIX}${p}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body && JSON.stringify(body) });
    return { status: r.status, body: r.status === 204 ? null : await r.json() };
  };
  const storage = (url, init) => fetch(`${origin}${STORAGE_ROUTE}?url=${encodeURIComponent(url)}`, init);
  return { backend, api, storage, origin, close: async () => { await backend.idle(); backend.close(); await new Promise(r => server.close(r)); } };
}

test('admins, customers and guests work end to end locally, and data survives a restart', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pb-local-')), admins = new Set(['admin-uid']);
  try {
    let s = await start(dir, admins);
    assert.equal((await s.api('POST', '/owner/create', { token: 'customer-token', body: { name: 'Local', date: '2026-12-01', location: 'Here', gb: 15 } })).status, 403);
    const made = await s.api('POST', '/owner/create', { token: 'admin-token', body: { name: 'Local', date: '2026-12-01', location: 'Here', gb: 15, owners: ['customer-uid'] } });
    assert.equal(made.status, 201); const id = made.body.id;
    const guest = (await s.api('POST', `/b/${id}/guest`)).body;
    const image = await jpeg(800, 600), thumb = await jpeg(120, 90);
    const grant = (await s.api('POST', `/b/${id}/uploads`, { token: guest.token, body: { photoId: 'p1', size: image.length, thumbSize: thumb.length } })).body;
    assert.equal((await s.storage(grant.image.url, { method: 'PUT', headers: grant.image.headers, body: image.subarray(0, 10) })).status, 403, 'size is enforced');
    assert.equal((await s.storage(grant.image.url, { method: 'PUT', headers: grant.image.headers, body: image })).status, 200);
    assert.equal((await s.storage(grant.thumbnail.url, { method: 'PUT', headers: grant.thumbnail.headers, body: thumb })).status, 200);
    const tampered = new URL(grant.image.url); tampered.searchParams.set('k', `buckets/${id}/photos/x/${'a'.repeat(32)}.jpg`);
    assert.equal((await s.storage(tampered.href, { method: 'PUT', body: image })).status, 403, 'a signed URL cannot be redirected');
    assert.equal((await s.storage('https://pb-x.s3.eu-north-1.amazonaws.com/a?b=c')).status, 403, 'no real storage URL is ever fetched');
    const committed = await s.api('POST', `/b/${id}/photos/p1/commit`, { token: guest.token, body: { uploadId: grant.uploadId, name: 'Guest' } });
    assert.equal(committed.status, 200, JSON.stringify(committed.body));
    const url = (await s.api('GET', `/b/${id}/photos/p1/url`, { token: guest.token })).body.url;
    assert.deepEqual(Buffer.from(await (await s.storage(url)).arrayBuffer()), image);
    assert.equal((await s.api('GET', `/b/${id}/photos`, { token: 'customer-token' })).body.items.length, 1);
    await s.backend.idle();
    assert.equal((await s.api('GET', `/b/${id}/backups`, { token: 'admin-token' })).body.unbacked, 0, 'the backup ran locally');
    // Admin rights follow the Firestore list on every request.
    admins.delete('admin-uid');
    assert.equal((await s.api('GET', `/b/${id}/backups`, { token: 'admin-token' })).status, 403);
    admins.add('admin-uid');
    await s.close();
    s = await start(dir, admins);
    const again = await s.api('GET', `/b/${id}/photos`, { token: guest.token });
    assert.equal(again.body.items.length, 1, 'the photo and guest token survive a restart');
    const later = (await s.api('GET', `/b/${id}/photos/p1/url`, { token: guest.token })).body.url;
    assert.equal((await s.storage(later)).status, 200, 'and its file');
    assert.equal((await s.api('DELETE', `/b/${id}/photos/p1`, { token: guest.token })).status, 204);
    assert.equal((await s.storage(later)).status, 404, 'a guest delete purges the local file too');
    // Event songs and the names flag work locally too.
    const frame = Buffer.alloc(417); frame[0] = 0xff; frame[1] = 0xfb; frame[2] = 0x90;
    const song = Buffer.concat([frame, frame, frame]);
    const songGrant = (await s.api('POST', '/events/localEvent1/song/uploads', { token: 'admin-token', body: { size: song.length } })).body;
    assert.equal((await s.storage(songGrant.upload.url, { method: 'PUT', headers: songGrant.upload.headers, body: song })).status, 200);
    assert.equal((await s.api('POST', '/events/localEvent1/song/commit', { token: 'admin-token', body: { uploadId: songGrant.uploadId } })).status, 200);
    const play = await (await s.storage((await s.api('GET', '/events/localEvent1/song')).body.url));
    assert.equal(play.headers.get('content-type'), 'audio/mpeg'); assert.deepEqual(Buffer.from(await play.arrayBuffer()), song);
    assert.equal((await s.api('GET', `/b/${id}/public`)).body.showUploaderNames, true);
    await s.close();
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test('simultaneous local uploads persist without racing on the object index', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pb-local-parallel-'));
  const admins = new Set(['admin-uid']);
  let s;
  try {
    s = await start(dir, admins);
    const bucket = await s.api('POST', '/owner/create', {
      token: 'admin-token', body: { name: 'Concurrent local bucket', date: '2027-01-01', location: 'Test Hall', gb: 15 },
    });
    assert.equal(bucket.status, 201);
    const prefix = `/b/${bucket.body.id}`;
    const guest = await s.api('POST', `${prefix}/guest`);
    assert.equal(guest.status, 200);
    const token = guest.body.token;
    const image = await jpeg(800, 600), thumb = await jpeg(120, 90);
    const photos = await Promise.all(Array.from({ length: 6 }, async (_, index) => {
      const id = `concurrent-${index}`;
      const grant = await s.api('POST', `${prefix}/uploads`, { token, body: { photoId: id, size: image.length, thumbSize: thumb.length } });
      assert.equal(grant.status, 200);
      return { id, ...grant.body };
    }));
    await Promise.all(photos.flatMap(photo => [
      [photo.image, image], [photo.thumbnail, thumb],
    ]).map(async ([target, body]) => {
      const uploaded = await s.storage(target.url, { method: 'PUT', headers: target.headers, body, signal: AbortSignal.timeout(5000) });
      assert.equal(uploaded.status, 200);
    }));
    for (const photo of photos) {
      const result = await s.api('POST', `${prefix}/photos/${photo.id}/commit`, { token, body: { uploadId: photo.uploadId } });
      assert.equal(result.status, 200);
    }
    await s.close();
    s = await start(dir, admins);
    const gallery = await s.api('GET', `${prefix}/photos`, { token });
    assert.deepEqual(gallery.body.items.map(photo => photo.id).sort(), photos.map(photo => photo.id).sort());
  } finally {
    await s?.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
