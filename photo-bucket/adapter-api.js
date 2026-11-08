// Online implementation of the owner/guest adapter contracts, backed by backend/ (S3 + DynamoDB).
// The upload queue (pending jobs and source files) stays in the browser so uploads survive refreshes.
import { API_URL } from './config.js';
import { guestAdapter as localGuest } from './adapter.js';
import { details, validId } from './links.js';
import { createLru } from './thumb-queue.js';

const localPreview = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const apiBase = localPreview ? '/__photo_bucket_api' : API_URL;
function storageUrl(url) { return localPreview ? `/__photo_bucket_storage?url=${encodeURIComponent(url)}` : url; }

const retryable = error => Object.assign(error, { retryable: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Final outcomes: never retried. 507 BUCKET_FULL and 503 BUCKET_FROZEN would otherwise look like "server trouble".
const finalFailure = (status, code) => status === 507 || code === 'BUCKET_FROZEN';
// Honours Retry-After on 429 and 503 BUSY with a couple of short waits, then lets the caller's own retry take over.
async function call(method, path, { token, body, query, noWait } = {}, waits = 0) {
  let response;
  try {
    response = await fetch(apiBase + path + (query ? '?' + new URLSearchParams(query) : ''), {
      method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw Object.assign(retryable(new Error('Could not reach the photo bucket service. Check your internet connection and try again.')), { network: true }); }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(data.error || (response.status === 404 ? 'Server setup is incomplete: the photo bucket service was not found. Contact an admin.' : response.status === 503 && !data.code ? 'Server setup is incomplete: the photo bucket service is not available. Contact an admin.' : 'The request failed. Please try again.'));
    error.status = response.status; error.code = data.code;
    if (finalFailure(response.status, data.code)) throw error;
    const seconds = Number(response.headers.get('retry-after'));
    if ((response.status === 429 || data.code === 'BUSY') && Number.isFinite(seconds) && seconds > 0) {
      if (!noWait && waits < 2 && seconds <= 30) { await sleep(seconds * 1000); return call(method, path, { token, body, query }, waits + 1); }
      error.retryAfter = seconds;
    }
    throw response.status >= 500 || response.status === 429 ? retryable(error) : error;
  }
  return response.status === 204 ? null : response.json();
}
// Used where a refusal must never become a dead page (joining a bucket). It waits out Retry-After (plus a little
// jitter), or backs off with full jitter, pauses while the phone is offline, and tells the page it is busy.
let busyListener = () => {};
export const onBusy = fn => { busyListener = typeof fn === 'function' ? fn : () => {}; };
async function patientCall(method, path, options = {}) {
  const started = Date.now();
  for (let attempt = 1; ; attempt += 1) {
    try { const result = await call(method, path, { ...options, noWait: true }); busyListener(null); return result; }
    catch (error) {
      if (!error.retryable || Date.now() - started > 10 * 60_000) { busyListener(null); throw error; }
      const wait = error.retryAfter > 0 ? Math.min(error.retryAfter, 120) * 1000 + Math.random() * 1000 : Math.random() * Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
      if (error.network && typeof navigator !== 'undefined' && navigator.onLine === false) { busyListener({ seconds: 0, offline: true }); await new Promise(r => window.addEventListener('online', r, { once: true })); continue; }
      busyListener({ seconds: Math.max(1, Math.ceil(wait / 1000)), attempt });
      await sleep(wait);
    }
  }
}
// Every list route answers { items, nextCursor }; a page can be short or empty while nextCursor is still set.
// A legacy stack answers a bare array, so both shapes are accepted.
async function allPages(fetchPage) {
  const out = [];
  for (let cursor = null, pages = 0; pages < 500; pages += 1) {
    const page = await fetchPage(cursor ? { cursor } : {});
    if (Array.isArray(page)) return page;
    out.push(...(page.items || []));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return out;
}
async function put(target, blob) {
  let response;
  try { response = await fetch(storageUrl(target.url), { method: 'PUT', headers: target.headers, body: blob }); }
  catch { throw Object.assign(retryable(new Error('The upload could not reach the server. Check your internet connection; it will resume by itself.')), { network: true }); }
  if (!response.ok) throw response.status >= 500 || response.status === 429 ? retryable(new Error('Upload service is busy. Retrying…')) : new Error('The upload was rejected. Please choose the photo again.');
}
// A thumbnail or photo that gets 503 or 429 (S3 slow-down) is retried with backoff and full jitter; other failures are final.
async function blobFor(token, bucketId, photoId, kind) {
  for (let attempt = 1; ; attempt += 1) {
    const { url } = await call('GET', `/b/${validId(bucketId)}/photos/${photoId}/url`, { token, query: { kind } });
    let response;
    try { response = await fetch(storageUrl(url)); } catch { response = null; }
    if (response?.ok) return response.blob();
    const transient = !response || response.status === 503 || response.status === 429 || response.status >= 500;
    if (!transient || attempt >= 5) throw transient ? Object.assign(retryable(new Error(response ? 'This photo is busy. Try again.' : 'Network problem while loading a photo.')), { network: !response }) : new Error('This photo could not be loaded.');
    const retryAfter = Number(response?.headers.get('retry-after'));
    await sleep(retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : Math.random() * Math.min(8000, 500 * 2 ** attempt));
  }
}
// Thumbnails are fetched on demand through the page's queue, never in bulk. The cache is
// bounded and keyed by bucket, photo and revision; each failure rejects only its own photo.
const thumbnails = createLru(300);
export const thumbnailKey = (bucketId, photo) => `${bucketId}:${photo.id}:${photo.revision}`;
async function thumbnailFor(token, bucketId, photo) {
  const key = thumbnailKey(bucketId, photo);
  if (thumbnails.has(key)) return thumbnails.get(key);
  const blob = await blobFor(token, bucketId, photo.id, 'thumb');
  thumbnails.set(key, blob);
  return blob;
}
const PAGE_SIZE = 100;
const pageOf = (api, bucketId, cursor, order = 'newest') => api('GET', `/b/${validId(bucketId)}/photos`, { query: { limit: PAGE_SIZE, order: order === 'oldest' ? 'oldest' : 'newest', ...(cursor ? { cursor } : {}) } }).then(r => Array.isArray(r) ? { items: r, nextCursor: null } : { items: r.items || [], nextCursor: r.nextCursor || null, ...(Number.isInteger(r.total) ? { total: r.total } : {}) });
const allOf = (api, bucketId, contributor) => allPages(cursor => api('GET', `/b/${validId(bucketId)}/photos`, { query: { limit: 200, ...(contributor ? { contributor } : {}), ...cursor } }));
const publicBucket = info => ({ id: info.id, ...details(info), paused: Boolean(info.paused), showUploaderNames: info.showUploaderNames === true, guestShowsDetails: info.guestShowsDetails !== false });

export function ownerAdapterApi(user) {
  const token = () => user.getIdToken();
  const api = async (method, path, options = {}) => call(method, path, { ...options, token: await token() });
  return {
    // Admin only. The server makes the id and validates gb (15, 20, ... 50). Demos are made by /api/admin-demos, not here.
    create(input) {
      const body = { ...details(input), showUploaderNames: input?.showUploaderNames !== false, cardShowsDetails: input?.cardShowsDetails === true, guestShowsDetails: input?.guestShowsDetails !== false, gb: Number(input?.gb), ...(Array.isArray(input?.owners) && input.owners.length ? { owners: input.owners } : {}) };
      return api('POST', '/owner/create', { body });
    },
    // Admins may pass { uid } to list the buckets another account owns.
    list: ({ uid } = {}) => allPages(cursor => api('GET', '/owner/list', { query: { limit: 50, ...(uid ? { uid } : {}), ...cursor } })),
    setSize: (bucketId, gb) => api('PUT', `/b/${validId(bucketId)}/size`, { body: { gb: Number(gb) } }),
    addOwner: (bucketId, uid) => api('POST', `/b/${validId(bucketId)}/owners`, { body: { uid } }),
    removeOwner: (bucketId, uid) => api('DELETE', `/b/${validId(bucketId)}/owners/${encodeURIComponent(uid)}`),
    deleteBucket: (bucketId) => api('DELETE', `/b/${validId(bucketId)}`, { query: { confirm: validId(bucketId) } }),
    // Admin only: failed backups across ALL buckets, { failed, buckets: [{ bucketId, failed }] }.
    platformBackups: () => api('GET', '/admin/backups'),
    backups: bucketId => api('GET', `/b/${validId(bucketId)}/backups`),
    redriveBackups: (bucketId, body = {}) => api('POST', `/b/${validId(bucketId)}/backups/redrive`, { body }),
    // Admin only. Items are DeletedRecord (deletedId, photoId = file number, restorable, restoredAt ...).
    deleted: bucketId => allPages(cursor => api('GET', `/b/${validId(bucketId)}/deleted`, { query: { limit: 100, ...cursor } })),
    // The restored photo is the quality 80 backup copy, not the original.
    async restoreDeleted(bucketId, deletedId) {
      try { return await api('POST', `/b/${validId(bucketId)}/deleted/${encodeURIComponent(deletedId)}/restore`); }
      catch (error) {
        if (error.code !== 'ALREADY_RESTORED') throw error;
        return { alreadyRestored: true };
      }
    },
    get: bucketId => api('GET', `/b/${validId(bucketId)}`),
    update: (bucketId, input) => api('PATCH', `/b/${validId(bucketId)}`, { body: { ...details(input), ...(typeof input?.showUploaderNames === 'boolean' ? { showUploaderNames: input.showUploaderNames } : {}), ...(typeof input?.cardShowsDetails === 'boolean' ? { cardShowsDetails: input.cardShowsDetails } : {}), ...(typeof input?.guestShowsDetails === 'boolean' ? { guestShowsDetails: input.guestShowsDetails } : {}) } }),
    // Main admin only (the server refuses anyone else): pause or resume the whole event.
    setFrozen: (bucketId, frozen) => api('POST', `/b/${validId(bucketId)}/freeze`, { body: { frozen: Boolean(frozen) } }),
    setPaused: (bucketId, paused) => api('POST', `/b/${validId(bucketId)}/pause`, { body: { paused: Boolean(paused) } }),
    // One page of 100 (no thumbnails). Thumbnails come from thumbnail(), through the page's queue.
    photosPage: (bucketId, cursor, order) => pageOf(api, bucketId, cursor, order),
    allPhotos: (bucketId, contributor) => allOf(api, bucketId, contributor),
    async thumbnail(bucketId, photo) { return thumbnailFor(await token(), bucketId, photo); },
    async image(bucketId, photoId) { return blobFor(await token(), bucketId, photoId, 'image'); },
    delete: (bucketId, photoId) => api('DELETE', `/b/${validId(bucketId)}/photos/${photoId}`),
    addFixture: async () => { throw new Error('Demo fixtures are not available online.'); },
    clearFixtures: async () => {},
  };
}

export async function guestAdapterApi(publicDetails) {
  const bucketId = validId(publicDetails.id), key = `photo-bucket:guest:${bucketId}`;
  let session;
  try { session = JSON.parse(localStorage.getItem(key)); } catch { session = null; }
  const start = async () => {
    // The guest's optional name (up to 40 characters) is sent when the bucket shows uploader names.
    let saved = ''; try { saved = (localStorage.getItem(`photo-bucket:uploader-name:${bucketId}`) || '').trim().slice(0, 40); } catch { /* storage blocked: no remembered name */ }
    session = await patientCall('POST', `/b/${bucketId}/guest`, saved ? { body: { name: saved } } : {});
    try { localStorage.setItem(key, JSON.stringify(session)); } catch { /* private mode: session lasts for this page */ }
  };
  if (!session?.token) await start();
  const queue = localGuest(session.contributorId);
  const api = async (method, path, options = {}) => {
    try { return await call(method, path, { ...options, token: session.token }); }
    catch (error) { if (error.status !== 401) throw error; await start(); return call(method, path, { ...options, token: session.token }); }
  };
  async function upload(bucketId_, photoId, image, extra) {
    const grant = await api('POST', `/b/${bucketId_}/uploads`, { body: { photoId, size: image.blob.size, thumbSize: image.thumbnail.size, ...extra } });
    if (grant.exists) return { photo: grant.exists };
    await put(grant.image, image.blob); await put(grant.thumbnail, image.thumbnail);
    return { grant };
  }
  async function finish(bucketId_, photoId, result, image, body) {
    if (result.photo) return result.photo; // A previous attempt already saved the canonical photo.
    const photo = await api('POST', `/b/${bucketId_}/photos/${photoId}/commit`, { body: { uploadId: result.grant.uploadId, ...body } });
    thumbnails.set(thumbnailKey(bucketId_, photo), image.thumbnail);
    return { ...photo, thumbnail: image.thumbnail };
  }
  return {
    ...queue,
    async open(info) { const canonical = publicBucket(await patientCall('GET', `/b/${bucketId}/public`)); await queue.open(canonical); return canonical; },
    status: async id => publicBucket(await call('GET', `/b/${validId(id)}/public`)),
    photosPage: (id, cursor, order) => pageOf(api, id, cursor, order),
    allPhotos: (id, contributor) => allOf(api, id, contributor),
    thumbnail: (id, photo) => thumbnailFor(session.token, validId(id), photo),
    image: (id, photoId) => blobFor(session.token, id, photoId, 'image'),
    async commit(id, jobId, image) {
      validId(id); const job = (await queue.jobs(id)).find(j => j.id === jobId);
      const name = job?.name?.trim();
      const photo = await finish(id, jobId, await upload(id, jobId, image, {}), image, name ? { name } : {});
      await queue.discardJob(id, jobId).catch(() => { /* best effort: the photo is saved; a leftover local copy is harmless */ });
      return photo;
    },
    async replace(id, photoId, image, revision) {
      validId(id); const result = await upload(id, photoId, image, { replace: true });
      return finish(id, photoId, result, image, { expectedRevision: revision });
    },
    delete: (id, photoId) => api('DELETE', `/b/${validId(id)}/photos/${photoId}`),
  };
}
