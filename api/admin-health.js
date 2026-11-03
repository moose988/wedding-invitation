import { API_URL as CONFIG_API_URL } from '../photo-bucket/config.js';
import { AdminError, bearerFrom, requireAdmin, sendError } from './_lib/admin-common.js';
import { adminConfigMode, adminServices } from './_lib/firebase-admin-app.js';
import { runHealthChecks, serviceAccountShape } from './_lib/health.js';

const SERVICE_ACCOUNT_FIX = 'In Vercel, Settings, Environment Variables: set FIREBASE_SERVICE_ACCOUNT_JSON to the whole service account JSON file from Firebase Console, Project settings, Service accounts, then redeploy.';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
  try {
    const mode = adminConfigMode();
    // Without admin services the caller cannot be verified, so only this one fact is shown.
    if (mode === 'missing' || (mode === 'service-account' && serviceAccountShape(process.env.FIREBASE_SERVICE_ACCOUNT_JSON) !== 'ok')) {
      throw new AdminError(503, 'NOT_CONFIGURED', 'Admin services are not configured on this deployment.', { fix: SERVICE_ACCOUNT_FIX });
    }
    const { auth, db } = adminServices();
    await requireAdmin(auth, db, bearerFrom(req));
    return res.status(200).json(await runHealthChecks({ env: process.env, mode, auth, db, configApiUrl: CONFIG_API_URL }));
  } catch (error) {
    return sendError(res, error, 'Admin health');
  }
}
