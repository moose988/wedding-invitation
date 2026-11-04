import { purgeSongFiles } from './files.mjs';
import { DEMO_ID, TOMBSTONE_ID, photoObjects, songUploadKey, validBucketId } from './lib.mjs';

// Permanent delete of one guest photo. Takes only a tombstone id, and acts only if that tombstone exists and nothing
// still owns the upload: not a live photo, not an owner's audit record. This is the only path from the API to version
// deletion, so what the API role can destroy is limited to what it has first removed from the table.
export async function purgeTombstone({ store, files, tombstoneId }) {
  const m = String(tombstoneId).match(TOMBSTONE_ID);
  if (!m) throw new Error('Invalid tombstone id.');
  const [, bucketId, photoId, uploadId] = m, tombId = `${photoId}.${uploadId}`;
  if (!await store.getTombstone(bucketId, tombId)) return { purged: false, reason: 'no-tombstone' };
  const live = await store.getPhoto(bucketId, photoId);
  if (live?.uploadId === uploadId || await store.getDeleted(bucketId, tombId)) return { purged: false, reason: 'still-owned' };
  const objects = photoObjects(bucketId, photoId, uploadId);
  await files.purgeKeys('photos', objects.photos); await files.purgeKeys('backups', objects.backups);
  return { purged: true };
}

// META goes last, so a crash at any step leaves the bucket findable and the next run finishes it. Each step only lists
// what still exists, which makes re-running harmless.
export async function purgeBucket({ store, files, bucketId, hasTime = () => true }) {
  if (!validBucketId(bucketId)) throw new Error('Invalid bucket id.');
  for (const [target, prefix] of [['photos', `buckets/${bucketId}/`], ['photos', `incoming/${bucketId}/`], ['backups', `buckets/${bucketId}/`]]) {
    if (!await files.purge(target, prefix, hasTime)) return { done: false };
  }
  let cursor;
  do {
    if (!hasTime()) return { done: false };
    const page = await store.listBucketItems(bucketId, cursor);
    await store.deleteItems(page.keys); cursor = page.nextCursor;
  } while (cursor);
  await store.deleteMeta(bucketId);
  return { done: true };
}

// The one test the demo sweep applies. All three must hold; an index entry alone proves nothing.
export const isExpiredDemo = (id, meta, now) => DEMO_ID.test(id) && meta?.bucketId === id && meta.demo === true && Number.isFinite(meta.expiresAt) && meta.expiresAt <= now;
const timeLeft = context => () => (context?.getRemainingTimeInMillis ? context.getRemainingTimeInMillis() > 30_000 : true);

// Scheduled. Takes no input from its event. Its IAM role (template.yaml) reaches only demo- keys and prefixes, so even
// with a bug here it could not touch a real customer's bucket.
export const createDemoSweep = ({ store, files, now = Date.now }) => async (_event, context) => {
  const hasTime = timeLeft(context), result = { purged: 0, unfinished: 0, refused: 0, failed: 0 };
  let cursor;
  do {
    const page = await store.listExpiredDemos({ now: now(), cursor });
    for (const id of page.ids) {
      if (!hasTime()) { result.unfinished += 1; continue; }
      try {
        const meta = await store.getMeta(id, { consistent: true });
        if (!isExpiredDemo(id, meta, now())) { result.refused += 1; continue; }
        await store.markDeleting(id, meta, { stamp: now() });
        const { done } = await purgeBucket({ store, files, bucketId: id, hasTime });
        result[done ? 'purged' : 'unfinished'] += 1;
      } catch (error) { result.failed += 1; console.error(JSON.stringify({ sweep: 'demo', bucketId: id, error: error.name || error.message })); }
    }
    cursor = page.nextCursor;
  } while (cursor);
  console.log(JSON.stringify({ sweep: 'demo', ...result }));
  return result;
};

// Scheduled. Purges only buckets an admin explicitly deleted through the API: listed in the PURGE index AND still
// marked deleting on the record itself. It also repeats the purge of each guest-deleted photo once its tombstone is
// due, which catches a failed first purge and a backup that was already running when the guest deleted.
export const createAdminSweep = ({ store, files, now = Date.now }) => async (_event, context) => {
  const hasTime = timeLeft(context), result = { purged: 0, unfinished: 0, refused: 0, failed: 0, photos: 0, songs: 0 };
  let cursor;
  do {
    const page = await store.listDueTombstones({ now: now(), cursor });
    for (const t of page.items) {
      if (!hasTime()) { result.unfinished += 1; continue; }
      try {
        await purgeTombstone({ store, files, tombstoneId: t.tombstoneId });
        await store.deleteItems([t.key]); result.photos += 1;
      } catch (error) { result.failed += 1; console.error(JSON.stringify({ sweep: 'photo', bucketId: t.bucketId, error: error.name || error.message })); }
    }
    cursor = page.nextCursor;
  } while (cursor);
  do {
    const page = await store.listPurgeQueue({ cursor });
    for (const id of page.ids) {
      if (!hasTime()) { result.unfinished += 1; continue; }
      try {
        const meta = await store.getMeta(id, { consistent: true });
        if (meta?.status !== 'deleting') { result.refused += 1; continue; }
        const { done } = await purgeBucket({ store, files, bucketId: id, hasTime });
        result[done ? 'purged' : 'unfinished'] += 1;
      } catch (error) { result.failed += 1; console.error(JSON.stringify({ sweep: 'admin', bucketId: id, error: error.name || error.message })); }
    }
    cursor = page.nextCursor;
  } while (cursor);
  do {
    const page = await store.listDueSongAttempts({ now: now(), cursor });
    for (const key of page.keys) {
      if (!hasTime()) { result.unfinished += 1; continue; }
      try {
        const attempt = await store.claimSongAttempt(key, now());
        if (!attempt) continue;
        // An unpublished copy cannot become current after the claim. A published
        // copy belongs to the active song or a later attempt that replaced it.
        const keys = attempt.published
          ? [attempt.previousKey, attempt.uploadId && songUploadKey(attempt.eventId, attempt.uploadId)]
          : [attempt.key];
        await purgeSongFiles(files, keys.filter(Boolean));
        await store.deleteSongAttempt(attempt);
        result.songs += 1;
      } catch (error) { result.failed += 1; console.error(JSON.stringify({ sweep: 'song', code: error.code || error.name })); }
    }
    cursor = page.nextCursor;
  } while (cursor);
  console.log(JSON.stringify({ sweep: 'admin', ...result }));
  return result;
};
