#!/usr/bin/env node
// Run by a person after each deploy:
//   read -rs QD_ADMIN_ID_TOKEN && export QD_ADMIN_ID_TOKEN   (paste, Enter; nothing is echoed)
//   node scripts/post-deploy-check.mjs https://your-site.example
// Read-only: it only sends GET requests, and the function probes carry no token, so
// they are refused before doing anything. The token is read from the environment,
// sent only to <site>/api/admin-health, and never printed or written anywhere.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FUNCTIONS = ['admin-health', 'admin-demos', 'admin-customer-access', 'customer-management', 'demo-cleanup'];
const PRIVATE_DIRS = ['server', 'api/_lib', 'backend', 'docs', '.orchestrate'];

// connect-src matching as browsers do for host sources: exact scheme+host, or *.suffix.
export function cspAllowsHost(csp, origin, name = 'connect-src') {
  const directive = String(csp || '').split(';').map((part) => part.trim().split(/\s+/)).find(([key]) => key === name);
  if (!directive) return false;
  const target = new URL(origin);
  return directive.slice(1).some((source) => {
    const match = source.match(/^(https?:)\/\/(\*\.)?([^/:]+)(:\d+)?\/?$/);
    if (!match || match[1] !== target.protocol) return false;
    return match[2] ? target.hostname.endsWith(`.${match[3]}`) : target.hostname === match[3];
  });
}

async function listFiles(dir, limit) {
  const out = [];
  async function walk(relative) {
    let entries;
    try { entries = await readdir(path.join(root, relative), { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (out.length >= limit) return;
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'node_modules') await walk(child); } else out.push(child);
    }
  }
  await walk(dir);
  return out;
}

// Paths that exist in the repository but must not be downloadable from the site.
export async function privatePaths() {
  const paths = ['server/demo-accounts.js', 'server/customer-management.js', '.orchestrate/README.md'];
  for (const dir of PRIVATE_DIRS) paths.push(...await listFiles(dir, 5));
  const rootMarkdown = (await readdir(root)).filter((name) => name.endsWith('.md'));
  return [...new Set([...paths, ...rootMarkdown])];
}

export async function runPostDeployChecks({ site, token, fetchImpl = fetch, vercelConfig, configApiUrl, paths }) {
  const base = new URL(site).origin;
  const results = [];
  const record = (name, pass, detail) => results.push({ name, pass, detail });
  const get = (pathname, headers = {}) => fetchImpl(`${base}${pathname}`, { headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });

  // 1. Configuration, as the deployment sees it.
  let health = null;
  if (!token) record('admin-health', false, 'QD_ADMIN_ID_TOKEN is not set, so configuration was not checked.');
  else {
    try {
      const response = await get('/api/admin-health', { authorization: `Bearer ${token}` });
      const data = await response.json().catch(() => ({}));
      if (response.status !== 200) record('admin-health', false, `HTTP ${response.status}: ${data.error || 'no JSON body'}${data.fix ? ` Fix: ${data.fix}` : ''}`);
      else {
        health = data;
        for (const check of data.checks || []) {
          if (check.status === 'warn') record(`config: ${check.id}`, true, `WARNING ${check.detail}${check.fix ? ` Fix: ${check.fix}` : ''}`);
          else record(`config: ${check.id}`, check.status === 'pass', check.status === 'pass' ? check.detail : `${check.detail} Fix: ${check.fix}`);
        }
      }
    } catch (error) { record('admin-health', false, `Request failed (${error?.name}).`); }
  }

  // 2. Every function is deployed: a function refuses an unauthenticated GET with JSON.
  for (const name of FUNCTIONS) {
    try {
      const response = await get(`/api/${name}`);
      const json = (response.headers.get('content-type') || '').includes('application/json');
      const noStore = (response.headers.get('cache-control') || '').includes('no-store');
      // 401 or 405 prove the function runs and is configured; 503 means deployed but unconfigured.
      record(`function reachable: /api/${name}`, [401, 405].includes(response.status) && json && noStore,
        `HTTP ${response.status}${json ? '' : ', not JSON'}${noStore ? '' : ', missing no-store'}${response.status === 503 ? ' (deployed but not configured)' : ''}`);
    } catch (error) { record(`function reachable: /api/${name}`, false, `Request failed (${error?.name}).`); }
  }

  // 3. Every page route answers 200 and is never cached.
  const routes = ['/', ...(vercelConfig.rewrites || []).map((rule) => rule.source)];
  let csp = null;
  for (const route of routes) {
    try {
      const response = await get(route);
      const cache = response.headers.get('cache-control') || '';
      if (route === '/') csp = response.headers.get('content-security-policy');
      record(`page: ${route}`, response.status === 200 && cache.includes('no-store'), `HTTP ${response.status}, Cache-Control "${cache}"`);
    } catch (error) { record(`page: ${route}`, false, `Request failed (${error?.name}).`); }
  }

  // 3a. Package manifests are deployed for the functions' install but never served.
  for (const file of ['package.json', 'package-lock.json']) {
    try { const response = await get(`/${file}`); record(`not served: /${file}`, response.status !== 200, `HTTP ${response.status}`); }
    catch (error) { record(`not served: /${file}`, false, `Request failed (${error?.name}).`); }
  }

  // 3b. The largest scripts and styles reach phones compressed (about 5x smaller on slow connections).
  for (const asset of ['/dashboard.js', '/dashboard.css', '/styles.css', '/script.js']) {
    try {
      const response = await get(asset, { 'accept-encoding': 'br, gzip' });
      const encoding = response.headers.get('content-encoding') || '';
      record(`compressed: ${asset}`, response.status === 200 && /\b(br|gzip)\b/.test(encoding), `HTTP ${response.status}, Content-Encoding "${encoding || 'none'}"`);
    } catch (error) { record(`compressed: ${asset}`, false, `Request failed (${error?.name}).`); }
  }

  // 4. Server code and internal files are not publicly served.
  for (const file of paths) {
    try {
      const response = await get(`/${file.split('/').map(encodeURIComponent).join('/')}`);
      record(`not served: /${file}`, response.status !== 200, `HTTP ${response.status}`);
    } catch (error) { record(`not served: /${file}`, false, `Request failed (${error?.name}).`); }
  }

  // 5. The browser may call the bucket API the pages are configured for.
  const bucketUrls = [...new Set([configApiUrl, health?.bucketApiHost ? `https://${health.bucketApiHost}` : null].filter(Boolean))];
  if (!bucketUrls.length) record('CSP allows bucket API', false, 'No bucket API URL is configured in photo-bucket/config.js or the deployment.');
  for (const url of bucketUrls) {
    const host = new URL(url).host;
    record(`CSP connect-src allows ${host}`, Boolean(csp) && cspAllowsHost(csp, url), csp ? 'Checked on /.' : 'No Content-Security-Policy header on /.');
    // Custom event songs play straight from S3 in the API's region, so media-src must allow that bucket host.
    const region = host.match(/\.execute-api\.([a-z0-9-]+)\.amazonaws\.com$/)?.[1];
    if (region) record(`CSP media-src allows S3 in ${region}`, Boolean(csp) && cspAllowsHost(csp, `https://pbs-shared.s3.${region}.amazonaws.com`, 'media-src'), csp ? 'Needed for custom event songs.' : 'No Content-Security-Policy header on /.');
  }
  return { ok: results.every((row) => row.pass), results };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const site = argv.find((arg) => !arg.startsWith('-'));
  if (!site || !/^https?:\/\//.test(site)) {
    console.error('Usage: QD_ADMIN_ID_TOKEN=<admin ID token> node scripts/post-deploy-check.mjs https://your-site.example');
    return 2;
  }
  const vercelConfig = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
  const { API_URL } = await import(pathToFileURL(path.join(root, 'photo-bucket/config.js')).href);
  const { ok, results } = await runPostDeployChecks({ site, token: env.QD_ADMIN_ID_TOKEN, vercelConfig, configApiUrl: API_URL, paths: await privatePaths() });
  for (const row of results) console.log(`${row.pass ? 'PASS' : 'FAIL'}  ${row.name}  ${row.detail}`);
  console.log(`\n${ok ? 'PASSED' : 'FAILED'}: ${results.filter((row) => row.pass).length} of ${results.length} checks passed.`);
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }, (error) => { console.error('Check could not run:', error?.message); process.exitCode = 2; });
}
