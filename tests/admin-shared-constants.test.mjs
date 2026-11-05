import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_DEMO_EXPIRY_HOURS, DEMO_EXPIRY_HOURS as BACKEND_HOURS, OVERDUE_HOURS as BACKEND_OVERDUE_HOURS } from '../backend/src/sizes.mjs';
import { WORDS } from '../api/_lib/demo-password.js';
import { DEFAULT_DEMO_HOURS, DEMO_EXPIRY_HOURS } from '../api/_lib/demo-rules.js';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('demo expiry hours match across the server, the bucket API and the admin UI', async () => {
  assert.deepEqual([...BACKEND_HOURS], [...DEMO_EXPIRY_HOURS]);
  assert.equal(DEFAULT_DEMO_EXPIRY_HOURS, DEFAULT_DEMO_HOURS);
  const { DEFAULT_DEMO_HOURS: uiDefault, DEMO_DURATIONS, OVERDUE_HOURS } = await import('../admin-api.js');
  assert.deepEqual(DEMO_DURATIONS.map(choice => choice.hours), [...DEMO_EXPIRY_HOURS]);
  assert.equal(uiDefault, DEFAULT_DEMO_HOURS);
  assert.equal(OVERDUE_HOURS, BACKEND_OVERDUE_HOURS);
});

test('the demo password word list matches the provisioning tool', async () => {
  const copy = (await source('scripts/provision-admins.mjs')).match(/const WORDS = `([^`]+)`/)[1].trim().split(/\s+/);
  assert.deepEqual([...WORDS], copy);
});

test('static deployments exclude server code and internal files', async () => {
  const ignored = (await source('.vercelignore')).split(/\r?\n/);
  for (const entry of ['server', 'docs', '*.md', '.orchestrate', '.omc', '.claude', '.local-buckets']) assert.ok(ignored.includes(entry), entry);
  const hosting = JSON.parse(await source('firebase.json')).hosting.ignore;
  for (const entry of ['**/.*/**', 'api/**', 'server/**', 'backend/**', '*.md']) assert.ok(hosting.includes(entry), entry);
  const vercel = JSON.parse(await source('vercel.json'));
  assert.ok(vercel.crons.some((cron) => cron.path === '/api/demo-cleanup' && cron.schedule === '0 3 * * *'));
});
