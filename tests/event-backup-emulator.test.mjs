import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { deleteApp as deleteAdminApp, initializeApp as initializeAdmin } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore, Timestamp } from 'firebase-admin/firestore';
import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { beginEventRestore, exportEventPage, finishEventRestore, startEventExport, writeEventRestorePage } from '../api/_lib/event-backup.js';
import { downloadEventBackup, readBackupText, restoreEventBackup } from '../event-backup.js';

// The real thing end to end: the browser module drives the server functions against the
// Firestore and Auth emulators. Run with `npm run test:event-backup`.
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST);
const options = { skip: !enabled };
const PROJECT = process.env.ADMIN_API_TEST_PROJECT || 'demo-wedding-security';
const PASSWORD = 'emulator-only-password';
let adminApp, auth, db, admin, adminToken, customer, customerToken;
const clientApps = [];
let counter = 0;
const unique = (label) => `${label}-${Date.now()}-${counter += 1}`;

async function newUser(label) {
  const email = `${unique(label)}@example.test`.toLowerCase();
  const user = await auth.createUser({ email, password: PASSWORD });
  return { uid: user.uid, email };
}
async function tokenFor(email) {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-key' }, unique('client'));
  clientApps.push(app);
  const clientAuth = getAuth(app);
  connectAuthEmulator(clientAuth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  return (await signInWithEmailAndPassword(clientAuth, email, PASSWORD)).user.getIdToken();
}

// Same dispatch as api/admin-event-backup.js, without HTTP. `tweak` shrinks pages so paging is exercised.
const posterFor = (token, tweak = {}) => async (body) => {
  const base = { auth, db, token, eventId: body.eventId };
  if (body.action === 'export-start') return JSON.parse(JSON.stringify(await startEventExport(base)));
  if (body.action === 'export-page') return JSON.parse(JSON.stringify(await exportEventPage({ ...base, path: body.path, cursor: body.cursor ?? null, ...tweak })));
  if (body.action === 'restore-begin') return beginEventRestore(base);
  if (body.action === 'restore-write') return writeEventRestorePage({ ...base, path: body.path, docs: body.docs });
  if (body.action === 'restore-finish') return finishEventRestore({ ...base, event: body.event, cards: body.cards, grants: body.grants, expected: body.expected });
  throw new Error(`unexpected ${body.action}`);
};

// Every document under the event, plus its cards and grants, as plain comparable data.
async function snapshotEvent(eventId, uids) {
  const out = {};
  const walk = async (ref) => {
    for (const collection of await ref.listCollections()) {
      for (const parent of await collection.listDocuments()) {
        const row = await parent.get();
        if (row.exists) out[parent.path] = row.data();
        await walk(parent);
      }
    }
  };
  const event = await db.doc(`weddings/${eventId}`).get();
  if (event.exists) out[event.ref.path] = event.data();
  await walk(event.ref);
  for (const uid of uids) { const card = await db.doc(`users/${uid}/weddingAccess/${eventId}`).get(); if (card.exists) out[card.ref.path] = card.data(); }
  for (const grant of (await db.collection('customerGrants').where('weddingId', '==', eventId).get()).docs) out[grant.ref.path] = grant.data();
  return out;
}

async function seedEvent(ownerUid = admin.uid) {
  const eventId = unique('event');
  const ref = db.doc(`weddings/${eventId}`);
  const stamp = Timestamp.fromMillis(1_760_000_000_123);
  const batch = db.batch();
  batch.set(ref, { eventTitle: 'Layla & Zaid', eventCategory: 'wedding_engagement', ownerUserId: ownerUid, status: 'active', seatingSchemaVersion: 2, hallObjects: [{ id: 'stage', x: 50.5, y: 10 }], createdAt: stamp, updatedAt: stamp });
  batch.set(ref.collection('dashboardUsers').doc(ownerUid), { userId: ownerUid, role: 'owner', canViewDashboard: true, createdAt: stamp });
  batch.set(ref.collection('dashboardUsers').doc(customer.uid), { userId: customer.uid, role: 'customer', email: customer.email, createdAt: stamp });
  for (let index = 0; index < 7; index += 1) {
    batch.set(ref.collection('guests').doc(`guest-${index}`), { fullName: `Guest ${index}`, phone: `+97150000000${index}`, side: 'bride', additionalGuests: index, rsvpStatus: 'pending', notes: 'x'.repeat(300), createdAt: stamp });
    batch.set(ref.collection('publicGuests').doc(`${'t'.repeat(42)}${index}`), { eventId, guest: { fullName: `Guest ${index}`, seatingAssignments: [] }, expiresAt: null, updatedAt: stamp });
  }
  batch.set(ref.collection('tables').doc('table-1'), { name: 'One', chairs: [{ id: 'c1' }, { id: 'c2' }] });
  batch.set(ref.collection('senderCapabilities').doc('cap-1'), { weddingId: eventId, status: 'active', expiresAt: null, createdAt: stamp });
  batch.set(ref.collection('senderCapabilities').doc('cap-1').collection('recipients').doc('0000'), { chunkIndex: 0, recipients: [{ name: 'Guest 0', phone: '+971500000000' }], createdAt: stamp });
  batch.set(ref.collection('genderRevealState').doc('summary'), { boyCount: 1, girlCount: 2, totalCount: 3 });
  batch.set(db.doc(`users/${ownerUid}/weddingAccess/${eventId}`), { eventTitle: 'Layla & Zaid', updatedAt: stamp });
  batch.set(db.doc(`users/${customer.uid}/weddingAccess/${eventId}`), { eventTitle: 'Layla & Zaid', updatedAt: stamp });
  batch.set(db.doc(`customerGrants/${unique('grant')}`), { email: 'pending@example.test', weddingId: eventId, role: 'customer', updatedAt: stamp });
  await batch.commit();
  return eventId;
}

before(async () => {
  if (!enabled) return;
  adminApp = initializeAdmin({ projectId: PROJECT }, 'event-backup-test');
  auth = getAdminAuth(adminApp);
  db = getAdminFirestore(adminApp);
  admin = await newUser('admin');
  await db.doc(`platformAdmins/${admin.uid}`).set({ enabled: true });
  adminToken = await tokenFor(admin.email);
  customer = await newUser('customer');
  customerToken = await tokenFor(customer.email);
});
after(async () => {
  await Promise.all(clientApps.map((app) => deleteApp(app)));
  if (adminApp) await deleteAdminApp(adminApp);
});

test('every backup step refuses anyone who is not an enabled administrator', options, async () => {
  const eventId = await seedEvent();
  const disabled = await newUser('disabled');
  await db.doc(`platformAdmins/${disabled.uid}`).set({ enabled: false });
  const disabledToken = await tokenFor(disabled.email);
  const before = await snapshotEvent(eventId, [admin.uid, customer.uid]);
  for (const [token, code] of [['', 'UNAUTHENTICATED'], ['not-a-token', 'UNAUTHENTICATED'], [customerToken, 'ADMIN_ONLY'], [disabledToken, 'ADMIN_ONLY']]) {
    const post = posterFor(token);
    for (const body of [
      { action: 'export-start', eventId }, { action: 'export-page', eventId, path: 'guests' }, { action: 'restore-begin', eventId },
      { action: 'restore-write', eventId, path: 'guests', docs: [{ id: 'x', data: {} }] }, { action: 'restore-finish', eventId, event: { ownerUserId: admin.uid }, cards: [], grants: [], expected: {} },
    ]) await assert.rejects(post(body), (error) => error.code === code, `${body.action} with ${code}`);
  }
  assert.deepEqual(await snapshotEvent(eventId, [admin.uid, customer.uid]), before, 'nothing was touched');
});

test('a backup restores the event exactly, after later changes', options, async () => {
  const eventId = await seedEvent();
  const uids = [admin.uid, customer.uid];
  const original = await snapshotEvent(eventId, uids);
  // Tiny pages: 3 records, or about one guest by size, so both paging limits are used.
  const backup = await downloadEventBackup({ post: posterFor(adminToken, { pageDocs: 3, pageBytes: 500 }), eventId });
  assert.equal(backup.counts.guests, 7);
  assert.equal(backup.counts['senderCapabilities/cap-1/recipients'], 1);
  assert.equal(backup.counts.genderRevealState, 1, 'records no browser can read are included');
  assert.equal(backup.cards.length, 2);
  assert.equal(backup.grants.length, 1);
  assert.deepEqual(await snapshotEvent(eventId, uids), original, 'downloading changes nothing');
  const file = await readBackupText(JSON.stringify(backup));

  // Life goes on after the backup: an edit, an addition, removals, a new member and a new section.
  const ref = db.doc(`weddings/${eventId}`);
  const stranger = await newUser('later-member');
  await Promise.all([
    ref.update({ eventTitle: 'Changed later', deleting: true }),
    ref.collection('guests').doc('guest-0').update({ rsvpStatus: 'confirmed' }),
    ref.collection('guests').doc('guest-late').set({ fullName: 'Added later' }),
    ref.collection('guests').doc('guest-3').delete(),
    ref.collection('tables').doc('table-1').delete(),
    ref.collection('checkinGuests').doc('guest-0').set({ checkedIn: true }),
    ref.collection('senderCapabilities').doc('cap-2').collection('recipients').doc('0000').set({ recipients: [] }),
    ref.collection('dashboardUsers').doc(stranger.uid).set({ userId: stranger.uid, role: 'customer' }),
    db.doc(`users/${stranger.uid}/weddingAccess/${eventId}`).set({ eventTitle: 'Changed later' }),
    db.doc(`customerGrants/${unique('grant-late')}`).set({ email: 'late@example.test', weddingId: eventId, role: 'customer' }),
  ]);

  const result = await restoreEventBackup({ post: posterFor(adminToken), backup: file });
  assert.equal(result.ok, true);
  assert.equal(result.ownerChanged, false);
  assert.deepEqual(await snapshotEvent(eventId, [...uids, stranger.uid]), original, 'the event, its access cards and its grants are exactly as backed up');
});

test('a deleted event comes back from its file', options, async () => {
  const eventId = await seedEvent();
  const uids = [admin.uid, customer.uid];
  const original = await snapshotEvent(eventId, uids);
  const backup = await downloadEventBackup({ post: posterFor(adminToken), eventId });
  await db.recursiveDelete(db.doc(`weddings/${eventId}`));
  await Promise.all(uids.map((uid) => db.doc(`users/${uid}/weddingAccess/${eventId}`).delete()));
  for (const grant of (await db.collection('customerGrants').where('weddingId', '==', eventId).get()).docs) await grant.ref.delete();
  assert.deepEqual(await snapshotEvent(eventId, uids), {});
  await assert.rejects(posterFor(adminToken)({ action: 'export-start', eventId }), (error) => error.code === 'EVENT_NOT_FOUND');
  await restoreEventBackup({ post: posterFor(adminToken), backup });
  assert.deepEqual(await snapshotEvent(eventId, uids), original);
});

test('writes are refused into a live event, and an incomplete restore never becomes visible', options, async () => {
  const eventId = await seedEvent();
  const post = posterFor(adminToken);
  const backup = await downloadEventBackup({ post, eventId });
  const live = await snapshotEvent(eventId, [admin.uid, customer.uid]);
  await assert.rejects(post({ action: 'restore-write', eventId, path: 'guests', docs: [{ id: 'intruder', data: { fullName: 'X' } }] }), (error) => error.code === 'RESTORE_NOT_STARTED');
  await assert.rejects(post({ action: 'restore-finish', eventId, event: backup.event, cards: [], grants: [], expected: {} }), (error) => error.code === 'RESTORE_NOT_STARTED');
  assert.deepEqual(await snapshotEvent(eventId, [admin.uid, customer.uid]), live);

  assert.deepEqual(await post({ action: 'restore-begin', eventId }), { done: true, existed: true });
  assert.deepEqual(await post({ action: 'restore-begin', eventId }), { done: true, existed: false }, 'clearing can be repeated');
  assert.deepEqual(await snapshotEvent(eventId, [admin.uid, customer.uid]), {}, 'the event and its access records are cleared');
  await post({ action: 'restore-write', eventId, path: 'guests', docs: backup.collections.guests.slice(0, 2) });
  await assert.rejects(post({ action: 'restore-finish', eventId, event: backup.event, cards: backup.cards, grants: backup.grants, expected: backup.counts }), (error) => error.code === 'RESTORE_INCOMPLETE' && error.extra.mismatched.some((row) => row.path === 'guests' && row.expected === 7 && row.found === 2));
  assert.equal((await db.doc(`weddings/${eventId}`).get()).exists, false, 'the event stays hidden until everything is back');

  for (const body of [
    { action: 'restore-write', eventId, path: '../clients', docs: [{ id: 'a', data: {} }] },
    { action: 'restore-write', eventId, path: 'guests', docs: [{ id: 'a/b', data: {} }] },
    { action: 'restore-write', eventId, path: 'guests', docs: [{ id: 'a', data: { when: { __t: 'bogus' } } }] },
    { action: 'restore-write', eventId, path: 'guests', docs: [] },
    { action: 'restore-finish', eventId, event: backup.event, cards: [], grants: [{ id: 'g', data: { weddingId: 'another-event' } }], expected: {} },
    { action: 'restore-finish', eventId, event: { eventTitle: 'No owner' }, cards: [], grants: [], expected: {} },
    { action: 'export-page', eventId, path: 'guests/x' },
    { action: 'export-start', eventId: 'a/b' },
  ]) await assert.rejects(post(body), (error) => error.status === 400, JSON.stringify(body).slice(0, 80));

  await restoreEventBackup({ post, backup });
  assert.deepEqual(await snapshotEvent(eventId, [admin.uid, customer.uid]), live, 'running the whole restore again recovers it');
});

test('an event whose owner is no longer an administrator goes to the restoring admin', options, async () => {
  const retired = await newUser('retired');
  await db.doc(`platformAdmins/${retired.uid}`).set({ enabled: true });
  const eventId = await seedEvent(retired.uid);
  const backup = await downloadEventBackup({ post: posterFor(adminToken), eventId });
  await db.doc(`platformAdmins/${retired.uid}`).set({ enabled: false });
  const result = await restoreEventBackup({ post: posterFor(adminToken), backup });
  assert.equal(result.ownerChanged, true);
  const event = (await db.doc(`weddings/${eventId}`).get()).data();
  assert.equal(event.ownerUserId, admin.uid);
  assert.equal(event.eventTitle, 'Layla & Zaid');
  assert.equal((await db.doc(`weddings/${eventId}/dashboardUsers/${admin.uid}`).get()).data().role, 'owner');
  assert.equal((await db.doc(`users/${admin.uid}/weddingAccess/${eventId}`).get()).exists, true);
});

test('an event that is being deleted cannot be backed up', options, async () => {
  const eventId = await seedEvent();
  await db.doc(`weddings/${eventId}`).update({ deleting: true });
  await assert.rejects(posterFor(adminToken)({ action: 'export-start', eventId }), (error) => error.code === 'EVENT_DELETING');
});
