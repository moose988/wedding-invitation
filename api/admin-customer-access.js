import { AdminError, bearerFrom, createBucketClient, readBody, sendError } from './_lib/admin-common.js';
import { cancelEventInvite, createCustomerAccount, listEventAccess, lookupCustomer, manageCustomerAccess, resolveAccounts, searchCustomers } from './_lib/customer-access.js';
import { adminServices } from './_lib/firebase-admin-app.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
  try {
    const token = bearerFrom(req);
    const { action, email, userId, targets, eventId, uids, term, password, grantId } = readBody(req);
    const { auth, db } = adminServices();
    if (action === 'lookup') return res.status(200).json(await lookupCustomer({ auth, db, token, email }));
    if (action === 'event-access') return res.status(200).json(await listEventAccess({ auth, db, token, eventId }));
    if (action === 'accounts') return res.status(200).json(await resolveAccounts({ auth, db, token, uids }));
    if (action === 'search') return res.status(200).json(await searchCustomers({ auth, db, token, term }));
    if (action === 'create') return res.status(201).json(await createCustomerAccount({ auth, db, token, email, password }));
    if (action === 'cancel-invite') return res.status(200).json(await cancelEventInvite({ auth, db, token, eventId, grantId }));
    if (action !== 'link' && action !== 'unlink') throw new AdminError(400, 'INVALID_ACTION', 'Unknown access action.');
    const bucketClient = process.env.PHOTO_BUCKET_API_URL ? createBucketClient({ baseUrl: process.env.PHOTO_BUCKET_API_URL, getToken: async () => token }) : null;
    return res.status(200).json(await manageCustomerAccess({ auth, db, token, action, userId, targets, bucketClient }));
  } catch (error) {
    return sendError(res, error, 'Customer access');
  }
}
