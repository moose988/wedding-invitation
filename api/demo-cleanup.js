import { bearerFrom, sendError } from './_lib/admin-common.js';
import { runCleanupRequest } from './_lib/demo-accounts.js';
import { adminServices } from './_lib/firebase-admin-app.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { auth, db } = adminServices();
    const result = await runCleanupRequest({ auth, db, method: req.method, bearer: bearerFrom(req) });
    if (!result.ok) console.error('Demo cleanup had failures:', result.events.failed.length, result.accounts.failed.length);
    return res.status(200).json(result);
  } catch (error) {
    return sendError(res, error, 'Demo cleanup');
  }
}
