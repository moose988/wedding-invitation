import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { CustomerError, manageCustomer } from '../server/customer-management.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
  if (!token) return res.status(401).json({ error: 'Sign in is required.' });
  try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) throw new CustomerError(503, 'Customer account management is not configured.');
    const app = getApps()[0] || initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)) });
    const { action, userId, password } = req.body || {};
    await manageCustomer({ auth: getAuth(app), db: getFirestore(app), token, action, userId, password });
    return res.status(200).json({ ok: true });
  } catch (error) {
    if (!(error instanceof CustomerError)) console.error('Customer account management failed:', error.code || error.name);
    return res.status(error.status || 500).json({ error: error instanceof CustomerError ? error.message : 'The operation could not be completed. Please retry.' });
  }
}
