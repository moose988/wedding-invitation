import { createHmac, randomUUID } from 'node:crypto';
import { purgeSongFiles } from './files.mjs';
import { HttpError, LIMITS, SONG_MAX_BYTES, assertPhotoHeader, cleanGuestName, hasJpegEnd, id3Skip, looksLikeMp3, songKey, songUploadKey, validEventId, cleanDetails, newBucketId, objectKeys, signGuestToken, validBucketId, validId, validUid, verifyGuestToken } from './lib.mjs';
import { BUCKET_SIZES_GB, DEFAULT_DEMO_EXPIRY_HOURS, DEMO_EXPIRY_HOURS, DEMO_SIZE_GB, bytesForGb, isAllowedSize, overdueInfo } from './sizes.mjs';
import { DEMO_SHARDS, SHARDS } from './store.mjs';

const reply = (statusCode, body, headers = {}) => ({ statusCode, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }, body: body === undefined ? '' : JSON.stringify(body) });
const publicPhoto = p => ({ id: p.id, bucketId: p.bucketId, contributorId: p.contributorId, name: p.name, source: p.source, size: p.size, createdAt: p.createdAt, updatedAt: p.updatedAt, revision: p.revision });
const ownerPhoto = p => ({ ...publicPhoto(p), backupState: p.backupState, ...(p.restoredFromBackup ? { restoredFromBackup: true } : {}) });
const namesShown = m => m.showUploaderNames !== false; // missing means on, for buckets made before the flag
// With names off, a customer gets nothing that tells contributors apart: no name and no contributor id. Admins and the
// guest who took the photo always see both.
const photoFor = (a, meta) => (a.role === 'guest' ? publicPhoto : a.isAdmin || namesShown(meta) ? ownerPhoto : p => { const { name, contributorId, ...rest } = ownerPhoto(p); return rest; });
const deletedView = d => ({ deletedId: d.deletedId, photoId: d.id, name: d.name, contributorId: d.contributorId, actorUid: d.actorUid, actorRole: d.actorRole, deletedAt: d.deletedAt, size: d.size, createdAt: d.createdAt, backupState: d.backupState, restorable: d.backupState === 'done' && !d.restoredAt, restoredAt: d.restoredAt ?? null, restoredBy: d.restoredBy ?? null, earlier: d.earlier || [] });
// A backup finishing after the owner's delete then hides the original. Restore waits out that one function run (120 s).
const LATE_BACKUP_MS = 130 * 1000;
const publicMeta = m => ({ id: m.bucketId, name: m.name, date: m.date, location: m.location, showUploaderNames: namesShown(m), paused: Boolean(m.paused), demo: Boolean(m.demo), expiresAt: m.expiresAt ?? null, createdAt: m.createdAt, updatedAt: m.updatedAt });
const PAUSED_MESSAGE = 'This photo collection is paused until the event. Please check back later.';
const uploadId = value => { if (!/^[a-f0-9]{32}$/.test(value || '')) throw new HttpError(400, 'Invalid upload.', 'INVALID_UPLOAD'); return value; };
const photoId = value => { if (!validId(value)) throw new HttpError(400, 'Invalid photo.', 'INVALID_PHOTO_ID'); return value; };
const noBucket = () => new HttpError(404, 'This photo collection does not exist.', 'BUCKET_NOT_FOUND');
const pageArgs = query => {
  const limit = query.limit === undefined ? LIMITS.pageDefault : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > LIMITS.pageMax) throw new HttpError(400, `limit must be 1 to ${LIMITS.pageMax}.`, 'INVALID_LIMIT');
  if (query.cursor !== undefined && (typeof query.cursor !== 'string' || query.cursor.length > 1024)) throw new HttpError(400, 'Invalid page cursor.', 'INVALID_CURSOR');
  return { limit, cursor: query.cursor };
};
// Routes a main admin can still use while a bucket is frozen. Everyone else gets the friendly message.
const ADMIN_ROUTE = /^(?:GET |PUT \/size|DELETE |POST \/freeze|POST \/owners|DELETE \/owners\/[^/]+|GET \/backups|POST \/backups\/redrive|GET \/deleted|POST \/deleted\/[^/]+\/restore)$/;

export function createHandler({ store, files, purgePhotoFiles, verifyOwner, secret, adminUids = [], now = Date.now, mintPerBucket = 1200, mintPerIp = 1000 }) {
  async function authenticate(headers) {
    const header = headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new HttpError(401, 'Sign in again.', 'UNAUTHENTICATED');
    if (token.startsWith('g.')) {
      const claims = verifyGuestToken(secret, token, now());
      if (!claims) throw new HttpError(401, 'Reopen the photo link to continue.', 'UNAUTHENTICATED');
      return { role: 'guest', bucketId: claims.bucketId, contributorId: claims.contributorId };
    }
    let uid;
    try { uid = await verifyOwner(token); } catch { throw new HttpError(401, 'Sign in again.', 'UNAUTHENTICATED'); }
    if (!uid) throw new HttpError(401, 'Sign in again.', 'UNAUTHENTICATED');
    return { role: 'owner', uid, isAdmin: adminUids.includes(uid) };
  }
  const expired = m => Boolean(m.demo) && m.expiresAt <= now();
  const needAdmin = a => { if (a.role !== 'owner' || !a.isAdmin) throw new HttpError(403, 'Only the main admin can do this.', 'ADMIN_ONLY'); };
  const needHost = a => { if (a.role !== 'owner') throw new HttpError(403, 'Only the host can do this.', 'HOST_ONLY'); };
  const guestOnly = a => { if (a.role !== 'guest') throw new HttpError(403, 'Open the guest link on a guest device to upload.', 'GUEST_ONLY'); };
  const mayTouch = (a, photo) => { if (a.role === 'guest' && photo.contributorId !== a.contributorId) throw new HttpError(404, 'This photo is not available to you.', 'PHOTO_NOT_FOUND'); };
  const full = () => new HttpError(507, 'This event has reached its storage limit.', 'BUCKET_FULL');
  const paused = () => new HttpError(403, 'Your host has paused new photos. Try again after uploads resume.', 'UPLOADS_PAUSED');

  // Limit and usage come from the counter shards; the rest is META. Owner uids and the overdue flag are for admins only.
  const view = async (a, m, counters) => {
    const c = counters || await store.readCounters(m.bucketId);
    return {
      ...publicMeta(m), usedBytes: c.usedBytes, limitBytes: m.limitBytes, limitGb: m.limitGb, photoCount: c.photoCount, backupBytes: c.backupBytes, frozen: Boolean(m.frozen), showUploaderNames: namesShown(m), expired: expired(m), canFreeze: Boolean(a.isAdmin), canAdmin: Boolean(a.isAdmin),
      ...(a.isAdmin ? { owners: m.owners || [], createdBy: m.createdBy, status: m.status, ...(m.demo ? { overdue: false, overdueAt: null } : overdueInfo(m.date, now())) } : {}),
    };
  };
  // The bucket's own rules, applied after we know who is asking. Order matters: strangers learn nothing about its state.
  function assertUsable(meta, a, method, rest) {
    const adminDelete = a?.isAdmin && method === 'DELETE' && rest === '';
    if (!meta || (meta.status === 'deleting' && !adminDelete)) throw noBucket();
    if (expired(meta) && !adminDelete) throw new HttpError(410, 'This demo has expired.', 'BUCKET_EXPIRED');
    if (meta.frozen && !(a?.isAdmin && ADMIN_ROUTE.test(`${method} ${rest}`))) throw new HttpError(503, PAUSED_MESSAGE, 'BUCKET_FROZEN');
  }
  async function loadFor(a, id, method, rest) {
    if (a.role === 'guest' && a.bucketId !== id) throw new HttpError(401, 'Reopen the photo link to continue.', 'TOKEN_WRONG_BUCKET');
    const meta = await store.getMeta(id, { consistent: a.role === 'owner' });
    if (!meta) throw noBucket();
    if (a.role === 'owner' && !a.isAdmin && !(meta.owners || []).includes(a.uid)) throw new HttpError(403, 'This account cannot manage this event.', 'NOT_AN_OWNER');
    assertUsable(meta, a, method, rest);
    return meta;
  }

  // HEAD plus a ranged read of the JPEG header. The 20 MB body never enters Lambda memory.
  async function inspect(key, options) {
    const head = await files.head(key);
    if (!head) return null;
    if (!head.size || head.size > options.maxBytes) throw new HttpError(400, 'The photo is empty or too large.', 'INVALID_PHOTO');
    for (const length of [LIMITS.headerProbeBytes, LIMITS.headerMaxBytes]) {
      const header = await files.readRange(key, Math.min(length, head.size));
      if (!header) return null;
      try { assertPhotoHeader(header, head.size, options); break; }
      catch (error) { if (length === LIMITS.headerMaxBytes || header.length >= head.size) throw error; }
    }
    const tail = await files.readTail(key, Math.min(LIMITS.tailBytes, head.size));
    if (!tail) return null;
    if (!hasJpegEnd(tail)) throw new HttpError(400, 'The photo did not upload completely. Please try again.', 'INVALID_PHOTO');
    return head.size;
  }

  // Permanent, through PhotoPurgeFunction: this role cannot delete versions. Failures are logged, not returned, because
  // the photo is already gone for everyone and the sweep repeats the purge from its tombstone.
  const purgeFiles = (bid, photo) => Promise.resolve().then(() => purgePhotoFiles(`${bid}/${photo.id}.${photo.uploadId}`)).catch(error => console.error(JSON.stringify({ photoPurgeRetrying: photo.id, error: error.name, message: error.message })));

  async function deletePhoto(a, meta, pid) {
    const bid = meta.bucketId;
    for (let attempt = 0; attempt < 4; attempt++) {
      const photo = await store.getPhoto(bid, pid);
      if (!photo) return;
      mayTouch(a, photo);
      try {
        if (a.role === 'guest') { await store.purgePhoto({ bucketId: bid, shards: meta.shards, photo, stamp: now() }); await purgeFiles(bid, photo); return; }
        const before = await store.getDeleted(bid, `${pid}.${photo.uploadId}`);
        const earlier = before ? [...(before.earlier || []), { actorUid: before.actorUid, deletedAt: before.deletedAt, restoredAt: before.restoredAt ?? null, restoredBy: before.restoredBy ?? null }].slice(-20) : [];
        await store.hidePhoto({ bucketId: bid, shards: meta.shards, photo, actor: a, stamp: now(), earlier });
        // With a backup, the original goes (expiring under the main bucket's lifecycle) and the thumbnail stays for a
        // restore. Without one, nothing is touched: the backup function hides the original once its copy exists.
        if (photo.backupState === 'done') await files.remove([photo.imageKey]).catch(error => console.error(JSON.stringify({ hideOriginal: pid, error: error.name })));
        return;
      } catch (error) { if (error.reason !== 'item') throw error; } // changed under us, for example its backup just finished: look again
    }
    throw new HttpError(409, 'This photo changed. Reload and try again.', 'REVISION_CONFLICT');
  }

  async function restorePhoto(a, meta, deletedId) {
    const bid = meta.bucketId, d = await store.getDeleted(bid, deletedId);
    if (!d) throw new HttpError(404, 'Photo not found.', 'PHOTO_NOT_FOUND');
    if (d.restoredAt) throw new HttpError(409, 'This photo was already restored.', 'ALREADY_RESTORED');
    const notReady = () => new HttpError(409, 'This photo has no backup copy yet. Try again later.', 'BACKUP_NOT_READY');
    if (d.backupState !== 'done' || !d.backupKey || (d.lateBackupAt && now() - d.lateBackupAt < LATE_BACKUP_MS)) throw notReady();
    if (await store.getPhoto(bid, d.id)) throw new HttpError(409, 'A newer photo is in its place. Delete that one first.', 'PHOTO_EXISTS');
    if ((await store.readCounters(bid, { consistent: true })).freeBytes < d.backupSize + (d.thumbSize || 0)) throw full();
    if (!await files.restoreFromBackup(d.backupKey, d.imageKey)) throw new HttpError(410, 'The backup copy of this photo is gone.', 'BACKUP_MISSING');
    try { await store.restorePhoto({ bucketId: bid, shards: meta.shards, deleted: d, actor: a, stamp: now() }); }
    catch (error) {
      if (!error.conflict) throw error;
      // A parallel restore may have just won, with this very key. Hide it again only if no live photo holds this upload.
      const live = await store.getPhoto(bid, d.id);
      if (live?.uploadId === d.uploadId) throw new HttpError(409, 'This photo was already restored.', 'ALREADY_RESTORED');
      await files.remove([d.imageKey]).catch(hideError => console.error(JSON.stringify({ hideRestoredCopy: d.id, error: hideError.name })));
      if (error.reason === 'full') throw full();
      throw new HttpError(409, 'This photo changed. Reload and try again.', 'REVISION_CONFLICT');
    }
    return ownerPhoto(await store.getPhoto(bid, d.id));
  }

  async function commit(a, meta, pid, body) {
    guestOnly(a); const id = uploadId(body.uploadId), bid = meta.bucketId;
    const same = p => { if (p?.uploadId !== id) return false; mayTouch(a, p); return true; };
    const existing = await store.getPhoto(bid, pid);
    if (existing) {
      mayTouch(a, existing);
      if (same(existing)) return publicPhoto(existing);
      if (!Number.isInteger(body.expectedRevision)) throw new HttpError(409, 'This photo already exists.', 'PHOTO_EXISTS');
      if (existing.revision !== body.expectedRevision) throw new HttpError(409, 'This photo changed in another tab. Reopen it before saving.', 'REVISION_CONFLICT');
    } else if (meta.paused) throw paused();
    const sourceImage = objectKeys.incomingImage(bid, pid, id), sourceThumb = objectKeys.incomingThumb(bid, pid, id);
    const lost = async () => { const winner = await store.getPhoto(bid, pid); if (same(winner)) return publicPhoto(winner); throw new HttpError(400, 'The upload did not finish. Please retry.', 'UPLOAD_INCOMPLETE'); };
    const [size, thumbSize] = await Promise.all([inspect(sourceImage, { maxBytes: LIMITS.fileBytes, maxEdge: LIMITS.edge }), inspect(sourceThumb, { maxBytes: LIMITS.thumbBytes, maxEdge: 640 })]);
    if (!size || !thumbSize) return lost();
    const bytes = size + thumbSize, delta = bytes - (existing?.bytes || 0);
    if (delta > 0 && (await store.readCounters(bid)).freeBytes < delta) throw full();
    const imageKey = objectKeys.image(bid, pid, id), thumbKey = objectKeys.thumb(bid, pid, id);
    if (!await files.copy(sourceImage, imageKey) || !await files.copy(sourceThumb, thumbKey)) return lost(); // a parallel retry finished first
    let previous = existing || null, photo;
    const given = cleanGuestName(body.name);
    if (given) await store.setContributorName(bid, a.contributorId, given, now());
    const uploader = given ?? previous?.name ?? (await store.getContributorName(bid, a.contributorId)) ?? '';
    for (let attempt = 0; ; attempt++) {
      const stamp = now();
      photo = { id: pid, bucketId: bid, contributorId: a.contributorId, name: uploader, source: 'guest', size, thumbSize, bytes, imageKey, thumbKey, uploadId: id, backupState: 'pending', createdAt: previous?.createdAt || stamp, updatedAt: previous ? stamp : undefined, revision: (previous?.revision || 0) + 1 };
      try { await store.commitPhoto({ bucketId: bid, shards: meta.shards, photo, previous, stamp }); break; }
      catch (error) {
        if (!error.conflict) throw error; // busy: the client's retry overwrites the copies with the same bytes
        const winner = await store.getPhoto(bid, pid); if (same(winner)) return publicPhoto(winner);
        // Same revision, so only the old photo's backup finished meanwhile: replace it again with its fresh record.
        if (error.reason === 'item' && previous && winner?.uploadId === previous.uploadId && winner.revision === previous.revision && attempt < 3) { previous = winner; continue; }
        // These copies are now orphans, unless a parallel retry of this same upload is about to commit the exact keys.
        // A tombstone lets the sweep remove them after its grace period, and the sweep refuses if a photo owns them by then.
        if (error.reason !== 'gone') await store.addTombstone(bid, { id: pid, uploadId: id }, now()).catch(tombError => console.error(JSON.stringify({ orphanTombstoneFailed: pid, error: tombError.name })));
        throwRefused(error);
      }
    }
    await files.remove([sourceImage, sourceThumb])
      .catch(error => console.error(JSON.stringify({ removeIncomingFailed: true, code: error.cause?.name || error.code || error.name })));
    if (previous) await purgeFiles(bid, previous); // a guest replacing a photo purges the old one, same as deleting it
    return publicPhoto(photo);
  }
  function throwRefused(error) {
    if (error.reason === 'full') throw full();
    if (error.reason === 'paused') throw paused();
    if (error.reason === 'item') throw new HttpError(409, 'This photo changed. Please retry.', 'REVISION_CONFLICT');
    if (error.reason === 'gone') throw noBucket();
    throw new HttpError(409, 'This photo collection is closed.', 'BUCKET_CLOSED');
  }

  async function createBucket(a, body) {
    needAdmin(a);
    const details = cleanDetails(body), demo = body.demo === true, stamp = now();
    if (body.demo !== undefined && typeof body.demo !== 'boolean') throw new HttpError(400, 'demo must be true or false.', 'INVALID_REQUEST');
    if (demo ? body.gb !== undefined && body.gb !== DEMO_SIZE_GB : !isAllowedSize(body.gb)) throw new HttpError(400, demo ? `Demo buckets are fixed at ${DEMO_SIZE_GB} GB.` : `Choose a size from ${BUCKET_SIZES_GB.join(', ')} GB.`, 'INVALID_SIZE');
    if (body.expiresInHours !== undefined && (!demo || !DEMO_EXPIRY_HOURS.includes(body.expiresInHours))) throw new HttpError(400, demo ? `Choose a demo lifetime from ${DEMO_EXPIRY_HOURS.join(', ')} hours.` : 'Only demo buckets expire.', 'INVALID_EXPIRY');
    if (body.showUploaderNames !== undefined && typeof body.showUploaderNames !== 'boolean') throw new HttpError(400, 'showUploaderNames must be true or false.', 'INVALID_REQUEST');
    if (body.owners !== undefined && !Array.isArray(body.owners)) throw new HttpError(400, 'owners must be a list of account ids.', 'INVALID_OWNER');
    const owners = [...new Set(body.owners || [])];
    if (owners.length > LIMITS.maxOwners || !owners.every(validUid)) throw new HttpError(400, 'owners must be a list of account ids.', 'INVALID_OWNER');
    const gb = demo ? DEMO_SIZE_GB : body.gb;
    const meta = { bucketId: newBucketId(demo), ...details, owners, createdBy: a.uid, demo, ...(demo ? { expiresAt: stamp + (body.expiresInHours ?? DEFAULT_DEMO_EXPIRY_HOURS) * 3600000 } : {}), showUploaderNames: body.showUploaderNames !== false, limitGb: gb, limitBytes: bytesForGb(gb), shards: demo ? DEMO_SHARDS : SHARDS, status: 'active', paused: false, frozen: false, createdAt: stamp, updatedAt: stamp };
    await store.createBucket(meta);
    return reply(201, await view(a, meta, { usedBytes: 0, photoCount: 0, backupBytes: 0 }));
  }

  async function listBuckets(a, query) {
    if (query.uid !== undefined && (!a.isAdmin || !validUid(query.uid))) throw new HttpError(a.isAdmin ? 400 : 403, 'Only the main admin can list another account.', a.isAdmin ? 'INVALID_OWNER' : 'ADMIN_ONLY');
    const page = pageArgs(query);
    const { ids, nextCursor } = await store.listBuckets({ uid: query.uid ?? (a.isAdmin ? null : a.uid), limit: Math.min(page.limit, 50), cursor: page.cursor });
    const metas = (await store.getMetas(ids)).filter(m => a.isAdmin || (m.status !== 'deleting' && !expired(m) && (m.owners || []).includes(a.uid)));
    return reply(200, { items: await Promise.all(metas.map(m => view(a, m))), nextCursor });
  }

  async function route(method, rest, query, body, a, meta) {
    const bid = meta.bucketId; let m;
    if (method === 'GET' && rest === '') { needHost(a); return reply(200, await view(a, meta)); }
    if (method === 'PATCH' && rest === '') {
      needHost(a);
      const extra = {};
      if (body.showUploaderNames !== undefined) {
        needAdmin(a); // customers cannot reveal or hide who took which photo
        if (typeof body.showUploaderNames !== 'boolean') throw new HttpError(400, 'showUploaderNames must be true or false.', 'INVALID_REQUEST');
        extra.showUploaderNames = body.showUploaderNames;
      }
      // The event date drives the "past 48 hours" overdue flag, so only admins may move it after creation.
      if (body.date !== undefined && body.date !== meta.date && !a.isAdmin) throw new HttpError(403, 'Only an admin can change the event date. Contact QD Systems if it needs to change.', 'ADMIN_ONLY');
      return reply(200, await view(a, await store.updateMeta(bid, { ...cleanDetails({ ...meta, ...body }), ...extra, updatedAt: now() })));
    }
    if (method === 'DELETE' && rest === '') {
      needAdmin(a);
      if (query.confirm !== bid) throw new HttpError(400, 'Confirm by passing the bucket id as confirm.', 'CONFIRM_REQUIRED');
      await store.markDeleting(bid, meta, { stamp: now(), by: a.uid, queue: true });
      return reply(202, { id: bid, status: 'deleting' });
    }
    if (method === 'PUT' && rest === '/size') {
      needAdmin(a);
      if (meta.demo) throw new HttpError(409, `Demo buckets are fixed at ${DEMO_SIZE_GB} GB.`, 'DEMO_FIXED_SIZE');
      if (!isAllowedSize(body.gb)) throw new HttpError(400, `Choose a size from ${BUCKET_SIZES_GB.join(', ')} GB.`, 'INVALID_SIZE');
      try { return reply(200, await view(a, await store.setLimit(bid, meta, bytesForGb(body.gb), body.gb, now()))); }
      catch (error) {
        if (error.reason === 'below') throw new HttpError(409, 'This bucket already holds more than that.', 'SIZE_BELOW_USAGE');
        if (error.reason === 'stale') throw new HttpError(409, 'The size just changed. Reload and try again.', 'SIZE_CHANGED');
        throw error;
      }
    }
    if (method === 'POST' && rest === '/owners') {
      needAdmin(a);
      if (!validUid(body.uid)) throw new HttpError(400, 'Invalid account id.', 'INVALID_OWNER');
      if ((meta.owners || []).length >= LIMITS.maxOwners && !meta.owners.includes(body.uid)) throw new HttpError(409, 'This bucket has too many owners.', 'TOO_MANY_OWNERS');
      await store.addOwner(bid, meta, body.uid, now());
      return reply(200, await view(a, await store.getMeta(bid, { consistent: true })));
    }
    if ((m = rest.match(/^\/owners\/([^/]+)$/)) && method === 'DELETE') {
      needAdmin(a);
      if (!validUid(m[1])) throw new HttpError(400, 'Invalid account id.', 'INVALID_OWNER');
      await store.removeOwner(bid, m[1], now());
      return reply(200, await view(a, await store.getMeta(bid, { consistent: true })));
    }
    if (method === 'POST' && rest === '/freeze') { needAdmin(a); return reply(200, await view(a, await store.setState(bid, { frozen: Boolean(body.frozen), updatedAt: now() }))); }
    if (method === 'POST' && rest === '/pause') { needHost(a); return reply(200, await view(a, await store.setState(bid, { paused: Boolean(body.paused), updatedAt: now() }))); }
    if (method === 'GET' && rest === '/backups') { needAdmin(a); const [counts, c] = await Promise.all([store.backupCounts(bid), store.readCounters(bid)]); return reply(200, { ...counts, photoCount: c.photoCount, backupBytes: c.backupBytes }); }
    if (method === 'POST' && rest === '/backups/redrive') {
      needAdmin(a);
      const { items, nextCursor } = await store.listUnbacked(bid, pageArgs({ limit: body.limit ?? 50, cursor: body.cursor }));
      await Promise.all(items.map(p => files.touch(p.imageKey)));
      return reply(200, { queued: items.length, nextCursor });
    }
    if (method === 'GET' && rest === '/deleted') { needAdmin(a); const { items, nextCursor } = await store.listDeleted(bid, pageArgs(query)); return reply(200, { items: items.map(deletedView), nextCursor }); }
    if ((m = rest.match(/^\/deleted\/([^/]+)\/restore$/)) && method === 'POST') {
      needAdmin(a);
      if (!/^[a-zA-Z0-9_-]{1,80}\.[a-f0-9]{32}$/.test(m[1])) throw new HttpError(400, 'Invalid photo.', 'INVALID_PHOTO_ID');
      return reply(200, await restorePhoto(a, meta, m[1]));
    }
    if (method === 'GET' && rest === '/photos') {
      const page = pageArgs(query);
      if (query.contributor !== undefined && !validId(query.contributor)) throw new HttpError(400, 'Invalid contributor.', 'INVALID_CONTRIBUTOR');
      if (query.contributor !== undefined && a.role === 'owner' && !a.isAdmin && !namesShown(meta)) throw new HttpError(403, 'Uploader names are hidden for this event.', 'NAMES_HIDDEN');
      // A guest is always scoped to their own id from the signed token. Whatever they pass as contributor is ignored.
      if (query.order !== undefined && !['newest', 'oldest'].includes(query.order)) throw new HttpError(400, 'order must be newest or oldest.', 'INVALID_ORDER');
      const { items, nextCursor } = await store.listPhotos(bid, { contributorId: a.role === 'guest' ? a.contributorId : query.contributor, ...page, order: query.order || 'newest' });
      // Owners get the bucket's real total on the first page, so the gallery never shows the page size as the count.
      const total = a.role === 'owner' && !page.cursor && query.contributor === undefined ? (await store.readCounters(bid)).photoCount : undefined;
      return reply(200, { items: items.map(photoFor(a, meta)), nextCursor, ...(total === undefined ? {} : { total }) });
    }
    if (method === 'POST' && rest === '/uploads') {
      guestOnly(a); const pid = photoId(body.photoId);
      const size = Number(body.size), thumbSize = Number(body.thumbSize);
      if (!Number.isInteger(size) || size < 1 || size > LIMITS.fileBytes || !Number.isInteger(thumbSize) || thumbSize < 1 || thumbSize > LIMITS.thumbBytes) throw new HttpError(400, 'Choose a smaller photo.', 'INVALID_PHOTO');
      const existing = await store.getPhoto(bid, pid);
      if (existing) { mayTouch(a, existing); if (!body.replace) return reply(200, { exists: publicPhoto(existing) }); } else if (meta.paused) throw paused();
      const delta = size + thumbSize - (existing?.bytes || 0);
      if (delta > 0 && (await store.readCounters(bid)).freeBytes < delta) throw full();
      const id = randomUUID().replaceAll('-', '');
      return reply(200, { uploadId: id, image: await files.presignPut(objectKeys.incomingImage(bid, pid, id), size), thumbnail: await files.presignPut(objectKeys.incomingThumb(bid, pid, id), thumbSize) });
    }
    if ((m = rest.match(/^\/photos\/([^/]+)(\/[a-z]+)?$/))) {
      const pid = photoId(m[1]), action = m[2] || '';
      if (method === 'POST' && action === '/commit') return reply(200, await commit(a, meta, pid, body));
      if (method === 'GET' && action === '/url') {
        const photo = await store.getPhoto(bid, pid); if (!photo) throw new HttpError(404, 'Photo not found.', 'PHOTO_NOT_FOUND'); mayTouch(a, photo);
        return reply(200, { url: await files.presignGet(query.kind === 'thumb' ? photo.thumbKey : photo.imageKey) });
      }
      if (method === 'DELETE' && action === '') { await deletePhoto(a, meta, pid); return reply(204); }
    }
    throw new HttpError(404, 'Not found.', 'NOT_FOUND');
  }

  // Bounded per bucket and per source address, because tokens are free to mint and need no login. All guests at a venue
  // can share one address, so that limit has to stay above a full room. The API also throttles this route overall.
  async function mint(event, id, body) {
    const name = cleanGuestName(body.name);
    const stamp = now(), retryAfter = String(Math.ceil((60000 - stamp % 60000) / 1000));
    const ip = event.requestContext?.http?.sourceIp;
    try {
      if (ip) await store.rateHit({ bucketId: id, key: `ip:${createHmac('sha256', secret).update(ip).digest('base64url').slice(0, 16)}`, max: mintPerIp, windowMs: 60000, now: stamp });
      await store.rateHit({ bucketId: id, key: 'bucket', max: mintPerBucket, windowMs: 60000, now: stamp });
    } catch (error) {
      if (error.conflict) throw new HttpError(429, 'Too many people are joining right now. Please try again shortly.', 'RATE_LIMITED', retryAfter);
      throw error;
    }
    const contributorId = randomUUID();
    if (name) await store.setContributorName(id, contributorId, name, stamp);
    return reply(200, { contributorId, ...(name ? { name } : {}), token: signGuestToken(secret, id, contributorId, stamp) });
  }

  const songRevision = song => song?.revision ?? song?.key ?? null;
  const newSongRevision = () => randomUUID().replaceAll('-', '');
  const songChanged = () => new HttpError(409, 'The song changed in another tab. Reload and try again.', 'SONG_CONFLICT');
  const songIncomplete = () => new HttpError(400, 'The upload did not finish. Please retry.', 'UPLOAD_INCOMPLETE');
  const songResponse = song => reply(200, { eventId: song.eventId, size: song.size, updatedAt: song.updatedAt });
  // Keep the previous key in the record until the next successful change so a retry can complete cleanup.
  async function cleanSong(song) {
    const keys = [song?.previousKey, song?.uploadId && songUploadKey(song.eventId, song.uploadId)].filter(Boolean);
    await purgeSongFiles(files, keys);
  }

  // Event songs for invitations. Admins upload; anyone with the event id can play the current song.
  async function songRoute(event, method, [, rawId, sub = ''], body) {
    let eventId;
    try { eventId = decodeURIComponent(rawId); } catch { eventId = null; }
    if (!validEventId(eventId)) throw new HttpError(400, 'Invalid event.', 'INVALID_EVENT');
    if (method === 'GET' && sub === '/song') {
      const song = await store.getSong(eventId);
      if (!song?.key) throw new HttpError(404, 'This event has no song.', 'NO_SONG');
      const expiresIn = 900, url = await files.presignGet(song.key, { contentType: 'audio/mpeg', expiresIn });
      // Cacheable for well under the URL's life, so a cached answer still plays.
      return reply(200, { url, expiresAt: now() + expiresIn * 1000, updatedAt: song.updatedAt, size: song.size }, { 'cache-control': 'public, max-age=300' });
    }
    const a = await authenticate(event.headers || {});
    needAdmin(a);
    const current = await store.getSong(eventId);
    const baseRevision = songRevision(current);
    if (method === 'POST' && sub === '/song/uploads') {
      const size = Number(body.size);
      if (!Number.isInteger(size) || size < 1 || size > SONG_MAX_BYTES) throw new HttpError(400, 'Choose an MP3 of up to 15 MB.', 'INVALID_AUDIO');
      const id = newSongRevision();
      await store.putSongUpload(eventId, id, baseRevision, now() + 600_000);
      return reply(200, { uploadId: id, upload: await files.presignPutAudio(songUploadKey(eventId, id), size) });
    }
    if (method === 'POST' && sub === '/song/commit') {
      const id = uploadId(body.uploadId);
      if (current?.uploadId === id) { await cleanSong(current); return songResponse(current); }
      const grant = await store.getSongUpload(eventId, id);
      if (!grant || grant.expiresAt <= now()) throw songIncomplete();
      if (grant.baseRevision !== baseRevision) throw songChanged();
      await cleanSong(current);

      const revision = newSongRevision(), key = songKey(eventId, id, revision);
      const source = songUploadKey(eventId, id);
      // Copy to an attempt-specific key: the upload URL can still overwrite the staging key,
      // and two retries for one upload must never delete or change each other's candidate.
      if (!await files.copy(source, key)) {
        const winner = await store.getSong(eventId);
        if (winner?.uploadId === id) return songResponse(winner);
        throw songIncomplete();
      }
      let song;
      try {
        const head = await files.head(key);
        if (!head) throw songIncomplete();
        if (head.size > SONG_MAX_BYTES) throw new HttpError(400, 'Choose an MP3 of up to 15 MB.', 'INVALID_AUDIO');
        const start = id3Skip(await files.readRange(key, Math.min(10, head.size)) || Buffer.alloc(0));
        const frames = start < head.size ? await files.readRange(key, Math.min(4096, head.size - start), start) : null;
        if (!frames || !looksLikeMp3(frames)) throw new HttpError(400, 'This file is not an MP3.', 'INVALID_AUDIO');
        song = { eventId, revision, key, uploadId: id, size: head.size, updatedAt: now(), updatedBy: a.uid, ...(current?.key ? { previousKey: current.key } : {}) };
      } catch (error) {
        await purgeSongFiles(files, [key]);
        throw error;
      }
      try { await store.putSong(song, baseRevision); }
      catch (error) {
        if (!error.conflict) throw error;
        const winner = await store.getSong(eventId);
        // A transport retry can observe the condition fail after its first write succeeded.
        if (winner?.key === key) { await cleanSong(winner); return songResponse(winner); }
        await purgeSongFiles(files, [key]);
        if (winner?.uploadId === id) { await cleanSong(winner); return songResponse(winner); }
        throw songChanged();
      }
      await cleanSong(song);
      return songResponse(song);
    }
    if (method === 'DELETE' && (sub === '/song' || sub === '')) {
      await cleanSong(current);
      // Keep a short-lived fence even when no song exists, so an upload granted before
      // the delete cannot bring it back. The fence outlives all outstanding upload grants.
      const removed = { eventId, revision: newSongRevision(), ttl: Math.ceil(now() / 1000) + 86400, ...(current?.key ? { previousKey: current.key } : {}) };
      await store.putSong(removed, baseRevision);
      await cleanSong(removed);
      return reply(204);
    }
    throw new HttpError(404, 'Not found.', 'NOT_FOUND');
  }

  return async function handler(event) {
    try {
      const method = event.requestContext.http.method, path = event.rawPath, query = event.queryStringParameters || {};
      if (method === 'OPTIONS') return reply(204);
      if (event.body && event.body.length > 64 * 1024) throw new HttpError(413, 'Request too large.', 'TOO_LARGE');
      let body = {};
      if (event.body) {
        try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body); } catch { throw new HttpError(400, 'Invalid request.', 'INVALID_REQUEST'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Invalid request.', 'INVALID_REQUEST');
      }
      const songPath = path.match(/^\/events\/([^/]+)(\/song(?:\/uploads|\/commit)?)?$/);
      if (songPath) return await songRoute(event, method, songPath, body);
      if (path === '/admin/backups') {
        if (method !== 'GET') throw new HttpError(404, 'Not found.', 'NOT_FOUND');
        const a = await authenticate(event.headers || {});
        needAdmin(a);
        return reply(200, await store.failedBackupCounts());
      }
      if (path === '/owner/create' || path === '/owner/list') {
        if (!(method === 'POST' && path === '/owner/create') && !(method === 'GET' && path === '/owner/list')) throw new HttpError(404, 'Not found.', 'NOT_FOUND');
        const a = await authenticate(event.headers || {});
        needHost(a);
        return await (path === '/owner/create' ? createBucket(a, body) : listBuckets(a, query));
      }
      const match = path.match(/^\/b\/([^/]+)(\/.*)?$/);
      if (!match) throw new HttpError(404, 'Not found.', 'NOT_FOUND');
      const id = match[1], rest = match[2] || '';
      if (!validBucketId(id)) throw noBucket();
      if ((method === 'GET' && rest === '/public') || (method === 'POST' && rest === '/guest')) {
        const meta = await store.getMeta(id);
        assertUsable(meta, null, method, rest);
        return rest === '/public' ? reply(200, publicMeta(meta)) : await mint(event, id, body);
      }
      const a = await authenticate(event.headers || {});
      return await route(method, rest, query, body, a, await loadFor(a, id, method, rest));
    } catch (error) {
      if (error instanceof HttpError) return reply(error.status, { error: error.message, code: error.code }, error.retryAfter ? { 'retry-after': error.retryAfter } : {});
      if (error.invalidCursor) return reply(400, { error: 'Invalid page cursor.', code: 'INVALID_CURSOR' });
      if (error.busy) return reply(503, { error: 'Things are busy right now. Please try again.', code: 'BUSY' }, { 'retry-after': '1' });
      if (error.conflict) return reply(409, { error: 'This changed in the meantime. Please reload and try again.', code: 'CONFLICT' });
      console.error(JSON.stringify({ unhandled: error.name, message: error.message })); return reply(500, { error: 'Something went wrong. Please try again.', code: 'INTERNAL' });
    }
  };
}
