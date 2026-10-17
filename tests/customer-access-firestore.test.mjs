import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as api from "firebase/firestore";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { assignCustomer, removeCustomer, customerMembership, issueCustomerGrant, redeemCustomerGrants } from "../account-access.js";
import { syncCustomerEventProjections } from "../customer-projections.js";
import { createInvitationTokenService } from "../invitations/shared/invitation-token-service.js";
import { mutateSeating } from "../seating-firestore.js";

test("customer lifecycle, canonical operations, isolation, pending grants and revocation", { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const env = await initializeTestEnvironment({ projectId: "demo-customer-access", firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") } });
  await env.clearFirestore();
  const event = { ownerUserId: "admin", eventTitle: "Synthetic event A", eventCategory: "wedding_engagement", eventDateISO: "2027-05-20T18:00:00.000Z", venueEn: "Test Hall", status: "active", seatingEnabled: true, seatingSchemaVersion: 2, hallObjects: [] };
  const guest = { fullName: "Synthetic Guest", phone: "971500000000", side: "bride", additionalGuests: 1, additionalGuestAllowance: 1, rsvpStatus: "pending", rsvpMessage: "", seatingAssignments: [], tableId: "", tableName: "", seatNumber: "", checkedIn: false, checkedInAt: null, notes: "private", inviteSentAt: null, reminderSentAt: null };
  const dbFor = (uid, claims = {}) => env.authenticatedContext(uid, { email: `${uid}@example.test`, ...claims }).firestore();
  try {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await api.setDoc(api.doc(db, "platformAdmins/admin"), { enabled: true });
      for (const id of ["a", "b"]) {
        await api.setDoc(api.doc(db, `weddings/${id}`), { ...event, eventTitle: `Synthetic event ${id}` });
        await api.setDoc(api.doc(db, `weddings/${id}/dashboardUsers/admin`), { ...customerMembership("admin", "admin@example.test", new Date()), role: "admin", canManageUsers: true });
        await api.setDoc(api.doc(db, `weddings/${id}/publicSummary/summary`), { ...event, eventId: id });
      }
    });
    const admin = dbFor("admin");
    for (const [uid, events] of [["customer-a", ["a"]], ["customer-b", ["b"]], ["customer-c", ["a"]], ["multi", ["a", "b"]]]) {
      for (const id of events) await assertSucceeds(assignCustomer(api, admin, id, { ...event, eventTitle: `Synthetic event ${id}` }, { userId: uid, email: `${uid}@example.test` }));
    }
    const a = dbFor("customer-a"), b = dbFor("customer-b"), c = dbFor("customer-c"), multi = dbFor("multi"), empty = dbFor("empty");
    for (const [db, ids] of [[a, ["a"]], [b, ["b"]], [c, ["a"]], [multi, ["a", "b"]], [empty, []]]) {
      const uid = db === a ? "customer-a" : db === b ? "customer-b" : db === c ? "customer-c" : db === multi ? "multi" : "empty";
      assert.deepEqual((await api.getDocs(api.collection(db, "users", uid, "weddingAccess"))).docs.map((row) => row.id).sort(), ids);
      for (const id of ids) await assertSucceeds(api.getDoc(api.doc(db, `weddings/${id}`)));
    }
    await assertFails(api.getDoc(api.doc(a, "weddings/b")));
    await assertFails(api.getDocs(api.collection(a, "weddings/b/guests")));
    await assertFails(api.setDoc(api.doc(a, "users/customer-a/weddingAccess/b"), { weddingId: "b" }));
    await assertFails(api.setDoc(api.doc(a, "platformAdmins/customer-a"), { enabled: true }));
    await assertFails(api.setDoc(api.doc(a, "weddings/rogue"), { ...event, ownerUserId: "customer-a" }));
    await assertFails(api.getDocs(api.collection(a, "customerDirectory")));
    await assertFails(api.setDoc(api.doc(a, "weddings/b/dashboardUsers/customer-a"), customerMembership("customer-a", "customer-a@example.test", api.serverTimestamp())));
    for (const patch of [{ seatingEnabled: false }, { showInvitationQr: false }, { ownerUserId: "customer-a" }, { eventCategory: "celebration" }, { status: "completed" }, { deleting: true }, { schedule: [] }, { venueMapEmbedUrl: "https://www.google.com/maps/embed?pb=forged" }]) {
      await assertFails(api.updateDoc(api.doc(a, "weddings/a"), { ...patch, updatedAt: api.serverTimestamp() }));
    }
    await assertFails(api.deleteDoc(api.doc(a, "weddings/a")));
    await assertSucceeds(api.updateDoc(api.doc(a, "weddings/a"), { eventTitle: "Updated synthetic event", brideName: "A", groomName: "B", coupleName: "A & B", eventDateISO: "2027-06-21T19:30:00.000Z", timeEn: "7:30 PM", timeAr: "19:30", venueEn: "New Hall", location: "Test City", locationEn: "Test City", mapsUrl: "https://maps.example.test/hall", whatsAppCountryCode: "971", invitationLanguage: "ar", updatedAt: api.serverTimestamp() }));
    const currentEvent = (await api.getDoc(api.doc(a, "weddings/a"))).data();
    await api.updateDoc(api.doc(a, "weddings/a"), { hallObjects: [{ id: "stage", type: "stage", label: "Synthetic Stage", x: 50, y: 10, notes: "PRIVATE ORGANIZER NOTE" }], updatedAt: api.serverTimestamp() });
    await assertSucceeds(api.setDoc(api.doc(a, "weddings/a/guests/g1"), { ...guest, createdAt: api.serverTimestamp(), updatedAt: api.serverTimestamp() }));
    console.info("sync customer projections");
    await assertSucceeds(syncCustomerEventProjections(api, a, "a"));
    const venueProjection = await api.getDoc(api.doc(env.unauthenticatedContext().firestore(), "weddings/a/publicVenue/stage"));
    assert.equal(venueProjection.data().label, "Synthetic Stage");
    assert.equal(JSON.stringify(venueProjection.data()).includes("PRIVATE ORGANIZER NOTE"), false);
    await assertFails(api.setDoc(api.doc(a, "weddings/a/seatingGuests/g1"), { fullName: "Forged", side: "bride", additionalGuests: 1, rsvpStatus: "pending" }));
    await assertFails(api.getDoc(api.doc(a, "weddings/a/checkinGuests/g1")));
    const service = createInvitationTokenService({ db: a, firestore: api });
    const scope = { uid: "customer-a", weddingId: "a", guestId: "g1", wedding: currentEvent, tables: [], customer: true };
    const beforeRefresh = (await api.getDoc(api.doc(a, "weddings/a/guests/g1"))).data().updatedAt;
    await syncCustomerEventProjections(api, a, "a");
    assert.deepEqual((await api.getDoc(api.doc(a, "weddings/a/guests/g1"))).data().updatedAt, beforeRefresh);
    await assertFails(api.updateDoc(api.doc(a, "weddings/a/guests/g1"), { checkedIn: true, checkedInAt: api.serverTimestamp(), updatedAt: api.serverTimestamp() }));
    console.info("stable invitation token");
    const token = await assertSucceeds(service.ensure(scope));
    assert.equal(await service.ensure(scope), token);
    const publicDb = env.unauthenticatedContext().firestore();
    const inviteRef = api.doc(publicDb, `weddings/a/publicGuests/${token}`);
    const invite = (await assertSucceeds(api.getDoc(inviteRef))).data();
    assert.equal(invite.guest.fullName, guest.fullName);
    assert.equal(JSON.stringify(invite).includes(guest.phone), false);
    await assertFails(api.updateDoc(api.doc(a, `weddings/a/publicGuests/${token}`), { "wedding.eventTitle": "Forged", updatedAt: api.serverTimestamp() }));
    const rsvp = api.writeBatch(publicDb);
    const patch = { rsvpStatus: "confirmed", additionalGuests: 1, rsvpMessage: "See you", updatedAt: api.serverTimestamp() };
    rsvp.update(inviteRef, patch); rsvp.update(api.doc(publicDb, "weddings/a/guests/g1"), patch);
    await assertSucceeds(rsvp.commit());
    await api.updateDoc(api.doc(a, "weddings/a/guests/g1"), { fullName: "Edited synthetic guest", updatedAt: api.serverTimestamp() });
    const table = { name: "Test table", shape: "round", x: 20, y: 20, width: 180, height: 180, rotation: 0, seatCount: 3, capacity: 3, tableColor: "#ffffff", borderColor: "#aaaaaa", chairColor: "#123456", chairs: [{ id: "c1", seatNumber: 1, x: 10, y: 10 }, { id: "c2", seatNumber: 2, x: 20, y: 20 }, { id: "c3", seatNumber: 3, x: 30, y: 30 }] };
    await api.setDoc(api.doc(a, "weddings/a/tables/t1"), table);
    for (const chairId of ["c1", "c2", "c3"]) await api.setDoc(api.doc(a, `weddings/a/seatOccupancy/t1~${chairId}`), { weddingId: "a", tableId: "t1", chairId, occupied: false, updatedAt: api.serverTimestamp() });
    console.info("sync customer projections");
    await assertSucceeds(syncCustomerEventProjections(api, a, "a"));
    await assertFails(api.setDoc(api.doc(a, "weddings/a/publicLayouts/t1"), { ...table, phone: "private", updatedAt: api.serverTimestamp() }));
    const permission = customerMembership("customer-a", "customer-a@example.test", new Date());
    const seat = (db, uid, type, source, destination) => mutateSeating({ api, db, uid, weddingId: "a", permission, type, source, destination });
    console.info("seating race");
    const race = await Promise.allSettled([seat(a, "customer-a", "assign", { guestId: "g1", partyMemberIndex: 0 }, { tableId: "t1", chairId: "c1" }), seat(c, "customer-c", "assign", { guestId: "g1", partyMemberIndex: 1 }, { tableId: "t1", chairId: "c1" })]);
    assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
    await seat(a, "customer-a", "move", { tableId: "t1", chairId: "c1" }, { tableId: "t1", chairId: "c2" });
    console.info("sync customer projections");
    await assertSucceeds(syncCustomerEventProjections(api, a, "a"));
    const seatedInvite = (await api.getDoc(inviteRef)).data();
    assert.equal(seatedInvite.guest.seatingAssignments[0].seatNumber, "2");
    await seat(a, "customer-a", "unassign", { tableId: "t1", chairId: "c2" });
    await api.updateDoc(api.doc(a, "weddings/a/tables/t1"), { x: 45, name: "Moved table" });
    console.info("sync customer projections");
    await assertSucceeds(syncCustomerEventProjections(api, a, "a"));
    assert.equal((await api.getDoc(api.doc(publicDb, "weddings/a/publicLayouts/t1"))).data().x, 45);
    await api.deleteDoc(api.doc(a, "weddings/a/tables/t1"));
    console.info("sync customer projections");
    await assertSucceeds(syncCustomerEventProjections(api, a, "a"));
    await assertFails(api.getDocs(api.collection(a, "weddings/a/dashboardUsers")));
    await assertFails(api.setDoc(api.doc(a, "weddings/a/senderCapabilities/forged"), { createdBy: "customer-a" }));
    await assertFails(api.getDoc(api.doc(a, "weddings/a/eventMaintenance/projections")));
    // Existing email grants can only be redeemed by a matching verified account.
    console.info("pending grants");
    await issueCustomerGrant(api, admin, "a", "new@example.test");
    await assertFails(redeemCustomerGrants(api, dbFor("attacker", { email: "other@example.test", email_verified: true }), { uid: "attacker", email: "new@example.test", emailVerified: true }));
    assert.equal(await redeemCustomerGrants(api, dbFor("new", { email: "new@example.test" }), { uid: "new", email: "new@example.test", emailVerified: false }), 0);
    await assertSucceeds(redeemCustomerGrants(api, dbFor("new", { email: "new@example.test", email_verified: true }), { uid: "new", email: "new@example.test", emailVerified: true }));
    await assertSucceeds(api.getDoc(api.doc(dbFor("new"), "weddings/a")));
    console.info("revocation");
    await removeCustomer(api, admin, "a", "customer-a");
    await assertFails(api.getDoc(api.doc(a, "weddings/a")));
    await assertFails(api.updateDoc(api.doc(a, "weddings/a/guests/g1"), { fullName: "After revocation" }));
    assert.equal((await api.getDocs(api.collection(a, "users/customer-a/weddingAccess"))).size, 0);
    await assertSucceeds(api.getDoc(api.doc(c, "weddings/a")));
    await assertSucceeds(api.getDoc(api.doc(multi, "weddings/b")));
    await assertSucceeds(service.revoke({ ...scope, uid: "customer-c" }).catch(async () => createInvitationTokenService({ db: c, firestore: api }).revoke({ ...scope, uid: "customer-c" })));
    const deletion = api.writeBatch(c);
    deletion.delete(api.doc(c, "weddings/a/guests/g1")); deletion.delete(api.doc(c, "weddings/a/seatingGuests/g1")); deletion.delete(api.doc(c, "weddings/a/checkinGuests/g1"));
    await assertSucceeds(deletion.commit());
  } finally { await env.cleanup(); }
});
