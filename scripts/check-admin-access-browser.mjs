// End-to-end QA with disposable loopback Auth/Firestore + the local bucket backend.
// Run the dev server in emulator mode first. No production credentials are used.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('Set both loopback emulator variables explicitly.');
const { chromium } = await import(process.env.ADMIN_ACCESS_PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.ADMIN_ACCESS_PLAYWRIGHT_MODULE)).href : 'playwright');
const origin = 'http://127.0.0.1:5173', evidence = resolve('.local-evidence/admin-access');
await mkdir(evidence, { recursive: true });
const app = initializeApp({ projectId: 'demo-wedding-security' }, 'admin-access-browser');
const auth = getAuth(app), db = getFirestore(app), stamp = Date.now();
const password = 'emulator-only-password', adminEmail = `access-admin-${stamp}@example.test`, email = `sara-${stamp}@example.test`;
const admin = await auth.createUser({ email: adminEmail, password });
const customer = await auth.createUser({ email, password });
await db.doc(`platformAdmins/${admin.uid}`).set({ enabled: true });
await db.doc(`customerDirectory/${customer.uid}`).set({ userId: customer.uid, email });
const signedIn = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: adminEmail, password, returnSecureToken: true }) }).then(r => r.json());
assert.ok(signedIn.idToken);
const api = async (path, body, method = 'POST') => {
  const response = await fetch(origin + path, { method, headers: { authorization: `Bearer ${signedIn.idToken}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json(); assert.ok(response.ok, JSON.stringify(data)); return data;
};
const eventId = `access-${stamp}`, ownedId = `owner-${stamp}`;
for (const [id, title, owner] of [[eventId, 'Layla & Zaid', admin.uid], [ownedId, 'Gender Reveal Party', customer.uid]]) {
  await db.doc(`weddings/${id}`).set({ eventCategory: 'celebration', eventTitle: title, ownerUserId: owner, status: 'active', eventDateISO: '2027-06-14T14:00:00Z', venueEn: 'Garden Hall', eventTimeZone: 'Asia/Dubai' });
}
const bucket = await api('/__photo_bucket_api/owner/create', { name: 'Wedding memories', date: '2027-06-14', location: 'Garden Hall', gb: 15 });
const demo = await api('/api/admin-demos', { type: 'celebration', name: 'Wedding demo', expiresInHours: 24 });
const demoUid = (await db.doc(`weddings/${demo.eventId}`).get()).data().demoAccountUid;
const results = [], errors = [];
const check = name => { results.push(name); console.log('PASS', name); };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(`${origin}/dashboard-login.html?emulator=1`);
  await page.locator('#loginEmail').fill(adminEmail); await page.locator('#loginPassword').fill(password); await page.locator('#loginSubmitButton').click();
  await page.waitForURL('**/all-events.html');
  // Record the actual old panel with the same local data and current page shell.
  await page.route('**/customer-link.js*', route => route.fulfill({ contentType: 'text/javascript', body: execFileSync('git', ['show', '1733b56:customer-link.js'], { encoding: 'utf8' }) }));
  await page.route('**/customers.css*', route => route.fulfill({ contentType: 'text/css', body: execFileSync('git', ['show', '1733b56:customers.css'], { encoding: 'utf8' }) }));
  await page.goto(`${origin}/customers.html`); await page.locator(`[data-target="event:${eventId}"]`).waitFor();
  const screenshotStyle = 'body > aside[role="status"], #localFirestoreDiagnostics { visibility: hidden !important; }';
  await page.locator('#linkPanel').screenshot({ path: `${evidence}/before-desktop.png`, style: screenshotStyle });
  await page.unroute('**/customer-link.js*'); await page.unroute('**/customers.css*');
  await page.reload(); await page.locator(`[data-target="event:${eventId}"]`).waitFor();
  const eventBox = () => page.locator(`[data-target="event:${eventId}"]`), bucketBox = () => page.locator(`[data-target="bucket:${bucket.id}"]`);
  assert.equal(await eventBox().isDisabled(), true);
  await page.locator('#lookupEmail').fill('invalid'); await page.locator('#lookupForm button').click();
  await page.getByText('Enter a full email address.').waitFor(); check('Invalid email is explained');
  await page.locator('#lookupEmail').fill(email); await page.locator('#lookupForm button').click(); await eventBox().waitFor();
  await page.waitForFunction(() => !document.querySelector('#eventChoices input:not([disabled])') === false);
  await bucketBox().waitFor();
  assert.equal(await page.locator(`[data-target="event:${ownedId}"]`).isDisabled(), true); check('Owner role is visibly protected');
  await eventBox().check(); await bucketBox().check();
  assert.equal(await page.locator('#doLink').textContent(), 'Link selected (2)');
  await page.locator('#doLink').click(); await page.getByText('2 succeeded, 0 failed.', { exact: true }).waitFor();
  assert.equal((await db.doc(`weddings/${eventId}/dashboardUsers/${customer.uid}`).get()).exists, true);
  assert.ok((await api(`/__photo_bucket_api/owner/list?uid=${customer.uid}`, null, 'GET')).items.some(row => row.id === bucket.id));
  check('One action links an event and a bucket; both backend records verified');
  await page.reload(); await page.locator('#lookupEmail').fill(email); await page.locator('#lookupForm button').click();
  await page.waitForFunction(() => document.querySelector('.access-state--linked'));
  await page.locator('#accessFilter').selectOption('linked');
  assert.equal(await eventBox().count(), 1); assert.equal(await bucketBox().count(), 1);
  await eventBox().check(); await page.locator('#eventFilter').fill('no matching event');
  assert.equal(await page.locator('#doUnlink').isDisabled(), false); check('Selections survive filtering and access survives reload');
  await page.locator('#eventFilter').fill(''); await page.locator('#accessFilter').selectOption('all');
  await page.locator('#clearSelection').click();
  assert.equal(await page.locator('#clearSelection').getAttribute('aria-busy'), null);
  assert.equal(await page.locator('#lookupForm button').getAttribute('aria-busy'), 'false');
  await writeFile(`${evidence}/preview.html`, await page.evaluate(() => `<!doctype html><html lang="en"><head><base href="${location.origin}/"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${[...document.head.querySelectorAll('link')].map(link => link.outerHTML).join('')}<style>body{margin:0}main{max-width:1260px;margin:auto;padding:24px}h1{font:700 24px Manrope,sans-serif;margin:0 0 20px}</style></head><body class="weddings-body"><main><h1>QD Events · Customers</h1>${document.querySelector('#linkPanel').outerHTML}</main></body></html>`));
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 }); await page.locator('#linkPanel').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `no overflow at ${width}`);
    await page.locator('#linkPanel').screenshot({ path: `${evidence}/after-${width}.png`, style: screenshotStyle });
  }
  check('Desktop, tablet and phone have no horizontal overflow');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await eventBox().check(); await bucketBox().check(); await page.locator('#doUnlink').click();
  assert.ok((await page.locator('#unlinkSummary').textContent()).includes(email));
  assert.equal(await page.locator('#unlinkTargets li').count(), 2);
  await page.locator('#cancelUnlink').click(); assert.equal((await db.doc(`weddings/${eventId}/dashboardUsers/${customer.uid}`).get()).exists, true);
  await page.locator('#doUnlink').click(); await page.locator('#unlinkAccessForm [type=submit]').click();
  await page.getByText('2 succeeded, 0 failed.', { exact: true }).waitFor();
  assert.equal((await db.doc(`weddings/${eventId}/dashboardUsers/${customer.uid}`).get()).exists, false);
  assert.equal((await api(`/__photo_bucket_api/owner/list?uid=${customer.uid}`, null, 'GET')).items.some(row => row.id === bucket.id), false);
  assert.ok(await auth.getUser(customer.uid)); check('Unlink confirmation cancels safely and removes both links without deleting the account');
  const eventData = (await db.doc(`weddings/${eventId}`).get()).data();
  await eventBox().check(); await bucketBox().check(); await db.doc(`weddings/${eventId}`).delete();
  await page.locator('#doLink').click(); await page.getByText('1 succeeded, 1 failed.', { exact: true }).waitFor();
  assert.equal(await eventBox().isChecked(), true); assert.equal(await bucketBox().isChecked(), false);
  await db.doc(`weddings/${eventId}`).set(eventData);
  await page.locator('#doLink').click(); await page.getByText('1 succeeded, 0 failed.', { exact: true }).waitFor();
  assert.equal(await eventBox().isChecked(), false);
  check('Partial failures retain only failed selections and retry completes');
  // A response that arrives after the email was edited must not reactivate the old identity.
  let release; const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/admin-customer-access', async route => { const body = route.request().postDataJSON(); if (body.action === 'lookup') await gate; await route.continue(); });
  await page.locator('#lookupForm button').click(); await page.locator('#lookupEmail').fill('another@example.test'); release();
  await page.waitForResponse(response => response.url().includes('/api/admin-customer-access'));
  assert.equal(await page.locator('#doLink').isDisabled(), true); assert.equal(await eventBox().isDisabled(), true);
  await page.unroute('**/api/admin-customer-access'); check('Late lookup cannot select the previous customer after an email edit');
  // Real delete UI; no direct deletion request bypasses the confirmation.
  await page.goto(`${origin}/all-events.html`);
  const deleteButton = id => page.locator(`[data-action="delete"][data-id="${id}"]`);
  const openDelete = async id => {
    await page.locator(`.wedding-card:has([data-id="${id}"]) .card-menu-toggle`).click(); await deleteButton(id).click();
  };
  await openDelete(demo.eventId); assert.equal(await page.locator('#deletePhrase').textContent(), 'delete');
  await page.locator('#deleteConfirmation').fill('wrong'); await page.locator('#deleteForm [type=submit]').click();
  assert.equal((await db.doc(`weddings/${demo.eventId}`).get()).exists, true);
  await page.locator('#deleteConfirmation').fill('delete'); await page.locator('#deleteForm [type=submit]').click();
  await page.locator('#deleteDialog').waitFor({ state: 'hidden' });
  assert.equal((await db.doc(`weddings/${demo.eventId}`).get()).exists, false);
  await assert.rejects(auth.getUser(demoUid), { code: 'auth/user-not-found' }); check('Typing delete removes the demo and its Auth account through the real UI');
  await openDelete(eventId); await page.locator('#deleteConfirmation').fill('delete'); await page.locator('#deleteForm [type=submit]').click();
  await page.locator('#deleteDialog').waitFor({ state: 'hidden' });
  assert.equal((await db.doc(`weddings/${eventId}`).get()).exists, false); check('Normal event deletion also accepts delete');
  const demoBucket = await api('/api/admin-demos', { type: 'photo_bucket', name: 'Demo photo memories', expiresInHours: 24 });
  const demoBucketUid = (await db.doc(`demoLedger/${demoBucket.demoId}`).get()).data().uid;
  await page.goto(`${origin}/all-events.html#buckets`);
  await page.reload();
  for (const id of [demoBucket.bucketId, bucket.id]) {
    await page.locator(`[data-bucket-action="delete"][data-id="${id}"]`).click();
    await page.locator('#bucketDeleteDialog input[name=phrase]').fill('delete');
    await page.locator('#bucketDeleteDialog [type=submit]').click();
    await page.locator('#bucketDeleteDialog').waitFor({ state: 'hidden' });
  }
  await assert.rejects(auth.getUser(demoBucketUid), { code: 'auth/user-not-found' });
  assert.ok(await auth.getUser(customer.uid));
  check('Photo bucket delete UI accepts delete and removes only generated demo accounts');
  await page.goto(`${origin}/customers.html`); await page.locator('#bucketChoices input, #bucketChoices .admin-note').first().waitFor();
  assert.equal(await bucketBox().count(), 0);
  assert.equal((await api('/__photo_bucket_api/owner/list', null, 'GET')).items.some(row => row.id === bucket.id), false);
  check('Deleted bucket stays absent after navigation and fresh admin listing before the sweep');
  assert.deepEqual(errors, []); check('No uncaught browser errors');
} catch (error) {
  await page.screenshot({ path: `${evidence}/failure.png`, fullPage: true });
  console.error('Browser state:', await page.locator('body').innerText());
  throw error;
} finally {
  await writeFile(`${evidence}/results.json`, JSON.stringify({ results, errors }, null, 2));
  await browser.close(); await deleteApp(app);
}
