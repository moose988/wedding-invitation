import { createClients } from './clients.mjs';
import { createFiles } from './files.mjs';
import { createAdminSweep, createDemoSweep } from './purge.mjs';
import { createStore } from './store.mjs';

const env = process.env, { doc, s3, backupS3 } = createClients(env);
const store = createStore({ client: doc, table: env.TABLE_NAME });
const files = createFiles({ s3, bucket: env.PHOTO_BUCKET, backupS3, backupBucket: env.BACKUP_BUCKET });
export const demoHandler = createDemoSweep({ store, files });
export const adminHandler = createAdminSweep({ store, files });
