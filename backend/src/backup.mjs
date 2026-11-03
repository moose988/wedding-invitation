import sharp from 'sharp';
import { createClients } from './clients.mjs';
import { createFiles } from './files.mjs';
import { objectKeys, parseImageKey } from './lib.mjs';
import { createStore } from './store.mjs';

// JPEG quality 80 at the same pixel dimensions, for every photo. rotate() only applies EXIF orientation, because the
// re-encode drops the EXIF tag; it never scales.
export const compress = buffer => sharp(buffer, { failOn: 'error' }).rotate().jpeg({ quality: 80, mozjpeg: true }).toBuffer();

const RACE_WINDOW_MS = 15 * 60 * 1000;
export function createBackupHandler({ store, files, encode = compress, now = Date.now }) {
  // What currently owns this file: the live photo, or the audit record of an owner's delete. Restored records no longer do.
  async function owner(ref) {
    const photo = await store.getPhoto(ref.bucketId, ref.photoId);
    if (photo?.uploadId === ref.uploadId) return { item: photo };
    const deletedId = `${ref.photoId}.${ref.uploadId}`, deleted = await store.getDeleted(ref.bucketId, deletedId);
    if (deleted && !deleted.restoredAt) return { item: deleted, deletedId };
    // A tombstone means a guest deleted it or its commit was refused: nothing to wait for, so no redelivery.
    return { replacedOrGone: !photo && !await store.getTombstone(ref.bucketId, deletedId) };
  }
  async function backUp(ref, eventTime) {
    const found = await owner(ref), { item, deletedId } = found;
    if (!item) {
      // The S3 event can overtake the commit transaction it belongs to. Let SQS redeliver for a while before giving up.
      if (found.replacedOrGone && eventTime && now() - Date.parse(eventTime) < RACE_WINDOW_MS) throw new Error('photo record not visible yet');
      return;
    }
    if (item.backupState === 'done') { if (deletedId) await files.remove([item.imageKey]); return; } // a crash may have stopped before hiding it
    const meta = await store.getMeta(ref.bucketId, { consistent: true });
    if (!meta) return;
    const backupKey = objectKeys.backup(ref.bucketId, ref.photoId, ref.uploadId);
    try {
      const source = await files.readFull(item.imageKey);
      if (!source) throw new Error('original missing');
      const body = await encode(source), record = id => store.recordBackup({ bucketId: ref.bucketId, shards: meta.shards, photoId: ref.photoId, deletedId: id, imageKey: item.imageKey, backupKey, backupSize: body.length, stamp: now() });
      await files.putBackup(backupKey, body);
      let holder = deletedId;
      try { await record(holder); }
      catch (error) {
        if (!error.conflict) throw error;
        // The photo changed while this ran. An owner's delete keeps the copy; a guest's delete or replace must leave none.
        const latest = await owner(ref);
        if (!latest.item) { await files.purgeKeys('backups', [backupKey]); return; }
        holder = latest.deletedId;
        if (latest.item.backupState !== 'done') await record(holder);
      }
      // Only now may the original go. Until a backup exists, it is the only copy of a deleted photo.
      if (holder) await files.remove([item.imageKey]);
    } catch (error) {
      await store.markBackupFailed({ bucketId: ref.bucketId, photo: item, deletedId, reason: error.message }).catch(() => {});
      throw error;
    }
  }
  // SQS batch: a failed message goes back alone, and after maxReceiveCount it lands in the DLQ. The photo stays counted
  // as unbacked on its record either way.
  return async function handler(event) {
    const batchItemFailures = [];
    for (const message of event.Records || []) {
      try {
        const body = JSON.parse(message.body);
        for (const record of body.Records || []) {
          const key = decodeURIComponent(String(record.s3?.object?.key).replaceAll('+', ' ')), ref = parseImageKey(key);
          if (ref) await backUp({ ...ref, key }, record.eventTime);
        }
      } catch (error) {
        console.error(JSON.stringify({ backupFailed: message.messageId, error: error.message }));
        batchItemFailures.push({ itemIdentifier: message.messageId });
      }
    }
    return { batchItemFailures };
  };
}

const env = process.env, { doc, s3, backupS3 } = createClients(env);
export const handler = createBackupHandler({ store: createStore({ client: doc, table: env.TABLE_NAME }), files: createFiles({ s3, bucket: env.PHOTO_BUCKET, backupS3, backupBucket: env.BACKUP_BUCKET }) });
