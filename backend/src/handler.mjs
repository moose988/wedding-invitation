import { randomUUID } from 'node:crypto';
import { HttpError, LIMITS, assertPhotoBytes, cleanDetails, signGuestToken, validId, verifyGuestToken } from './lib.mjs';

const reply = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: body === undefined ? '' : JSON.stringify(body) });
const publicPhoto = p => ({ id: p.id, bucketId: p.bucketId, contributorId: p.contributorId, name: p.name, source: p.source, size: p.size, createdAt: p.createdAt, updatedAt: p.updatedAt, revision: p.revision });
const publicMeta = m => ({ id: m.bucketId, name: m.name, date: m.date, location: m.location, paused: m.paused, createdAt: m.createdAt, updatedAt: m.updatedAt });
const ownerMeta = m => ({ ...publicMeta(m), ownerId: m.ownerId, usedBytes: m.totalBytes, limitBytes: LIMITS.usableBytes, backupBytes: m.backupBytes, backupLimitBytes: LIMITS.backupBytes });
const uploadId = value => { if (!/^[a-f0-9]{32}$/.test(value || '')) throw new HttpError(400, 'Invalid upload.'); return value; };
const photoId = value => { if (!validId(value)) throw new HttpError(400, 'Invalid photo.'); return value; };

export function createHandler(deps) {
  const { store, files, verifyOwner, secret, eventId, ownerUids, now = Date.now } = deps;

  async function actor(headers) {
    const header = headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new HttpError(401, 'Sign in again.');
    if (token.startsWith('g.')) {
      const claims = verifyGuestToken(secret, token, now());
      if (!claims || claims.bucketId !== eventId) throw new HttpError(401, 'Reopen the photo link to continue.');
      return { role: 'guest', contributorId: claims.contributorId };
    }
    let uid;
    try { uid = await verifyOwner(token); } catch { throw new HttpError(401, 'Sign in again.'); }
    if (!uid || !ownerUids.includes(uid)) throw new HttpError(403, 'This account cannot manage this event.');
    return { role: 'owner', uid };
  }
  const needMeta = async () => { const meta = await store.getMeta(); if (!meta) throw new HttpError(404, 'This photo collection does not exist.'); return meta; };
  // Every uid in ownerUids (the planner and the customer) may manage this one event; nobody else can.
  const ownedMeta = async a => { if (a.role !== 'owner') throw new HttpError(403, 'Only the host can do this.'); return needMeta(); };
  const guestOnly = a => { if (a.role !== 'guest') throw new HttpError(403, 'Open the guest link on a guest device to upload.'); };
  const mayTouch = (a, photo) => { if (a.role === 'guest' && photo.contributorId !== a.contributorId) throw new HttpError(404, 'This photo is not available to you.'); };

  async function commit(a, pid, body) {
    guestOnly(a); const meta = await needMeta(); const id = uploadId(body.uploadId);
    const existing = await store.getPhoto(pid);
    if (existing) {
      mayTouch(a, existing);
      if (existing.uploadId === id) return publicPhoto(existing);
      if (!Number.isInteger(body.expectedRevision)) throw new HttpError(409, 'This photo already exists.');
      if (existing.revision !== body.expectedRevision) throw new HttpError(409, 'This photo changed in another tab. Reopen it before saving.');
    } else if (meta.paused) throw new HttpError(403, 'Your host has paused new photos. Try again after uploads resume.');
    const sourceImage = `incoming/${pid}/${id}.jpg`, sourceThumb = `incoming/${pid}/${id}.thumb.jpg`;
    const [image, thumb] = await Promise.all([files.read(sourceImage), files.read(sourceThumb)]);
    if (!image || !thumb) throw new HttpError(400, 'The upload did not finish. Please retry.');
    assertPhotoBytes(image); assertPhotoBytes(thumb, { maxBytes: LIMITS.thumbBytes, maxEdge: 640 });
    const delta = image.length - (existing?.size || 0);
    if (meta.totalBytes + delta > LIMITS.usableBytes) throw new HttpError(507, 'This event has reached its storage limit.');
    const imageKey = `photos/${pid}/${id}.jpg`, thumbKey = `photos/${pid}/${id}.thumb.jpg`;
    await files.copy(sourceImage, imageKey); await files.copy(sourceThumb, thumbKey);
    const stamp = now();
    const photo = { id: pid, bucketId: eventId, contributorId: a.contributorId, name: String(body.name ?? existing?.name ?? '').trim().slice(0, 60), source: 'guest', size: image.length, thumbSize: thumb.length, imageKey, thumbKey, uploadId: id, createdAt: existing?.createdAt || stamp, updatedAt: existing ? stamp : undefined, revision: (existing?.revision || 0) + 1 };
    try { await store.commitPhoto({ photo, previous: existing || null, delta, cap: LIMITS.usableBytes }); }
    catch (error) { await files.remove([imageKey, thumbKey]).catch(() => {}); throw error.conflict ? new HttpError(409, 'This photo could not be saved because the event is paused, full, or the photo changed. Please retry.') : error; }
    await files.remove([sourceImage, sourceThumb]).catch(() => {});
    if (existing) await files.remove([existing.imageKey, existing.thumbKey], [existing.backupKey]).catch(() => {});
    return publicPhoto(photo);
  }

  async function route(method, path, query, body, a) {
    let m;
    if (method === 'POST' && path === '/owner/create') {
      if (a.role !== 'owner') throw new HttpError(403, 'Only the host can do this.');
      const stamp = now();
      const meta = { bucketId: eventId, ownerId: a.uid, ...cleanDetails(body), paused: false, totalBytes: 0, backupBytes: 0, createdAt: stamp, updatedAt: stamp };
      try { await store.createMeta(meta); } catch (error) {
        if (!error.conflict) throw error;
        return reply(200, ownerMeta(await needMeta()));
      }
      return reply(201, ownerMeta(meta));
    }
    if (method === 'GET' && path === '/owner/list') { const meta = await store.getMeta(); return reply(200, meta && a.role === 'owner' ? [ownerMeta(meta)] : []); }
    if (!(m = path.match(/^\/b\/([^/]+)(\/.*)?$/))) throw new HttpError(404, 'Not found.');
    if (m[1] !== eventId) throw new HttpError(404, 'This photo collection does not exist.');
    const rest = m[2] || '';
    if (method === 'GET' && rest === '') return reply(200, ownerMeta(await ownedMeta(a)));
    if (method === 'PATCH' && rest === '') { const meta = await ownedMeta(a); return reply(200, ownerMeta(await store.updateMeta({ ...cleanDetails({ ...meta, ...body }), updatedAt: now() }))); }
    if (method === 'POST' && rest === '/pause') { await ownedMeta(a); return reply(200, ownerMeta(await store.updateMeta({ paused: Boolean(body.paused), updatedAt: now() }))); }
    if (method === 'GET' && rest === '/photos') {
      await needMeta();
      const all = await store.listPhotos(); return reply(200, all.filter(p => a.role === 'owner' || p.contributorId === a.contributorId).map(publicPhoto));
    }
    if (method === 'POST' && rest === '/uploads') {
      guestOnly(a); const meta = await needMeta(); const pid = photoId(body.photoId);
      const size = Number(body.size), thumbSize = Number(body.thumbSize);
      if (!Number.isInteger(size) || size < 1 || size > LIMITS.fileBytes || !Number.isInteger(thumbSize) || thumbSize < 1 || thumbSize > LIMITS.thumbBytes) throw new HttpError(400, 'Choose a smaller photo.');
      const existing = await store.getPhoto(pid);
      if (existing) { mayTouch(a, existing); if (!body.replace) return reply(200, { exists: publicPhoto(existing) }); } else if (meta.paused) throw new HttpError(403, 'Your host has paused new photos. Try again after uploads resume.');
      if (meta.totalBytes + size - (existing?.size || 0) > LIMITS.usableBytes) throw new HttpError(507, 'This event has reached its storage limit.');
      const id = randomUUID().replaceAll('-', '');
      return reply(200, { uploadId: id, image: await files.presignPut(`incoming/${pid}/${id}.jpg`, size), thumbnail: await files.presignPut(`incoming/${pid}/${id}.thumb.jpg`, thumbSize) });
    }
    if ((m = rest.match(/^\/photos\/([^/]+)(\/[a-z]+)?$/))) {
      const pid = photoId(m[1]), action = m[2] || '';
      if (method === 'POST' && action === '/commit') return reply(200, await commit(a, pid, body));
      if (method === 'GET' && action === '/url') {
        if (a.role === 'owner') await ownedMeta(a);
        const photo = await store.getPhoto(pid); if (!photo) throw new HttpError(404, 'Photo not found.'); mayTouch(a, photo);
        return reply(200, { url: await files.presignGet(query.kind === 'thumb' ? photo.thumbKey : photo.imageKey) });
      }
      if (method === 'DELETE' && action === '') {
        if (a.role === 'owner') await ownedMeta(a);
        const photo = await store.getPhoto(pid); if (!photo) return reply(204); mayTouch(a, photo);
        await store.removePhoto(photo); await files.remove([photo.imageKey, photo.thumbKey], [photo.backupKey]).catch(() => {});
        return reply(204);
      }
    }
    throw new HttpError(404, 'Not found.');
  }

  return async function handler(event) {
    try {
      const method = event.requestContext.http.method, path = event.rawPath;
      if (method === 'OPTIONS') return reply(204);
      if (event.body && event.body.length > 64 * 1024) throw new HttpError(413, 'Request too large.');
      let body = {};
      if (event.body) { try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body); } catch { throw new HttpError(400, 'Invalid request.'); } }
      const bid = path.match(/^\/b\/([^/]+)\/public$/);
      if (method === 'GET' && bid) { if (bid[1] !== eventId) throw new HttpError(404, 'This photo collection does not exist.'); return reply(200, publicMeta(await needMeta())); }
      const guestStart = path.match(/^\/b\/([^/]+)\/guest$/);
      if (method === 'POST' && guestStart) {
        if (guestStart[1] !== eventId) throw new HttpError(404, 'This photo collection does not exist.');
        await needMeta(); const contributorId = randomUUID();
        return reply(200, { contributorId, token: signGuestToken(secret, eventId, contributorId, now()) });
      }
      return await route(method, path, event.queryStringParameters || {}, body, await actor(event.headers || {}));
    } catch (error) {
      if (error instanceof HttpError) return reply(error.status, { error: error.message });
      console.error(error); return reply(500, { error: 'Something went wrong. Please try again.' });
    }
  };
}
