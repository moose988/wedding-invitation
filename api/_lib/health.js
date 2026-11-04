// Configuration and reachability checks for api/admin-health.js. Reports names,
// hosts and pass or fail only, never secret values.
import { MIN_SECRET_LENGTH } from './demo-rules.js';

const PROBE_BUCKET = `demo-${'0'.repeat(32)}`; // Valid id shape that can never exist.
const DEPENDS = {
  'admin-health': ['service_account', 'firestore', 'auth'],
  'customer-management': ['service_account', 'firestore', 'auth'],
  'admin-customer-access': ['service_account', 'firestore', 'auth', 'bucket_api_url', 'bucket_api_reachable'],
  'admin-demos': ['service_account', 'firestore', 'auth', 'bucket_api_url', 'bucket_api_reachable'],
  'demo-cleanup': ['service_account', 'firestore', 'auth', 'cron_secret', 'web_api_key', 'demo_service_admin', 'bucket_api_url', 'bucket_api_reachable'],
  'photo-bucket pages': ['bucket_config_match'],
};
const BUCKET_ONLY = new Set(['bucket_api_url', 'bucket_api_reachable']);

const normalizeUrl = (value) => String(value || '').trim().replace(/\/+$/, '');
const hostOf = (value) => { try { return new URL(value).host; } catch { return null; } };

export function serviceAccountShape(raw) {
  if (!raw) return 'missing';
  try {
    const parsed = JSON.parse(raw);
    return parsed && parsed.project_id && parsed.client_email && parsed.private_key ? 'ok' : 'incomplete';
  } catch { return 'invalid'; }
}

export async function runHealthChecks({ env, mode, auth, db, configApiUrl, fetchImpl = fetch }) {
  const checks = [];
  const add = (id, status, detail, fix = '') => checks.push({ id, status, detail, ...(status === 'pass' ? {} : { fix }) });
  const local = mode === 'local-emulator';

  if (local) add('service_account', 'pass', 'Local preview: using the Firebase emulators, no service account needed.');
  else {
    const shape = serviceAccountShape(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (shape === 'ok') add('service_account', 'pass', 'FIREBASE_SERVICE_ACCOUNT_JSON is set and parses.');
    else add('service_account', 'fail', `FIREBASE_SERVICE_ACCOUNT_JSON is ${shape}.`, 'In Vercel, Settings, Environment Variables: paste the whole service account JSON file from Firebase Console, Project settings, Service accounts, then redeploy.');
  }
  try { await db.doc('platformAdmins/health-probe').get(); add('firestore', 'pass', 'Firestore answered a read.'); }
  catch (error) { add('firestore', 'fail', `Firestore read failed (${error?.code || error?.name}).`, 'Check the service account belongs to this Firebase project and has the Firebase Admin role.'); }
  try {
    await auth.getUser('__health_probe__');
    add('auth', 'pass', 'Firebase Auth answered.');
  } catch (error) {
    if (error?.code === 'auth/user-not-found') add('auth', 'pass', 'Firebase Auth answered.');
    else add('auth', 'fail', `Firebase Auth lookup failed (${error?.code || error?.name}).`, 'Check the service account belongs to this Firebase project and has the Firebase Admin role.');
  }

  const bucketUrl = normalizeUrl(env.PHOTO_BUCKET_API_URL);
  const bucketHost = hostOf(bucketUrl);
  const httpsOk = bucketHost && (bucketUrl.startsWith('https://') || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(bucketUrl));
  if (!bucketUrl) add('bucket_api_url', 'fail', 'PHOTO_BUCKET_API_URL is not set, so linking buckets and photo bucket demos fail.', 'Set PHOTO_BUCKET_API_URL in Vercel to the ApiUrl printed by backend/deploy.sh (no trailing slash), then redeploy.');
  else if (!httpsOk) add('bucket_api_url', 'fail', 'PHOTO_BUCKET_API_URL is not an https URL.', 'Use the https ApiUrl printed by backend/deploy.sh.');
  else add('bucket_api_url', 'pass', `PHOTO_BUCKET_API_URL is set (host ${bucketHost}).`);

  if (!httpsOk) add('bucket_api_reachable', 'fail', 'Not checked: PHOTO_BUCKET_API_URL is missing or invalid.', 'Fix PHOTO_BUCKET_API_URL first.');
  else {
    // The bucket API has no health route; its public route for an id that cannot exist
    // must answer with the contract's JSON error.
    try {
      const response = await fetchImpl(`${bucketUrl}/b/${PROBE_BUCKET}/public`, { signal: AbortSignal.timeout(5000) });
      const data = await response.json().catch(() => ({}));
      if (response.status === 404 && data.code) add('bucket_api_reachable', 'pass', 'The bucket API answered.');
      else add('bucket_api_reachable', 'fail', `The bucket API answered unexpectedly (HTTP ${response.status}).`, 'Check PHOTO_BUCKET_API_URL points at the deployed photo bucket stack, not another service.');
    } catch {
      add('bucket_api_reachable', 'fail', 'The bucket API did not answer within 5 seconds.', 'Check the stack is deployed and PHOTO_BUCKET_API_URL is the ApiUrl from backend/deploy.sh.');
    }
  }

  const configUrl = normalizeUrl(configApiUrl);
  if (!configUrl) add('bucket_config_match', 'fail', 'photo-bucket/config.js has no API_URL, so photo bucket pages use the browser-only demo.', 'Set API_URL in photo-bucket/config.js to the same ApiUrl and redeploy.');
  else if (!bucketUrl) add('bucket_config_match', 'fail', `photo-bucket/config.js uses host ${hostOf(configUrl)}, but PHOTO_BUCKET_API_URL is not set.`, 'Set PHOTO_BUCKET_API_URL to the same ApiUrl as photo-bucket/config.js.');
  else if (configUrl !== bucketUrl) add('bucket_config_match', 'fail', `photo-bucket/config.js (host ${hostOf(configUrl)}) and PHOTO_BUCKET_API_URL (host ${bucketHost}) differ, so pages and admin functions use different stacks.`, 'Make both the ApiUrl of the current stack, then redeploy.');
  else add('bucket_config_match', 'pass', 'photo-bucket/config.js and PHOTO_BUCKET_API_URL match.');

  const secret = env.CRON_SECRET || '';
  if (secret.length >= MIN_SECRET_LENGTH) add('cron_secret', 'pass', 'CRON_SECRET is set and long enough.');
  else add('cron_secret', local ? 'warn' : 'fail', secret ? `CRON_SECRET is shorter than ${MIN_SECRET_LENGTH} characters, so it is ignored.` : 'CRON_SECRET is not set, so the daily cleanup is refused.', `Set CRON_SECRET in Vercel to a random value of at least ${MIN_SECRET_LENGTH} characters (for example: openssl rand -hex 32), then redeploy.`);

  if (env.FIREBASE_WEB_API_KEY) add('web_api_key', 'pass', 'FIREBASE_WEB_API_KEY is set.');
  else add('web_api_key', local ? 'warn' : 'fail', 'FIREBASE_WEB_API_KEY is not set, so the scheduled cleanup cannot check buckets and keeps demo accounts.', 'Set FIREBASE_WEB_API_KEY to the apiKey from the site Firebase config, then redeploy.');

  const serviceUid = env.DEMO_SERVICE_ADMIN_UID;
  if (!serviceUid) add('demo_service_admin', local ? 'warn' : 'fail', 'DEMO_SERVICE_ADMIN_UID is not set, so the scheduled cleanup keeps demo accounts.', 'Set DEMO_SERVICE_ADMIN_UID to the uid of an enabled platform admin that is also in the bucket stack ADMIN_UIDS.');
  else {
    try {
      const admin = await db.doc(`platformAdmins/${serviceUid}`).get();
      if (admin.exists && admin.data().enabled === true) add('demo_service_admin', 'pass', 'DEMO_SERVICE_ADMIN_UID is an enabled platform admin. It must also be in the bucket stack ADMIN_UIDS, which this check cannot see.');
      else add('demo_service_admin', 'fail', 'DEMO_SERVICE_ADMIN_UID is not an enabled platform admin.', 'Use the uid of an enabled platform admin, or enable it with scripts/provision-admins.mjs.');
    } catch {
      add('demo_service_admin', 'fail', 'DEMO_SERVICE_ADMIN_UID could not be checked.', 'Fix the Firestore check first.');
    }
  }

  const status = Object.fromEntries(checks.map((check) => [check.id, check.status]));
  const functions = Object.fromEntries(Object.entries(DEPENDS).map(([name, ids]) => {
    const failing = ids.filter((id) => status[id] === 'fail');
    const coreFailing = failing.filter((id) => !BUCKET_ONLY.has(id));
    const note = failing.length && !coreFailing.length && (name === 'admin-customer-access' || name === 'admin-demos')
      ? 'Events work; photo bucket operations fail.' : undefined;
    return [name, { ok: failing.length === 0, failing, ...(note ? { note } : {}) }];
  }));
  return { ok: checks.every((check) => check.status !== 'fail'), mode, bucketApiHost: bucketHost, configBucketApiHost: hostOf(configUrl), checks, functions };
}
