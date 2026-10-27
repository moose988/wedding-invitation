import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createFiles } from './files.mjs';
import { createHandler } from './handler.mjs';
import { createStore } from './store.mjs';

const env = process.env;
const jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
export const handler = createHandler({
  store: createStore({ client: DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } }), table: env.TABLE_NAME }),
  files: createFiles({ s3: new S3Client({}), bucket: env.PHOTO_BUCKET, backupS3: new S3Client({ region: env.BACKUP_REGION }), backupBucket: env.BACKUP_BUCKET }),
  verifyOwner: async token => (await jwtVerify(token, jwks, { issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`, audience: env.FIREBASE_PROJECT_ID })).payload.sub,
  secret: env.GUEST_TOKEN_SECRET,
  eventId: env.EVENT_ID,
  ownerUids: env.OWNER_UIDS.split(',').map(s => s.trim()).filter(Boolean),
});
