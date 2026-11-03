import { AdminError } from './_lib/admin-common.js';
import { CustomerError, manageCustomer } from './_lib/customer-management.js';
import { adminServices } from './_lib/firebase-admin-app.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
  if (!token) return res.status(401).json({ error: 'Sign in is required.' });
  try {
    let services;
    try { services = adminServices(); } catch (error) { throw error instanceof AdminError ? new CustomerError(error.status, 'Customer account management is not configured.') : error; }
    let body;
    try { body = req.body; } catch { throw new CustomerError(400, 'The request body is not valid JSON.'); }
    const { action, userId, password } = body || {};
    await manageCustomer({ auth: services.auth, db: services.db, token, action, userId, password });
    return res.status(200).json({ ok: true });
  } catch (error) {
    if (!(error instanceof CustomerError)) console.error('Customer account management failed:', error.code || error.name);
    return res.status(error.status || 500).json({ error: error instanceof CustomerError ? error.message : 'The operation could not be completed. Please retry.' });
  }
}
