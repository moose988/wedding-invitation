import { createClients } from './clients.mjs';
import { createFiles } from './files.mjs';
import { purgeTombstone } from './purge.mjs';
import { createStore } from './store.mjs';

const env = process.env, { doc, s3, backupS3 } = createClients(env);
const store = createStore({ client: doc, table: env.TABLE_NAME });
const files = createFiles({ s3, bucket: env.PHOTO_BUCKET, backupS3, backupBucket: env.BACKUP_BUCKET });
// Reads one field of its input. Nothing else from the caller reaches a key.
export const handler = event => purgeTombstone({ store, files, tombstoneId: event?.tombstoneId });
