import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BUCKET_SIZES_GB, DEFAULT_BUCKET_GB, estimateLabel, estimatePhotos } from '../photo-bucket/sizes.js';
import * as backendSizes from '../backend/src/sizes.mjs';

const read = f => readFile(new URL(`../${f}`, import.meta.url), 'utf8').then(source => source.replace(/\r\n/g, '\n'));
const [dashboard, allEvents, weddings, config] = await Promise.all(['dashboard.js', 'all-events.html', 'weddings.js', 'photo-bucket/config.js'].map(read));

test('frontend size list and estimate mirror backend/src/sizes.mjs', () => {
  assert.deepEqual([...BUCKET_SIZES_GB], [...backendSizes.BUCKET_SIZES_GB]);
  for (const gb of BUCKET_SIZES_GB) assert.equal(estimatePhotos(gb), backendSizes.estimatePhotos(gb));
  assert.equal(DEFAULT_BUCKET_GB, 15);
});
test('size hint rounds down to the nearest 100', () => {
  assert.equal(estimateLabel(15), 'About 4,000 photos');
  assert.equal(estimateLabel(20), 'About 5,400 photos');
  assert.equal(estimateLabel(50), 'About 13,600 photos');
});
test('create form has a labelled 15..50 GB select with a polite live hint, wired to the create call', () => {
  const field = allEvents.match(/<label[^>]*id="photoBucketSizeField"[\s\S]*?<\/label>/)?.[0] || '';
  assert.match(field, /Storage size<select/);
  assert.deepEqual([...field.matchAll(/<option value="(\d+)"/g)].map(m => Number(m[1])), [...BUCKET_SIZES_GB]);
  assert.match(field, /<option value="15" selected>/);
  // The hint sits after the label so a screen reader does not read it as part of the label.
  assert.doesNotMatch(field, /photoBucketGbHint">/);
  assert.match(allEvents, /<\/label><small class="full" id="photoBucketGbHint" aria-live="polite">About 4,000 photos/);
  assert.match(weddings, /gb: bucketGb\(\)/);
  assert.match(weddings, /photoBucketGb"\)\?\.addEventListener\("change", updateBucketSizeHint\)/);
  assert.match(weddings, /if \(!state\.isAdmin \|\| state\.editId\) return;/);
});
test('chair details modal reuses the copy-guest-invite flow and hides it where copying cannot work', () => {
  const fn = dashboard.match(/function renderChairInvitationLink[\s\S]*?\n}\n/)?.[0] || '';
  assert.match(fn, /data-action="copy-guest-invite"/);
  assert.match(fn, /isGenderRevealEvent\(state\.wedding\)\) return ""/);
  assert.match(fn, /can\("canEditGuests"\)/);
  assert.match(fn, /getPartySize\(guest\)/);
  assert.match(dashboard, /\$\{renderChairInvitationLink\(guest, assignments\)\}/);
  assert.match(dashboard, /function handleAssignmentChairClick[\s\S]{0,120}if \(!can\("canEditSeating"\)\)/);
});
test('live API_URL is untouched until the new stack is deployed', () => {
  assert.match(config, /https:\/\/udtnp2ttd3\.execute-api\.eu-north-1\.amazonaws\.com/);
});

// Behavioural tests of the online adapter with a stubbed fetch.
globalThis.location = { hostname: 'qd.example.test' };
globalThis.localStorage = { getItem: () => null, setItem() {} };
const { ownerAdapterApi } = await import('../photo-bucket/adapter-api.js');
const user = { getIdToken: async () => 'tok' };
const reply = (status, body, headers = {}) => ({ ok: status < 400, status, headers: { get: k => headers[k.toLowerCase()] ?? null }, json: async () => body });
function stub(handler) { const calls = []; globalThis.fetch = async (url, init) => { calls.push({ url, init }); return handler(calls.length, url, init); }; return calls; }

test('507 and BUCKET_FROZEN are final and keep their code', async () => {
  for (const [status, code] of [[507, 'BUCKET_FULL'], [503, 'BUCKET_FROZEN']]) {
    stub(() => reply(status, { error: 'no', code }));
    await assert.rejects(ownerAdapterApi(user).get('b-abc'), e => e.code === code && e.status === status && !e.retryable);
  }
});
test('other 5xx and 503 BUSY stay retryable', async () => {
  stub(() => reply(500, { error: 'x', code: 'INTERNAL' }));
  await assert.rejects(ownerAdapterApi(user).get('b-abc'), e => e.retryable === true && e.code === 'INTERNAL');
});
test('429 with a long Retry-After is surfaced, not slept on', async () => {
  const calls = stub(() => reply(429, { error: 'slow', code: 'RATE_LIMITED' }, { 'retry-after': '120' }));
  await assert.rejects(ownerAdapterApi(user).get('b-abc'), e => e.retryable && e.retryAfter === 120);
  assert.equal(calls.length, 1);
});
test('create sends gb and owners (demos are made by the admin API), and list follows cursors', async () => {
  let calls = stub(() => reply(201, { id: 'b-1' }));
  await ownerAdapterApi(user).create({ name: 'N', date: '2027-04-18', location: 'L', gb: '25', owners: ['u1'] });
  assert.deepEqual(JSON.parse(calls[0].init.body), { name: 'N', date: '2027-04-18', location: 'L', showUploaderNames: true, cardShowsDetails: false, guestShowsDetails: true, gb: 25, owners: ['u1'] });
  calls = stub(n => n === 1 ? reply(200, { items: [], nextCursor: 'c1' }) : n === 2 ? reply(200, { items: [{ id: 'b-1' }], nextCursor: 'c2' }) : reply(200, { items: [{ id: 'b-2' }], nextCursor: null }));
  assert.deepEqual((await ownerAdapterApi(user).list()).map(b => b.id), ['b-1', 'b-2']);
  assert.match(calls[1].url, /cursor=c1/);
  stub(() => reply(200, [{ id: 'old' }]));
  assert.deepEqual(await ownerAdapterApi(user).list(), [{ id: 'old' }]);
});
