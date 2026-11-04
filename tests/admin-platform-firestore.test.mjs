import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as api from "firebase/firestore";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { assignCustomer, customerMembership, issueCustomerGrant, removeCustomer } from "../account-access.js";
import { recordCustomerAudit } from "../customer-audit.js";
import { createInvitationTokenService } from "../invitations/shared/invitation-token-service.js";
import { persistCanonicalSeatDiff } from "../seating-transactions.js";
import { syncCustomerEventProjections } from "../customer-projections.js";
import { publicEventData } from "../event-publishing.js";

const skip = !process.env.FIRESTORE_EMULATOR_HOST;
const HOUR = 3_600_000;
const TOKEN = "T".repeat(43);
const event = { ownerUserId: "third-admin", eventTitle: "Synthetic event", eventCategory: "wedding_engagement", eventDateISO: "2027-05-20T18:00:00.000Z", venueEn: "Test Hall", status: "active", seatingEnabled: true, seatingSchemaVersion: 2, hallObjects: [] };
const guest = { fullName: "Synthetic Guest", phone: "971500000000", side: "bride", additionalGuests: 0, additionalGuestAllowance: 0, rsvpStatus: "pending", rsvpMessage: "", seatingAssignments: [], tableId: "", tableName: "", seatNumber: "", checkedIn: false, checkedInAt: null, notes: "", inviteSentAt: null, reminderSentAt: null };
const chairs = [1, 2].map((seatNumber) => ({ id: `c${seatNumber}`, seatNumber, x: 10, y: 10 }));
const table = { id: "t", name: "Synthetic table", capacity: 2, seatCount: 2, chairs, shape: "round", x: 20, y: 20, width: 180, height: 180, rotation: 0, tableColor: "#ffffff", borderColor: "#aaaaaa", chairColor: "#112233" };
const seatingMember = { userId: "seat-member", email: "seat-member@example.test", role: "seating", canViewDashboard: true, canEditGuests: false, canEditSeating: true, canCheckIn: false, canManageUsers: false, seatingOnly: true, allowedSide: "bride" };

async function environment(projectId) {
  const env = await initializeTestEnvironment({ projectId, firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") } });
  await env.clearFirestore();
  return env;
}
const dbFor = (env, uid, claims = {}) => env.authenticatedContext(uid, { email: `${uid}@example.test`, ...claims }).firestore();
const seed = (env, callback) => env.withSecurityRulesDisabled((context) => callback(context.firestore()));
const put = (db, path, data) => api.setDoc(api.doc(db, path), data);
const now = () => api.serverTimestamp();

test("two platform admins hold every right on an event owned by a third, without any membership", { skip }, async () => {
  const env = await environment("demo-admin-parity");
  try {
    await seed(env, async (db) => {
      for (const uid of ["third-admin", "admin-one", "admin-two"]) await put(db, `platformAdmins/${uid}`, { enabled: true });
      await put(db, "platformAdmins/disabled-admin", { enabled: false });
      await put(db, "weddings/e", event);
      await put(db, "weddings/e/dashboardUsers/third-admin", { userId: "third-admin", email: "third-admin@example.test", role: "owner", canViewDashboard: true, canEditGuests: true, canEditSeating: true, canCheckIn: true, canManageUsers: true });
      await put(db, "weddings/e/seatingAccess/bride", { allowed: true });
      await put(db, "users/customer-x/weddingAccess/e", { weddingId: "e" });
      await put(db, "weddings/e/genderRevealResponses/r", { fullName: "x" });
      await put(db, "weddings/e/customerAudit/existing", { actorUid: "x" });
    });
    for (const [uid, other] of [["admin-one", "admin-two"], ["admin-two", "admin-one"]]) {
      const db = dbFor(env, uid);
      const wedding = (await assertSucceeds(api.getDoc(api.doc(db, "weddings/e")))).data();
      await assertSucceeds(api.getDocs(api.collection(db, "weddings")));
      await assertSucceeds(api.getDocs(api.query(api.collection(db, "weddings"), api.where("status", "==", "active"))));

      // Event document write paths: details, QR, seating switch, hall, lifecycle, schema.
      await assertSucceeds(api.updateDoc(api.doc(db, "weddings/e"), { eventTitle: `Edited by ${uid}`, updatedAt: now() }));
      await assertSucceeds(api.updateDoc(api.doc(db, "weddings/e"), { showInvitationQr: false, updatedAt: now() }));
      await assertSucceeds(api.updateDoc(api.doc(db, "weddings/e"), { seatingEnabled: true, updatedAt: now() }));
      await assertSucceeds(api.updateDoc(api.doc(db, "weddings/e"), { hallObjects: [], updatedAt: now() }));
      await assertSucceeds(api.updateDoc(api.doc(db, "weddings/e"), { status: "upcoming", updatedAt: now() }));
      await assertSucceeds(api.updateDoc(api.doc(db, "weddings/e"), { status: "active", updatedAt: now() }));
      await assertSucceeds(api.updateDoc(api.doc(db, "weddings/e"), { seatingSchemaVersion: 2, updatedAt: now() }));

      // Accounts and discovery.
      await assertSucceeds(api.getDocs(api.collection(db, "weddings/e/dashboardUsers")));
      await assertSucceeds(api.getDoc(api.doc(db, `weddings/e/dashboardUsers/${other}`)));
      await assertSucceeds(api.getDocs(api.collection(db, "weddings/e/seatingAccess")));
      await assertSucceeds(assignCustomer(api, db, "e", wedding, { userId: `customer-${uid}`, email: `customer-${uid}@example.test` }));
      await assertSucceeds(removeCustomer(api, db, "e", `customer-${uid}`));
      await assertSucceeds(issueCustomerGrant(api, db, "e", `grant-${uid}@example.test`));
      await assertSucceeds(api.getDoc(api.doc(db, "users/customer-x/weddingAccess/e")));

      // Guests and their projections.
      const guestId = `guest-${uid}`;
      await assertSucceeds(api.setDoc(api.doc(db, `weddings/e/guests/${guestId}`), { ...guest, createdAt: now(), updatedAt: now() }));
      await assertSucceeds(api.getDocs(api.collection(db, "weddings/e/guests")));
      await assertSucceeds(api.updateDoc(api.doc(db, `weddings/e/guests/${guestId}`), { fullName: "Edited", updatedAt: now() }));
      await assertSucceeds(put(db, `weddings/e/seatingGuests/${guestId}`, { fullName: "Edited", side: "bride", additionalGuests: 0, rsvpStatus: "pending" }));
      await assertSucceeds(put(db, `weddings/e/checkinGuests/${guestId}`, { guestId, fullName: "Edited", phone: "", side: "bride", rsvpStatus: "pending", tableId: "", tableName: "", seatNumber: "", checkedIn: false, checkedInAt: null }));
      await assertSucceeds(api.getDocs(api.collection(db, "weddings/e/seatingGuests")));
      await assertSucceeds(api.getDocs(api.collection(db, "weddings/e/checkinGuests")));

      // Tables, occupancy and canonical seating: these were member-only before.
      const tableId = `t-${uid}`;
      const layout = { ...table, id: tableId };
      await assertSucceeds(put(db, `weddings/e/tables/${tableId}`, layout));
      await assertSucceeds(api.getDocs(api.collection(db, "weddings/e/tables")));
      await assertSucceeds(api.updateDoc(api.doc(db, `weddings/e/tables/${tableId}`), { x: 25 }));
      for (const chair of chairs) await assertSucceeds(put(db, `weddings/e/seatOccupancy/${tableId}~${chair.id}`, { weddingId: "e", tableId, chairId: chair.id, occupied: false, updatedAt: now() }));
      await assertSucceeds(api.getDocs(api.collection(db, "weddings/e/seatOccupancy")));
      const seated = { ...layout, x: 25, chairs: chairs.map((chair, index) => index === 0 ? { ...chair, assignment: { guestId, partyMemberIndex: 0, personKey: "main", side: "bride" } } : chair) };
      await assertSucceeds(api.runTransaction(db, (transaction) => persistCanonicalSeatDiff({ api, db, weddingId: "e", transaction, beforeTables: [{ ...layout, x: 25 }], afterTables: [seated] })));
      await assertSucceeds(api.getDocs(api.collection(db, "weddings/e/seatAssignments")));
      await assertSucceeds(api.getDocs(api.collection(db, "weddings/e/seatedPeople")));
      await assertSucceeds(api.runTransaction(db, (transaction) => persistCanonicalSeatDiff({ api, db, weddingId: "e", transaction, beforeTables: [seated], afterTables: [{ ...layout, x: 25 }] })));
      await assertSucceeds(api.deleteDoc(api.doc(db, `weddings/e/tables/${tableId}`)));

      // Public projections and owner-only maintenance.
      await assertSucceeds(put(db, "weddings/e/publicScene/state", { version: 1, updatedAt: now() }));
      await assertSucceeds(put(db, "weddings/e/publicStats/stats", { eventId: "e", eventCategory: "wedding_engagement", stats: {}, updatedAt: now() }));
      await assertSucceeds(api.getDoc(api.doc(db, "weddings/e/publicStats/stats")));
      await assertSucceeds(put(db, "weddings/e/publicSummary/summary", { eventId: "e", eventTitle: "x", coupleName: "", eventCategory: "wedding_engagement", seatingEnabled: true, seatingSchemaVersion: 2, stats: {}, updatedAt: now() }));
      await assertSucceeds(put(db, "weddings/e/eventMaintenance/m", { status: "running", updatedAt: now() }));
      await assertSucceeds(api.getDocs(api.collection(db, "weddings/e/eventMaintenance")));
      await assertSucceeds(put(db, "weddings/e/seatingMigrations/m", { status: "running", updatedAt: now() }));
      await assertSucceeds(api.getDocs(api.collection(db, "weddings/e/seatingMigrations")));

      // Invitations and sender capabilities.
      const service = createInvitationTokenService({ db, firestore: api });
      const token = await assertSucceeds(service.ensure({ uid, weddingId: "e", guestId, wedding, tables: [], customer: false }));
      await assertSucceeds(api.getDoc(api.doc(db, `weddings/e/invitationTokens/${token}`)));
      await assertSucceeds(api.getDocs(api.collection(db, "weddings/e/invitationTokens")));
      await assertSucceeds(api.getDoc(api.doc(db, `weddings/e/invitationSecrets/${guestId}`)));
      await assertSucceeds(api.getDocs(api.collection(db, "weddings/e/invitationSecrets")));
      await assertSucceeds(api.getDoc(api.doc(db, `weddings/e/publicGuests/${token}`)));
      const capability = { weddingId: "e", purpose: "whatsapp-sender", status: "preparing", createdBy: uid, side: "all", eventTitle: "x", eventCategory: "wedding_engagement", recipientCount: 1, chunkCount: 1, expiresAt: null, createdAt: new Date(), updatedAt: now() };
      await assertSucceeds(put(db, `weddings/e/senderCapabilities/${uid}`, capability));
      await assertSucceeds(api.getDocs(api.collection(db, "weddings/e/senderCapabilities")));
      await assertSucceeds(api.getDocs(api.collection(db, "weddings/e/genderRevealResponses")));
      await assertSucceeds(api.getDocs(api.collection(db, "weddings/e/customerAudit")));
    }

    // Neither a disabled record nor a signed-in stranger inherits any of it.
    for (const uid of ["disabled-admin", "stranger"]) {
      const db = dbFor(env, uid);
      await assertFails(api.getDoc(api.doc(db, "weddings/e")));
      await assertFails(api.getDocs(api.collection(db, "weddings/e/guests")));
      await assertFails(api.getDocs(api.collection(db, "weddings/e/tables")));
      await assertFails(put(db, "weddings/e/tables/x", table));
      await assertFails(api.updateDoc(api.doc(db, "weddings/e"), { hallObjects: [], updatedAt: now() }));
      await assertFails(api.getDocs(api.collection(db, "weddings/e/customerAudit")));
    }

    // Admin deletion path, including cleanup, on an event someone else owns.
    const admin = dbFor(env, "admin-one");
    await assertFails(api.deleteDoc(api.doc(admin, "weddings/e")));
    await assertSucceeds(api.updateDoc(api.doc(admin, "weddings/e"), { deleting: true, updatedAt: now() }));
    await assertSucceeds(api.deleteDoc(api.doc(admin, "weddings/e/customerAudit/existing")));
    await assertSucceeds(api.deleteDoc(api.doc(admin, "weddings/e/genderRevealResponses/r")));
    await assertSucceeds(api.deleteDoc(api.doc(admin, "weddings/e")));
  } finally { await env.cleanup(); }
});

test("an admin who also holds a restricted membership keeps full rights; the member alone does not", { skip }, async () => {
  const env = await environment("demo-admin-dual-role");
  try {
    await seed(env, async (db) => {
      await put(db, "platformAdmins/dual-customer", { enabled: true });
      await put(db, "platformAdmins/dual-seating", { enabled: true });
      await put(db, "weddings/e", event);
      await put(db, "weddings/e/dashboardUsers/dual-customer", customerMembership("dual-customer", "dual-customer@example.test", new Date()));
      await put(db, "weddings/e/dashboardUsers/plain-customer", customerMembership("plain-customer", "plain-customer@example.test", new Date()));
      await put(db, "weddings/e/dashboardUsers/dual-seating", { ...seatingMember, userId: "dual-seating", email: "dual-seating@example.test" });
      await put(db, "weddings/e/dashboardUsers/seat-member", seatingMember);
      await put(db, "weddings/e/guests/g", guest);
    });
    const dualCustomer = dbFor(env, "dual-customer"), dualSeating = dbFor(env, "dual-seating");
    const customer = dbFor(env, "plain-customer"), seating = dbFor(env, "seat-member");
    await assertSucceeds(api.updateDoc(api.doc(dualCustomer, "weddings/e"), { status: "upcoming", updatedAt: now() }));
    await assertSucceeds(api.updateDoc(api.doc(dualCustomer, "weddings/e"), { showInvitationQr: false, updatedAt: now() }));
    await assertSucceeds(api.getDocs(api.collection(dualSeating, "weddings/e/guests")));
    await assertSucceeds(put(dualSeating, "weddings/e/tables/x", table));
    await assertSucceeds(api.getDoc(api.doc(dualSeating, "weddings/e")));

    // Customers and seating-only members stay exactly as narrow as before.
    await assertFails(api.updateDoc(api.doc(customer, "weddings/e"), { status: "draft", updatedAt: now() }));
    await assertFails(api.updateDoc(api.doc(customer, "weddings/e"), { showInvitationQr: true, updatedAt: now() }));
    await assertFails(api.getDocs(api.collection(customer, "weddings/e/dashboardUsers")));
    await assertFails(api.getDocs(api.collection(customer, "weddings/e/checkinGuests")));
    await assertFails(api.getDocs(api.collection(customer, "weddings/e/eventMaintenance")));
    await assertFails(api.getDocs(api.collection(seating, "weddings/e/guests")));
    await assertFails(api.getDoc(api.doc(seating, "weddings/e")));
    await assertFails(put(seating, "weddings/e/tables/y", table));
    await assertSucceeds(api.getDocs(api.collection(seating, "weddings/e/tables")));
  } finally { await env.cleanup(); }
});

function auditEntry(uid, overrides = {}) {
  return { actorUid: uid, actorEmail: `${uid}@example.test`, action: "guest.update", targetType: "guest", targetId: "g1", summary: "Edited a guest", createdAt: now(), ...overrides };
}

test("the customer audit trail is append-only, customer-written and administrator-read", { skip }, async () => {
  const env = await environment("demo-customer-audit");
  try {
    await seed(env, async (db) => {
      await put(db, "platformAdmins/admin", { enabled: true });
      await put(db, "weddings/e", { ...event, ownerUserId: "admin" });
      await put(db, "weddings/other", { ...event, ownerUserId: "admin" });
      await put(db, "weddings/e/dashboardUsers/customer", customerMembership("customer", "customer@example.test", new Date()));
      await put(db, "weddings/e/dashboardUsers/admin", { userId: "admin", email: "admin@example.test", role: "owner", canViewDashboard: true, canManageUsers: true });
      await put(db, "weddings/e/dashboardUsers/seat-member", seatingMember);
      await put(db, "weddings/e/customerAudit/seeded", { actorUid: "customer" });
    });
    const customer = dbFor(env, "customer"), admin = dbFor(env, "admin"), seating = dbFor(env, "seat-member");
    const stranger = dbFor(env, "stranger"), anonymous = env.unauthenticatedContext().firestore();
    const audit = "weddings/e/customerAudit";

    // Create: exact shape, bound to the signed-in customer.
    await assertSucceeds(put(customer, `${audit}/ok`, auditEntry("customer")));
    await assertSucceeds(put(customer, `${audit}/empty-target`, auditEntry("customer", { targetId: "", summary: "" })));
    await assertSucceeds(put(customer, `${audit}/max`, auditEntry("customer", { action: "a".repeat(64), targetType: "t".repeat(40), targetId: "i".repeat(200), summary: "s".repeat(500) })));
    const arabicSummary = "أ".repeat(250) + "\n" + "ب".repeat(248) + "🎉";
    await assertSucceeds(put(customer, `${audit}/arabic-max`, auditEntry("customer", { summary: arabicSummary })));
    for (const [id, data] of Object.entries({
      longArabicSummary: auditEntry("customer", { summary: arabicSummary + "ب" }),
      forgedUid: auditEntry("customer", { actorUid: "other" }),
      forgedEmail: auditEntry("customer", { actorEmail: "other@example.test" }),
      clientTime: auditEntry("customer", { createdAt: new Date() }),
      extraKey: auditEntry("customer", { extra: "x" }),
      longAction: auditEntry("customer", { action: "a".repeat(65) }),
      longType: auditEntry("customer", { targetType: "t".repeat(41) }),
      longId: auditEntry("customer", { targetId: "i".repeat(201) }),
      longSummary: auditEntry("customer", { summary: "s".repeat(501) }),
      badAction: auditEntry("customer", { action: "Guest Update" }),
      badSummary: auditEntry("customer", { summary: 7 }),
    })) await assertFails(put(customer, `${audit}/${id}`, data));
    const missing = auditEntry("customer");
    delete missing.summary;
    await assertFails(put(customer, `${audit}/missing`, missing));
    await assertFails(put(customer, `${audit}/${"x".repeat(65)}`, auditEntry("customer")));

    // Only a customer member of this event may write.
    await assertFails(put(admin, `${audit}/admin`, auditEntry("admin")));
    await assertFails(put(seating, `${audit}/seating`, auditEntry("seat-member")));
    await assertFails(put(stranger, `${audit}/stranger`, auditEntry("stranger")));
    await assertFails(put(anonymous, `${audit}/guest`, auditEntry("guest")));
    await assertFails(put(customer, "weddings/other/customerAudit/cross", auditEntry("customer")));

    // Read: platform admins only, and customers cannot read their own entries.
    await assertSucceeds(api.getDocs(api.collection(admin, audit)));
    await assertSucceeds(api.getDoc(api.doc(admin, `${audit}/ok`)));
    for (const db of [customer, seating, stranger, anonymous]) {
      await assertFails(api.getDoc(api.doc(db, `${audit}/ok`)));
      await assertFails(api.getDocs(api.collection(db, audit)));
      await assertFails(api.getDocs(api.collectionGroup(db, "customerAudit")));
    }

    // Append-only for everyone until event deletion, administrators included.
    for (const db of [customer, admin]) {
      await assertFails(api.updateDoc(api.doc(db, `${audit}/ok`), { summary: "changed" }));
      await assertFails(api.deleteDoc(api.doc(db, `${audit}/ok`)));
      await assertFails(put(db, `${audit}/ok`, auditEntry("customer")));
    }

    // The browser helper writes through the real rules; a refused write is swallowed.
    const user = { uid: "customer", email: "Customer@Example.Test" };
    const permissions = { role: "customer" };
    assert.equal(await recordCustomerAudit({ api, db: customer, weddingId: "e", user, permissions, action: "seating.assign", targetType: "seat", targetId: "t~c1", summary: "Assigned a seat" }), true);
    assert.equal(await recordCustomerAudit({ api, db: customer, weddingId: "other", user, permissions, action: "seating.assign", targetType: "seat" }), false);
    const logged = (await api.getDocs(api.query(api.collection(admin, audit), api.where("action", "==", "seating.assign")))).docs[0].data();
    assert.equal(logged.actorEmail, "customer@example.test");

    // Deletion cleanup is the only removal path, and the deleting flag does not
    // open the trail to a customer or to a former administrator who still owns it.
    await assertSucceeds(api.updateDoc(api.doc(admin, "weddings/e"), { deleting: true, updatedAt: now() }));
    await assertFails(put(customer, `${audit}/late`, auditEntry("customer")));
    await assertFails(api.deleteDoc(api.doc(customer, `${audit}/ok`)));
    await assertFails(api.updateDoc(api.doc(admin, `${audit}/ok`), { summary: "changed" }));
    await assertSucceeds(api.getDocs(api.collection(admin, audit)));
    await assertSucceeds(api.deleteDoc(api.doc(admin, `${audit}/ok`)));
    await seed(env, (db) => api.deleteDoc(api.doc(db, "platformAdmins/admin")));
    await assertFails(api.getDocs(api.collection(admin, audit)));
    await assertFails(api.getDoc(api.doc(admin, `${audit}/max`)));
    await assertSucceeds(api.getDocs(api.collection(admin, "weddings/e/guests")));
    await assertSucceeds(api.deleteDoc(api.doc(admin, `${audit}/max`)));
  } finally { await env.cleanup(); }
});

function clientRecord(overrides = {}) {
  return { name: "Synthetic Client", phone: "+971500000000", email: "client@example.test", notes: "Prefers mornings", linkedEventIds: ["event-a", "event_B1"], priceFils: 150000, currency: "AED", createdAt: now(), updatedAt: now(), ...overrides };
}
function quoteRecord(overrides = {}) {
  return { number: "QD-2026-0001", lineItems: [{ description: "Invitation design", quantity: 2, unitPriceFils: 50000, totalFils: 100000 }], totals: { subtotalFils: 100000, discountFils: 10000, vatFils: 4500, totalFils: 94500 }, status: "draft", currency: "AED", terms: "Bucket photos are deleted after 48 hours.", createdAt: now(), updatedAt: now(), ...overrides };
}

test("clients and quotations are platform-admin only and strictly validated", { skip }, async () => {
  const env = await environment("demo-clients");
  try {
    await seed(env, async (db) => {
      await put(db, "platformAdmins/admin", { enabled: true });
      await put(db, "platformAdmins/disabled", { enabled: false });
      await put(db, "weddings/e", { ...event, ownerUserId: "admin" });
      await put(db, "weddings/e/dashboardUsers/customer", customerMembership("customer", "customer@example.test", new Date()));
      await put(db, "clients/seeded", { name: "Seeded" });
      await put(db, "clients/seeded/quotes/q", { number: "1" });
    });
    const admin = dbFor(env, "admin");
    const denied = [dbFor(env, "customer"), dbFor(env, "disabled"), dbFor(env, "stranger"), env.unauthenticatedContext().firestore()];
    for (const db of denied) {
      await assertFails(api.getDoc(api.doc(db, "clients/seeded")));
      await assertFails(api.getDocs(api.collection(db, "clients")));
      await assertFails(api.getDoc(api.doc(db, "clients/seeded/quotes/q")));
      await assertFails(api.getDocs(api.collection(db, "clients/seeded/quotes")));
      await assertFails(api.getDocs(api.collectionGroup(db, "quotes")));
      await assertFails(put(db, "clients/rogue", clientRecord()));
      await assertFails(put(db, "clients/seeded/quotes/rogue", quoteRecord()));
      await assertFails(api.deleteDoc(api.doc(db, "clients/seeded")));
      await assertFails(api.deleteDoc(api.doc(db, "clients/seeded/quotes/q")));
    }

    await assertSucceeds(put(admin, "clients/c", clientRecord()));
    await assertSucceeds(api.getDocs(api.collection(admin, "clients")));
    await assertSucceeds(put(admin, "clients/minimal", clientRecord({ phone: "", email: "", notes: "", linkedEventIds: [], priceFils: 0 })));
    await assertSucceeds(put(admin, "clients/most-links", clientRecord({ linkedEventIds: Array.from({ length: 20 }, (_, i) => `${"e".repeat(140)}${i}`) })));
    for (const [id, data] of Object.entries({
      floatPrice: clientRecord({ priceFils: 10.5 }),
      negativePrice: clientRecord({ priceFils: -1 }),
      stringPrice: clientRecord({ priceFils: "100" }),
      hugePrice: clientRecord({ priceFils: 1000000000001 }),
      usd: clientRecord({ currency: "USD" }),
      noName: clientRecord({ name: "" }),
      longName: clientRecord({ name: "n".repeat(161) }),
      longPhone: clientRecord({ phone: "1".repeat(41) }),
      longEmail: clientRecord({ email: "e".repeat(255) }),
      longNotes: clientRecord({ notes: "n".repeat(5001) }),
      tooManyLinks: clientRecord({ linkedEventIds: Array.from({ length: 21 }, (_, i) => `e${i}`) }),
      emptyLink: clientRecord({ linkedEventIds: ["a", ""] }),
      nonStringLink: clientRecord({ linkedEventIds: ["ok", 7] }),
      badLink: clientRecord({ linkedEventIds: ["../other"] }),
      linkWithComma: clientRecord({ linkedEventIds: ["a,b,"] }),
      linksNotList: clientRecord({ linkedEventIds: "event-a" }),
      extraKey: clientRecord({ isAdmin: true }),
      clientCreatedAt: clientRecord({ createdAt: new Date(0) }),
    })) await assertFails(put(admin, `clients/${id}`, data));
    const created = (await api.getDoc(api.doc(admin, "clients/c"))).data().createdAt;
    await assertSucceeds(api.updateDoc(api.doc(admin, "clients/c"), { notes: "Updated", updatedAt: now() }));
    await assertFails(api.updateDoc(api.doc(admin, "clients/c"), { createdAt: new Date(0), updatedAt: now() }));
    await assertFails(api.updateDoc(api.doc(admin, "clients/c"), { notes: "No timestamp" }));
    assert.deepEqual((await api.getDoc(api.doc(admin, "clients/c"))).data().createdAt, created);

    const quotes = "clients/c/quotes";
    await assertSucceeds(put(admin, `${quotes}/q`, quoteRecord()));
    await assertSucceeds(api.getDocs(api.collection(admin, quotes)));
    // The longest permitted quote must stay inside the rules expression budget, on update too.
    const line = { description: "d".repeat(500), quantity: 100000, unitPriceFils: 1000000, totalFils: 100000000000 };
    await assertSucceeds(put(admin, `${quotes}/full`, quoteRecord({ lineItems: Array(50).fill(line), totals: { subtotalFils: 1000000000000, discountFils: 0, vatFils: 0, totalFils: 1000000000000 }, validUntil: new Date(Date.now() + 86_400_000), notes: "n".repeat(5000), terms: "t".repeat(10000) })));
    await assertSucceeds(api.updateDoc(api.doc(admin, `${quotes}/full`), { status: "sent", updatedAt: now() }));
    const validLine = { description: "x", quantity: 1, unitPriceFils: 1, totalFils: 1 };
    for (const [id, data] of Object.entries({
      noLines: quoteRecord({ lineItems: [] }),
      manyLines: quoteRecord({ lineItems: Array(51).fill(validLine) }),
      lastLineBad: quoteRecord({ lineItems: [...Array(9).fill(validLine), { ...validLine, totalFils: 2 }] }),
      wrongLineTotal: quoteRecord({ lineItems: [{ ...validLine, totalFils: 5 }] }),
      negativeUnit: quoteRecord({ lineItems: [{ ...validLine, unitPriceFils: -1, totalFils: -1 }] }),
      zeroQuantity: quoteRecord({ lineItems: [{ ...validLine, quantity: 0, totalFils: 0 }] }),
      lineMissingKey: quoteRecord({ lineItems: [{ description: "x", quantity: 1, unitPriceFils: 1, other: 1 }] }),
      totalsRenamed: quoteRecord({ totals: { subtotalFils: 1, discountFils: 0, vatFils: 0, other: 1 } }),
      floatQuantity: quoteRecord({ lineItems: [{ ...validLine, quantity: 1.5 }] }),
      lineExtraKey: quoteRecord({ lineItems: [{ ...validLine, hidden: 1 }] }),
      lineNotMap: quoteRecord({ lineItems: ["x"] }),
      longDescription: quoteRecord({ lineItems: [{ ...validLine, description: "d".repeat(501) }] }),
      wrongTotal: quoteRecord({ totals: { subtotalFils: 100, discountFils: 0, vatFils: 0, totalFils: 99 } }),
      bigDiscount: quoteRecord({ totals: { subtotalFils: 100, discountFils: 200, vatFils: 100, totalFils: 0 } }),
      floatTotal: quoteRecord({ totals: { subtotalFils: 100.5, discountFils: 0, vatFils: 0, totalFils: 100.5 } }),
      totalsExtra: quoteRecord({ totals: { subtotalFils: 1, discountFils: 0, vatFils: 0, totalFils: 1, x: 1 } }),
      badStatus: quoteRecord({ status: "paid" }),
      usd: quoteRecord({ currency: "USD" }),
      noNumber: quoteRecord({ number: "" }),
      longNumber: quoteRecord({ number: "1".repeat(41) }),
      longTerms: quoteRecord({ terms: "t".repeat(10001) }),
      extraKey: quoteRecord({ price: 1 }),
      clientCreatedAt: quoteRecord({ createdAt: new Date(0) }),
    })) await assertFails(put(admin, `${quotes}/${id}`, data));
    await assertSucceeds(api.updateDoc(api.doc(admin, `${quotes}/q`), { status: "sent", updatedAt: now() }));
    await assertFails(api.updateDoc(api.doc(admin, `${quotes}/q`), { number: "QD-2026-0002", updatedAt: now() }));
    await assertFails(api.updateDoc(api.doc(admin, `${quotes}/q`), { createdAt: new Date(0), updatedAt: now() }));
    await assertSucceeds(api.deleteDoc(api.doc(admin, `${quotes}/q`)));
    await assertSucceeds(api.deleteDoc(api.doc(admin, "clients/c")));
  } finally { await env.cleanup(); }
});

const inHours = (hours) => new Date(Date.now() + hours * HOUR);
const SUBCOLLECTIONS = [
  ["dashboardUsers", "customer"], ["seatingAccess", "bride"], ["tables", "t"], ["guests", "g"], ["seatingGuests", "g"], ["checkinGuests", "g"],
  ["seatAssignments", "t~c1"], ["seatOccupancy", "t~c1"], ["seatedPeople", "g~main"], ["seatingMigrations", "m"], ["publicLayouts", "t"],
  ["publicEvent", "details"], ["genderRevealResponses", "r"], ["genderRevealState", "summary"], ["genderRevealResults", "aggregate"],
  ["publicScene", "state"], ["publicSchedule", "0"], ["publicVenue", "v"], ["eventMaintenance", "m"], ["invitationSecrets", "g"],
  ["invitationTokens", TOKEN], ["publicStats", "stats"], ["publicSummary", "summary"], ["senderCapabilities", "cap"], ["publicGuests", TOKEN],
  ["customerAudit", "a"],
];

async function seedDemo(db, id, fields, category = "wedding_engagement") {
  await put(db, `weddings/${id}`, { ...event, ownerUserId: "former-admin-owner", eventCategory: category, ...fields });
  await put(db, `weddings/${id}/dashboardUsers/customer`, customerMembership("customer", "customer@example.test", new Date()));
  await put(db, `weddings/${id}/dashboardUsers/seat-member`, seatingMember);
  await put(db, `weddings/${id}/dashboardUsers/checkin`, { userId: "checkin", email: "checkin@example.test", role: "checkin", canViewDashboard: false, canCheckIn: true, allowedSide: "all" });
  await put(db, `weddings/${id}/dashboardUsers/former-admin-owner`, { userId: "former-admin-owner", email: "former-admin-owner@example.test", role: "owner", canViewDashboard: true, canEditGuests: true, canEditSeating: true, canCheckIn: true, canManageUsers: true });
  for (const [name, docId] of SUBCOLLECTIONS) if (name !== "dashboardUsers") await put(db, `weddings/${id}/${name}/${docId}`, { side: "bride", seeded: true });
  await put(db, `weddings/${id}/guests/g`, { ...guest });
  await put(db, `weddings/${id}/seatingGuests/g`, { fullName: "Synthetic Guest", side: "bride", additionalGuests: 0, rsvpStatus: "pending" });
  await put(db, `weddings/${id}/checkinGuests/g`, { guestId: "g", fullName: "Synthetic Guest", phone: "", side: "bride", rsvpStatus: "pending", tableId: "", tableName: "", seatNumber: "", checkedIn: false, checkedInAt: null });
  await put(db, `weddings/${id}/invitationSecrets/g`, { token: TOKEN, status: "active", purpose: "guest-invitation", version: 1, expiresAt: null, createdAt: new Date(), updatedAt: new Date(), wedding: {} });
  await put(db, `weddings/${id}/invitationTokens/${TOKEN}`, { guestId: "g", status: "active", purpose: "guest-invitation", version: 1, expiresAt: null, createdAt: new Date(), updatedAt: new Date(), seatingAssignments: [] });
  await put(db, `weddings/${id}/publicGuests/${TOKEN}`, { eventId: id, wedding: {}, guest: { fullName: "Synthetic Guest", additionalGuestAllowance: 0, seatingAssignments: [], tableId: "", tableName: "", seatNumber: "" }, rsvpStatus: "pending", additionalGuests: 0, rsvpMessage: "", expiresAt: null, updatedAt: new Date() });
  await put(db, `weddings/${id}/senderCapabilities/cap`, { weddingId: id, purpose: "whatsapp-sender", status: "active", createdBy: "former-admin-owner", side: "all", eventTitle: "x", eventCategory: "wedding_engagement", recipientCount: 1, chunkCount: 1, expiresAt: null, createdAt: new Date(), updatedAt: new Date() });
  await put(db, `weddings/${id}/senderCapabilities/cap/recipients/0000`, { weddingId: id, capabilityId: "cap", chunkIndex: 0, recipients: [{ name: "x" }], createdAt: new Date() });
  await put(db, `weddings/${id}/genderRevealSessionKeys/anonymous-session-identifier`, { responseId: "r", createdAt: new Date() });
}

test("demo metadata is server-owned even for platform administrators", { skip }, async () => {
  const env = await environment("demo-demo-create");
  try {
    await seed(env, async (db) => {
      await put(db, "platformAdmins/admin", { enabled: true });
      await put(db, "platformAdmins/second", { enabled: true });
      await put(db, "weddings/plain", { ...event, ownerUserId: "admin" });
      await put(db, "weddings/plain/dashboardUsers/customer", customerMembership("customer", "customer@example.test", new Date()));
      await put(db, "weddings/demo", { ...event, ownerUserId: "admin", isDemo: true, demoExpiresAt: inHours(23.5), demoAccountUid: "demo-fixture" });
    });
    const admin = dbFor(env, "admin"), customer = dbFor(env, "customer");
    const draft = { ...event, ownerUserId: "admin" };
    await assertSucceeds(api.getDoc(api.doc(admin, "weddings/demo")));
    await assertSucceeds(put(admin, "weddings/ordinary", draft));
    for (const [id, fields] of Object.entries({
      validDemo: { isDemo: true, demoExpiresAt: inHours(23.5) },
      accountOnly: { demoAccountUid: "demo-fixture" },
      tooLong: { isDemo: true, demoExpiresAt: inHours(24.5) },
      tooShort: { isDemo: true, demoExpiresAt: inHours(1) },
      past: { isDemo: true, demoExpiresAt: inHours(-1) },
      noExpiry: { isDemo: true },
      expiryOnly: { demoExpiresAt: inHours(23.5) },
      falseFlag: { isDemo: false, demoExpiresAt: inHours(23.5) },
      falseAlone: { isDemo: false },
      stringFlag: { isDemo: "true", demoExpiresAt: inHours(23.5) },
      stringExpiry: { isDemo: true, demoExpiresAt: inHours(23.5).toISOString() },
    })) await assertFails(put(admin, `weddings/${id}`, { ...draft, ...fields }));
    for (const uid of ["customer", "stranger"]) {
      const db = dbFor(env, uid);
      await assertFails(put(db, `weddings/${uid}-demo`, { ...draft, ownerUserId: uid, isDemo: true, demoExpiresAt: inHours(23.5) }));
    }

    // No client, administrators included, can extend, shorten, clear or add these.
    const second = dbFor(env, "second");
    for (const db of [admin, second]) {
      await assertFails(api.updateDoc(api.doc(db, "weddings/demo"), { demoExpiresAt: inHours(48), updatedAt: now() }));
      await assertFails(api.updateDoc(api.doc(db, "weddings/demo"), { isDemo: false, updatedAt: now() }));
      await assertFails(api.updateDoc(api.doc(db, "weddings/demo"), { demoAccountUid: "another-demo", updatedAt: now() }));
      await assertFails(api.updateDoc(api.doc(db, "weddings/demo"), { isDemo: api.deleteField(), updatedAt: now() }));
      await assertFails(api.updateDoc(api.doc(db, "weddings/demo"), { demoExpiresAt: api.deleteField(), updatedAt: now() }));
      await assertFails(api.updateDoc(api.doc(db, "weddings/plain"), { isDemo: true, demoExpiresAt: inHours(23.5), updatedAt: now() }));
    }
    await assertFails(api.updateDoc(api.doc(customer, "weddings/plain"), { isDemo: true, updatedAt: now() }));
  } finally { await env.cleanup(); }
});

test("an expired demo closes to members and the public, stays open to admins; live demos and ordinary events are unchanged", { skip }, async () => {
  const env = await environment("demo-demo-expiry");
  try {
    await seed(env, async (db) => {
      await put(db, "platformAdmins/admin", { enabled: true });
      await put(db, "platformAdmins/second", { enabled: true });
      await seedDemo(db, "expired", { isDemo: true, demoExpiresAt: inHours(-1) });
      await seedDemo(db, "live", { isDemo: true, demoExpiresAt: inHours(23) });
      await seedDemo(db, "ordinary", {});
      await seedDemo(db, "malformed", { isDemo: true, demoExpiresAt: "tomorrow" });
      await seedDemo(db, "no-expiry", { isDemo: true });
      await seedDemo(db, "reveal-expired", { isDemo: true, demoExpiresAt: inHours(-1) }, "gender_reveal");
      await seedDemo(db, "reveal-ordinary", {}, "gender_reveal");
    });
    const members = ["customer", "seat-member", "checkin", "former-admin-owner"].map((uid) => dbFor(env, uid));
    const customer = members[0], seating = members[1], owner = members[3];
    const publicDb = env.unauthenticatedContext().firestore();
    const stranger = dbFor(env, "stranger");
    const anonymous = dbFor(env, "anonymous-session-identifier", { firebase: { sign_in_provider: "anonymous" } });

    for (const id of ["expired", "malformed", "no-expiry", "reveal-expired"]) {
      for (const db of [...members, publicDb, stranger, anonymous]) {
        await assertFails(api.getDoc(api.doc(db, `weddings/${id}`)));
        for (const [name, docId] of SUBCOLLECTIONS) {
          await assertFails(api.getDoc(api.doc(db, `weddings/${id}/${name}/${docId}`)));
          await assertFails(api.getDocs(api.collection(db, `weddings/${id}/${name}`)));
        }
        await assertFails(api.getDoc(api.doc(db, `weddings/${id}/senderCapabilities/cap/recipients/0000`)));
        await assertFails(api.getDoc(api.doc(db, `weddings/${id}/genderRevealSessionKeys/anonymous-session-identifier`)));
      }
      for (const db of members) {
        await assertFails(api.updateDoc(api.doc(db, `weddings/${id}`), { eventTitle: "Late", updatedAt: now() }));
        await assertFails(api.updateDoc(api.doc(db, `weddings/${id}`), { hallObjects: [], updatedAt: now() }));
        await assertFails(api.updateDoc(api.doc(db, `weddings/${id}`), { status: "draft", updatedAt: now() }));
        await assertFails(api.updateDoc(api.doc(db, `weddings/${id}`), { showInvitationQr: true, updatedAt: now() }));
        await assertFails(api.updateDoc(api.doc(db, `weddings/${id}`), { seatingEnabled: true, updatedAt: now() }));
        await assertFails(api.updateDoc(api.doc(db, `weddings/${id}`), { deleting: true, updatedAt: now() }));
        await assertFails(put(db, `weddings/${id}/guests/late`, { ...guest, createdAt: now(), updatedAt: now() }));
        await assertFails(api.updateDoc(api.doc(db, `weddings/${id}/guests/g`), { fullName: "Late", updatedAt: now() }));
        await assertFails(api.deleteDoc(api.doc(db, `weddings/${id}/guests/g`)));
        await assertFails(put(db, `weddings/${id}/tables/late`, table));
        await assertFails(api.updateDoc(api.doc(db, `weddings/${id}/seatingGuests/g`), { fullName: "Late", updatedAt: now() }));
        await assertFails(api.updateDoc(api.doc(db, `weddings/${id}/checkinGuests/g`), { checkedIn: true, checkedInAt: now(), updatedAt: now() }));
        await assertFails(put(db, `weddings/${id}/publicScene/state`, { version: 1, updatedAt: now() }));
        await assertFails(put(db, `weddings/${id}/eventMaintenance/late`, { status: "running", updatedAt: now() }));
        await assertFails(api.deleteDoc(api.doc(db, `weddings/${id}/dashboardUsers/customer`)));
        await assertFails(put(db, `weddings/${id}/customerAudit/late`, auditEntry("customer")));
      }
      await assertFails(api.updateDoc(api.doc(customer, `weddings/${id}/publicGuests/${TOKEN}`), { rsvpStatus: "confirmed", updatedAt: now() }));
      // A public RSVP needs the guest mirror too, so it uses a real two-document batch.
      const rsvp = api.writeBatch(publicDb);
      const patch = { rsvpStatus: "confirmed", additionalGuests: 0, rsvpMessage: "", updatedAt: now() };
      rsvp.update(api.doc(publicDb, `weddings/${id}/publicGuests/${TOKEN}`), patch);
      rsvp.update(api.doc(publicDb, `weddings/${id}/guests/g`), patch);
      await assertFails(rsvp.commit());

      // Administrators keep everything, whether or not they own the event.
      for (const uid of ["admin", "second"]) {
        const admin = dbFor(env, uid);
        await assertSucceeds(api.getDoc(api.doc(admin, `weddings/${id}`)));
        for (const [name, docId] of SUBCOLLECTIONS) {
          // These two are closed to administrators on every event, or open only on gender reveals.
          if (name === "genderRevealState" || name === "genderRevealResults") continue;
          await assertSucceeds(api.getDoc(api.doc(admin, `weddings/${id}/${name}/${docId}`)));
        }
        await assertSucceeds(api.getDocs(api.collection(admin, `weddings/${id}/guests`)));
        await assertSucceeds(api.getDocs(api.collection(admin, `weddings/${id}/tables`)));
        await assertSucceeds(api.getDocs(api.collection(admin, `weddings/${id}/customerAudit`)));
        await assertSucceeds(api.updateDoc(api.doc(admin, `weddings/${id}/guests/g`), { fullName: `Edited by ${uid}`, updatedAt: now() }));
      }
    }

    // Live demo and ordinary event behave identically for each kind of account.
    for (const id of ["live", "ordinary"]) {
      await assertSucceeds(api.getDoc(api.doc(customer, `weddings/${id}`)));
      await assertSucceeds(api.getDocs(api.collection(customer, `weddings/${id}/guests`)));
      await assertSucceeds(api.getDocs(api.collection(customer, `weddings/${id}/tables`)));
      await assertSucceeds(api.updateDoc(api.doc(customer, `weddings/${id}/guests/g`), { fullName: "Edited", updatedAt: now() }));
      await assertSucceeds(put(customer, `weddings/${id}/customerAudit/live`, auditEntry("customer")));
      await assertSucceeds(api.getDocs(api.collection(seating, `weddings/${id}/seatOccupancy`)));
      await assertSucceeds(api.getDoc(api.doc(owner, `weddings/${id}`)));
      await assertSucceeds(api.updateDoc(api.doc(owner, `weddings/${id}`), { eventTitle: "Owner edit", updatedAt: now() }));
      await assertSucceeds(api.getDoc(api.doc(publicDb, `weddings/${id}/publicEvent/details`)));
      await assertSucceeds(api.getDoc(api.doc(publicDb, `weddings/${id}/publicGuests/${TOKEN}`)));
      await assertSucceeds(api.getDoc(api.doc(publicDb, `weddings/${id}/senderCapabilities/cap`)));
      const rsvp = api.writeBatch(publicDb);
      const patch = { rsvpStatus: "confirmed", additionalGuests: 0, rsvpMessage: "", updatedAt: now() };
      rsvp.update(api.doc(publicDb, `weddings/${id}/publicGuests/${TOKEN}`), patch);
      rsvp.update(api.doc(publicDb, `weddings/${id}/guests/g`), patch);
      await assertSucceeds(rsvp.commit());
      await assertSucceeds(api.getDoc(api.doc(anonymous, `weddings/${id}/genderRevealSessionKeys/anonymous-session-identifier`)));
    }
    await assertSucceeds(api.getDoc(api.doc(publicDb, "weddings/reveal-ordinary/genderRevealResults/aggregate")));
    await assertFails(api.getDoc(api.doc(publicDb, "weddings/reveal-expired/genderRevealResults/aggregate")));

    // A session key under a missing event keeps working, as it did before expiry existed.
    await seed(env, (db) => put(db, "weddings/gone/genderRevealSessionKeys/anonymous-session-identifier", { responseId: "r" }));
    await assertSucceeds(api.getDoc(api.doc(anonymous, "weddings/gone/genderRevealSessionKeys/anonymous-session-identifier")));
  } finally { await env.cleanup(); }
});

test("an expired demo refuses grant redemption and owner cleanup, and an admin can still delete it", { skip }, async () => {
  const env = await environment("demo-demo-cleanup");
  try {
    const email = "invited@example.test";
    const claims = { email, email_verified: true };
    await seed(env, async (db) => {
      await put(db, "platformAdmins/admin", { enabled: true });
      for (const id of ["expired", "live"]) {
        await put(db, `weddings/${id}`, { ...event, ownerUserId: "former-admin-owner", isDemo: true, demoExpiresAt: inHours(id === "live" ? 23 : -1) });
        await put(db, `customerGrants/grant-${id}`, { email, weddingId: id, role: "customer", updatedAt: new Date() });
      }
      await put(db, "weddings/expired-deleting", { ...event, ownerUserId: "former-admin-owner", isDemo: true, demoExpiresAt: inHours(-1), deleting: true });
      await put(db, "weddings/expired-deleting/guests/g", guest);
    });
    const invited = dbFor(env, "invited", claims);
    const redeem = (id) => {
      const batch = api.writeBatch(invited);
      batch.set(api.doc(invited, `weddings/${id}/dashboardUsers/invited`), { ...customerMembership("invited", email, new Date()), updatedAt: now(), grantId: `grant-${id}` });
      batch.delete(api.doc(invited, `customerGrants/grant-${id}`));
      return batch.commit();
    };
    await assertFails(redeem("expired"));
    await assertSucceeds(redeem("live"));

    const owner = dbFor(env, "former-admin-owner"), admin = dbFor(env, "admin");
    await assertFails(api.getDocs(api.collection(owner, "weddings/expired-deleting/guests")));
    await assertFails(api.deleteDoc(api.doc(owner, "weddings/expired-deleting/guests/g")));
    await assertFails(api.deleteDoc(api.doc(owner, "weddings/expired-deleting")));
    await assertSucceeds(api.getDocs(api.collection(admin, "weddings/expired-deleting/guests")));
    await assertSucceeds(api.deleteDoc(api.doc(admin, "weddings/expired-deleting/guests/g")));
    await assertSucceeds(api.deleteDoc(api.doc(admin, "weddings/expired-deleting")));
  } finally { await env.cleanup(); }
});

// The heaviest real requests, on the event type that evaluates the most rules: a
// full party moved in one transaction and the projections and token that follow.
test("the largest customer transactions stay inside the rules budget on a live demo and for a non-member admin", { skip }, async () => {
  const env = await environment("demo-budget");
  try {
    const seats = Array.from({ length: 12 }, (_, i) => ({ id: `c${i + 1}`, seatNumber: i + 1, x: 20, y: 20 }));
    const layout = { ...table, capacity: 12, seatCount: 12, chairs: seats };
    await seed(env, async (db) => {
      await put(db, "platformAdmins/admin", { enabled: true });
      for (const [id, fields] of [["live", { isDemo: true, demoExpiresAt: inHours(23) }], ["ordinary", {}]]) {
        await put(db, `weddings/${id}`, { ...event, ownerUserId: "former-admin-owner", eventTitle: "Synthetic party", ...fields });
        await put(db, `weddings/${id}/dashboardUsers/customer`, customerMembership("customer", "customer@example.test", new Date()));
        await put(db, `weddings/${id}/tables/t`, layout);
        await put(db, `weddings/${id}/seatingGuests/g`, { fullName: "Synthetic party", side: "family", additionalGuests: 10, rsvpStatus: "confirmed" });
        await put(db, `weddings/${id}/guests/g`, { ...guest, fullName: "Synthetic party", side: "family", additionalGuests: 10, additionalGuestAllowance: 10, rsvpStatus: "confirmed" });
        for (const chair of seats) await put(db, `weddings/${id}/seatOccupancy/t~${chair.id}`, { weddingId: id, tableId: "t", chairId: chair.id, occupied: false, updatedAt: new Date() });
      }
    });
    const full = { ...layout, chairs: seats.map((chair, i) => i < 11 ? { ...chair, assignment: { guestId: "g", partyMemberIndex: i, personKey: i ? `guest-${i}` : "main", side: "family" } } : chair) };
    for (const [uid, id, customer] of [["customer", "live", true], ["customer", "ordinary", true], ["admin", "live", false], ["admin", "ordinary", false]]) {
      const db = dbFor(env, uid);
      await assertSucceeds(api.runTransaction(db, (transaction) => persistCanonicalSeatDiff({ api, db, weddingId: id, transaction, beforeTables: [layout], afterTables: [full] })));
      assert.equal((await api.getDocs(api.collection(db, `weddings/${id}/seatAssignments`))).size, 11);
      if (customer) await assertSucceeds(syncCustomerEventProjections(api, db, id));
      const wedding = (await api.getDoc(api.doc(db, `weddings/${id}`))).data();
      const service = createInvitationTokenService({ db, firestore: api });
      await assertSucceeds(service.ensure({ uid, weddingId: id, guestId: "g", wedding, tables: [full], customer }));
      await assertSucceeds(api.runTransaction(db, (transaction) => persistCanonicalSeatDiff({ api, db, weddingId: id, transaction, beforeTables: [full], afterTables: [layout] })));
      assert.equal((await api.getDocs(api.collection(db, `weddings/${id}/seatAssignments`))).size, 0);
    }
  } finally { await env.cleanup(); }
});

function noteRecord(uid, overrides = {}) {
  return { text: "Called about a June wedding; wants the photo bucket.", priceFils: 1250000, currency: "AED", interests: ["photo bucket", "seating"], pinned: false, authorUid: uid, authorName: "Shadi", createdAt: now(), updatedAt: now(), ...overrides };
}

test("client notes are a platform-admin timeline with an exact, validated shape", { skip }, async () => {
  const env = await environment("demo-client-notes");
  try {
    await seed(env, async (db) => {
      await put(db, "platformAdmins/admin", { enabled: true });
      await put(db, "platformAdmins/second", { enabled: true });
      await put(db, "platformAdmins/disabled", { enabled: false });
      await put(db, "weddings/e", { ...event, ownerUserId: "admin" });
      await put(db, "weddings/e/dashboardUsers/customer", customerMembership("customer", "customer@example.test", new Date()));
      await put(db, "clients/c", { name: "Seeded client" });
      await put(db, "clients/c/notes/seeded", { text: "Seeded", authorUid: "admin", authorName: "Shadi" });
    });
    const admin = dbFor(env, "admin"), second = dbFor(env, "second");
    const notes = "clients/c/notes";

    // Everyone else is denied every operation, including collection-group reads.
    for (const [uid, db] of [["customer", dbFor(env, "customer")], ["stranger", dbFor(env, "stranger")], ["disabled", dbFor(env, "disabled")], ["signed-out", env.unauthenticatedContext().firestore()]]) {
      await assertFails(api.getDoc(api.doc(db, `${notes}/seeded`)));
      await assertFails(api.getDocs(api.collection(db, notes)));
      await assertFails(api.getDocs(api.collectionGroup(db, "notes")));
      await assertFails(put(db, `${notes}/by-${uid}`, noteRecord(uid)));
      await assertFails(api.updateDoc(api.doc(db, `${notes}/seeded`), { text: "Changed", updatedAt: now() }));
      await assertFails(api.deleteDoc(api.doc(db, `${notes}/seeded`)));
    }

    // Create: full and minimal shapes.
    await assertSucceeds(put(admin, `${notes}/full`, noteRecord("admin", { pinned: true })));
    await assertSucceeds(put(admin, `${notes}/minimal`, { text: "x", authorUid: "admin", authorName: "", createdAt: now(), updatedAt: now() }));
    await assertSucceeds(put(admin, `${notes}/limits`, noteRecord("admin", { text: "t".repeat(5000), authorName: "a".repeat(80), priceFils: 0, interests: Array.from({ length: 10 }, (_, i) => `${"i".repeat(39)}${i}`) })));
    await assertSucceeds(api.getDocs(api.query(api.collection(admin, notes), api.orderBy("createdAt", "desc"))));
    const noPrice = noteRecord("admin");
    delete noPrice.priceFils;
    delete noPrice.currency;
    await assertSucceeds(put(admin, `${notes}/no-price`, noPrice));

    const missing = (key) => { const data = noteRecord("admin"); delete data[key]; return data; };
    for (const [id, data] of Object.entries({
      emptyText: noteRecord("admin", { text: "" }),
      longText: noteRecord("admin", { text: "t".repeat(5001) }),
      numberText: noteRecord("admin", { text: 5 }),
      noText: missing("text"),
      floatPrice: noteRecord("admin", { priceFils: 10.5 }),
      negativePrice: noteRecord("admin", { priceFils: -1 }),
      stringPrice: noteRecord("admin", { priceFils: "100" }),
      priceWithoutCurrency: missing("currency"),
      usd: noteRecord("admin", { currency: "USD" }),
      currencyWithoutPrice: missing("priceFils"),
      tooManyInterests: noteRecord("admin", { interests: Array(11).fill("x") }),
      longInterest: noteRecord("admin", { interests: ["i".repeat(41)] }),
      numberInterest: noteRecord("admin", { interests: ["ok", 7] }),
      interestsNotList: noteRecord("admin", { interests: "seating" }),
      stringPinned: noteRecord("admin", { pinned: "yes" }),
      forgedAuthor: noteRecord("second"),
      noAuthor: missing("authorUid"),
      longAuthorName: noteRecord("admin", { authorName: "a".repeat(81) }),
      noAuthorName: missing("authorName"),
      clientCreatedAt: noteRecord("admin", { createdAt: new Date(0) }),
      clientUpdatedAt: noteRecord("admin", { updatedAt: new Date(0) }),
      extraKey: noteRecord("admin", { visibleToCustomer: true }),
    })) await assertFails(put(admin, `${notes}/${id}`, data));
    await assertFails(put(admin, "clients/missing/notes/orphan", noteRecord("admin")));

    // Any admin may edit; authorUid and createdAt never change.
    await assertSucceeds(api.updateDoc(api.doc(second, `${notes}/full`), { text: "Edited by the second admin", pinned: false, interests: [], authorName: "Daya", updatedAt: now() }));
    await assertSucceeds(api.updateDoc(api.doc(second, `${notes}/full`), { priceFils: api.deleteField(), currency: api.deleteField(), updatedAt: now() }));
    await assertFails(api.updateDoc(api.doc(second, `${notes}/full`), { authorUid: "second", updatedAt: now() }));
    await assertFails(api.updateDoc(api.doc(second, `${notes}/full`), { createdAt: new Date(0), updatedAt: now() }));
    await assertFails(api.updateDoc(api.doc(second, `${notes}/full`), { text: "No timestamp" }));
    await assertFails(api.updateDoc(api.doc(second, `${notes}/full`), { priceFils: 5, updatedAt: now() }));
    const stored = (await api.getDoc(api.doc(admin, `${notes}/full`))).data();
    assert.equal(stored.authorUid, "admin");
    assert.equal(stored.text, "Edited by the second admin");

    // Client deletion: notes are removable before and after the client document.
    await assertSucceeds(api.deleteDoc(api.doc(second, `${notes}/minimal`)));
    await assertSucceeds(api.deleteDoc(api.doc(admin, "clients/c")));
    for (const row of (await api.getDocs(api.collection(admin, notes))).docs) await assertSucceeds(api.deleteDoc(row.ref));
    assert.equal((await api.getDocs(api.collection(admin, notes))).size, 0);
  } finally { await env.cleanup(); }
});

// The projection as written before music existed, plus whatever music keys a case adds.
function projection(event, music = {}) {
  const data = publicEventData(event);
  for (const key of ["musicMode", "musicVersion", "musicName"]) delete data[key];
  return { ...data, ...music, updatedAt: now() };
}

test("event music: platform admins set it, the public projection carries mode and version only", { skip }, async () => {
  const env = await environment("demo-music");
  try {
    await seed(env, async (db) => {
      await put(db, "platformAdmins/admin", { enabled: true });
      await put(db, "platformAdmins/second", { enabled: true });
      await put(db, "weddings/e", { ...event, ownerUserId: "former-admin-owner" });
      await put(db, "weddings/e/dashboardUsers/customer", customerMembership("customer", "customer@example.test", new Date()));
      await put(db, "weddings/e/dashboardUsers/former-admin-owner", { userId: "former-admin-owner", email: "former-admin-owner@example.test", role: "owner", canViewDashboard: true, canEditGuests: true, canEditSeating: true, canCheckIn: true, canManageUsers: true, canEditEventDetails: true });
      await put(db, "weddings/e/dashboardUsers/seat-member", seatingMember);
    });
    const admin = dbFor(env, "admin"), second = dbFor(env, "second"), customer = dbFor(env, "customer");
    const owner = dbFor(env, "former-admin-owner"), seating = dbFor(env, "seat-member");
    const eventRef = (db) => api.doc(db, "weddings/e");
    const details = (db) => api.doc(db, "weddings/e/publicEvent/details");
    const current = async () => (await api.getDoc(eventRef(admin))).data();

    // No music fields: behaves as "default". The old projection shape still works,
    // and so does one that states the default explicitly.
    await assertSucceeds(api.setDoc(details(customer), projection(await current())));
    await assertSucceeds(api.setDoc(details(customer), projection(await current(), { musicMode: "default", musicVersion: 0 })));
    await assertFails(api.setDoc(details(customer), projection(await current(), { musicMode: "off" })));
    await assertFails(api.setDoc(details(customer), projection(await current(), { musicMode: "default", musicVersion: 1 })));
    await assertFails(api.setDoc(details(customer), projection(await current(), { musicName: "Our song.mp3" })));
    await assertSucceeds(syncCustomerEventProjections(api, customer, "e"));

    // Only platform admins may set or change music, in a write of its own.
    for (const db of [customer, owner, seating, dbFor(env, "stranger")]) {
      await assertFails(api.updateDoc(eventRef(db), { musicMode: "off", updatedAt: now() }));
      await assertFails(api.updateDoc(eventRef(db), { musicName: "x", updatedAt: now() }));
      await assertFails(api.updateDoc(eventRef(db), { musicVersion: 1, updatedAt: now() }));
    }
    for (const patch of [{ musicMode: "loud" }, { musicMode: true }, { musicVersion: -1 }, { musicVersion: 1.5 }, { musicVersion: 2 }, { musicName: "n".repeat(81) }, { musicName: 7 }, { musicMode: "off", eventTitle: "Mixed write" }]) {
      await assertFails(api.updateDoc(eventRef(admin), { ...patch, updatedAt: now() }));
    }
    await assertFails(api.updateDoc(eventRef(admin), { musicMode: "off" }));
    await assertSucceeds(api.updateDoc(eventRef(admin), { musicMode: "off", updatedAt: now() }));

    // Once set, a projection must state it; the old shape no longer passes.
    await assertFails(api.setDoc(details(customer), projection(await current())));
    await assertFails(api.setDoc(details(customer), projection(await current(), { musicMode: "default", musicVersion: 0 })));
    await assertSucceeds(api.setDoc(details(customer), projection(await current(), { musicMode: "off", musicVersion: 0 })));

    // Replacing a custom song moves the version by exactly one; any admin may do it.
    await assertSucceeds(api.updateDoc(eventRef(second), { musicMode: "custom", musicVersion: 1, musicName: "n".repeat(80), updatedAt: now() }));
    await assertSucceeds(api.updateDoc(eventRef(admin), { musicVersion: 2, musicName: "Second song.mp3", updatedAt: now() }));
    await assertSucceeds(api.updateDoc(eventRef(admin), { musicMode: "custom", musicName: "Renamed only", updatedAt: now() }));
    await assertFails(api.updateDoc(eventRef(admin), { musicVersion: 1, updatedAt: now() }));
    await assertFails(api.updateDoc(eventRef(admin), { musicVersion: 4, updatedAt: now() }));
    await assertFails(api.setDoc(details(customer), projection(await current(), { musicMode: "custom", musicVersion: 1 })));
    await assertFails(api.setDoc(details(customer), projection(await current(), { musicMode: "custom" })));
    await assertFails(api.setDoc(details(customer), projection(await current(), { musicMode: "custom", musicVersion: 2, musicName: "Second song.mp3" })));
    await assertSucceeds(api.setDoc(details(customer), projection(await current(), { musicMode: "custom", musicVersion: 2 })));
    const published = (await api.getDoc(details(env.unauthenticatedContext().firestore()))).data();
    assert.equal(published.musicMode, "custom");
    assert.equal(published.musicVersion, 2);
    assert.equal("musicName" in published, false);

    // Customers keep their ordinary event edits on a music-configured event.
    await assertSucceeds(api.updateDoc(eventRef(customer), { eventTitle: "Customer edit", updatedAt: now() }));
    await assertFails(api.updateDoc(eventRef(customer), { eventTitle: "Sneaky", musicMode: "off", updatedAt: now() }));

    // Create validates music fields; only platform admins create events at all.
    const draft = { ...event, ownerUserId: "admin" };
    await assertSucceeds(put(admin, "weddings/with-music", { ...draft, musicMode: "custom", musicVersion: 1, musicName: "Song.mp3" }));
    await assertSucceeds(put(admin, "weddings/without-music", draft));
    for (const [id, music] of Object.entries({ badMode: { musicMode: "loud" }, badVersion: { musicVersion: -1 }, longName: { musicName: "n".repeat(81) } })) {
      await assertFails(put(admin, `weddings/${id}`, { ...draft, ...music }));
    }
  } finally { await env.cleanup(); }
});
