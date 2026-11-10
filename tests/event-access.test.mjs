import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MIN_NEW_PASSWORD, accessRows, cleanEmail, describeMember, bucketRows, linkOutcome, nextStepFor, withoutMembers } from '../event-access.js';

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('each kind of member is named, and only customers can be removed', () => {
  const owner = 'owner-1';
  assert.deepEqual(describeMember({ id: owner, role: 'customer' }, owner).kind, 'owner', 'the recorded owner is the owner whatever the record says');
  assert.equal(describeMember({ id: owner }, owner).removable, false);
  assert.equal(describeMember({ id: 'a', role: 'owner' }, owner).removable, false);
  assert.deepEqual(describeMember({ id: 'c', role: 'customer' }, owner), { kind: 'customer', label: 'Customer', note: 'Guests, seating, event details and exports.', removable: true });
  assert.equal(describeMember({ id: 's', seatingOnly: true, allowedSide: 'bride', canEditSeating: true }, owner).label, 'Seating only, bride side');
  assert.equal(describeMember({ id: 'k', canCheckIn: true, allowedSide: 'all' }, owner).label, 'Check-in');
  assert.equal(describeMember({ id: 'k2', canCheckIn: true, allowedSide: 'groom' }, owner).label, 'Check-in, groom side');
  assert.equal(describeMember({ id: 'm', role: 'member', canViewDashboard: true, canCheckIn: true }, owner).label, 'Staff');
  for (const member of [{ id: 's', seatingOnly: true }, { id: 'k', canCheckIn: true }, { id: 'm', role: 'admin' }]) assert.equal(describeMember(member, owner).removable, false);
});

test('the list shows the owner first, then customers by email, then staff', () => {
  const rows = accessRows([
    { id: 'staff-1', email: 'door@example.test', canCheckIn: true },
    { id: 'cust-2', email: 'zed@example.test', role: 'customer' },
    { id: 'owner-1', email: 'admin@example.test', role: 'owner' },
    { id: 'cust-1', email: 'amal@example.test', role: 'customer' },
    { id: 'cust-3', role: 'customer' },
  ], 'owner-1');
  assert.deepEqual(rows.map((row) => row.id), ['owner-1', 'cust-3', 'cust-1', 'cust-2', 'staff-1']);
  assert.equal(rows[1].email, '', 'a missing email is shown as missing, not invented');
});

test('emails are trimmed, lowercased and checked', () => {
  assert.equal(cleanEmail('  Amal@Example.TEST '), 'amal@example.test');
  for (const value of ['', 'no-at-sign', 'a@b', 'two words@example.test', null, `${'x'.repeat(250)}@example.test`]) assert.equal(cleanEmail(value), '', String(value));
});

test('the next step after a lookup never links an admin, a disabled account or an existing member', () => {
  const rows = accessRows([{ id: 'cust-1', email: 'amal@example.test', role: 'customer' }], 'owner-1');
  assert.equal(nextStepFor(null, rows).step, 'create');
  assert.equal(nextStepFor({ uid: 'new-1', isAdmin: false, disabled: false }, rows).step, 'link');
  assert.deepEqual(nextStepFor({ uid: 'x', isAdmin: true }, rows).step, 'stop');
  assert.match(nextStepFor({ uid: 'x', isAdmin: true }, rows).message, /already have access to every event/);
  assert.equal(nextStepFor({ uid: 'x', disabled: true }, rows).step, 'stop');
  assert.match(nextStepFor({ uid: 'cust-1' }, rows).message, /already has access as Customer/);
  assert.ok(MIN_NEW_PASSWORD >= 8);
});

test('server results become one plain sentence', () => {
  assert.deepEqual(linkOutcome({ results: [{ ok: true, status: 'linked' }] }, 'link'), { ok: true, message: 'Access given.' });
  assert.equal(linkOutcome({ results: [{ ok: true, status: 'unlinked' }] }, 'unlink').ok, true);
  assert.match(linkOutcome({ results: [{ ok: false, code: 'PRESERVED_ROLE' }] }, 'unlink').message, /owner or staff/);
  assert.match(linkOutcome({ results: [{ ok: false, code: 'EVENT_DELETING' }] }, 'link').message, /being deleted/);
  assert.equal(linkOutcome({ results: [{ ok: false, code: 'SOMETHING_NEW', error: 'Server said no.' }] }, 'link').message, 'Server said no.');
  assert.equal(linkOutcome(null, 'link').ok, false);
});

test('search results leave out people who already have access', () => {
  const rows = accessRows([{ id: 'cust-1', email: 'amal@example.test', role: 'customer' }], 'owner-1');
  const results = [{ uid: 'cust-2', email: 'zed@example.test' }, { uid: 'cust-1', email: 'amal@example.test' }, { uid: 'no-email', email: '' }];
  assert.deepEqual(withoutMembers(results, rows), [{ uid: 'cust-2', email: 'zed@example.test' }]);
});

test('a photo bucket lists its owners by email, and every one can be removed', () => {
  const rows = bucketRows([{ uid: 'u2', email: 'zed@example.test', exists: true }, { uid: 'u1', email: 'amal@example.test', exists: true }, { uid: 'gone', email: '', exists: false }]);
  assert.deepEqual(rows.map((row) => row.id), ['gone', 'u1', 'u2']);
  assert.ok(rows.every((row) => row.removable && row.kind === 'customer'));
  assert.equal(rows[0].label, 'Account no longer exists');
  assert.deepEqual(bucketRows([]), []);
});

test('one Access section serves event cards, the event dashboard and the photo bucket page', () => {
  const section = read('access-section.js');
  assert.match(section, /<details class="access-section/, 'a collapsible panel, like Edit details');
  assert.match(section, /<summary>Access<\/summary>/);
  for (const label of ['+ Add user', 'Add existing user', 'Create new user', 'Find a user']) assert.ok(section.includes(label), label);
  assert.doesNotMatch(section, /<select/, 'the user picker is a search box, not a long drop-down');
  assert.doesNotMatch(section, /firebase-config|firestore|getDocs|setDoc|writeBatch|createUserWithEmailAndPassword|createIsolatedCustomer/, 'no database or public sign-up call: everything goes through the admin API');
  assert.match(section, /action: "unlink", userId: row\.id, targets: \[target\]/);
  assert.match(section, /action: "link", userId: account\.userId, targets: \[target\]/);
  assert.match(section, /action: "create", email, password/);
  assert.match(section, /confirmAction\(\{ title: "Remove access\?"/);
  // Everything from the server reaches the page through esc().
  for (const value of ['row.email', 'row.label', 'row.id', 'row.uid', 'failed']) assert.ok(section.includes(`esc(${value}`), `${value} is escaped`);
  // Every style rule is scoped, so no page's own styles are touched.
  const css = read('access-section.css').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const rule of css.match(/[^{}]+(?=\{)/g).map((selector) => selector.trim()).filter((selector) => selector && !selector.startsWith('@'))) {
    for (const part of rule.split(',')) assert.match(part.trim(), /^\.access-section/, `unscoped rule: ${part.trim()}`);
  }

  const page = read('weddings.js');
  assert.match(page, /state\.isAdmin && w\.seatingOnly !== true && !w\.cleanupPending \? `<div class="card-admin-links"><button class="secondary-button access-tab" data-action="access"/, 'the tab sits in the admin-only row of the card');
  assert.match(page, /dataset\.action === "access" && state\.isAdmin/);
  assert.doesNotMatch(read('customer-events.html') + read('customer-list.js'), /data-action="access"/);
  assert.match(read('event-access-ui.js'), /mountAccessSection\(/);
  assert.match(read('dashboard.js'), /isWeddingOwner\(\) \? '<div id="customerAccessPanel"><\/div>/, 'the dashboard shows it to administrators only');
  assert.match(read('photo-bucket/app.js'), /online && bucket\.canAdmin \? '<div id="accessSection"><\/div>/, 'the bucket page shows it to administrators only');
});

test('the new server actions all check for an administrator first', () => {
  const lib = read('api/_lib/customer-access.js');
  for (const name of ['listEventAccess', 'resolveAccounts', 'searchCustomers', 'createCustomerAccount', 'cancelEventInvite']) {
    const body = lib.slice(lib.indexOf(`export async function ${name}(`));
    assert.match(body.slice(0, 200), /\{\n  await requireAdmin\(auth, db, token\);/, `${name} checks the caller before anything else`);
  }
});
