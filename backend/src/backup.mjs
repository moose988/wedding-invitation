import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { putBackup } from './files.mjs';
import { LIMITS } from './lib.mjs';
import { createStore } from './store.mjs';

const env = process.env;
const store = createStore({ client: DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } }), table: env.TABLE_NAME });
const s3 = new S3Client({}), backupS3 = new S3Client({ region: env.BACKUP_REGION });

// Smaller, lower-quality copy for disaster recovery. The full-quality original stays in the main bucket.
export const compress = buffer => sharp(buffer, { failOn: 'error' }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 60, mozjpeg: true }).toBuffer();

export async function handler(event) {
  for (const record of event.Records) {
    const key = decodeURIComponent(record.s3.object.key.replaceAll('+', ' '));
    const match = key.match(/^photos\/([a-zA-Z0-9_-]+)\/[a-f0-9]{32}\.jpg$/); // thumbnails end in .thumb.jpg and never match
    if (!match) continue;
    const photo = await store.getPhoto(match[1]);
    if (!photo || photo.imageKey !== key || photo.backupKey) continue; // replaced, deleted or already backed up
    const source = Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: env.PHOTO_BUCKET, Key: key }))).Body.transformToByteArray());
    const body = await compress(source), backupKey = `backup/${match[1]}/${key.split('/').pop()}`;
    await putBackup({ s3: backupS3, bucket: env.BACKUP_BUCKET, key: backupKey, body });
    try { await store.recordBackup({ photoId: photo.id, imageKey: key, backupKey, backupSize: body.length, cap: LIMITS.backupBytes }); }
    catch (error) {
      if (!error.conflict) throw error;
      // Photo changed or the 9 GB backup budget is full: do not keep an untracked copy.
      await backupS3.send(new DeleteObjectCommand({ Bucket: env.BACKUP_BUCKET, Key: backupKey }));
      console.warn(JSON.stringify({ backupSkipped: key }));
    }
  }
}
