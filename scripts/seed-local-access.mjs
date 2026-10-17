import { readFile } from "node:fs/promises";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import * as fsdb from "firebase/firestore";
import { customerMembership, discoveryData } from "../account-access.js";
import { generateTableChairs } from "../seating-utils.js";

// Refuse to run unless both emulators are explicitly selected on loopback.
if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099") throw new Error("Set both loopback emulator variables explicitly. This script never targets production.");
const projectId = "demo-wedding-security";
const env = await initializeTestEnvironment({ projectId, firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") } });
const users = {};
for (const label of ["admin", "customer-a", "customer-b", "customer-c", "multi", "unassigned", "bride", "checkin"]) {
  const result = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${label}@example.test`, password: "emulator-only", returnSecureToken: true }) }).then((r) => r.json());
  if (!result.localId) {
    const existing = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${label}@example.test`, password: "emulator-only", returnSecureToken: true }) }).then((r) => r.json());
    if (!existing.localId) throw new Error(`Could not seed ${label}: ${result.error?.message}`);
    users[label] = existing.localId;
  } else users[label] = result.localId;
}
await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  await fsdb.setDoc(fsdb.doc(db, "platformAdmins", users.admin), { enabled: true });
  for (const [id, title] of [["luxury-wedding-demo", "Layla & Zaid"], ["event-b", "Synthetic Celebration"]]) {
    const event = { ownerUserId: users.admin, eventTitle: title, coupleName: title, brideName: "Layla", groomName: "Zaid", eventCategory: id === "event-b" ? "celebration" : "wedding_engagement", eventDateISO: "2027-05-20T18:00:00.000Z", venueEn: "Synthetic Garden Hall", location: "Synthetic City", mapsUrl: "", status: "active", seatingEnabled: true, showInvitationQr: true, seatingSchemaVersion: 2, hallObjects: [], schedule: [], whatsAppCountryCode: "971", invitationLanguage: "en" };
    await fsdb.setDoc(fsdb.doc(db, "weddings", id), event);
    await fsdb.setDoc(fsdb.doc(db, "weddings", id, "publicSummary", "summary"), { eventId: id, eventTitle: title, coupleName: title, eventCategory: event.eventCategory, seatingEnabled: true, seatingSchemaVersion: 2, stats: {}, updatedAt: new Date() });
    const labels = id === "event-b" ? ["admin", "customer-b", "multi"] : ["admin", "customer-a", "customer-c", "multi"];
    for (const label of labels) {
      const userId = users[label], email = `${label}@example.test`;
      const membership = customerMembership(userId, email, new Date());
      if (label === "admin") Object.assign(membership, { role: "admin", canManageUsers: true, canCheckIn: true, allowedViews: ["overview", "guests", "seating", "settings", "exports", "share", "checkin"] });
      await fsdb.setDoc(fsdb.doc(db, "weddings", id, "dashboardUsers", userId), membership);
      await fsdb.setDoc(fsdb.doc(db, "users", userId, "weddingAccess", id), { ...discoveryData(id, event), updatedAt: new Date() });
      if (label !== "admin") await fsdb.setDoc(fsdb.doc(db, "customerDirectory", userId), { userId, email, updatedAt: new Date() });
    }
  }
  for (const [label, membership] of [["bride", { role: "seating", seatingOnly: true, allowedSide: "bride", canViewDashboard: true, canEditSeating: true }], ["checkin", { canCheckIn: true, allowedSide: "all", canViewDashboard: false }]]) {
    await fsdb.setDoc(fsdb.doc(db, "weddings/luxury-wedding-demo/dashboardUsers", users[label]), { ...membership, userId: users[label] });
  }
  if (process.argv.includes("--fixtures")) {
    const guest = { fullName: "Synthetic Browser Guest", phone: "440000000000", side: "family", additionalGuests: 1, additionalGuestAllowance: 1, rsvpStatus: "confirmed", rsvpMessage: "", seatingAssignments: [], tableId: "", tableName: "", seatNumber: "", checkedIn: false, checkedInAt: null, notes: "Synthetic fixture", inviteSentAt: null, reminderSentAt: null, createdAt: new Date(), updatedAt: new Date() };
    await fsdb.setDoc(fsdb.doc(db, "weddings/luxury-wedding-demo/guests/browser-guest"), guest);
    await fsdb.setDoc(fsdb.doc(db, "weddings/luxury-wedding-demo/seatingGuests/browser-guest"), { fullName: guest.fullName, side: guest.side, additionalGuests: 1, rsvpStatus: "confirmed" });
    await fsdb.setDoc(fsdb.doc(db, "weddings/luxury-wedding-demo/checkinGuests/browser-guest"), { guestId: "browser-guest", fullName: guest.fullName, phone: guest.phone, side: guest.side, rsvpStatus: "confirmed", tableId: "", tableName: "", seatNumber: "", checkedIn: false, checkedInAt: null });
    const tableId = "browser-table";
    const chairs = generateTableChairs("round", 4, 180, 180, [], tableId).map(({ assignment, guestId, status, ...chair }) => chair);
    await fsdb.setDoc(fsdb.doc(db, "weddings/luxury-wedding-demo/tables", tableId), { id: tableId, name: "Synthetic Table", shape: "round", x: 20, y: 20, width: 180, height: 180, rotation: 0, capacity: 4, seatCount: 4, tableColor: "#f3ebdc", borderColor: "#bc9b61", chairColor: "#24554a", chairs, guestIds: [] });
    for (const chair of chairs) await fsdb.setDoc(fsdb.doc(db, "weddings/luxury-wedding-demo/seatOccupancy", `${tableId}~${chair.id}`), { weddingId: "luxury-wedding-demo", tableId, chairId: chair.id, occupied: false, updatedAt: new Date() });
  }
});
await env.cleanup();
console.log("Seeded synthetic administrator, shared/multiple/empty customers, and specialized roles in local emulators.");
