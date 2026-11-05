// Emulator mode only: the real Photo Bucket handler (backend/src) running in this process, over the repo's in-memory
// table and a small file-backed object store in /.local-buckets/, so buckets work end to end with no AWS at all.
// Nothing here can reach a real API: there is no outbound network call anywhere in this file.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createBackupHandler } from '../backend/src/backup.mjs';
import { createHandler } from '../backend/src/handler.mjs';
import { createAdminSweep, createDemoSweep, purgeTombstone } from '../backend/src/purge.mjs';
import { createStore } from '../backend/src/store.mjs';
import { FakeDynamo } from '../backend/test/helpers.mjs';

export const LOCAL_GUEST_SECRET = 'local-emulator-only-guest-secret-not-for-production';
export const API_PREFIX = '/__photo_bucket_api', STORAGE_ROUTE = '/__photo_bucket_storage', OBJECT_ROUTE = '/__local_bucket_object';
const MAX_OBJECT = 20 * 1024 * 1024 + 1; // photos up to 20 MiB; songs up to 15 MB fit too

// The one decision the dev server makes. In emulator mode the answer never contains the configured live API URL.
export function bucketApiTarget({ emulatorMode, liveApiUrl }) {
  return emulatorMode ? { kind: 'local' } : { kind: 'live', url: liveApiUrl || null };
}
export const isLoopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);

const encodeItem = item => JSON.stringify(item, (_, v) => (v instanceof Set ? { $set: [...v] } : v));
const decodeItem = text => JSON.parse(text, (_, v) => (v && typeof v === 'object' && Array.isArray(v.$set) ? new Set(v.$set) : v));
async function atomicWrite(file, data) { const tmp = `${file}.${process.pid}.tmp`; await writeFile(tmp, data); await rename(tmp, file); }

// Same interface as backend/src/files.mjs, kept on disk. Versions and delete markers behave like a versioned bucket.
function diskFiles({ dir, origin, signKey }) {
  const indexFile = path.join(dir, 'objects.json'), blobs = path.join(dir, 'blobs');
  const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : { photos: {}, backups: {} };
  const events = [];
  let indexWrite = Promise.resolve();
  function saveIndex() {
    const snapshot = JSON.stringify(index);
    // Uploads, commits and backups share one index and one atomic-write temp file.
    // Keep the snapshots in order and let a later save proceed after a disk error.
    indexWrite = indexWrite.catch(() => {}).then(() => atomicWrite(indexFile, snapshot));
    return indexWrite;
  }
  const list = (name, key) => (index[name === 'backups' ? 'backups' : 'photos'][key] ||= []);
  const current = (name, key) => { const v = index[name === 'backups' ? 'backups' : 'photos'][key]?.at(-1); return v && !v.marker ? v : null; };
  const blob = async v => readFile(path.join(blobs, v.blob));
  async function store(body) { const id = createHash('sha256').update(body).digest('hex'); await writeFile(path.join(blobs, id), body); return id; }
  const sign = (method, key, size, exp) => createHmac('sha256', signKey).update(`${method}\n${key}\n${size}\n${exp}`).digest('base64url');
  const signed = (method, key, size) => { const exp = Date.now() + (method === 'PUT' ? 600 : 300) * 1000; const q = new URLSearchParams({ k: key, m: method, s: String(size), e: String(exp), sig: sign(method, key, size, exp) }); return `${origin}${OBJECT_ROUTE}?${q}`; };
  const files = {
    events, save: saveIndex,
    async init() { await mkdir(blobs, { recursive: true }); },
    verify(url, method) {
      const q = url.searchParams, key = q.get('k'), size = q.get('s'), exp = Number(q.get('e')), given = Buffer.from(q.get('sig') || '', 'base64url'), want = Buffer.from(sign(q.get('m'), key, size, exp), 'base64url');
      if (url.origin !== origin || url.pathname !== OBJECT_ROUTE || q.get('m') !== method || !key || given.length !== want.length || !timingSafeEqual(given, want) || !(exp > Date.now())) return null;
      return { key, size: Number(size) };
    },
    async putSigned(key, body) { list('photos', key).push({ blob: await store(body), size: body.length }); await files.save(); },
    async getCurrent(key) { const v = current('photos', key); return v ? blob(v) : null; },
    presignPut: async (key, size) => ({ url: signed('PUT', key, size), headers: { 'content-type': 'image/jpeg' } }),
    presignGet: async key => signed('GET', key, 0),
    presignPutAudio: async (key, size) => ({ url: signed('PUT', key, size), headers: { 'content-type': 'audio/mpeg' } }),
    async purgeAudio(prefix, keep) { if (!/^audio\/[^/]+\/$/.test(prefix)) throw new Error('bad prefix'); for (const k of Object.keys(index.photos)) if (k.startsWith(prefix) && k !== keep) delete index.photos[k]; await files.save(); },
    head: async key => { const v = current('photos', key); return v ? { size: v.size } : null; },
    readRange: async (key, length, start = 0) => { const v = current('photos', key); return v ? (await blob(v)).subarray(start, start + length) : null; },
    readTail: async (key, length) => { const v = current('photos', key); if (!v) return null; const b = await blob(v); return b.subarray(Math.max(0, b.length - length)); },
    readFull: async key => { const v = current('photos', key); return v ? blob(v) : null; },
    async copy(from, to) { const v = current('photos', from); if (!v) return false; list('photos', to).push({ ...v }); events.push(to); await files.save(); return true; },
    async touch(key) { const v = current('photos', key); if (v) { list('photos', key).push({ ...v }); events.push(key); await files.save(); } },
    async restoreFromBackup(backupKey, imageKey) { const v = current('backups', backupKey); if (!v) return false; list('photos', imageKey).push({ ...v }); events.push(imageKey); await files.save(); return true; },
    async putBackup(key, body) { list('backups', key).push({ blob: await store(body), size: body.length }); await files.save(); },
    async remove(keys) { keys.filter(Boolean).forEach(k => list('photos', k).push({ marker: true })); await files.save(); },
    async purgeKeys(name, keys) { for (const k of keys) delete index[name === 'backups' ? 'backups' : 'photos'][k]; await files.save(); },
    async purge(name, prefix) {
      if (!/^(buckets|incoming)\/[a-z0-9-]+\/$/.test(prefix)) throw new Error('bad prefix');
      const map = index[name === 'backups' ? 'backups' : 'photos'];
      for (const k of Object.keys(map)) if (k.startsWith(prefix)) delete map[k];
      await files.save(); return true;
    },
  };
  return files; // unreferenced blobs stay on disk; delete the folder to start fresh
}

// verifyOwner(token) -> uid and listAdminUids() -> uid[] are injected: the dev server passes Firebase emulator checks.
export async function createLocalBucketBackend({ dir, origin, verifyOwner, listAdminUids, sweepEveryMs = 60_000 }) {
  await mkdir(dir, { recursive: true });
  const dbFile = path.join(dir, 'table.json'), dynamo = new FakeDynamo();
  if (existsSync(dbFile)) for (const line of readFileSync(dbFile, 'utf8').split('\n').filter(Boolean)) dynamo.put(decodeItem(line));
  const files = diskFiles({ dir, origin, signKey: `${LOCAL_GUEST_SECRET}:objects` }); await files.init();
  const store = createStore({ client: dynamo, table: 'local' });
  const backup = createBackupHandler({ store, files });
  const saveDb = () => atomicWrite(dbFile, dynamo.dump().map(encodeItem).join('\n'));
  // Backups run after the response, like the SQS pipeline; a failure is retried on the next request.
  let work = Promise.resolve();
  const drain = () => { work = work.then(async () => {
    const keys = files.events.splice(0);
    if (keys.length) {
      const { batchItemFailures } = await backup({ Records: keys.map(key => ({ messageId: key, body: JSON.stringify({ Records: [{ eventTime: new Date().toISOString(), s3: { object: { key } } }] }) })) });
      const failed = new Set(batchItemFailures.map(f => f.itemIdentifier)); setTimeout(() => { files.events.push(...keys.filter(k => failed.has(k))); }, 5000).unref();
    }
    await saveDb();
  }).catch(error => console.error('Local bucket backups:', error.message)); return work; };
  const sweep = () => { work = work.then(async () => { await createDemoSweep({ store, files })(); await createAdminSweep({ store, files })(); await saveDb(); }).catch(error => console.error('Local bucket sweep:', error.message)); return work; };
  const timer = sweepEveryMs ? setInterval(sweep, sweepEveryMs) : null; timer?.unref();

  async function readBody(req, limit) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > limit) return null; chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
  const send = (res, status, body, headers = {}) => { res.writeHead(status, { 'cache-control': 'no-store', ...headers }); res.end(body); };

  async function handleApi(req, res, requestUrl) {
    const body = await readBody(req, 64 * 1024 + 1);
    const adminUids = await listAdminUids();
    const handler = createHandler({ store, files, secret: LOCAL_GUEST_SECRET, adminUids, verifyOwner, purgePhotoFiles: tombstoneId => purgeTombstone({ store, files, tombstoneId }) });
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const reply = await handler({ requestContext: { http: { method: req.method, sourceIp: req.socket.remoteAddress } }, rawPath: requestUrl.pathname.slice(API_PREFIX.length) || '/', queryStringParameters: Object.fromEntries(requestUrl.searchParams), headers, body: body === null ? 'x'.repeat(64 * 1024 + 1) : body.length ? body.toString('utf8') : undefined });
    send(res, reply.statusCode, reply.body, reply.headers);
    drain();
  }
  // The browser reaches objects through STORAGE_ROUTE?url=<signed url>, as it does in live preview; the URL must be ours.
  async function handleStorage(req, res, requestUrl) {
    let url;
    try { url = requestUrl.pathname === OBJECT_ROUTE ? requestUrl : new URL(requestUrl.searchParams.get('url')); } catch { return send(res, 400, 'Invalid storage URL'); }
    const grant = files.verify(url, req.method);
    if (!grant) return send(res, 403, 'Invalid or expired storage URL');
    if (req.method === 'PUT') {
      if (Number(req.headers['content-length']) !== grant.size) return send(res, 403, 'Size does not match the signed size');
      const body = await readBody(req, Math.min(grant.size, MAX_OBJECT));
      if (!body || body.length !== grant.size) return send(res, 403, 'Size does not match the signed size');
      await files.putSigned(grant.key, body); return send(res, 200, '', { etag: `"${createHash('md5').update(body).digest('hex')}"` });
    }
    const object = await files.getCurrent(grant.key);
    return object ? send(res, 200, object, { 'content-type': grant.key.endsWith('.mp3') ? 'audio/mpeg' : 'image/jpeg' }) : send(res, 404, 'Not found');
  }
  return {
    handle: (req, res, requestUrl) => (requestUrl.pathname.startsWith(`${API_PREFIX}/`) ? handleApi(req, res, requestUrl) : handleStorage(req, res, requestUrl)),
    idle: () => drain(), sweep, close: () => timer && clearInterval(timer), store, dynamo,
  };
}

// Firebase emulator wiring for the dev server. Requires the emulator env vars to be set already.
export async function createEmulatorBucketBackend({ root, origin, projectId = 'demo-wedding-security' }) {
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Local buckets need the Firebase emulators.');
  const [{ getApps, initializeApp }, { getAuth }, { getFirestore }] = await Promise.all([import('firebase-admin/app'), import('firebase-admin/auth'), import('firebase-admin/firestore')]);
  const app = getApps()[0] || initializeApp({ projectId });
  const auth = getAuth(app), db = getFirestore(app);
  return createLocalBucketBackend({
    dir: path.join(root, '.local-buckets'), origin,
    verifyOwner: async token => (await auth.verifyIdToken(token, true)).uid,
    listAdminUids: async () => (await db.collection('platformAdmins').where('enabled', '==', true).get()).docs.map(d => d.id),
  });
}
