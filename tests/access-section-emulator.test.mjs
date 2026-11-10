import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { deleteApp as deleteAdminApp, initializeApp as initializeAdmin } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { cancelEventInvite, createCustomerAccount, listEventAccess, manageCustomerAccess, resolveAccounts, searchCustomers } from '../api/_lib/customer-access.js';

// The server actions behind the Access section, against the Auth and Firestore emulators.
// Run with `npm run test:access`.
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST);
const options = { skip: !enabled };
const PROJECT = process.env.ADMIN_API_TEST_PROJECT || 'demo-wedding-security';
const PASSWORD = 'emulator-only-password';
let adminApp, auth, db, admin, adminToken, plain, plainToken;
const clientApps = [];
let counter = 0;
const unique = (label) => `${label}-${Date.now()}-${counter += 1}`;

async function newUser(label) {
  const email = `${unique(label)}@example.test`.toLowerCase();
  const user = await auth.createUser({ email, password: PASSWORD });
  return { uid: user.uid, email };
}
async function tokenFor(email, password = PASSWORD) {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-key' }, unique('client'));
  clientApps.push(app);
  const clientAuth = getAuth(app);
  connectAuthEmulator(clientAuth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  return (await signInWithEmailAndPassword(clientAuth, email, password)).user.getIdToken();
}
async function seedEvent() {
  const eventId = unique('event');
  await db.doc(`weddings/${eventId}`).set({ eventTitle: 'Access test', eventCategory: 'celebration', ownerUserId: admin.uid, status: 'active' });
  await db.doc(`weddings/${eventId}/dashboardUsers/${admin.uid}`).set({ userId: admin.uid, email: admin.email, role: 'owner', canViewDashboard: true });
  return eventId;
}

before(async () => {
  if (!enabled) return;
  adminApp = initializeAdmin({ projectId: PROJECT }, 'access-section-test');
  auth = getAdminAuth(adminApp);
  db = getAdminFirestore(adminApp);
  admin = await newUser('admin');
  await db.doc(`platformAdmins/${admin.uid}`).set({ enabled: true });
  adminToken = await tokenFor(admin.email);
  plain = await newUser('plain');
  plainToken = await tokenFor(plain.email);
});
after(async () => {
  await Promise.all(clientApps.map((app) => deleteApp(app)));
  if (adminApp) await deleteAdminApp(adminApp);
});

test('every Access action refuses anyone who is not an enabled administrator', options, async () => {
  const eventId = await seedEvent();
  const disabled = await newUser('disabled');
  await db.doc(`platformAdmins/${disabled.uid}`).set({ enabled: false });
  const disabledToken = await tokenFor(disabled.email);
  const email = `${unique('never-made')}@example.test`;
  for (const [token, code] of [['', 'UNAUTHENTICATED'], [plainToken, 'ADMIN_ONLY'], [disabledToken, 'ADMIN_ONLY']]) {
    const base = { auth, db, token };
    for (const [name, run] of [
      ['list', () => listEventAccess({ ...base, eventId })], ['accounts', () => resolveAccounts({ ...base, uids: [admin.uid] })],
      ['search', () => searchCustomers({ ...base, term: '' })], ['create', () => createCustomerAccount({ ...base, email, password: 'long-enough-1' })],
      ['cancel', () => cancelEventInvite({ ...base, eventId, grantId: 'x' })],
    ]) await assert.rejects(run(), (error) => error.code === code, `${name} with ${code}`);
  }
  await assert.rejects(auth.getUserByEmail(email), (error) => error.code === 'auth/user-not-found', 'no account was made by a refused call');
});

test('a new customer is created on the server, linked, listed with a role, and removed again', options, async () => {
  const eventId = await seedEvent();
  const base = { auth, db, token: adminToken };
  const email = `${unique('New.Customer')}@Example.test`;
  const made = await createCustomerAccount({ ...base, email: `  ${email} `, password: 'first-password-1' });
  assert.equal(made.email, email.toLowerCase());
  assert.equal((await auth.getUser(made.uid)).emailVerified, false);
  assert.equal((await db.doc(`customerDirectory/${made.uid}`).get()).data().email, email.toLowerCase());
  assert.ok(await tokenFor(email.toLowerCase(), 'first-password-1'), 'the customer can sign in with the password the admin chose');
  await assert.rejects(createCustomerAccount({ ...base, email, password: 'first-password-1' }), (error) => error.code === 'EMAIL_EXISTS' && error.status === 409);
  for (const [input, code] of [[{ email: 'not-an-email', password: 'first-password-1' }, 'INVALID_EMAIL'], [{ email, password: 'short' }, 'INVALID_PASSWORD'], [{ email, password: 7 }, 'INVALID_PASSWORD']]) {
    await assert.rejects(createCustomerAccount({ ...base, ...input }), (error) => error.code === code && error.status === 400);
  }

  const linked = await manageCustomerAccess({ ...base, action: 'link', userId: made.uid, targets: [{ kind: 'event', id: eventId }] });
  assert.equal(linked.results[0].status, 'linked');
  await db.doc(`weddings/${eventId}/dashboardUsers/${plain.uid}`).set({ userId: plain.uid, seatingOnly: true, allowedSide: 'bride', canEditSeating: true, plannerSecret: 'never sent to the page' });
  await db.doc('customerGrants/pending-1').set({ email: 'pending@example.test', weddingId: eventId, role: 'customer' });
  const access = await listEventAccess({ ...base, eventId });
  assert.equal(access.ownerUserId, admin.uid);
  assert.deepEqual(access.members.map((row) => row.id).sort(), [admin.uid, made.uid, plain.uid].sort());
  const customer = access.members.find((row) => row.id === made.uid);
  assert.deepEqual(customer, { id: made.uid, email: email.toLowerCase(), role: 'customer', seatingOnly: false, canCheckIn: false, canViewDashboard: true, allowedSide: 'all' });
  assert.deepEqual(Object.keys(access.members.find((row) => row.id === plain.uid)).sort(), ['allowedSide', 'canCheckIn', 'canViewDashboard', 'email', 'id', 'role', 'seatingOnly'], 'only the fields the page needs are returned');
  assert.deepEqual(access.invited, [{ id: 'pending-1', email: 'pending@example.test' }]);

  await assert.rejects(cancelEventInvite({ ...base, eventId: 'another-event', grantId: 'pending-1' }), (error) => error.code === 'INVALID_INVITE', 'an invitation is only cancelled for its own event');
  assert.equal((await db.doc('customerGrants/pending-1').get()).exists, true);
  await cancelEventInvite({ ...base, eventId, grantId: 'pending-1' });
  assert.equal((await db.doc('customerGrants/pending-1').get()).exists, false);

  const unlinked = await manageCustomerAccess({ ...base, action: 'unlink', userId: made.uid, targets: [{ kind: 'event', id: eventId }] });
  assert.equal(unlinked.results[0].status, 'unlinked');
  const staff = await manageCustomerAccess({ ...base, action: 'unlink', userId: plain.uid, targets: [{ kind: 'event', id: eventId }] });
  assert.equal(staff.results[0].code, 'PRESERVED_ROLE', 'staff are never removed through the Access section');
  assert.deepEqual((await listEventAccess({ ...base, eventId })).members.map((row) => row.id).sort(), [admin.uid, plain.uid].sort());
  await assert.rejects(listEventAccess({ ...base, eventId: 'missing-event' }), (error) => error.code === 'EVENT_NOT_FOUND');
  await assert.rejects(listEventAccess({ ...base, eventId: 'a/b' }), (error) => error.code === 'INVALID_EVENT');
});

test('search finds customers by the start of their email, a few at a time', options, async () => {
  const base = { auth, db, token: adminToken };
  const tag = unique('zz-search').toLowerCase();
  await Promise.all(Array.from({ length: 11 }, (_, index) => db.doc(`customerDirectory/${tag}-${index}`).set({ userId: `${tag}-${index}`, email: `${tag}-${String(index).padStart(2, '0')}@example.test` })));
  const first = await searchCustomers({ ...base, term: `  ${tag.toUpperCase()} ` });
  assert.equal(first.results.length, 8);
  assert.equal(first.more, true);
  assert.equal(first.results[0].email, `${tag}-00@example.test`);
  assert.deepEqual(Object.keys(first.results[0]).sort(), ['email', 'uid']);
  const narrow = await searchCustomers({ ...base, term: `${tag}-1` });
  assert.deepEqual(narrow.results.map((row) => row.email), [`${tag}-10@example.test`]);
  assert.equal(narrow.more, false);
  assert.deepEqual(await searchCustomers({ ...base, term: `${tag}-nobody` }), { results: [], more: false });
  assert.ok((await searchCustomers({ ...base, term: '' })).results.length > 0, 'an empty search lists the first few customers');
  await assert.rejects(searchCustomers({ ...base, term: 'x'.repeat(300) }), (error) => error.code === 'INVALID_SEARCH');
});

test('account ids become emails for a photo bucket owner list', options, async () => {
  const base = { auth, db, token: adminToken };
  const found = await resolveAccounts({ ...base, uids: [plain.uid, 'no-such-account', plain.uid] });
  assert.deepEqual(found.accounts, [{ uid: plain.uid, email: plain.email, exists: true }, { uid: 'no-such-account', email: '', exists: false }]);
  assert.deepEqual(await resolveAccounts({ ...base, uids: [] }), { accounts: [] });
  await assert.rejects(resolveAccounts({ ...base, uids: 'nope' }), (error) => error.code === 'INVALID_USER');
  await assert.rejects(resolveAccounts({ ...base, uids: Array.from({ length: 51 }, (_, index) => `u${index}`) }), (error) => error.code === 'INVALID_USER');
  await assert.rejects(resolveAccounts({ ...base, uids: ['a/b'] }), (error) => error.code === 'INVALID_USER');
});
