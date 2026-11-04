// Online implementation of the owner/guest adapter contracts, backed by backend/ (S3 + DynamoDB).
// The upload queue (pending jobs and source files) stays in the browser so uploads survive refreshes.
import { API_URL } from './config.js';
import { guestAdapter as localGuest } from './adapter.js';
import { details, validId } from './links.js';

const localPreview = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const apiBase = localPreview ? '/__photo_bucket_api' : API_URL;
function storageUrl(url) { return localPreview ? `/__photo_bucket_storage?url=${encodeURIComponent(url)}` : url; }

const retryable = error => Object.assign(error, { retryable: true });
async function call(method, path, { token, body, query } = {}) {
  let response;
  try {
    response = await fetch(apiBase + path + (query ? '?' + new URLSearchParams(query) : ''), {
      method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw retryable(new Error('Network problem. Check your connection and try again.')); }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(data.error || 'The request failed. Please try again.');
    error.status = response.status;
    throw response.status >= 500 || response.status === 429 ? retryable(error) : error;
  }
  return response.status === 204 ? null : response.json();
}
async function put(target, blob) {
  let response;
  try { response = await fetch(storageUrl(target.url), { method: 'PUT', headers: target.headers, body: blob }); }
  catch { throw retryable(new Error('Network problem while uploading. Check your connection and try again.')); }
  if (!response.ok) throw response.status >= 500 ? retryable(new Error('Upload service is busy. Retrying…')) : new Error('The upload was rejected. Please choose the photo again.');
}
async function blobFor(token, bucketId, photoId, kind) {
  const { url } = await call('GET', `/b/${validId(bucketId)}/photos/${photoId}/url`, { token, query: { kind } });
  let response;
  try { response = await fetch(storageUrl(url)); } catch { throw retryable(new Error('Network problem while loading a photo.')); }
  if (!response.ok) throw new Error('This photo could not be loaded.');
  return response.blob();
}
const thumbnails = new Map();
async function withThumbnails(token, bucketId, list) {
  const out = [], queue = [...list];
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let photo; (photo = queue.shift());) {
      const key = `${photo.id}:${photo.revision}`;
      if (!thumbnails.has(key)) thumbnails.set(key, await blobFor(token, bucketId, photo.id, 'thumb'));
      out.push({ ...photo, thumbnail: thumbnails.get(key) });
    }
  }));
  return out;
}
const publicBucket = info => ({ id: info.id, ...details(info), paused: Boolean(info.paused) });

export function ownerAdapterApi(user) {
  const token = () => user.getIdToken();
  const api = async (method, path, options = {}) => call(method, path, { ...options, token: await token() });
  return {
    create: input => api('POST', '/owner/create', { body: details(input) }),
    list: () => api('GET', '/owner/list'),
    get: bucketId => api('GET', `/b/${validId(bucketId)}`),
    update: (bucketId, input) => api('PATCH', `/b/${validId(bucketId)}`, { body: details(input) }),
    // Main admin only (the server refuses anyone else): pause or resume the whole event.
    setFrozen: (bucketId, frozen) => api('POST', `/b/${validId(bucketId)}/freeze`, { body: { frozen: Boolean(frozen) } }),
    setPaused: (bucketId, paused) => api('POST', `/b/${validId(bucketId)}/pause`, { body: { paused: Boolean(paused) } }),
    async photos(bucketId) { const list = await api('GET', `/b/${validId(bucketId)}/photos`); return withThumbnails(await token(), bucketId, list); },
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
    session = await call('POST', `/b/${bucketId}/guest`);
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
    const photo = result.photo || await api('POST', `/b/${bucketId_}/photos/${photoId}/commit`, { body: { uploadId: result.grant.uploadId, ...body } });
    thumbnails.set(`${photo.id}:${photo.revision}`, image.thumbnail);
    return { ...photo, thumbnail: image.thumbnail };
  }
  return {
    ...queue,
    async open(info) { const canonical = publicBucket(await call('GET', `/b/${bucketId}/public`)); await queue.open(canonical); return canonical; },
    status: async id => publicBucket(await call('GET', `/b/${validId(id)}/public`)),
    async photos(id) { return withThumbnails(session.token, validId(id), await api('GET', `/b/${validId(id)}/photos`)); },
    image: (id, photoId) => blobFor(session.token, id, photoId, 'image'),
    async commit(id, jobId, image) {
      validId(id); const job = (await queue.jobs(id)).find(j => j.id === jobId);
      const photo = await finish(id, jobId, await upload(id, jobId, image, {}), image, { name: job?.name || '' });
      await queue.discardJob(id, jobId).catch(() => {});
      return photo;
    },
    async replace(id, photoId, image, revision) {
      validId(id); const result = await upload(id, photoId, image, { replace: true });
      return finish(id, photoId, result, image, { expectedRevision: revision });
    },
    delete: (id, photoId) => api('DELETE', `/b/${validId(id)}/photos/${photoId}`),
  };
}
