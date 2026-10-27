import { readFile, writeFile, mkdir } from "node:fs/promises";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import * as api from "firebase/firestore";
import { buildInvitationProjection, generateInvitationToken } from "../../invitations/shared/invitation-token.js";
import { generateTableChairs } from "../../seating-utils.js";

if (process.env.GCLOUD_PROJECT !== "demo-wedding-security" || process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080") {
  throw new Error("Refusing to seed the chair selector. Select only the demo-project Firestore emulator on 127.0.0.1:8080.");
}

const projectId = "demo-wedding-security";
const eventId = `layla-chair-selector-${Date.now()}`;
const output = new URL("../../.local-evidence/layla-chair-selector-fixtures.json", import.meta.url);
const env = await initializeTestEnvironment({ projectId, firestore: { rules: await readFile(new URL("../../firestore.rules", import.meta.url), "utf8") } });
const fixture = { eventId, invitations: {} };

const tables = [
  { id: "selector-east", name: "East Garden", capacity: 8, x: 24, y: 48 },
  { id: "selector-west", name: "West Terrace", capacity: 8, x: 74, y: 48 },
].map((table) => ({
  ...table,
  shape: "round",
  width: 180,
  height: 180,
  rotation: 0,
  seatCount: table.capacity,
  tableColor: "#f3ebdc",
  borderColor: "#bc9b61",
  chairColor: "#24554a",
  chairs: generateTableChairs("round", table.capacity, 180, 180, [], table.id),
}));

const event = {
  eventTitle: "Layla & Zaid",
  coupleName: "Layla & Zaid",
  brideName: "Layla",
  groomName: "Zaid",
  eventCategory: "wedding_engagement",
  eventDateISO: "2027-06-21T19:30:00.000Z",
  venueEn: "Synthetic Garden Hall",
  locationEn: "Synthetic City",
  mapsUrl: "",
  venueMapEmbedUrl: "https://www.google.com/maps/embed?pb=!1m0",
  status: "active",
  seatingEnabled: true,
  showInvitationQr: false,
  hallObjects: [],
  schedule: [],
};

const fixtureGuests = [
  { id: "party-1", size: 1, assignments: [[0, 1, 6]], name: "Single Guest" },
  { id: "party-3", size: 3, assignments: [[0, 0, 7], [1, 1, 2]], name: "Adel Younis with a Long Family Name" },
  { id: "party-11", size: 11, assignments: Array.from({ length: 10 }, (_, index) => [index, index < 5 ? 0 : 1, (index % 5) + 1]), name: "Maximum Party Guest" },
];

try {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const ref = (...parts) => api.doc(db, "weddings", eventId, ...parts);
    await api.setDoc(ref(), event);
    await api.setDoc(ref("publicEvent", "details"), { ...event, scheduleCount: 0 });

    for (const party of fixtureGuests) {
      const guestId = `guest-${party.id}`;
      const guest = {
        fullName: party.name,
        phone: "440000000000",
        side: "bride",
        additionalGuests: party.size - 1,
        additionalGuestAllowance: party.size - 1,
        rsvpStatus: "confirmed",
        rsvpMessage: "Synthetic seating fixture",
        seatingAssignments: party.assignments.map(([partyIndex, tableIndex, seatNumber]) => ({
          tableId: tables[tableIndex].id,
          tableName: tables[tableIndex].name,
          seatNumber: String(seatNumber),
          personKey: partyIndex === 0 ? "main" : `guest-${partyIndex}`,
          label: partyIndex === 0 ? "Main guest" : `Companion ${partyIndex}`,
        })),
        tableId: "",
        tableName: "",
        seatNumber: "",
      };
      const token = generateInvitationToken();
      const projection = buildInvitationProjection(eventId, event, guest, tables);
      await api.setDoc(ref("guests", guestId), guest);
      await api.setDoc(ref("invitationSecrets", guestId), { token, status: "active", purpose: "guest-invitation", version: 1, expiresAt: null });
      await api.setDoc(ref("seatingGuests", guestId), {
        fullName: guest.fullName,
        side: guest.side,
        additionalGuests: guest.additionalGuests,
        rsvpStatus: guest.rsvpStatus,
      });
      await api.setDoc(ref("checkinGuests", guestId), {
        guestId,
        fullName: guest.fullName,
        phone: guest.phone,
        side: guest.side,
        rsvpStatus: guest.rsvpStatus,
        tableId: "",
        tableName: "",
        seatNumber: "",
        checkedIn: false,
        checkedInAt: null,
      });
      await api.setDoc(ref("invitationTokens", token), {
        guestId,
        status: "active",
        purpose: "guest-invitation",
        version: 1,
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await api.setDoc(ref("publicGuests", token), {
        ...projection,
        rsvpStatus: guest.rsvpStatus,
        additionalGuests: guest.additionalGuests,
        rsvpMessage: guest.rsvpMessage,
        expiresAt: null,
        updatedAt: new Date(),
      });
      fixture.invitations[party.id] = { guestId, token, size: party.size };
    }
  });

  await mkdir(new URL("../../.local-evidence/", import.meta.url), { recursive: true });
  await writeFile(output, JSON.stringify(fixture, null, 2));
  console.log(`Seeded local-only invitation fixtures at ${output.pathname}`);
} finally {
  await env.cleanup();
}
