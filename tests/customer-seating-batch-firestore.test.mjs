import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as api from "firebase/firestore";
import { initializeTestEnvironment, assertSucceeds } from "@firebase/rules-unit-testing";
import { customerMembership } from "../account-access.js";
import { persistCanonicalSeatDiff } from "../seating-transactions.js";
import { syncCustomerEventProjections } from "../customer-projections.js";
import { createInvitationTokenService } from "../invitations/shared/invitation-token-service.js";

test("the dashboard seating transaction changes only affected chairs, including a full party", { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const env = await initializeTestEnvironment({ projectId: "demo-customer-seating-batch", firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") } });
  await env.clearFirestore();
  const chairs = Array.from({ length: 12 }, (_, i) => ({ id: `c${i + 1}`, seatNumber: i + 1, x: 20, y: 20 }));
  const layout = { id: "t", name: "Synthetic table", capacity: 12, seatCount: 12, chairs, shape: "round", x: 20, y: 20, width: 180, height: 180, rotation: 0, tableColor: "#ffffff", borderColor: "#aaaaaa", chairColor: "#112233" };
  try {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await api.setDoc(api.doc(db, "weddings/a"), { ownerUserId: "admin", eventTitle: "Synthetic party event", eventDateISO: "2027-06-21T19:30:00.000Z", venueEn: "Test Hall", eventCategory: "wedding_engagement", seatingSchemaVersion: 2, seatingEnabled: true });
      await api.setDoc(api.doc(db, "weddings/a/dashboardUsers/customer"), customerMembership("customer", "customer@example.test", new Date()));
      await api.setDoc(api.doc(db, "weddings/a/tables/t"), layout);
      await api.setDoc(api.doc(db, "weddings/a/seatingGuests/g"), { fullName: "Synthetic party", side: "family", additionalGuests: 10, rsvpStatus: "confirmed" });
      await api.setDoc(api.doc(db, "weddings/a/guests/g"), { fullName: "Synthetic party", phone: "", side: "family", additionalGuests: 10, additionalGuestAllowance: 10, rsvpStatus: "confirmed", rsvpMessage: "", tableId: "", tableName: "", seatNumber: "", seatingAssignments: [], checkedIn: false, checkedInAt: null, notes: "private", inviteSentAt: null, reminderSentAt: null });
      for (const chair of chairs) await api.setDoc(api.doc(db, `weddings/a/seatOccupancy/t~${chair.id}`), { weddingId: "a", tableId: "t", chairId: chair.id, occupied: false, updatedAt: new Date() });
    });
    const db = env.authenticatedContext("customer").firestore();
    const assignment = (index) => ({ guestId: "g", partyMemberIndex: index, personKey: index ? `guest-${index}` : "main", side: "family" });
    const first = { ...layout, chairs: chairs.map((chair, i) => i < 2 ? { ...chair, assignment: assignment(i) } : chair) };
    await assertSucceeds(api.runTransaction(db, (transaction) => persistCanonicalSeatDiff({ api, db, weddingId: "a", transaction, beforeTables: [layout], afterTables: [first] })));
    assert.equal((await api.getDocs(api.collection(db, "weddings/a/seatAssignments"))).size, 2);
    const swapped = { ...layout, chairs: chairs.map((chair, i) => i < 2 ? { ...chair, assignment: assignment(1 - i) } : chair) };
    await assertSucceeds(api.runTransaction(db, (transaction) => persistCanonicalSeatDiff({ api, db, weddingId: "a", transaction, beforeTables: [first], afterTables: [swapped] })));
    const moved = { ...layout, chairs: chairs.map((chair, i) => i >= 2 && i < 4 ? { ...chair, assignment: assignment(i - 2) } : chair) };
    await assertSucceeds(api.runTransaction(db, (transaction) => persistCanonicalSeatDiff({ api, db, weddingId: "a", transaction, beforeTables: [swapped], afterTables: [moved] })));
    assert.equal((await api.getDoc(api.doc(db, "weddings/a/seatAssignments/t~c3"))).data().personKey, "main");
    const full = { ...layout, chairs: chairs.map((chair, i) => i < 11 ? { ...chair, assignment: assignment(i) } : chair) };
    await assertSucceeds(api.runTransaction(db, (transaction) => persistCanonicalSeatDiff({ api, db, weddingId: "a", transaction, beforeTables: [moved], afterTables: [full] })));
    assert.equal((await api.getDocs(api.collection(db, "weddings/a/seatAssignments"))).size, 11);
    await assertSucceeds(syncCustomerEventProjections(api, db, "a"));
    const wedding = (await api.getDoc(api.doc(db, "weddings/a"))).data();
    const service = createInvitationTokenService({ db, firestore: api });
    const scope = { uid: "customer", weddingId: "a", guestId: "g", wedding, tables: [layout], customer: true };
    const token = await assertSucceeds(service.ensure(scope));
    assert.equal(await service.ensure(scope), token);
    const publicInvite = await api.getDoc(api.doc(env.unauthenticatedContext().firestore(), `weddings/a/publicGuests/${token}`));
    assert.equal(publicInvite.data().guest.seatingAssignments.length, 11);
    await assertSucceeds(api.runTransaction(db, (transaction) => persistCanonicalSeatDiff({ api, db, weddingId: "a", transaction, beforeTables: [full], afterTables: [layout] })));
    assert.equal((await api.getDocs(api.collection(db, "weddings/a/seatAssignments"))).size, 0);
  } finally { await env.cleanup(); }
});
