import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import * as api from 'firebase/firestore';
import { commitGuestEdit, commitGuestCheckin, commitBulkGuestRsvp, seatingGuestData, checkinGuestData } from '../guest-edit.js';
import { createDashboardPersistence } from '../dashboard-persistence.js';
import { assignCustomer, issueCustomerGrant, redeemCustomerGrants, removeEventCustomerGrants } from '../account-access.js';

test('guest mirrors stay atomic and event deletion closes and removes pending grants', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const env = await initializeTestEnvironment({ projectId: 'demo-consistency-regressions', firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') } });
  try {
    await env.clearFirestore();
    const event = { ownerUserId: 'owner', eventTitle: 'Regression event', eventCategory: 'wedding_engagement', status: 'active', seatingEnabled: true, seatingSchemaVersion: 2, hallObjects: [], schedule: [] };
    const guest = { fullName: 'Regression Guest', phone: '971500000000', side: 'bride', additionalGuests: 0, additionalGuestAllowance: 0, rsvpStatus: 'pending', rsvpMessage: '', checkedIn: false, checkedInAt: null, tableId: '', tableName: '', seatNumber: '', seatingAssignments: [] };
    await env.withSecurityRulesDisabled(async c => {
      const db = c.firestore();
      await api.setDoc(api.doc(db, 'platformAdmins/admin'), { enabled: true });
      await api.setDoc(api.doc(db, 'weddings/a'), event);
      await api.setDoc(api.doc(db, 'weddings/b'), event);
      await api.setDoc(api.doc(db, 'weddings/a/dashboardUsers/staff'), { userId: 'staff', canCheckIn: true, allowedSide: 'all', canViewDashboard: false });
      for (const id of ['g', 'h']) {
        await api.setDoc(api.doc(db, `weddings/a/guests/${id}`), guest);
        await api.setDoc(api.doc(db, `weddings/a/seatingGuests/${id}`), seatingGuestData(guest));
        await api.setDoc(api.doc(db, `weddings/a/checkinGuests/${id}`), checkinGuestData(id, guest));
      }
    });
    const admin = env.authenticatedContext('admin').firestore();
    const owner = env.authenticatedContext('owner').firestore();
    const staff = env.authenticatedContext('staff').firestore();
    const get = async (kind, id = 'g') => (await api.getDoc(api.doc(admin, `weddings/a/${kind}/${id}`))).data();
    const persistence = createDashboardPersistence({ api, db: admin, weddingId: 'a' });
    const edit = patch => commitGuestEdit({ api: { ...api, runTransaction: persistence.runTransaction }, db: admin, weddingId: 'a', guestId: 'g', patch });
    for (const checkedIn of [true, false]) {
      await edit({ checkedIn, checkedInAt: checkedIn ? api.serverTimestamp() : null });
      assert.equal((await get('guests')).checkedIn, checkedIn);
      assert.equal((await get('checkinGuests')).checkedIn, checkedIn);
      assert.deepEqual((await get('guests')).checkedInAt, (await get('checkinGuests')).checkedInAt);
    }
    await assertFails(api.getDoc(api.doc(staff, 'weddings/a/guests/g')));
    await commitGuestCheckin({ api, db: staff, weddingId: 'a', guestId: 'g', checkedIn: true, checkedInAt: api.serverTimestamp() });
    assert.equal((await get('guests')).checkedIn, true);
    assert.equal((await get('checkinGuests')).checkedIn, true);
    await api.deleteDoc(api.doc(admin, 'weddings/a/checkinGuests/h'));
    await assert.rejects(commitGuestCheckin({ api, db: staff, weddingId: 'a', guestId: 'h', checkedIn: true, checkedInAt: api.serverTimestamp() }));
    assert.equal((await get('guests', 'h')).checkedIn, false, 'failed mirror write rolls back canonical check-in');
    await api.setDoc(api.doc(admin, 'weddings/a/checkinGuests/h'), checkinGuestData('h', guest));
    await assignCustomer(api, admin, 'a', event, { userId: 'customer', email: 'customer@example.test' });
    const customer = env.authenticatedContext('customer', { email: 'customer@example.test' }).firestore();
    const cp = createDashboardPersistence({ api, db: customer, weddingId: 'a' });
    await commitBulkGuestRsvp({ api: { ...api, runTransaction: cp.runTransaction }, db: customer, weddingId: 'a', guestIds: ['g', 'h'], status: 'confirmed' });
    for (const id of ['g', 'h']) for (const kind of ['guests', 'seatingGuests', 'checkinGuests']) assert.equal((await get(kind, id)).rsvpStatus, 'confirmed');
    await assertFails(commitGuestCheckin({ api, db: customer, weddingId: 'a', guestId: 'h', checkedIn: true, checkedInAt: api.serverTimestamp() }));
    const user = { uid: 'invitee', email: 'invitee@example.test', emailVerified: true };
    const invited = env.authenticatedContext(user.uid, { email: user.email, email_verified: true }).firestore();
    await issueCustomerGrant(api, admin, 'b', user.email);
    assert.equal(await redeemCustomerGrants(api, invited, user), 1, 'active grants still work');
    await issueCustomerGrant(api, admin, 'a', user.email);
    await api.updateDoc(api.doc(owner, 'weddings/a'), { deleting: true, updatedAt: api.serverTimestamp() });
    await assertFails(redeemCustomerGrants(api, invited, user));
    await api.deleteDoc(api.doc(owner, 'weddings/a'));
    await assertFails(redeemCustomerGrants(api, invited, user));
    assert.equal((await api.getDoc(api.doc(admin, 'weddings/a/dashboardUsers/invitee'))).exists(), false);
    // Resume cleanup after an interrupted deletion; an ordinary owner can remove only their deleting event's grants.
    await env.withSecurityRulesDisabled(async c => {
      await api.setDoc(api.doc(c.firestore(), 'weddings/a'), { ...event, deleting: true });
      const batch = api.writeBatch(c.firestore());
      for (let i = 0; i < 401; i++) batch.set(api.doc(c.firestore(), `customerGrants/cleanup-${i}`), { weddingId: 'a', email: `fixture-${i}@example.test`, role: 'customer' });
      await batch.commit();
    });
    await issueCustomerGrant(api, admin, 'b', 'keep@example.test');
    await assertFails(removeEventCustomerGrants(api, customer, 'a'));
    await removeEventCustomerGrants(api, owner, 'a');
    await removeEventCustomerGrants(api, owner, 'a');
    const grants = await api.getDocs(api.collection(admin, 'customerGrants'));
    assert.equal(grants.size, 1);
    assert.equal(grants.docs[0].data().weddingId, 'b');
  } finally { await env.cleanup(); }
});
