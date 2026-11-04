import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { AdminError } from './admin-common.js';

// Local preview only: opted in by scripts/dev-server.mjs, both emulators on loopback, never with real credentials.
const loopback = value => /^(127\.0\.0\.1|localhost):\d+$/.test(value || '');
const localEmulators = () => process.env.QD_LOCAL_ADMIN_EMULATOR === '1' && !process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  && loopback(process.env.FIRESTORE_EMULATOR_HOST) && loopback(process.env.FIREBASE_AUTH_EMULATOR_HOST);

export function adminServices() {
  if (localEmulators()) {
    const app = getApps()[0] || initializeApp({ projectId: 'demo-wedding-security' });
    return { auth: getAuth(app), db: getFirestore(app) };
  }
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) throw new AdminError(503, 'NOT_CONFIGURED', 'Admin services are not configured.');
  let credential;
  try { credential = cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)); }
  catch { throw new AdminError(503, 'NOT_CONFIGURED', 'Admin services are misconfigured: the service account is not valid.'); }
  const app = getApps()[0] || initializeApp({ credential });
  return { auth: getAuth(app), db: getFirestore(app) };
}

// For api/admin-health.js: which credential path adminServices() would take. Never returns values.
export function adminConfigMode(env = process.env) {
  if (env === process.env && localEmulators()) return 'local-emulator';
  return env.FIREBASE_SERVICE_ACCOUNT_JSON ? 'service-account' : 'missing';
}
