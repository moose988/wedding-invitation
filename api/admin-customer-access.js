import { AdminError, bearerFrom, createBucketClient, readBody, sendError } from './_lib/admin-common.js';
import { lookupCustomer, manageCustomerAccess } from './_lib/customer-access.js';
import { adminServices } from './_lib/firebase-admin-app.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
  try {
    const token = bearerFrom(req);
    const { action, email, userId, targets } = readBody(req);
    const { auth, db } = adminServices();
    if (action === 'lookup') return res.status(200).json(await lookupCustomer({ auth, db, token, email }));
    if (action !== 'link' && action !== 'unlink') throw new AdminError(400, 'INVALID_ACTION', 'Choose lookup, link or unlink.');
    const bucketClient = process.env.PHOTO_BUCKET_API_URL ? createBucketClient({ baseUrl: process.env.PHOTO_BUCKET_API_URL, getToken: async () => token }) : null;
    return res.status(200).json(await manageCustomerAccess({ auth, db, token, action, userId, targets, bucketClient }));
  } catch (error) {
    return sendError(res, error, 'Customer access');
  }
}
