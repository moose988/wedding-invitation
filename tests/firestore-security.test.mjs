import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createInvitationTokenService } from "../invitations/shared/invitation-token-service.js";

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
      const legacyBrideGuest = guestData("bride");
      delete legacyBrideGuest.additionalGuestAllowance;
      await firestore.setDoc(firestore.doc(db, "weddings/event-a/guests/bride-2"), legacyBrideGuest);
      await firestore.setDoc(firestore.doc(db, "weddings/event-a/guests/groom-1"), guestData("groom"));
      await firestore.setDoc(firestore.doc(db, "weddings/event-a/tables/table-1"), {
        name: "Table 1", capacity: 8, seatCount: 8, x: 20, y: 20, width: 180, height: 180,
        shape: "round", chairs: [], guestIds: [], updatedAt: new Date(),
      });
      await firestore.setDoc(firestore.doc(db, "weddings/event-a/publicGuests/legacy-token"), {
        guestId: "bride-1", fullName: "Private name", phone: "private", guestToken: "legacy-token",
      });
      await firestore.setDoc(firestore.doc(db, "weddings/event-a/publicStats/summary"), { guestCount: 2 });
      const capability = "A".repeat(43);
      const capabilityExpiry = new Date("2020-01-01T00:00:00.000Z");
      await firestore.setDoc(firestore.doc(db, `weddings/event-a/invitationSecrets/bride-1`), {
        token: capability, status: "active", purpose: "guest-invitation", version: 1,
        expiresAt: capabilityExpiry, createdAt: new Date(), updatedAt: new Date(),
      });
      await firestore.setDoc(firestore.doc(db, `weddings/event-a/invitationTokens/${capability}`), {
        guestId: "bride-1", status: "active", purpose: "guest-invitation", version: 1,
        expiresAt: capabilityExpiry, createdAt: new Date(), updatedAt: new Date(),
      });
      await firestore.setDoc(firestore.doc(db, `weddings/event-a/publicGuests/${capability}`), {
        eventId: "event-a", wedding: { eventTitle: "event-a" },
        guest: { fullName: "bride guest", additionalGuestAllowance: 2 },
        rsvpStatus: "pending", additionalGuests: 1, rsvpMessage: "", expiresAt: capabilityExpiry, updatedAt: new Date(),
      });
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
    const validInvitationPath = "weddings/event-a/publicGuests/" + "A".repeat(43);
    await env.withSecurityRulesDisabled(async (context) => {
      await firestore.updateDoc(firestore.doc(context.firestore(), "weddings/event-a"), { status: "completed" });
    });
    await assertSucceeds(firestore.getDoc(firestore.doc(anonymous, validInvitationPath)));
    await assertFails(firestore.getDocs(firestore.collection(anonymous, "weddings/event-a/publicGuests")));
    await assertFails(firestore.getDoc(firestore.doc(anonymous, "weddings/event-b/publicGuests/" + "A".repeat(43))));
    await assertFails(firestore.updateDoc(firestore.doc(anonymous, validInvitationPath), {
      rsvpStatus: "confirmed", additionalGuests: 3, updatedAt: firestore.serverTimestamp(),
    }));
    const deniedStandaloneRsvp = firestore.writeBatch(anonymous);
    deniedStandaloneRsvp.update(firestore.doc(anonymous, validInvitationPath), {
      rsvpStatus: "confirmed", additionalGuests: 2, rsvpMessage: "Looking forward to it.",
      updatedAt: firestore.serverTimestamp(),
    });
    await assertFails(deniedStandaloneRsvp.commit());
    const rsvpBatch = firestore.writeBatch(anonymous);
    const rsvpPatch = {
      rsvpStatus: "confirmed", additionalGuests: 2, rsvpMessage: "Looking forward to it.",
      updatedAt: firestore.serverTimestamp(),
    };
    rsvpBatch.update(firestore.doc(anonymous, validInvitationPath), rsvpPatch);
    rsvpBatch.update(firestore.doc(anonymous, guestPath("event-a", "bride-1")), rsvpPatch);
    await assertSucceeds(rsvpBatch.commit());
    await assertFails(firestore.getDoc(firestore.doc(anonymous, guestPath("event-a", "bride-1"))));
    let persistedRsvp;
    await env.withSecurityRulesDisabled(async (context) => {
      persistedRsvp = await firestore.getDoc(firestore.doc(context.firestore(), validInvitationPath));
    });
    assert.equal(persistedRsvp.data().rsvpStatus, "confirmed");
    assert.equal(persistedRsvp.data().additionalGuests, 2);
    const owner = env.authenticatedContext("owner-a").firestore();
    const longLivedService = createInvitationTokenService({ db: owner, firestore });
    const longLivedScope = { uid: "owner-a", weddingId: "event-a", guestId: "bride-1", tables: [] };
    assert.equal(await longLivedService.ensure(longLivedScope), "A".repeat(43));
    let longLivedProjection;
    await env.withSecurityRulesDisabled(async (context) => {
      longLivedProjection = await firestore.getDoc(firestore.doc(context.firestore(), validInvitationPath));
    });
    assert.equal(longLivedProjection.data().expiresAt, null);
    assert.equal(longLivedProjection.data().rsvpStatus, "confirmed");
    await env.withSecurityRulesDisabled(async (context) => {
      await firestore.updateDoc(firestore.doc(context.firestore(), "weddings/event-a"), { status: "active" });
    });
    await assertFails(firestore.updateDoc(firestore.doc(anonymous, validInvitationPath), {
      phone: "971500000000", updatedAt: firestore.serverTimestamp(),
    }));
    await assertFails(firestore.updateDoc(firestore.doc(anonymous, validInvitationPath), {
      guest: firestore.deleteField(), updatedAt: firestore.serverTimestamp(),
    }));
    await assertFails(firestore.getDoc(firestore.doc(anonymous, "weddings/event-a/invitationSecrets/bride-1")));
    await assertFails(firestore.getDoc(firestore.doc(anonymous, "weddings/event-a/invitationTokens/" + "A".repeat(43))));
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
    await assertSucceeds(firestore.getDoc(firestore.doc(brideSeat, "weddings/event-a/invitationSecrets/bride-1")));
    await assertFails(firestore.getDoc(firestore.doc(brideSeat, "weddings/event-a/invitationSecrets/groom-1")));
    await assertFails(firestore.getDocs(firestore.collection(brideSeat, "weddings/event-a/invitationSecrets")));
    const brideInvitationService = createInvitationTokenService({ db: brideSeat, firestore });
    assert.equal(await brideInvitationService.ensure({ uid: "bride-seat-a", weddingId: "event-a", guestId: "bride-1", tables: [] }), "A".repeat(43));
    let restrictedTokenByte = 90;
    const restrictedIssueService = createInvitationTokenService({
      db: brideSeat,
      firestore,
      tokenFactory: () => Buffer.from(new Uint8Array(32).fill(++restrictedTokenByte)).toString("base64url"),
    });
    const restrictedToken = await restrictedIssueService.ensure({
      uid: "bride-seat-a", weddingId: "event-a", guestId: "bride-2",
      tables: Array.from({ length: 7 }, (_, tableIndex) => ({
        id: `table-${tableIndex + 1}`, name: `Table ${tableIndex + 1}`, shape: "round",
        x: 50, y: 50, width: 180, height: 180, rotation: 0, seatCount: 15,
        chairs: Array.from({ length: 15 }, (_, chairIndex) => ({
          id: `chair-${chairIndex + 1}`, seatNumber: chairIndex + 1, x: 50, y: 50, rotation: 0,
        })),
      })),
      wedding: {
        eventTitle: "event-a", eventCategory: "wedding_engagement", eventDateISO: "2027-05-20T18:00:00.000Z",
        hallObjects: Array.from({ length: 3 }, (_, index) => ({ id: `object-${index}`, type: "stage", label: "Stage" })),
        schedule: Array.from({ length: 5 }, (_, index) => ({ titleEn: `Schedule ${index}`, timeEn: "18:00" })),
      },
    });
    const restrictedInvitation = await firestore.getDoc(firestore.doc(anonymous, `weddings/event-a/publicGuests/${restrictedToken}`));
    assert.equal(restrictedInvitation.data().guest.additionalGuestAllowance, 1);
    await assert.rejects(
      brideInvitationService.ensure({ uid: "bride-seat-a", weddingId: "event-a", guestId: "groom-1", tables: [] }),
      /permission-denied|Missing or insufficient permissions/i,
    );
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
    const issuedToken = "B".repeat(43);
    const expiry = new Date("2027-08-18T18:00:00.000Z");
    const issueBatch = firestore.writeBatch(owner);
    issueBatch.set(firestore.doc(owner, `weddings/event-a/invitationSecrets/groom-1`), {
      token: issuedToken, status: "active", purpose: "guest-invitation", version: 1,
      expiresAt: expiry, createdAt: firestore.serverTimestamp(), updatedAt: firestore.serverTimestamp(),
    });
    issueBatch.set(firestore.doc(owner, `weddings/event-a/invitationTokens/${issuedToken}`), {
      guestId: "groom-1", status: "active", purpose: "guest-invitation", version: 1,
      expiresAt: expiry, createdAt: firestore.serverTimestamp(), updatedAt: firestore.serverTimestamp(),
    });
    issueBatch.set(firestore.doc(owner, `weddings/event-a/publicGuests/${issuedToken}`), {
      eventId: "event-a", wedding: { eventTitle: "event-a" },
      guest: {
        fullName: "groom guest", additionalGuestAllowance: 2, seatingAssignments: [],
        tableId: "", tableName: "", seatNumber: "",
      },
      rsvpStatus: "pending", additionalGuests: 1, rsvpMessage: "", expiresAt: expiry,
      updatedAt: firestore.serverTimestamp(),
    });
    await assertSucceeds(issueBatch.commit());
    const issuedPublic = await firestore.getDoc(firestore.doc(anonymous, `weddings/event-a/publicGuests/${issuedToken}`));
    assert.equal(issuedPublic.data().guest.fullName, "groom guest");
    assert.equal(Object.hasOwn(issuedPublic.data(), "phone"), false);
    assert.equal(Object.hasOwn(issuedPublic.data(), "guestId"), false);

    let tokenByte = 0;
    const tokenFactory = () => {
      const bytes = new Uint8Array(32);
      bytes.fill(++tokenByte);
      return Buffer.from(bytes).toString("base64url");
    };
    const serviceA = createInvitationTokenService({ db: owner, firestore, tokenFactory });
    const serviceB = createInvitationTokenService({ db: owner, firestore, tokenFactory });
    const issueScope = { uid: "owner-a", weddingId: "event-a", guestId: "bride-1", tables: [] };
    const [firstToken, concurrentToken] = await Promise.all([
      serviceA.ensure(issueScope), serviceB.ensure(issueScope),
    ]);
    assert.equal(firstToken, concurrentToken);
    assert.equal(firstToken.length, 43);
    assert.equal(await serviceA.ensure(issueScope), firstToken);
    await serviceA.revoke(issueScope);
    await assert.rejects(serviceA.ensure(issueScope), /unavailable/i);
    const regenRequestId = "request-identifier-0001";
    const regeneratedToken = await serviceA.regenerate(issueScope, regenRequestId);
    assert.notEqual(regeneratedToken, firstToken);
    assert.equal(await serviceA.regenerate(issueScope, regenRequestId), regeneratedToken);
    await assertFails(firestore.getDoc(firestore.doc(anonymous, `weddings/event-a/publicGuests/${firstToken}`)));
    await assertSucceeds(firestore.getDoc(firestore.doc(anonymous, `weddings/event-a/publicGuests/${regeneratedToken}`)));
    const copiedInvitationUrl = new URL("index.html", "http://127.0.0.1:8000/dashboard.html?wedding=event-a");
    copiedInvitationUrl.searchParams.set("wedding", "event-a");
    copiedInvitationUrl.hash = new URLSearchParams({ guest: regeneratedToken, recipient: "bride-1" }).toString();
    assert.match(copiedInvitationUrl.href, /wedding=event-a#guest=[A-Za-z0-9_-]{43}&recipient=bride-1$/);
    const pastedUrl = new URL(copiedInvitationUrl.href);
    const pastedToken = new URLSearchParams(pastedUrl.hash.slice(1)).get("guest");
    assert.equal(pastedUrl.searchParams.get("wedding"), "event-a");
    assert.equal(pastedToken, regeneratedToken);
    const openedInvitation = await firestore.getDoc(firestore.doc(anonymous, `weddings/event-a/publicGuests/${pastedToken}`));
    assert.equal(openedInvitation.data().eventId, "event-a");
    assert.equal(openedInvitation.data().guest.fullName, "Updated bride guest");
  } finally {
    await env.cleanup();
  }
});
