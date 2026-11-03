import test from 'node:test';
import assert from 'node:assert/strict';
import { runHealthChecks } from '../api/_lib/health.js';
import { cspAllowsHost, main, privatePaths, runPostDeployChecks } from '../scripts/post-deploy-check.mjs';

const BUCKET = 'https://abc123.execute-api.eu-north-1.amazonaws.com';
const SECRET = 's'.repeat(40);
const ACCOUNT = JSON.stringify({ project_id: 'p', client_email: 'svc@p.iam', private_key: 'PRIVATE-KEY-VALUE' });
const goodEnv = { FIREBASE_SERVICE_ACCOUNT_JSON: ACCOUNT, PHOTO_BUCKET_API_URL: `${BUCKET}/`, CRON_SECRET: SECRET, FIREBASE_WEB_API_KEY: 'web-key-value', DEMO_SERVICE_ADMIN_UID: 'svc' };

function fakes({ admins = { svc: { enabled: true } }, firestoreDown = false, authDown = false } = {}) {
  return {
    db: { doc: (path) => ({ get: async () => {
      if (firestoreDown) throw Object.assign(new Error('x'), { code: 'permission-denied' });
      const id = path.split('/')[1];
      return { exists: Boolean(admins[id]), data: () => admins[id] };
    } }) },
    auth: { getUser: async () => { throw Object.assign(new Error('x'), { code: authDown ? 'app/invalid-credential' : 'auth/user-not-found' }); } },
  };
}
const bucketFetch = (status = 404, body = { code: 'BUCKET_NOT_FOUND', error: 'Not found.' }) => async (url) => {
  assert.ok(url.startsWith(`${BUCKET}/b/demo-`) && url.endsWith('/public'), 'only the public route is probed');
  return new Response(JSON.stringify(body), { status });
};
const statusOf = (result) => Object.fromEntries(result.checks.map((check) => [check.id, check.status]));

test('health passes when every function is configured', async () => {
  const result = await runHealthChecks({ env: goodEnv, mode: 'service-account', ...fakes(), configApiUrl: BUCKET, fetchImpl: bucketFetch() });
  assert.equal(result.ok, true, JSON.stringify(result.checks.filter((check) => check.status !== 'pass')));
  assert.ok(Object.values(result.functions).every((fn) => fn.ok));
  assert.equal(result.bucketApiHost, new URL(BUCKET).host);
  for (const value of [SECRET, 'PRIVATE-KEY-VALUE', 'web-key-value', 'svc@p.iam']) assert.ok(!JSON.stringify(result).includes(value), 'no values are returned');
});

test('health names each missing setting with a fix and the affected functions', async () => {
  const env = { FIREBASE_SERVICE_ACCOUNT_JSON: '{not json', CRON_SECRET: 'tiny-secret-xyz' };
  const result = await runHealthChecks({ env, mode: 'service-account', ...fakes(), configApiUrl: BUCKET, fetchImpl: bucketFetch() });
  assert.equal(result.ok, false);
  const status = statusOf(result);
  for (const id of ['service_account', 'bucket_api_url', 'bucket_api_reachable', 'bucket_config_match', 'cron_secret', 'web_api_key', 'demo_service_admin']) assert.equal(status[id], 'fail', id);
  assert.ok(result.checks.filter((check) => check.status === 'fail').every((check) => check.fix.length > 20), 'every failure has a fix');
  assert.ok(!JSON.stringify(result).includes('tiny-secret-xyz'), 'the short secret is not echoed');
  assert.deepEqual(result.functions['demo-cleanup'].failing.sort(), ['bucket_api_reachable', 'bucket_api_url', 'cron_secret', 'demo_service_admin', 'service_account', 'web_api_key']);
  assert.equal(result.functions['customer-management'].ok, false);
});

test('bucket-only failures leave event linking usable and say so', async () => {
  const env = { ...goodEnv, PHOTO_BUCKET_API_URL: '' };
  const result = await runHealthChecks({ env, mode: 'service-account', ...fakes(), configApiUrl: BUCKET, fetchImpl: bucketFetch() });
  assert.equal(result.functions['admin-customer-access'].note, 'Events work; photo bucket operations fail.');
  assert.equal(result.functions['customer-management'].ok, true);
});

test('health detects a config.js mismatch, an unreachable or wrong bucket API, and backend failures', async () => {
  const mismatch = await runHealthChecks({ env: goodEnv, mode: 'service-account', ...fakes(), configApiUrl: 'https://flo4boqpu9.execute-api.eu-north-1.amazonaws.com', fetchImpl: bucketFetch() });
  assert.equal(statusOf(mismatch).bucket_config_match, 'fail');
  assert.match(mismatch.checks.find((check) => check.id === 'bucket_config_match').detail, /flo4boqpu9/);
  const down = await runHealthChecks({ env: goodEnv, mode: 'service-account', ...fakes(), configApiUrl: BUCKET, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.equal(statusOf(down).bucket_api_reachable, 'fail');
  const wrong = await runHealthChecks({ env: goodEnv, mode: 'service-account', ...fakes(), configApiUrl: BUCKET, fetchImpl: bucketFetch(200, { hello: 'world' }) });
  assert.equal(statusOf(wrong).bucket_api_reachable, 'fail');
  const http = await runHealthChecks({ env: { ...goodEnv, PHOTO_BUCKET_API_URL: 'http://example.com' }, mode: 'service-account', ...fakes(), configApiUrl: BUCKET, fetchImpl: bucketFetch() });
  assert.equal(statusOf(http).bucket_api_url, 'fail');
  const broken = await runHealthChecks({ env: goodEnv, mode: 'service-account', ...fakes({ firestoreDown: true, authDown: true }), configApiUrl: BUCKET, fetchImpl: bucketFetch() });
  assert.equal(statusOf(broken).firestore, 'fail');
  assert.equal(statusOf(broken).auth, 'fail');
  const disabled = await runHealthChecks({ env: goodEnv, mode: 'service-account', ...fakes({ admins: { svc: { enabled: false } } }), configApiUrl: BUCKET, fetchImpl: bucketFetch() });
  assert.equal(statusOf(disabled).demo_service_admin, 'fail');
});

test('local preview mode warns about scheduler settings but fails a missing bucket URL', async () => {
  const result = await runHealthChecks({ env: {}, mode: 'local-emulator', ...fakes(), configApiUrl: BUCKET, fetchImpl: bucketFetch() });
  const status = statusOf(result);
  assert.equal(status.service_account, 'pass');
  assert.equal(status.cron_secret, 'warn');
  assert.equal(status.web_api_key, 'warn');
  assert.equal(status.bucket_api_url, 'fail', 'this is the silent local linking failure');
  assert.equal(result.functions['customer-management'].ok, true);
});

test('health endpoint: GET only, and without a service account it reveals only that', async () => {
  const saved = { ...process.env };
  for (const key of ['FIREBASE_SERVICE_ACCOUNT_JSON', 'QD_LOCAL_ADMIN_EMULATOR']) delete process.env[key];
  process.env.CRON_SECRET = 'leak-check-value';
  const { default: handler } = await import('../api/admin-health.js');
  const invoke = async (method, account) => {
    if (account === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON; else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = account;
    const out = {};
    await handler({ method, headers: {} }, { setHeader(key, value) { out[key] = value; }, status(code) { out.status = code; return this; }, json(body) { out.body = body; return this; } });
    return out;
  };
  try {
    assert.equal((await invoke('POST')).status, 405);
    for (const account of [undefined, '{broken', '{"project_id":"p"}']) {
      const out = await invoke('GET', account);
      assert.equal(out.status, 503);
      assert.equal(out.body.code, 'NOT_CONFIGURED');
      assert.match(out.body.fix, /FIREBASE_SERVICE_ACCOUNT_JSON/);
      assert.equal(out.body.checks, undefined, 'no other configuration is shown to an unverified caller');
      assert.ok(!JSON.stringify(out.body).includes('leak-check-value'));
      assert.equal(out['Cache-Control'], 'no-store');
    }
  } finally { process.env = saved; }
});

test('CSP connect-src matching', () => {
  const csp = "default-src 'self'; connect-src 'self' https://*.execute-api.eu-north-1.amazonaws.com https://firestore.googleapis.com; img-src 'self'";
  assert.equal(cspAllowsHost(csp, BUCKET), true);
  assert.equal(cspAllowsHost(csp, 'https://abc.execute-api.us-east-1.amazonaws.com'), false);
  assert.equal(cspAllowsHost(csp, 'http://abc.execute-api.eu-north-1.amazonaws.com'), false);
  assert.equal(cspAllowsHost(csp, 'https://firestore.googleapis.com'), true);
  assert.equal(cspAllowsHost("default-src 'self'", BUCKET), false);
});

function fakeSite({ broken = false } = {}) {
  const calls = [];
  const csp = `default-src 'self'; connect-src 'self' ${broken ? 'https://other.example' : 'https://*.execute-api.eu-north-1.amazonaws.com'}`;
  const fetchImpl = async (url, init = {}) => {
    const { pathname } = new URL(url);
    calls.push({ pathname, method: init.method || 'GET', auth: init.headers?.authorization });
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    if (pathname === '/api/admin-health') {
      if (!init.headers?.authorization) return json(401, { error: 'Sign in' });
      return broken ? json(503, { error: 'Admin services are not configured on this deployment.', fix: 'Set FIREBASE_SERVICE_ACCOUNT_JSON.' })
        : json(200, { ok: true, bucketApiHost: new URL(BUCKET).host, checks: [{ id: 'service_account', status: 'pass', detail: 'ok' }, { id: 'cron_secret', status: 'warn', detail: 'w', fix: 'f' }] });
    }
    if (broken && pathname === '/api/_lib/demo-accounts.js') return new Response('code', { status: 200 });
    if (pathname.startsWith('/api/_lib/')) return new Response('Not Found', { status: 404 });
    if (pathname.startsWith('/api/')) return broken && pathname === '/api/demo-cleanup' ? new Response('Not found', { status: 404 }) : json(pathname === '/api/demo-cleanup' ? 401 : 405, { error: 'x' });
    if (pathname === '/' || pathname === '/dashboard' || pathname === '/send') {
      return new Response('<html>', { status: 200, headers: { 'cache-control': broken && pathname === '/send' ? 'public, max-age=60' : 'no-store, max-age=0', 'content-security-policy': csp } });
    }
    return new Response('Not Found', { status: 404 });
  };
  return { fetchImpl, calls };
}
const vercelConfig = { rewrites: [{ source: '/dashboard', destination: '/dashboard.html' }, { source: '/send', destination: '/send.html' }] };
const paths = ['api/_lib/demo-accounts.js', 'backend/src/handler.mjs', 'docs/x.md', '.orchestrate/runs/x/STATUS.md', 'README.md'];

test('post-deploy check passes a healthy site using only GETs, sending the token only to admin-health', async () => {
  const site = fakeSite();
  const token = 'id-token-value';
  const result = await runPostDeployChecks({ site: 'https://site.example/some/page', token, fetchImpl: site.fetchImpl, vercelConfig, configApiUrl: BUCKET, paths });
  assert.equal(result.ok, true, JSON.stringify(result.results.filter((row) => !row.pass)));
  assert.ok(site.calls.every((call) => call.method === 'GET'));
  assert.deepEqual(site.calls.filter((call) => call.auth).map((call) => call.pathname), ['/api/admin-health']);
  assert.ok(!JSON.stringify(result).includes(token));
  assert.ok(result.results.some((row) => row.name === 'config: cron_secret' && row.pass && row.detail.startsWith('WARNING')));
});

test('post-deploy check fails each kind of broken deployment', async () => {
  const site = fakeSite({ broken: true });
  const result = await runPostDeployChecks({ site: 'https://site.example', token: 't', fetchImpl: site.fetchImpl, vercelConfig, configApiUrl: BUCKET, paths });
  const failed = result.results.filter((row) => !row.pass).map((row) => row.name);
  assert.equal(result.ok, false);
  for (const name of ['admin-health', 'function reachable: /api/demo-cleanup', 'page: /send', 'not served: /api/_lib/demo-accounts.js', `CSP connect-src allows ${new URL(BUCKET).host}`]) assert.ok(failed.includes(name), name);
  assert.match(result.results.find((row) => row.name === 'admin-health').detail, /Fix: Set FIREBASE_SERVICE_ACCOUNT_JSON/);
  const noToken = await runPostDeployChecks({ site: 'https://site.example', token: '', fetchImpl: fakeSite().fetchImpl, vercelConfig, configApiUrl: BUCKET, paths });
  assert.equal(noToken.ok, false);
});

test('post-deploy check covers the private folders and root Markdown, and needs a site URL', async () => {
  const list = await privatePaths();
  for (const prefix of ['server/', 'api/_lib/', 'backend/', 'docs/', '.orchestrate/']) assert.ok(list.some((file) => file.startsWith(prefix)), prefix);
  for (const file of ['README.md', 'RELEASE.md']) assert.ok(list.includes(file), file);
  const errors = [];
  const original = console.error;
  console.error = (line) => errors.push(line);
  try { assert.equal(await main([], {}), 2); } finally { console.error = original; }
  assert.match(errors[0], /Usage/);
});
