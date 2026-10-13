import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

test("Event Settings Firestore rules authorize only owners and explicit editors, including legacy saves", {
  skip: emulatorAvailable ? false : "Run with the Firestore Emulator to verify security rules.",
}, async () => {
  const [{ assertFails, assertSucceeds, initializeTestEnvironment }, firestore] = await Promise.all([
    import("@firebase/rules-unit-testing"),
    import("firebase/firestore"),
  ]);
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  const env = await initializeTestEnvironment({
    projectId: "demo-event-settings",
    firestore: { rules },
  });

  const weddingPath = (id) => `weddings/${id}`;
  const memberPath = (weddingId, uid) => `weddings/${weddingId}/dashboardUsers/${uid}`;
  const indexPath = (uid, weddingId) => `users/${uid}/weddingAccess/${weddingId}`;
  const eventData = {
    eventTitle: "Legacy event",
    eventDateISO: "2027-05-20T18:00:00.000Z",
    venueEn: "Garden Hall",
    mapsUrl: "",
    venueMapEmbedUrl: "https://www.google.com/maps/embed?pb=sample",
    schedule: [],
    updatedAt: new Date(),
  };

  try {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      // This legacy wedding intentionally has no schedule or embed URL.
      await firestore.setDoc(firestore.doc(db, weddingPath("owner-event")), {
        ownerUserId: "owner-1",
        eventCategory: "wedding_engagement",
        eventTitle: "Legacy event",
        eventDateISO: "2027-05-20T18:00:00.000Z",
        venueEn: "Old Hall",
        status: "upcoming",
      });
      for (const [weddingId, uid, permissions] of [
        ["editor-event", "editor-1", { canViewDashboard: true, canEditEventDetails: true }],
        ["seating-event", "seating-1", { canViewDashboard: true, canEditEventDetails: true, canEditSeating: true, seatingOnly: true }],
        ["guest-event", "guest-1", { canViewDashboard: true, canEditGuests: true }],
      ]) {
        await firestore.setDoc(firestore.doc(db, weddingPath(weddingId)), {
          ownerUserId: "owner-1",
          eventCategory: "wedding_engagement",
          eventTitle: "Legacy event",
          eventDateISO: "2027-05-20T18:00:00.000Z",
          venueEn: "Old Hall",
          status: "upcoming",
        });
        await firestore.setDoc(firestore.doc(db, memberPath(weddingId, uid)), permissions);
      }
    });

    const saveAsBatch = async (uid, weddingId, payload = eventData) => {
      const db = env.authenticatedContext(uid).firestore();
      const batch = firestore.writeBatch(db);
      batch.update(firestore.doc(db, weddingPath(weddingId)), payload);
      batch.set(firestore.doc(db, indexPath(uid, weddingId)), {
        weddingId,
        eventTitle: payload.eventTitle,
        venueEn: payload.venueEn,
        updatedAt: payload.updatedAt,
      }, { merge: true });
      return batch.commit();
    };

    // Owner has no workspace index yet; the batch must create it atomically.
    await assertSucceeds(saveAsBatch("owner-1", "owner-event"));
    await assertSucceeds(saveAsBatch("editor-1", "editor-event"));
    await assertFails(saveAsBatch("seating-1", "seating-event"));
    await assertFails(saveAsBatch("guest-1", "guest-event"));

    await assertFails(saveAsBatch("owner-1", "owner-event", {
      ...eventData,
      venueMapEmbedUrl: "https://maps.google.com/not-an-embed",
    }));
    await assertFails(saveAsBatch("owner-1", "owner-event", {
      ...eventData,
      schedule: Array.from({ length: 13 }, (_, index) => ({ titleEn: `Item ${index}` })),
    }));
  } finally {
    await env.cleanup();
  }
});
