// Proof that a customer linked to one event reaches nothing else. Every attempt
// here is one a hand-written client could make; the UI is not involved.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as api from "firebase/firestore";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { customerMembership } from "../account-access.js";

const skip = !process.env.FIRESTORE_EMULATOR_HOST;
const TOKEN = "B".repeat(43);
const event = { ownerUserId: "admin", eventTitle: "Synthetic event", eventCategory: "wedding_engagement", eventDateISO: "2027-05-20T18:00:00.000Z", venueEn: "Test Hall", status: "active", seatingEnabled: true, seatingSchemaVersion: 2, hallObjects: [], schedule: [] };
const guest = { fullName: "Private Guest", phone: "971500000000", side: "bride", additionalGuests: 0, additionalGuestAllowance: 0, rsvpStatus: "pending", rsvpMessage: "", seatingAssignments: [], tableId: "", tableName: "", seatNumber: "", checkedIn: false, checkedInAt: null, notes: "private", inviteSentAt: null, reminderSentAt: null };
const put = (db, path, data) => api.setDoc(api.doc(db, path), data);
const now = () => api.serverTimestamp();

// Each private subcollection of an event, with a document seeded in event B.
const PRIVATE = [
  ["dashboardUsers", "customer-b"], ["seatingAccess", "bride"], ["tables", "t"], ["guests", "g"], ["seatingGuests", "g"],
  ["checkinGuests", "g"], ["seatAssignments", "t~c"], ["seatOccupancy", "t~c"], ["seatedPeople", "g~main"], ["seatingMigrations", "m"],
  ["genderRevealResponses", "r"], ["genderRevealSessionKeys", "s"], ["genderRevealState", "summary"], ["eventMaintenance", "m"],
  ["invitationSecrets", "g"], ["invitationTokens", TOKEN], ["publicStats", "stats"], ["customerAudit", "a"],
];
// The invitation page reads these without signing in, so they carry only public
// event details, and any visitor who knows the event ID can read them by design.
const PUBLIC_GET = [["publicEvent", "details"], ["publicScene", "state"], ["publicLayouts", "t"], ["publicSchedule", "0"], ["publicVenue", "v"], ["publicSummary", "summary"]];
const PUBLIC_LIST = ["publicLayouts", "publicSchedule", "publicVenue"];
const PUBLIC_NO_LIST = ["publicEvent", "publicScene", "publicSummary", "publicGuests"];

async function seedEvent(db, id, customers) {
  await put(db, `weddings/${id}`, { ...event, eventTitle: `Synthetic event ${id}` });
  await put(db, `weddings/${id}/dashboardUsers/admin`, { userId: "admin", email: "admin@example.test", role: "owner", canViewDashboard: true, canEditGuests: true, canEditSeating: true, canCheckIn: true, canManageUsers: true });
  for (const uid of customers) {
    await put(db, `weddings/${id}/dashboardUsers/${uid}`, customerMembership(uid, `${uid}@example.test`, new Date()));
    await put(db, `users/${uid}/weddingAccess/${id}`, { weddingId: id });
  }
  for (const [name, docId] of [...PRIVATE, ...PUBLIC_GET]) {
    if (name !== "dashboardUsers") await put(db, `weddings/${id}/${name}/${docId}`, { side: "bride", private: true });
  }
  await put(db, `weddings/${id}/guests/g`, guest);
  await put(db, `weddings/${id}/seatingGuests/g`, { fullName: "Private Guest", side: "bride", additionalGuests: 0, rsvpStatus: "pending" });
  await put(db, `weddings/${id}/invitationTokens/${TOKEN}`, { guestId: "g", status: "active", purpose: "guest-invitation", version: 1, expiresAt: null, createdAt: new Date(), updatedAt: new Date(), seatingAssignments: [] });
  await put(db, `weddings/${id}/invitationSecrets/g`, { token: TOKEN, status: "active", purpose: "guest-invitation", version: 1, expiresAt: null, createdAt: new Date(), updatedAt: new Date(), wedding: {} });
  await put(db, `weddings/${id}/publicGuests/${TOKEN}`, { eventId: id, wedding: {}, guest: { fullName: "Private Guest", additionalGuestAllowance: 0, seatingAssignments: [], tableId: "", tableName: "", seatNumber: "" }, rsvpStatus: "pending", additionalGuests: 0, rsvpMessage: "", expiresAt: null, updatedAt: new Date() });
  await put(db, `weddings/${id}/senderCapabilities/cap`, { weddingId: id, purpose: "whatsapp-sender", status: "revoked", createdBy: "admin", side: "all", eventTitle: "x", eventCategory: "wedding_engagement", recipientCount: 1, chunkCount: 1, expiresAt: null, createdAt: new Date(), updatedAt: new Date() });
  await put(db, `weddings/${id}/senderCapabilities/cap/recipients/0000`, { weddingId: id, capabilityId: "cap", chunkIndex: 0, recipients: [{ phone: "971500000000" }], createdAt: new Date() });
}

async function withEnvironment(projectId, callback) {
  const env = await initializeTestEnvironment({ projectId, firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") } });
  await env.clearFirestore();
  try {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await put(db, "platformAdmins/admin", { enabled: true });
      await put(db, "customerDirectory/customer-a", { userId: "customer-a", email: "customer-a@example.test", updatedAt: new Date() });
      await put(db, "customerDirectory/customer-b", { userId: "customer-b", email: "customer-b@example.test", updatedAt: new Date() });
      await put(db, "customerGrants/grant-b", { email: "customer-b@example.test", weddingId: "B", role: "customer", updatedAt: new Date() });
      await put(db, "clients/c", { name: "Private client" });
      await put(db, "clients/c/quotes/q", { number: "1" });
      await seedEvent(db, "A", ["customer-a", "multi"]);
      await seedEvent(db, "B", ["customer-b"]);
      await seedEvent(db, "C", ["multi"]);
    });
    const dbFor = (uid, claims = {}) => env.authenticatedContext(uid, { email: `${uid}@example.test`, ...claims }).firestore();
    await callback({ env, dbFor });
  } finally { await env.cleanup(); }
}

function assertEventClosed(db, id) {
  return (async () => {
    await assertFails(api.getDoc(api.doc(db, `weddings/${id}`)));
    for (const [name, docId] of PRIVATE) {
      await assertFails(api.getDoc(api.doc(db, `weddings/${id}/${name}/${docId}`)));
      await assertFails(api.getDocs(api.collection(db, `weddings/${id}/${name}`)));
    }
    await assertFails(api.getDocs(api.collection(db, `weddings/${id}/senderCapabilities`)));
    await assertFails(api.getDoc(api.doc(db, `weddings/${id}/senderCapabilities/cap`)));
    await assertFails(api.getDoc(api.doc(db, `weddings/${id}/senderCapabilities/cap/recipients/0000`)));
    await assertFails(api.getDocs(api.collection(db, `weddings/${id}/senderCapabilities/cap/recipients`)));
  })();
}

test("a customer linked to event A cannot read event B or query across events", { skip }, async () => {
  await withEnvironment("demo-isolation-read", async ({ dbFor }) => {
    const a = dbFor("customer-a");
    await assertSucceeds(api.getDoc(api.doc(a, "weddings/A")));
    await assertSucceeds(api.getDocs(api.collection(a, "weddings/A/guests")));
    await assertEventClosed(a, "B");

    // Every shape of list on the top-level collection.
    const weddings = api.collection(a, "weddings");
    for (const queryShape of [weddings, api.query(weddings, api.limit(1)), api.query(weddings, api.where("status", "==", "active")),
      api.query(weddings, api.where("ownerUserId", "==", "admin")), api.query(weddings, api.where(api.documentId(), "==", "B")),
      api.query(weddings, api.where(api.documentId(), "in", ["A", "B"]))]) {
      await assertFails(api.getDocs(queryShape));
    }
    // Collection groups would otherwise cross every event at once.
    for (const name of [...PRIVATE.map(([collection]) => collection), "publicGuests", "senderCapabilities", "recipients", "weddingAccess", "quotes"]) {
      await assertFails(api.getDocs(api.collectionGroup(a, name)));
    }
    await assertFails(api.getDocs(api.query(api.collectionGroup(a, "dashboardUsers"), api.where("userId", "==", "customer-a"))));
    await assertFails(api.getDocs(api.query(api.collectionGroup(a, "guests"), api.limit(1))));

    // An invitation is a bearer capability: the exact token reads its own page,
    // but the list of tokens, and the guest behind it, remain closed.
    await assertFails(api.getDocs(api.collection(a, "weddings/B/publicGuests")));
    await assertSucceeds(api.getDoc(api.doc(a, `weddings/B/publicGuests/${TOKEN}`)));
    await assertFails(api.getDoc(api.doc(a, `weddings/B/publicGuests/${"X".repeat(43)}`)));

    // Public invitation projections are readable by design; their lists stay narrow.
    for (const [name, docId] of PUBLIC_GET) await assertSucceeds(api.getDoc(api.doc(a, `weddings/B/${name}/${docId}`)));
    for (const name of PUBLIC_LIST) await assertSucceeds(api.getDocs(api.collection(a, `weddings/B/${name}`)));
    for (const name of PUBLIC_NO_LIST) await assertFails(api.getDocs(api.collection(a, `weddings/B/${name}`)));
  });
});

test("a customer linked to event A cannot write anything on event B", { skip }, async () => {
  await withEnvironment("demo-isolation-write", async ({ dbFor }) => {
    const a = dbFor("customer-a");
    const b = (path) => api.doc(a, `weddings/B/${path}`);
    for (const patch of [{ eventTitle: "Hijack" }, { ownerUserId: "customer-a" }, { deleting: true }, { status: "archived" }, { hallObjects: [] }, { seatingEnabled: false }, { showInvitationQr: false }, { seatingSchemaVersion: 2 }]) {
      await assertFails(api.updateDoc(api.doc(a, "weddings/B"), { ...patch, updatedAt: now() }));
    }
    await assertFails(api.deleteDoc(api.doc(a, "weddings/B")));
    await assertFails(api.setDoc(api.doc(a, "weddings/B"), event));
    await assertFails(api.setDoc(b("dashboardUsers/customer-a"), customerMembership("customer-a", "customer-a@example.test", now())));
    await assertFails(api.updateDoc(b("dashboardUsers/customer-b"), { canManageUsers: true }));
    await assertFails(api.deleteDoc(b("dashboardUsers/customer-b")));
    await assertFails(api.setDoc(b("guests/new"), { ...guest, createdAt: now(), updatedAt: now() }));
    await assertFails(api.updateDoc(b("guests/g"), { fullName: "Hijack", updatedAt: now() }));
    await assertFails(api.deleteDoc(b("guests/g")));
    await assertFails(api.setDoc(b("seatingGuests/new"), { fullName: "x", side: "bride", additionalGuests: 0, rsvpStatus: "pending" }));
    await assertFails(api.updateDoc(b("seatingGuests/g"), { fullName: "Hijack" }));
    await assertFails(api.setDoc(b("tables/new"), { name: "x" }));
    await assertFails(api.deleteDoc(b("tables/t")));
    await assertFails(api.setDoc(b("seatOccupancy/new~c"), { weddingId: "B", tableId: "new", chairId: "c", occupied: false, updatedAt: now() }));
    await assertFails(api.deleteDoc(b("seatAssignments/t~c")));
    await assertFails(api.setDoc(b("publicScene/state"), { version: 1, updatedAt: now() }));
    await assertFails(api.setDoc(b("publicStats/stats"), { eventId: "B", eventCategory: "wedding_engagement", stats: {}, updatedAt: now() }));
    await assertFails(api.setDoc(b("eventMaintenance/m"), { status: "running", updatedAt: now() }));
    await assertFails(api.setDoc(b("seatingMigrations/m"), { status: "running", updatedAt: now() }));
    await assertFails(api.deleteDoc(b(`publicGuests/${TOKEN}`)));
    await assertFails(api.updateDoc(b(`publicGuests/${TOKEN}`), { "guest.fullName": "Hijack", updatedAt: now() }));
    await assertFails(api.deleteDoc(b(`invitationTokens/${TOKEN}`)));
    await assertFails(api.deleteDoc(b("invitationSecrets/g")));
    await assertFails(api.setDoc(b("senderCapabilities/new"), { weddingId: "B", purpose: "whatsapp-sender", status: "preparing", createdBy: "customer-a", side: "all", eventTitle: "x", eventCategory: "wedding_engagement", recipientCount: 1, chunkCount: 1, expiresAt: null, createdAt: new Date(), updatedAt: now() }));
    await assertFails(api.setDoc(b("customerAudit/new"), { actorUid: "customer-a", actorEmail: "customer-a@example.test", action: "guest.update", targetType: "guest", targetId: "g", summary: "", createdAt: now() }));
    // A batch that writes to event A does not carry event B along with it.
    const batch = api.writeBatch(a);
    batch.update(api.doc(a, "weddings/A/guests/g"), { fullName: "Fine", updatedAt: now() });
    batch.update(b("guests/g"), { fullName: "Hijack", updatedAt: now() });
    await assertFails(batch.commit());
    await assertSucceeds(api.updateDoc(api.doc(a, "weddings/A/guests/g"), { fullName: "Fine", updatedAt: now() }));
  });
});

test("a customer cannot reach clients, audit, platformAdmins, the directory, or another user's cards", { skip }, async () => {
  await withEnvironment("demo-isolation-platform", async ({ dbFor }) => {
    const a = dbFor("customer-a", { email_verified: true });
    await assertFails(api.getDoc(api.doc(a, "clients/c")));
    await assertFails(api.getDocs(api.collection(a, "clients")));
    await assertFails(api.getDoc(api.doc(a, "clients/c/quotes/q")));
    await assertFails(api.getDocs(api.collection(a, "clients/c/quotes")));
    await assertFails(put(a, "clients/new", { name: "x" }));
    await assertFails(put(a, "clients/c/quotes/new", { number: "2" }));
    await assertFails(api.deleteDoc(api.doc(a, "clients/c")));

    // Customers cannot read the trail of their own event either.
    await assertFails(api.getDoc(api.doc(a, "weddings/A/customerAudit/a")));
    await assertFails(api.getDocs(api.collection(a, "weddings/A/customerAudit")));
    await assertFails(api.deleteDoc(api.doc(a, "weddings/A/customerAudit/a")));
    await assertFails(api.updateDoc(api.doc(a, "weddings/A/customerAudit/a"), { summary: "changed" }));

    await assertFails(api.getDoc(api.doc(a, "platformAdmins/admin")));
    await assertFails(api.getDocs(api.collection(a, "platformAdmins")));
    await assertFails(put(a, "platformAdmins/customer-a", { enabled: true }));
    await assertFails(api.deleteDoc(api.doc(a, "platformAdmins/admin")));

    await assertSucceeds(api.getDoc(api.doc(a, "customerDirectory/customer-a")));
    await assertFails(api.getDoc(api.doc(a, "customerDirectory/customer-b")));
    await assertFails(api.getDocs(api.collection(a, "customerDirectory")));
    await assertFails(put(a, "customerDirectory/customer-b", { userId: "customer-b", email: "customer-a@example.test", updatedAt: now() }));
    await assertFails(api.deleteDoc(api.doc(a, "customerDirectory/customer-b")));

    await assertFails(api.getDoc(api.doc(a, "customerGrants/grant-b")));
    await assertFails(api.getDocs(api.collection(a, "customerGrants")));
    await assertFails(put(a, "customerGrants/forged", { email: "customer-a@example.test", weddingId: "B", role: "customer", updatedAt: now() }));

    await assertFails(api.getDoc(api.doc(a, "users/customer-b/weddingAccess/B")));
    await assertFails(api.getDocs(api.collection(a, "users/customer-b/weddingAccess")));
    await assertFails(put(a, "users/customer-b/weddingAccess/A", { weddingId: "A" }));
    await assertFails(api.deleteDoc(api.doc(a, "users/customer-b/weddingAccess/B")));
    await assertFails(api.getDoc(api.doc(a, "users/customer-b")));
  });
});

test("a forged discovery hint grants nothing", { skip }, async () => {
  await withEnvironment("demo-isolation-hint", async ({ env, dbFor }) => {
    const a = dbFor("customer-a");
    // The rules refuse to let the customer write it for an event they do not belong to.
    await assertFails(put(a, "users/customer-a/weddingAccess/B", { weddingId: "B", ownerUserId: "customer-a", canViewDashboard: true }));
    // Even when one exists, whatever it says, it is only a hint.
    await env.withSecurityRulesDisabled((context) => put(context.firestore(), "users/customer-a/weddingAccess/B", { weddingId: "B", ownerUserId: "customer-a", role: "owner", canViewDashboard: true, canManageUsers: true }));
    assert.deepEqual((await api.getDocs(api.collection(a, "users/customer-a/weddingAccess"))).docs.map((row) => row.id).sort(), ["A", "B"]);
    await assertEventClosed(a, "B");
    await assertFails(api.updateDoc(api.doc(a, "weddings/B"), { eventTitle: "Hijack", updatedAt: now() }));
    await assertFails(api.updateDoc(api.doc(a, "weddings/B/guests/g"), { fullName: "Hijack", updatedAt: now() }));
    // Neither do the customer's own claims or a card aimed at an admin record.
    const claimed = dbFor("customer-a", { admin: true, role: "admin", platformAdmin: true });
    await assertEventClosed(claimed, "B");
    await assertFails(api.getDocs(api.collection(claimed, "clients")));
  });
});

test("a multi-event customer reaches A and C but not B", { skip }, async () => {
  await withEnvironment("demo-isolation-multi", async ({ dbFor }) => {
    const multi = dbFor("multi");
    assert.deepEqual((await api.getDocs(api.collection(multi, "users/multi/weddingAccess"))).docs.map((row) => row.id).sort(), ["A", "C"]);
    for (const id of ["A", "C"]) {
      await assertSucceeds(api.getDoc(api.doc(multi, `weddings/${id}`)));
      await assertSucceeds(api.getDocs(api.collection(multi, `weddings/${id}/guests`)));
      await assertSucceeds(api.getDocs(api.collection(multi, `weddings/${id}/tables`)));
      await assertSucceeds(api.updateDoc(api.doc(multi, `weddings/${id}/guests/g`), { fullName: `Edited ${id}`, updatedAt: now() }));
      await assertSucceeds(put(multi, `weddings/${id}/customerAudit/mine`, { actorUid: "multi", actorEmail: "multi@example.test", action: "guest.update", targetType: "guest", targetId: "g", summary: "", createdAt: now() }));
    }
    await assertEventClosed(multi, "B");
    await assertFails(api.updateDoc(api.doc(multi, "weddings/B/guests/g"), { fullName: "Hijack", updatedAt: now() }));
    // Removal from one event leaves the other in place.
    const admin = dbFor("admin");
    await assertSucceeds(api.deleteDoc(api.doc(admin, "weddings/C/dashboardUsers/multi")));
    await assertEventClosed(multi, "C");
    await assertSucceeds(api.getDoc(api.doc(multi, "weddings/A")));
  });
});

// Found by this audit: rsvpStatus and additionalGuests on these two derivatives
// could be refreshed by any visitor who knew an event ID and a guest ID.
test("guest derivatives change only inside the RSVP batch that proves the invitation", { skip }, async () => {
  await withEnvironment("demo-isolation-mirror", async ({ env, dbFor }) => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await put(db, "weddings/B/guests/g", { ...guest, rsvpStatus: "confirmed" });
      await put(db, "weddings/B/checkinGuests/g", { guestId: "g", fullName: "Private Guest", phone: "", side: "bride", rsvpStatus: "pending", tableId: "", tableName: "", seatNumber: "", checkedIn: false, checkedInAt: null });
    });
    for (const db of [env.unauthenticatedContext().firestore(), dbFor("customer-a")]) {
      await assertFails(api.updateDoc(api.doc(db, "weddings/B/seatingGuests/g"), { rsvpStatus: "confirmed", updatedAt: now() }));
      await assertFails(api.updateDoc(api.doc(db, "weddings/B/checkinGuests/g"), { rsvpStatus: "confirmed", updatedAt: now() }));
    }
    const publicDb = env.unauthenticatedContext().firestore();
    const patch = { rsvpStatus: "declined", additionalGuests: 0, rsvpMessage: "Sorry", updatedAt: now() };
    const withoutInvitation = api.writeBatch(publicDb);
    withoutInvitation.update(api.doc(publicDb, "weddings/B/guests/g"), patch);
    withoutInvitation.update(api.doc(publicDb, "weddings/B/seatingGuests/g"), { rsvpStatus: "declined", additionalGuests: 0, updatedAt: now() });
    await assertFails(withoutInvitation.commit());
    const rsvp = api.writeBatch(publicDb);
    rsvp.update(api.doc(publicDb, `weddings/B/publicGuests/${TOKEN}`), patch);
    rsvp.update(api.doc(publicDb, "weddings/B/guests/g"), patch);
    rsvp.update(api.doc(publicDb, "weddings/B/seatingGuests/g"), { rsvpStatus: "declined", additionalGuests: 0, updatedAt: now() });
    rsvp.update(api.doc(publicDb, "weddings/B/checkinGuests/g"), { rsvpStatus: "declined", updatedAt: now() });
    await assertSucceeds(rsvp.commit());
  });
});

test("anonymous, signed-out and unlinked sessions get no more than a customer does", { skip }, async () => {
  await withEnvironment("demo-isolation-unlinked", async ({ env, dbFor }) => {
    const sessions = [env.unauthenticatedContext().firestore(), dbFor("stranger"), dbFor("guest-session", { firebase: { sign_in_provider: "anonymous" } })];
    for (const db of sessions) {
      await assertEventClosed(db, "A");
      await assertFails(api.getDocs(api.collection(db, "weddings")));
      await assertFails(api.getDocs(api.collection(db, "clients")));
      await assertFails(api.getDocs(api.collection(db, "customerDirectory")));
      await assertFails(api.getDocs(api.collectionGroup(db, "guests")));
      await assertFails(put(db, "weddings/rogue", { ...event, ownerUserId: "stranger" }));
    }
  });
});
