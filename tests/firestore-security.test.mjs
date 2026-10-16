import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

test("Firestore rules enforce event, guest, seating, invitation, and check-in boundaries", {
  skip: emulatorAvailable ? false : "Run with the Firestore Emulator to verify security rules.",
}, async () => {
  const [{ assertFails, assertSucceeds, initializeTestEnvironment }, firestore] = await Promise.all([
    import("@firebase/rules-unit-testing"),
    import("firebase/firestore"),
  ]);
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  const env = await initializeTestEnvironment({ projectId: "demo-wedding-security", firestore: { rules } });
  const guestData = (side) => ({
    fullName: `${side} guest`, phone: "", side, additionalGuests: 1, additionalGuestAllowance: 2,
    rsvpStatus: "pending", rsvpMessage: "", tableId: "", tableName: "", seatNumber: "",
    seatingAssignments: [], checkedIn: false, checkedInAt: null, notes: "",
    inviteSentAt: null, reminderSentAt: null, createdAt: new Date(), updatedAt: new Date(),
  });
  const guestPath = (eventId, id) => `weddings/${eventId}/guests/${id}`;
  const tablePath = (eventId, id) => `weddings/${eventId}/tables/${id}`;

  try {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      for (const eventId of ["event-a", "event-b"]) {
        await firestore.setDoc(firestore.doc(db, `weddings/${eventId}`), {
          ownerUserId: eventId === "event-a" ? "owner-a" : "owner-b",
          eventCategory: "wedding_engagement", eventTitle: eventId, status: "active",
          eventDateISO: "2027-05-20T18:00:00.000Z", venueEn: "Test venue",
        });
        await firestore.setDoc(firestore.doc(db, `weddings/${eventId}/publicSummary/summary`), { eventTitle: eventId });
      }
      for (const [uid, permissions] of [
        ["owner-a", { canViewDashboard: true, canManageUsers: true, canEditGuests: true, canEditSeating: true, canManageSeatingLayout: true, canCheckIn: true, allowedSide: "all" }],
        ["guest-editor-a", { canViewDashboard: true, canEditGuests: true }],
        ["bride-seat-a", { canViewDashboard: true, canEditGuests: true, canEditSeating: true, canManageSeatingLayout: true, seatingOnly: true, allowedSide: "bride" }],
        ["groom-checkin-a", { canCheckIn: true, allowedSide: "groom" }],
      ]) {
        await firestore.setDoc(firestore.doc(db, `weddings/event-a/dashboardUsers/${uid}`), { ...permissions, userId: uid });
      }
      await firestore.setDoc(firestore.doc(db, "weddings/event-a/guests/bride-1"), guestData("bride"));
      await firestore.setDoc(firestore.doc(db, "weddings/event-a/guests/groom-1"), guestData("groom"));
      await firestore.setDoc(firestore.doc(db, "weddings/event-a/tables/table-1"), {
        name: "Table 1", capacity: 8, seatCount: 8, x: 20, y: 20, width: 180, height: 180,
        shape: "round", chairs: [], guestIds: [], updatedAt: new Date(),
      });
      await firestore.setDoc(firestore.doc(db, "weddings/event-a/publicGuests/legacy-token"), {
        guestId: "bride-1", fullName: "Private name", phone: "private", guestToken: "legacy-token",
      });
      await firestore.setDoc(firestore.doc(db, "weddings/event-a/publicStats/summary"), { guestCount: 2 });
      await firestore.setDoc(firestore.doc(db, "invitationAccessTokens/hash"), { weddingId: "event-a", guestId: "bride-1" });
      await firestore.setDoc(firestore.doc(db, "senderSessions/hash"), {
        weddingId: "event-a", purpose: "whatsapp-sender", guestIds: ["bride-1"], status: "active",
      });
    });

    const anonymous = env.unauthenticatedContext().firestore();
    await assertFails(firestore.getDoc(firestore.doc(anonymous, "weddings/event-a")));
    await assertFails(firestore.getDoc(firestore.doc(anonymous, guestPath("event-a", "bride-1"))));
    await assertFails(firestore.getDocs(firestore.collection(anonymous, "weddings/event-a/guests")));
    await assertFails(firestore.getDoc(firestore.doc(anonymous, tablePath("event-a", "table-1"))));
    await assertFails(firestore.getDoc(firestore.doc(anonymous, "weddings/event-a/publicGuests/legacy-token")));
    await assertFails(firestore.getDoc(firestore.doc(anonymous, "weddings/event-a/publicStats/summary")));
    await assertFails(firestore.getDoc(firestore.doc(anonymous, "invitationAccessTokens/hash")));
    await assertFails(firestore.getDoc(firestore.doc(anonymous, "senderSessions/hash")));
    await assertFails(firestore.setDoc(firestore.doc(anonymous, "senderSessions/forged"), { purpose: "whatsapp-sender" }));
    await assertSucceeds(firestore.getDoc(firestore.doc(anonymous, "weddings/event-a/publicSummary/summary")));

    const eventAEditor = env.authenticatedContext("guest-editor-a").firestore();
    await assertSucceeds(firestore.getDoc(firestore.doc(eventAEditor, guestPath("event-a", "bride-1"))));
    await assertFails(firestore.getDoc(firestore.doc(eventAEditor, "weddings/event-b")));
    await assertFails(firestore.getDoc(firestore.doc(eventAEditor, guestPath("event-b", "bride-1"))));
    await assertFails(firestore.updateDoc(firestore.doc(eventAEditor, guestPath("event-a", "bride-1")), { guestToken: "forged" }));
    await assertFails(firestore.updateDoc(firestore.doc(eventAEditor, guestPath("event-a", "bride-1")), { ownerUserId: "attacker" }));
    await assertFails(firestore.updateDoc(firestore.doc(eventAEditor, guestPath("event-a", "bride-1")), { side: firestore.deleteField() }));
    await assertFails(firestore.updateDoc(firestore.doc(eventAEditor, "weddings/event-a"), {
      ownerUserId: firestore.deleteField(), updatedAt: firestore.serverTimestamp(),
    }));
    await assertFails(firestore.deleteDoc(firestore.doc(eventAEditor, "weddings/event-a")));

    const brideSeat = env.authenticatedContext("bride-seat-a").firestore();
    await assertSucceeds(firestore.getDoc(firestore.doc(brideSeat, guestPath("event-a", "bride-1"))));
    await assertFails(firestore.getDoc(firestore.doc(brideSeat, guestPath("event-a", "groom-1"))));
    await assertFails(firestore.getDoc(firestore.doc(brideSeat, tablePath("event-a", "table-1"))));
    await assertFails(firestore.updateDoc(firestore.doc(brideSeat, guestPath("event-a", "bride-1")), {
      rsvpStatus: "confirmed", updatedAt: firestore.serverTimestamp(),
    }));
    await assertFails(firestore.updateDoc(firestore.doc(brideSeat, guestPath("event-a", "bride-1")), {
      phone: "971500000000", updatedAt: firestore.serverTimestamp(),
    }));
    await assertFails(firestore.updateDoc(firestore.doc(brideSeat, guestPath("event-a", "groom-1")), {
      tableId: "table-1", updatedAt: firestore.serverTimestamp(),
    }));
    await assertFails(firestore.updateDoc(firestore.doc(brideSeat, tablePath("event-a", "table-1")), {
      chairs: [{ guestId: "groom-1" }], guestIds: ["groom-1"], updatedAt: firestore.serverTimestamp(),
    }));

    const groomCheckin = env.authenticatedContext("groom-checkin-a").firestore();
    await assertFails(firestore.getDoc(firestore.doc(groomCheckin, guestPath("event-a", "groom-1"))));
    await assertFails(firestore.getDocs(firestore.collection(groomCheckin, "weddings/event-a/guests")));
    await assertFails(firestore.getDoc(firestore.doc(groomCheckin, guestPath("event-a", "bride-1"))));
    await assertFails(firestore.getDoc(firestore.doc(groomCheckin, "weddings/event-a")));
    await assertSucceeds(firestore.updateDoc(firestore.doc(groomCheckin, guestPath("event-a", "groom-1")), {
      checkedIn: true, checkedInAt: firestore.serverTimestamp(), updatedAt: firestore.serverTimestamp(),
    }));
    await assertFails(firestore.updateDoc(firestore.doc(groomCheckin, guestPath("event-a", "groom-1")), {
      rsvpStatus: "confirmed", updatedAt: firestore.serverTimestamp(),
    }));

    const owner = env.authenticatedContext("owner-a").firestore();
    await assertSucceeds(firestore.getDoc(firestore.doc(owner, "weddings/event-a")));
    await assertSucceeds(firestore.updateDoc(firestore.doc(owner, guestPath("event-a", "bride-1")), {
      fullName: "Updated bride guest", updatedAt: firestore.serverTimestamp(),
    }));
    await assertSucceeds(firestore.setDoc(firestore.doc(owner, guestPath("event-a", "new-guest")), {
      ...guestData("family"), fullName: "New guest",
      createdAt: firestore.serverTimestamp(), updatedAt: firestore.serverTimestamp(),
    }));
    await assertFails(firestore.updateDoc(firestore.doc(owner, guestPath("event-a", "bride-1")), {
      inventedProtectedValue: true, updatedAt: firestore.serverTimestamp(),
    }));
    await assertSucceeds(firestore.updateDoc(firestore.doc(owner, guestPath("event-a", "bride-1")), {
      rsvpMessage: firestore.deleteField(), updatedAt: firestore.serverTimestamp(),
    }));
    await assertFails(firestore.updateDoc(firestore.doc(owner, guestPath("event-a", "bride-1")), {
      side: firestore.deleteField(), updatedAt: firestore.serverTimestamp(),
    }));
    const persistedGuest = await firestore.getDoc(firestore.doc(owner, guestPath("event-a", "bride-1")));
    assert.equal(persistedGuest.data().fullName, "Updated bride guest");
    assert.equal(Object.hasOwn(persistedGuest.data(), "inventedProtectedValue"), false);
    assert.equal(Object.hasOwn(persistedGuest.data(), "rsvpMessage"), false);
    assert.equal(persistedGuest.data().side, "bride");
    await assertSucceeds(firestore.updateDoc(firestore.doc(owner, tablePath("event-a", "table-1")), {
      chairs: [], guestIds: [], updatedAt: firestore.serverTimestamp(),
    }));
    await assertFails(firestore.deleteDoc(firestore.doc(owner, "weddings/event-a")));
    await assertFails(firestore.setDoc(firestore.doc(owner, "weddings/event-a/publicGuests/new-token"), {
      guestToken: "new-token", guestId: "bride-1",
    }));
  } finally {
    await env.cleanup();
  }
});
