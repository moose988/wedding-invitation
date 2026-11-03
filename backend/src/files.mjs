import { CopyObjectCommand, DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectVersionsCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const missing = error => ['NoSuchKey', 'NotFound', 'NoSuchVersion'].includes(error?.name);
const source = (bucket, key) => `${bucket}/${encodeURIComponent(key).replaceAll('%2F', '/')}`;

// S3 slowing down (SlowDown, a bodiless 503 the SDK names UnknownError, 500s) becomes a retryable "busy", never a 500.
const S3_BUSY = new Set(['SlowDown', 'ServiceUnavailable', 'InternalError', 'RequestTimeout', 'RequestTimeTooSkewed', 'ThrottlingException', 'TooManyRequestsException', 'TimeoutError']);
export const s3Busy = error => S3_BUSY.has(error?.name) || [500, 502, 503, 504].includes(error?.$metadata?.httpStatusCode);
const guard = client => ({ send: command => client.send(command).catch(error => { throw s3Busy(error) ? Object.assign(new Error('S3 is busy'), { busy: true, cause: error }) : error; }) });

export function createFiles({ s3: rawS3, bucket, backupS3: rawBackupS3, backupBucket }) {
  const s3 = guard(rawS3), backupS3 = guard(rawBackupS3); // the presigner below gets the raw client: it sends nothing
  const target = name => (name === 'backups' ? { client: backupS3, Bucket: backupBucket } : { client: s3, Bucket: bucket });
  return {
    presignPut: async (key, size) => ({
      url: await getSignedUrl(rawS3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: 'image/jpeg', ContentLength: size }), { expiresIn: 600, signableHeaders: new Set(['content-type', 'content-length']) }),
      headers: { 'content-type': 'image/jpeg' },
    }),
    presignGet: (key, { contentType = 'image/jpeg', expiresIn = 300 } = {}) => getSignedUrl(rawS3, new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentType: contentType }), { expiresIn }),
    presignPutAudio: async (key, size) => ({
      url: await getSignedUrl(rawS3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: 'audio/mpeg', ContentLength: size }), { expiresIn: 600, signableHeaders: new Set(['content-type', 'content-length']) }),
      headers: { 'content-type': 'audio/mpeg' },
    }),
    // Size without reading the body. Commit never loads a whole photo into Lambda memory.
    async head(key) {
      try { return { size: (await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))).ContentLength }; }
      catch (error) { if (missing(error)) return null; throw error; }
    },
    async readRange(key, length, start = 0) {
      try { return Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=${start}-${start + length - 1}` }))).Body.transformToByteArray()); }
      catch (error) { if (missing(error)) return null; throw error; }
    },
    // The last bytes, to check a JPEG ends properly without reading the rest.
    async readTail(key, length) {
      try { return Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=-${length}` }))).Body.transformToByteArray()); }
      catch (error) { if (missing(error)) return null; throw error; }
    },
    // Only the backup function reads whole photos; sharp needs the full file.
    async readFull(key) {
      try { return Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))).Body.transformToByteArray()); }
      catch (error) { if (missing(error)) return null; throw error; }
    },
    async copy(from, to) {
      try { await s3.send(new CopyObjectCommand({ Bucket: bucket, Key: to, CopySource: source(bucket, from) })); return true; }
      catch (error) { if (missing(error)) return false; throw error; }
    },
    // A copy onto itself fires the same S3 notification a commit does, which re-drives the backup without a queue client.
    touch: key => s3.send(new CopyObjectCommand({ Bucket: bucket, Key: key, CopySource: source(bucket, key), MetadataDirective: 'REPLACE', ContentType: 'image/jpeg', Metadata: { redriven: String(Date.now()) } })),
    // Server-side copy of the quality-80 backup back into place. The restored photo IS that copy. False if it is gone.
    async restoreFromBackup(backupKey, imageKey) {
      try { await s3.send(new CopyObjectCommand({ Bucket: bucket, Key: imageKey, CopySource: source(backupBucket, backupKey), ContentType: 'image/jpeg', MetadataDirective: 'REPLACE' })); return true; }
      catch (error) { if (missing(error)) return false; throw error; }
    },
    putBackup: (key, body) => backupS3.send(new PutObjectCommand({ Bucket: backupBucket, Key: key, Body: body, ContentType: 'image/jpeg', StorageClass: 'STANDARD_IA' })),
    // Hides objects in the main bucket: a delete without a version id only adds a delete marker, and the noncurrent
    // version behind it expires under the main bucket's lifecycle rule.
    async remove(keys) {
      const Objects = keys.filter(Boolean).map(Key => ({ Key }));
      if (Objects.length) await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects, Quiet: true } }));
    },
    // Permanent, for named keys only: every version and delete marker. Used when a guest deletes or replaces their photo.
    async purgeKeys(name, keys) {
      const { client, Bucket } = target(name);
      for (const key of keys) {
        for (;;) {
          const page = await client.send(new ListObjectVersionsCommand({ Bucket, Prefix: key, MaxKeys: 1000 }));
          const Objects = [...(page.Versions || []), ...(page.DeleteMarkers || [])].filter(v => v.Key === key).map(({ Key, VersionId }) => ({ Key, VersionId }));
          if (!Objects.length) break;
          const { Errors = [] } = await client.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects, Quiet: true } }));
          if (Errors.length) throw new Error(`S3 refused ${Errors.length} deletes`);
        }
      }
    },
    // Every version of every song file of one event, except the key to keep. The API role may do this under audio/ only.
    async purgeAudio(prefix, keep) {
      if (!/^audio\/[^/]+\/$/.test(prefix)) throw new Error('Refusing to purge outside one event song prefix.');
      for (;;) {
        const page = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: prefix, MaxKeys: 1000 }));
        const Objects = [...(page.Versions || []), ...(page.DeleteMarkers || [])].filter(v => v.Key !== keep).map(({ Key, VersionId }) => ({ Key, VersionId }));
        if (!Objects.length) return;
        const { Errors = [] } = await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects, Quiet: true } }));
        if (Errors.length) throw new Error(`S3 refused ${Errors.length} deletes`);
      }
    },
    // Removes every version and delete marker under one bucket's prefix. Only the sweep functions can list and delete a
    // whole prefix like this in normal use. Returns false when it ran out of time; a later run picks up what is left.
    async purge(name, prefix, hasTime = () => true) {
      if (!/^(buckets|incoming)\/[a-z0-9-]+\/$/.test(prefix)) throw new Error('Refusing to purge outside one bucket prefix.');
      const { client, Bucket } = target(name);
      for (;;) {
        if (!hasTime()) return false;
        const page = await client.send(new ListObjectVersionsCommand({ Bucket, Prefix: prefix, MaxKeys: 1000 }));
        const Objects = [...(page.Versions || []), ...(page.DeleteMarkers || [])].map(({ Key, VersionId }) => ({ Key, VersionId }));
        if (!Objects.length) return true;
        const { Errors = [] } = await client.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects, Quiet: true } }));
        if (Errors.length) throw new Error(`S3 refused ${Errors.length} deletes under ${prefix}`);
      }
    },
  };
}
