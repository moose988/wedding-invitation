import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createClients } from './clients.mjs';
import { createFiles } from './files.mjs';
import { createHandler } from './handler.mjs';
import { createPurgeInvoker } from './invoke.mjs';
import { createStore } from './store.mjs';

const env = process.env, { doc, s3, backupS3 } = createClients(env);
const jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
export const handler = createHandler({
  store: createStore({ client: doc, table: env.TABLE_NAME }),
  files: createFiles({ s3, bucket: env.PHOTO_BUCKET, backupS3, backupBucket: env.BACKUP_BUCKET }),
  purgePhotoFiles: createPurgeInvoker({ functionName: env.PHOTO_PURGE_FUNCTION, region: env.AWS_REGION }),
  verifyOwner: async token => (await jwtVerify(token, jwks, { issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`, audience: env.FIREBASE_PROJECT_ID })).payload.sub,
  secret: env.GUEST_TOKEN_SECRET,
  adminUids: (env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean),
});
