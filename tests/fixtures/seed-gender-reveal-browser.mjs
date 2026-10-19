import { readFile } from "node:fs/promises";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import * as firestore from "firebase/firestore";
import { customerMembership, discoveryData } from "../../account-access.js";
import { publicEventData } from "../../event-publishing.js";
import { genderRevealEmulatorFixture } from "./gender-reveal-event.mjs";

const projectId = process.env.GCLOUD_PROJECT || "";
const password = process.env.GENDER_REVEAL_TEST_PASSWORD || "";
if (projectId !== "demo-wedding-security" || process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099") {
  throw new Error("Refusing to seed. Start Auth and Firestore on 127.0.0.1 and set GCLOUD_PROJECT=demo-wedding-security.");
}
if (password.length < 8) throw new Error("Set a disposable GENDER_REVEAL_TEST_PASSWORD for the Auth emulator accounts.");

const authEndpoint = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts";
async function ensureEmulatorUser(label) {
  const email = `gr-${label}@example.test`;
  const body = JSON.stringify({ email, password, returnSecureToken: true });
  const request = (method) => fetch(`${authEndpoint}:${method}?key=demo-key`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body,
  }).then(async (response) => ({ ok: response.ok, data: await response.json() }));
  const created = await request("signUp");
  const account = created.ok ? created.data : (await request("signInWithPassword")).data;
  if (!account.localId) throw new Error(`Auth emulator did not create or find ${email}.`);
  return { uid: account.localId, email };
}

const [admin, customerA, customerA2, customerB] = await Promise.all([
  "admin", "customer-a", "customer-a2", "customer-b",
].map(ensureEmulatorUser));
const rules = await readFile(new URL("../../firestore.rules", import.meta.url), "utf8");
const env = await initializeTestEnvironment({ projectId, firestore: { rules } });
const timestamp = new Date();
const eventAId = "gr-browser-event-a";
const eventBId = "gr-browser-event-b";
const eventA = {
  ...genderRevealEmulatorFixture,
  ownerUserId: admin.uid,
  status: "active",
  guestGroupMode: "general",
  venueEn: "",
  location: "",
  mapsUrl: "",
  createdAt: timestamp,
  updatedAt: timestamp,
};
const eventB = {
  ownerUserId: admin.uid,
  eventCategory: "celebration",
  eventTitle: "Synthetic Celebration B",
  eventDateISO: "2027-06-01T14:00:00.000Z",
  eventTimeZone: "Asia/Dubai",
  venueEn: "Synthetic Hall B",
  location: "Synthetic City B",
  mapsUrl: "",
  status: "active",
  seatingEnabled: true,
  showInvitationQr: true,
  invitationLanguage: "en",
  guestGroupMode: "general",
  schedule: [],
  hallObjects: [],
  createdAt: timestamp,
  updatedAt: timestamp,
};

try {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await firestore.setDoc(firestore.doc(db, `platformAdmins/${admin.uid}`), { enabled: true });
    for (const [eventId, event, customers] of [
      [eventAId, eventA, [customerA, customerA2]],
      [eventBId, eventB, [customerB]],
    ]) {
      await firestore.setDoc(firestore.doc(db, `weddings/${eventId}`), event);
      await firestore.setDoc(firestore.doc(db, `weddings/${eventId}/publicEvent/details`), {
        ...publicEventData(event), updatedAt: timestamp,
      });
      await firestore.setDoc(firestore.doc(db, `weddings/${eventId}/publicSummary/summary`), {
        eventId, eventTitle: event.eventTitle, eventCategory: event.eventCategory,
        eventDateISO: event.eventDateISO, status: event.status, updatedAt: timestamp,
      });
      await firestore.setDoc(firestore.doc(db, `weddings/${eventId}/dashboardUsers/${admin.uid}`), {
        userId: admin.uid, email: admin.email, role: "owner", canViewDashboard: true,
        canEditGuests: true, canEditSeating: true, canEditEventDetails: true,
        canViewEventSettings: true, canExport: true, canCheckIn: true, canManageUsers: true,
        seatingOnly: false, allowedViews: ["overview", "guests", "seating", "share", "exports", "checkin", "settings"],
        createdAt: timestamp, updatedAt: timestamp,
      });
      await firestore.setDoc(firestore.doc(db, `users/${admin.uid}/weddingAccess/${eventId}`), {
        ...discoveryData(eventId, event), updatedAt: timestamp,
      });
      for (const customer of customers) {
        await firestore.setDoc(firestore.doc(db, `weddings/${eventId}/dashboardUsers/${customer.uid}`),
          customerMembership(customer.uid, customer.email, timestamp));
        await firestore.setDoc(firestore.doc(db, `users/${customer.uid}/weddingAccess/${eventId}`), {
          ...discoveryData(eventId, event), updatedAt: timestamp,
        });
        await firestore.setDoc(firestore.doc(db, `customerDirectory/${customer.uid}`), {
          userId: customer.uid, email: customer.email, updatedAt: timestamp,
        });
      }
    }
  });
} finally {
  await env.cleanup();
}

console.log(JSON.stringify({ projectId, eventAId, eventBId, admin: admin.email, customerA: customerA.email, customerA2: customerA2.email, customerB: customerB.email }));
