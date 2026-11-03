import { bearerFrom, createBucketClient, readBody, sendError } from './_lib/admin-common.js';
import { createDemo } from './_lib/demo-accounts.js';
import { adminServices } from './_lib/firebase-admin-app.js';

export default async function handler(req, res) {
  // The response is the only copy of the demo password.
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
  try {
    const token = bearerFrom(req);
    const { type, name, expiresInHours } = readBody(req);
    const { auth, db } = adminServices();
    const bucketClient = process.env.PHOTO_BUCKET_API_URL ? createBucketClient({ baseUrl: process.env.PHOTO_BUCKET_API_URL, getToken: async () => token }) : null;
    return res.status(201).json(await createDemo({ auth, db, token, type, name, expiresInHours, bucketClient }));
  } catch (error) {
    return sendError(res, error, 'Demo creation');
  }
}
