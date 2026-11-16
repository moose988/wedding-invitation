import { AdminError, bearerFrom, createBucketClient, readBody, sendError } from './_lib/admin-common.js';
import { createDemo, deleteDemoBucket, deleteDemoEvent } from './_lib/demo-accounts.js';
import { adminServices } from './_lib/firebase-admin-app.js';

export default async function handler(req, res) {
  // The response is the only copy of the demo password.
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
  try {
    const token = bearerFrom(req);
    const { action, type, name, expiresInHours, eventId, bucketId, confirmation } = readBody(req);
    const { auth, db } = adminServices();
    const bucketClient = process.env.PHOTO_BUCKET_API_URL ? createBucketClient({ baseUrl: process.env.PHOTO_BUCKET_API_URL, getToken: async () => token }) : null;
    if (action === 'delete') {
      if (bucketId && eventId) throw new AdminError(400, 'INVALID_TARGET', 'Choose one demo to delete.');
      return res.status(200).json(await (bucketId ? deleteDemoBucket({ auth, db, token, bucketId, confirmation, bucketClient }) : deleteDemoEvent({ auth, db, token, eventId, confirmation, bucketClient })));
    }
    if (action && action !== 'create') throw new AdminError(400, 'INVALID_ACTION', 'Choose create or delete.');
    return res.status(201).json(await createDemo({ auth, db, token, type, name, expiresInHours, bucketClient }));
  } catch (error) {
    return sendError(res, error, 'Demo creation');
  }
}
