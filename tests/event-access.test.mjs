import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MIN_NEW_PASSWORD, accessRows, cleanEmail, describeMember, existingChoices, linkOutcome, nextStepFor, searchChoices } from '../event-access.js';

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

test('the existing-user list leaves out people who already have access', () => {
  const rows = accessRows([{ id: 'cust-1', email: 'amal@example.test', role: 'customer' }], 'owner-1');
  const directory = [{ id: 'cust-2', email: 'zed@example.test' }, { id: 'cust-1', email: 'amal@example.test' }, { id: 'cust-3', email: 'badr@example.test' }, { id: 'no-email', email: '' }];
  assert.deepEqual(existingChoices(directory, rows).map((row) => row.email), ['badr@example.test', 'zed@example.test']);
});

test('typing part of an email narrows a long user list to a few results', () => {
  const choices = Array.from({ length: 150 }, (_, index) => ({ id: `u${index}`, email: `guest${String(index).padStart(3, '0')}@example.test` })).concat([{ id: 'amal', email: 'amal.h@planner.test' }, { id: 'sam', email: 'sam@amal-events.test' }]);
  const empty = searchChoices(choices, '');
  assert.equal(empty.shown.length, 8);
  assert.equal(empty.more, 144);
  assert.deepEqual(searchChoices(choices, '  AMAL ').shown.map((row) => row.id), ['amal', 'sam'], 'emails that start with the text come first; case and spaces are ignored');
  assert.equal(searchChoices(choices, 'guest14').shown[0].email, 'guest140@example.test');
  assert.equal(searchChoices(choices, 'guest14').shown.length, 8);
  assert.equal(searchChoices(choices, 'guest14').more, 2);
  assert.deepEqual(searchChoices(choices, 'guest007').shown.map((row) => row.id), ['u7']);
  assert.deepEqual(searchChoices(choices, 'nobody'), { shown: [], more: 0 });
});

test('the Access tab is on the card for administrators only and changes access through the server', () => {
  const page = read('weddings.js');
  assert.match(page, /state\.isAdmin && w\.seatingOnly !== true && !w\.cleanupPending \? `<div class="card-admin-links"><button class="secondary-button access-tab" data-action="access"/, 'the tab sits in the admin-only row of the card');
  assert.match(page, /dataset\.action === "access" && state\.isAdmin/);
  assert.doesNotMatch(read('customer-events.html') + read('customer-list.js'), /data-action="access"/);
  const panel = read('event-access-ui.js');
  for (const label of ['+ Add user', 'Add existing user', 'Create new user', 'Find a user']) assert.ok(panel.includes(label), label);
  assert.match(panel, /action: "unlink", userId: row\.id, targets: \[\{ kind: "event", id: wedding\.id \}\]/);
  assert.match(panel, /action: "link", userId: account\.userId, targets: \[\{ kind: "event", id: wedding\.id \}\]/);
  assert.doesNotMatch(panel, /assignCustomer|removeCustomer|writeBatch|setDoc/, 'memberships are never written from this panel');
  assert.match(panel, /confirmAction\(\{ title: "Remove access\?"/);
  // Everything from the database reaches the page through esc().
  assert.doesNotMatch(panel, /<select/, 'the user picker is a search box, not a long drop-down');
  for (const value of ['row.email', 'row.label', 'row.id', 'row.data().email', 'title']) assert.ok(panel.includes(`esc(${value}`), `${value} is escaped`);
});
