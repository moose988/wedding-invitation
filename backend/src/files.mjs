import { CopyObjectCommand, DeleteObjectsCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export function createFiles({ s3, bucket, backupS3, backupBucket }) {
  return {
    presignPut: async (key, size) => ({
      url: await getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: 'image/jpeg', ContentLength: size }), { expiresIn: 600, signableHeaders: new Set(['content-type', 'content-length']) }),
      headers: { 'content-type': 'image/jpeg' },
    }),
    presignGet: key => getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentType: 'image/jpeg' }), { expiresIn: 300 }),
    async read(key) {
      try { return Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))).Body.transformToByteArray()); }
      catch (error) { if (error.name === 'NoSuchKey') return null; throw error; }
    },
    copy: (from, to) => s3.send(new CopyObjectCommand({ Bucket: bucket, Key: to, CopySource: `${bucket}/${encodeURIComponent(from).replaceAll('%2F', '/')}` })),
    async remove(keys, backupKeys = []) {
      const clean = list => list.filter(Boolean).map(Key => ({ Key }));
      if (clean(keys).length) await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: clean(keys) } }));
      if (clean(backupKeys).length) await backupS3.send(new DeleteObjectsCommand({ Bucket: backupBucket, Delete: { Objects: clean(backupKeys) } }));
    },
  };
}
export const putBackup = ({ s3, bucket, key, body }) => s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'image/jpeg', StorageClass: 'STANDARD_IA' }));
