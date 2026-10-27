// All persistence lives here. UI code uses the async owner/guest interfaces only.
import { details, validId } from './links.js';
import { LIMITS, validateFile } from './limits.js';
let opening;
const stores = ['buckets', 'photos', 'images', 'jobs', 'sources'];
function database() {
  if (!globalThis.indexedDB) throw new Error('This browser does not support saving photos. Try an up-to-date browser.');
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open('photo-bucket-local-v1', 1);
    request.onupgradeneeded = () => {
      for (const name of stores) {
        const store = request.result.createObjectStore(name, { keyPath: 'id' });
        if (['photos', 'jobs'].includes(name)) store.createIndex('bucketId', 'bucketId');
        if (name === 'buckets') store.createIndex('ownerId', 'ownerId');
      }
    };
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); opening = null; }; resolve(db); };
    request.onerror = () => { opening = null; reject(request.error); };
    request.onblocked = () => { opening = null; reject(new Error('Close other Photo Bucket tabs, then refresh to finish opening storage.')); };
  });
  return opening;
}
const req = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
async function transaction(names, mode, work) {
  const db = await database();
  const tx = db.transaction(names, mode);
  const done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error || new Error('Local save was cancelled.')); tx.onerror = () => {}; });
  const tables = Object.fromEntries(names.map(name => [name, tx.objectStore(name)]));
  try { const result = await work(tables); await done; return result; }
  catch (error) { try { tx.abort(); } catch {} await done.catch(() => {}); throw error; }
}
const id = () => crypto.randomUUID();
function identity(value) { if (typeof value !== 'string' || !value || value.length > 160) throw new Error('A valid local identity is required.'); return value; }
function checkBucket(bucket, ownerId) { if (!bucket || bucket.ownerId !== ownerId) throw new Error('This bucket is not available to your account on this browser.'); return bucket; }
function checkPhoto(photo, bucketId, contributorId) {
  if (!photo || photo.bucketId !== bucketId || (contributorId && photo.contributorId !== contributorId)) throw new Error('This photo is not available to you.');
  return photo;
}
function writable(bucket) { if (!bucket) throw new Error('Open the complete guest link first.'); if (bucket.paused) throw new Error('Your host has paused new photos. Try again after uploads resume.'); }
function validImage(image) {
  if (!(image?.blob instanceof Blob) || !image.blob.size || image.blob.size > LIMITS.fileBytes || !(image.thumbnail instanceof Blob)) throw new Error('The processed photo is invalid. Your previous photo is unchanged.');
}
export async function anonymousIdentity() {
  // The single ID is shared by tabs, buckets and refreshes in this browser profile.
  // Web Locks closes the first-visit race between two tabs where available.
  const obtain = () => { let value = localStorage.getItem('photo-bucket:contributor'); if (!value) { value = id(); localStorage.setItem('photo-bucket:contributor', value); } return identity(value); };
  return navigator.locks ? navigator.locks.request('photo-bucket-identity', obtain) : obtain();
}
export function ownerAdapter(ownerId) {
  identity(ownerId);
  const owned = async (s, bucketId) => checkBucket(await req(s.buckets.get(validId(bucketId))), ownerId);
  return {
    async create(input) {
      const bucket = { id: id(), ownerId, ...details(input), paused: false, createdAt: Date.now(), updatedAt: Date.now() };
      await transaction(['buckets'], 'readwrite', s => req(s.buckets.add(bucket))); return bucket;
    },
    list: () => transaction(['buckets'], 'readonly', s => req(s.buckets.index('ownerId').getAll(ownerId))),
    get: bucketId => transaction(['buckets'], 'readonly', s => owned(s, bucketId)),
    update: (bucketId, input) => transaction(['buckets'], 'readwrite', async s => { const bucket = { ...await owned(s, bucketId), ...details(input), updatedAt: Date.now() }; await req(s.buckets.put(bucket)); return bucket; }),
    setPaused: (bucketId, paused) => transaction(['buckets'], 'readwrite', async s => { const bucket = { ...await owned(s, bucketId), paused: Boolean(paused), updatedAt: Date.now() }; await req(s.buckets.put(bucket)); return bucket; }),
    photos: bucketId => transaction(['buckets', 'photos'], 'readonly', async s => { await owned(s, bucketId); return req(s.photos.index('bucketId').getAll(bucketId)); }),
    image: (bucketId, photoId) => transaction(['buckets', 'photos', 'images'], 'readonly', async s => { await owned(s, bucketId); checkPhoto(await req(s.photos.get(photoId)), bucketId); return (await req(s.images.get(photoId))).blob; }),
    delete: (bucketId, photoId) => transaction(['buckets', 'photos', 'images', 'jobs', 'sources'], 'readwrite', async s => { await owned(s, bucketId); checkPhoto(await req(s.photos.get(photoId)), bucketId); for (const name of ['photos', 'images', 'jobs', 'sources']) s[name].delete(photoId); }),
    // Fixtures use a separate source marker and can never overwrite a real photo.
    addFixture: (bucketId, key, contributor, image) => transaction(['buckets', 'photos', 'images'], 'readwrite', async s => {
      await owned(s, bucketId); validImage(image); const photoId = `${bucketId}-fixture-${key}`;
      if (await req(s.photos.get(photoId))) return;
      s.photos.put({ id: photoId, bucketId, contributorId: `fixture-${contributor}`, name: contributor, source: 'fixture', thumbnail: image.thumbnail, size: image.blob.size, createdAt: Date.now(), revision: 1 }); s.images.put({ id: photoId, blob: image.blob });
    }),
    clearFixtures: bucketId => transaction(['buckets', 'photos', 'images'], 'readwrite', async s => { await owned(s, bucketId); for (const photo of await req(s.photos.index('bucketId').getAll(bucketId))) if (photo.source === 'fixture') { s.photos.delete(photo.id); s.images.delete(photo.id); } }),
  };
}
export function guestAdapter(contributorId) {
  identity(contributorId);
  const mine = (photo, bucketId) => checkPhoto(photo, bucketId, contributorId);
  return {
    async open(publicBucket) {
      const bucketId = validId(publicBucket.id); const display = details(publicBucket);
      return transaction(['buckets'], 'readwrite', async s => {
        let bucket = await req(s.buckets.get(bucketId));
        // Locally managed details always win over old printed links.
        if (!bucket) { bucket = { id: bucketId, ...display, ownerId: null, paused: false, createdAt: Date.now() }; s.buckets.add(bucket); }
        return { id: bucket.id, ...details(bucket), paused: bucket.paused };
      });
    },
    status: bucketId => transaction(['buckets'], 'readonly', async s => { const b = await req(s.buckets.get(validId(bucketId))); if (!b) throw new Error('Open the complete guest link first.'); return { id: b.id, ...details(b), paused: b.paused }; }),
    photos: bucketId => transaction(['photos'], 'readonly', async s => (await req(s.photos.index('bucketId').getAll(validId(bucketId)))).filter(p => p.contributorId === contributorId)),
    image: (bucketId, photoId) => transaction(['photos', 'images'], 'readonly', async s => { mine(await req(s.photos.get(photoId)), validId(bucketId)); return (await req(s.images.get(photoId))).blob; }),
    async enqueue(bucketId, file, name = '') {
      validateFile(file); validId(bucketId);
      return transaction(['buckets', 'jobs', 'sources'], 'readwrite', async s => {
        writable(await req(s.buckets.get(bucketId)));
        const queued = await req(s.jobs.getAll());
        if (queued.reduce((sum, j) => sum + j.size, 0) + file.size > LIMITS.queuedBytes) throw new Error('The local queue is full. Finish or remove pending photos, then try again.');
        const job = { id: id(), bucketId, contributorId, name: String(name).trim().slice(0, 60), size: file.size, filename: file.name, createdAt: Date.now(), attempts: 0, state: 'queued', error: '' };
        s.jobs.add(job); s.sources.add({ id: job.id, blob: file }); return job;
      });
    },
    jobs: bucketId => transaction(['jobs'], 'readonly', async s => (await req(s.jobs.index('bucketId').getAll(validId(bucketId)))).filter(j => j.contributorId === contributorId)),
    jobFile: (bucketId, jobId) => transaction(['jobs', 'sources'], 'readonly', async s => { mine(await req(s.jobs.get(jobId)), validId(bucketId)); return (await req(s.sources.get(jobId))).blob; }),
    updateJob: (bucketId, jobId, changes) => transaction(['jobs'], 'readwrite', async s => { const job = mine(await req(s.jobs.get(jobId)), validId(bucketId)); for (const key of ['state', 'attempts', 'error', 'thumbnail']) if (key in changes) job[key] = changes[key]; s.jobs.put(job); return job; }),
    commit: (bucketId, jobId, image) => transaction(['buckets', 'photos', 'images', 'jobs', 'sources'], 'readwrite', async s => {
      validId(bucketId); validImage(image); writable(await req(s.buckets.get(bucketId)));
      const existing = await req(s.photos.get(jobId));
      if (existing) { mine(existing, bucketId); return existing; }
      const job = mine(await req(s.jobs.get(jobId)), bucketId);
      const photo = { id: job.id, bucketId, contributorId, name: job.name, source: 'guest', thumbnail: image.thumbnail, size: image.blob.size, createdAt: job.createdAt, revision: 1 };
      s.photos.add(photo); s.images.add({ id: photo.id, blob: image.blob }); s.jobs.delete(job.id); s.sources.delete(job.id); return photo;
    }),
    replace: (bucketId, photoId, image, revision) => transaction(['photos', 'images'], 'readwrite', async s => {
      validImage(image); const previous = mine(await req(s.photos.get(photoId)), validId(bucketId));
      if (previous.revision !== revision) throw new Error('This photo changed in another tab. Reopen it before saving.');
      const photo = { ...previous, thumbnail: image.thumbnail, size: image.blob.size, revision: previous.revision + 1, updatedAt: Date.now() }; s.photos.put(photo); s.images.put({ id: photoId, blob: image.blob }); return photo;
    }),
    delete: (bucketId, photoId) => transaction(['photos', 'images'], 'readwrite', async s => { mine(await req(s.photos.get(photoId)), validId(bucketId)); s.photos.delete(photoId); s.images.delete(photoId); }),
    discardJob: (bucketId, jobId) => transaction(['jobs', 'sources'], 'readwrite', async s => { mine(await req(s.jobs.get(jobId)), validId(bucketId)); s.jobs.delete(jobId); s.sources.delete(jobId); }),
  };
}
