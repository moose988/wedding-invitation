import { readFile, writeFile, mkdir } from "node:fs/promises";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import * as api from "firebase/firestore";
import { customerMembership, discoveryData } from "../account-access.js";
import { seatingGuestData, checkinGuestData } from "../guest-edit.js";
import { buildInvitationProjection, generateInvitationToken } from "../invitations/shared/invitation-token.js";
import { generateTableChairs } from "../seating-utils.js";

if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099") throw new Error("Both loopback emulator endpoints must be explicitly selected. Production seeding is forbidden.");
const projectId = "demo-wedding-security";
process.argv.push("--fixtures");
await import("./seed-local-access.mjs");
const users = {};
for (const label of ["admin", "customer-a"]) {
  const response = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${label}@example.test`, password: "emulator-only", returnSecureToken: true }) }).then((result) => result.json());
  if (!response.localId) throw new Error("Synthetic emulator account was not available.");
  users[label] = response.localId;
}
const env = await initializeTestEnvironment({ projectId, firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") } });
const evidence = {};
try {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [eventId, title, count] of [["luxury-wedding-demo", "Layla & Zaid", 30], ["M1S1aBL9134GSAozWh6G", "Ali & Salma", 30], ["event-b", "Synthetic Generic Invitation", 30], ["large-event", "Synthetic 300 Guest Event", 300]]) {
      const ref = (...parts) => api.doc(db, "weddings", eventId, ...parts);
      const event = { ownerUserId: users.admin, eventTitle: title, coupleName: title, brideName: "Synthetic Bride", groomName: "Synthetic Groom", eventCategory: "wedding_engagement", eventDateISO: "2027-06-21T19:30:00.000Z", venueEn: "Synthetic Garden Hall", location: "Synthetic City", locationEn: "Synthetic City", mapsUrl: "", status: "active", seatingEnabled: true, showInvitationQr: true, seatingSchemaVersion: 2, hallObjects: [], schedule: [], invitationLanguage: "en", whatsAppCountryCode: "971" };
      await api.setDoc(ref(), event);
      for (const label of ["admin", "customer-a"]) {
        const uid = users[label], email = `${label}@example.test`;
        await api.setDoc(ref("dashboardUsers", uid), { ...customerMembership(uid, email, new Date()), ...(label === "admin" ? { role: "admin", canManageUsers: true, canCheckIn: true, allowedViews: ["overview", "guests", "seating", "settings", "exports", "share", "checkin"] } : {}) });
        await api.setDoc(api.doc(db, "users", uid, "weddingAccess", eventId), { ...discoveryData(eventId, event), updatedAt: new Date() });
      }
      const tables = [{ id: "browser-table", name: "Synthetic Table", capacity: 4 }, { id: "party-table", name: "Full Party Table", capacity: 11 }].map((table) => ({ ...table, shape: "round", x: table.id === "party-table" ? 65 : 25, y: 45, width: 180, height: 180, rotation: 0, seatCount: table.capacity, tableColor: "#f3ebdc", borderColor: "#bc9b61", chairColor: "#24554a", chairs: generateTableChairs("round", table.capacity, 180, 180, [], table.id).map(({ assignment, guestId, status, notes, vip, ...chair }) => chair) }));
      for (const table of tables) {
        await api.setDoc(ref("tables", table.id), table);
        for (const chair of table.chairs) await api.setDoc(ref("seatOccupancy", `${table.id}~${chair.id}`), { weddingId: eventId, tableId: table.id, chairId: chair.id, occupied: table.id === "party-table", updatedAt: new Date() });
      }
      for (let index = 0; index < count; index++) {
        const id = index === 0 ? "browser-guest" : index === 1 ? "legacy-guest" : index === 2 ? "full-party" : `synthetic-${String(index).padStart(3, "0")}`;
        const guest = { fullName: index === 0 ? "Synthetic Browser Guest" : index === 1 ? "Synthetic Legacy Guest" : index === 2 ? "Synthetic Eleven Person Party" : `Synthetic Guest ${String(index).padStart(3, "0")}`, phone: "440000000000", side: "bride", additionalGuests: index === 2 ? 10 : 1, additionalGuestAllowance: index === 2 ? 10 : 1, rsvpStatus: "confirmed", rsvpMessage: "Synthetic response", seatingAssignments: [], tableId: "", tableName: "", seatNumber: "", notes: "Private synthetic fixture note", checkedIn: index === 1, checkedInAt: index === 1 ? "Today, 8:12 PM" : null, inviteSentAt: null, reminderSentAt: null, ...(index === 1 ? { qrCodeValue: "Retired synthetic field", fullNameAr: "Legacy synthetic name", token: "retired synthetic value" } : {}) };
        if (index === 2) {
          for (let partyIndex = 0; partyIndex < 11; partyIndex++) {
            const table = tables[1], chair = table.chairs[partyIndex], personKey = partyIndex ? `guest-${partyIndex}` : "main";
            await api.setDoc(ref("seatAssignments", `${table.id}~${chair.id}`), { weddingId: eventId, guestId: id, tableId: table.id, chairId: chair.id, personKey, partyMemberIndex: partyIndex, side: "bride", seatNumber: partyIndex + 1, updatedAt: new Date() });
            await api.setDoc(ref("seatedPeople", `${id}~${personKey}`), { weddingId: eventId, guestId: id, tableId: table.id, chairId: chair.id, personKey, side: "bride", updatedAt: new Date() });
            guest.seatingAssignments.push({ tableId: table.id, tableName: table.name, seatNumber: String(partyIndex + 1), personKey, label: partyIndex ? `Additional guest ${partyIndex}` : "Main guest" });
          }
          guest.tableId = tables[1].id; guest.tableName = tables[1].name; guest.seatNumber = "1";
        }
        await api.setDoc(ref("guests", id), guest);
        await api.setDoc(ref("seatingGuests", id), seatingGuestData(guest));
        await api.setDoc(ref("checkinGuests", id), checkinGuestData(id, guest));
        if (index < 3 && eventId !== "large-event") {
          const token = generateInvitationToken();
          await api.setDoc(ref("invitationSecrets", id), { token, status: "active", purpose: "guest-invitation", version: 1, expiresAt: null, createdAt: new Date(), updatedAt: new Date() });
          await api.setDoc(ref("invitationTokens", token), { guestId: id, status: "active", purpose: "guest-invitation", version: 1, expiresAt: null, createdAt: new Date(), updatedAt: new Date() });
          // Deliberately start with an existing embedded-format invitation.
          await api.setDoc(ref("publicGuests", token), { ...buildInvitationProjection(eventId, event, guest, tables), rsvpStatus: guest.rsvpStatus, additionalGuests: guest.additionalGuests, rsvpMessage: guest.rsvpMessage, expiresAt: null, updatedAt: new Date() });
          evidence[`${eventId}/${id}`] = { eventId, guestId: id, token };
        }
      }
    }
  });
  await mkdir(".local-evidence", { recursive: true });
  await writeFile(".local-evidence/browser-fixtures.json", JSON.stringify(evidence));
  console.log("Seeded synthetic 30/300-guest events and existing invitations in the demo emulators only. Fixture capabilities are in ignored local evidence, never production.");
} finally { await env.cleanup(); }
