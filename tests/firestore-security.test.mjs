import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createInvitationTokenService } from "../invitations/shared/invitation-token-service.js";
import { migrateLegacySeating, mutateSeating } from "../seating-firestore.js";

const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

const event = (ownerUserId, eventTitle = "Test event") => ({
  ownerUserId, eventTitle, eventCategory: "wedding_engagement", status: "active",
  eventDateISO: "2027-05-20T18:00:00.000Z", venueEn: "Test venue",
  seatingEnabled: true, seatingSchemaVersion: 2,
});

const membership = (userId, overrides = {}) => ({
  userId, email: `${userId}@example.test`, role: "member",
  canViewDashboard: false, canEditGuests: false, canEditSeating: false,
  canCheckIn: false, canManageUsers: false, canEditEventDetails: false,
  seatingOnly: false, allowedSide: "all", ...overrides,
});

const guest = (id, side) => ({
  fullName: `${id} Guest`, phone: "971500000001", side,
  additionalGuests: 1, additionalGuestAllowance: 2, rsvpStatus: "pending", rsvpMessage: "",
  tableId: "", tableName: "", seatNumber: "", seatingAssignments: [],
  checkedIn: false, checkedInAt: null, notes: "private organizer note",
  inviteSentAt: null, reminderSentAt: null,
});

const seatingGuest = (id, side) => ({ fullName: `${id} Guest`, side, additionalGuests: 1, rsvpStatus: "pending" });

const checkinGuest = (id, side) => ({
  guestId: id, fullName: `${id} Guest`, phone: "971500000001", side,
  rsvpStatus: "pending", tableId: "", tableName: "", seatNumber: "",
  checkedIn: false, checkedInAt: null,
});

test("Spark Firestore rules and direct client workflows enforce event, seating, RSVP, sender, and check-in boundaries", {
  skip: emulatorAvailable ? false : "Run with the Firestore Emulator to verify security rules.",
}, async () => {
  const [{ assertFails, assertSucceeds, initializeTestEnvironment }, firestore] = await Promise.all([
    import("@firebase/rules-unit-testing"), import("firebase/firestore"),
  ]);
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  const env = await initializeTestEnvironment({ projectId: "demo-wedding-rules", firestore: { rules } });
  await env.clearFirestore();
  const api = {
    doc: firestore.doc, runTransaction: firestore.runTransaction,
    serverTimestamp: firestore.serverTimestamp,
  };

  try {
    // The owner can create the event and its own authoritative membership in
    // one batch. No self-promotion write is required after event creation.
    await env.withSecurityRulesDisabled((context) => firestore.setDoc(firestore.doc(context.firestore(), "platformAdmins/owner-a"), { enabled: true }));
    const ownerBootstrap = env.authenticatedContext("owner-a").firestore();
    const bootstrap = firestore.writeBatch(ownerBootstrap);
    bootstrap.set(firestore.doc(ownerBootstrap, "weddings/event-a"), event("owner-a", "A & B"));
    bootstrap.set(firestore.doc(ownerBootstrap, "weddings/event-a/dashboardUsers/owner-a"), {
      ...membership("owner-a", {
        canViewDashboard: true, canEditGuests: true, canEditSeating: true,
        canCheckIn: true, canManageUsers: true, canEditEventDetails: true,
      }),
      createdAt: firestore.serverTimestamp(), updatedAt: firestore.serverTimestamp(),
    });
    await assertSucceeds(bootstrap.commit());
    await assertSucceeds(firestore.getDoc(firestore.doc(ownerBootstrap, "weddings/event-a")));

    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await firestore.setDoc(firestore.doc(db, "weddings/event-b"), event("owner-b", "Other event"));
      await firestore.setDoc(firestore.doc(db, "weddings/event-a/publicSummary/summary"), {
        eventId: "event-a", eventTitle: "A & B", coupleName: "A & B", eventCategory: "wedding_engagement",
        seatingEnabled: true, seatingSchemaVersion: 2, stats: { total: 3, bride: 2, groom: 1 }, updatedAt: new Date(),
      });
      await firestore.setDoc(firestore.doc(db, "weddings/event-a/publicStats/summary"), {
        eventId: "event-a", eventCategory: "wedding_engagement", stats: { total: 3 }, updatedAt: new Date(),
      });
      for (const [uid, role] of [
        ["bride-a", membership("bride-a", { canViewDashboard: true, canEditSeating: true, seatingOnly: true, allowedSide: "bride" })],
        ["bride-b", membership("bride-b", { canViewDashboard: true, canEditSeating: true, seatingOnly: true, allowedSide: "bride" })],
        ["groom-seat", membership("groom-seat", { canViewDashboard: true, canEditSeating: true, seatingOnly: true, allowedSide: "groom" })],
        ["groom-checkin", membership("groom-checkin", { canCheckIn: true, allowedSide: "groom" })],
        ["guest-editor", membership("guest-editor", { canViewDashboard: true, canEditGuests: true })],
      ]) await firestore.setDoc(firestore.doc(db, `weddings/event-a/dashboardUsers/${uid}`), role);

      for (const [id, side] of [["bride-1", "bride"], ["bride-2", "bride"], ["groom-1", "groom"]]) {
        await firestore.setDoc(firestore.doc(db, `weddings/event-a/guests/${id}`), {
          ...guest(id, side), createdAt: new Date(), updatedAt: new Date(),
        });
        await firestore.setDoc(firestore.doc(db, `weddings/event-a/seatingGuests/${id}`), seatingGuest(id, side));
        await firestore.setDoc(firestore.doc(db, `weddings/event-a/checkinGuests/${id}`), checkinGuest(id, side));
      }
      await firestore.setDoc(firestore.doc(db, "weddings/event-a/tables/table-1"), {
        name: "Table 1", capacity: 3, seatCount: 3, x: 20, y: 20, width: 180, height: 180,
        shape: "round", chairs: [
          { id: "chair-1", seatNumber: 1, x: 25, y: 25 },
          { id: "chair-2", seatNumber: 2, x: 75, y: 25 },
          { id: "chair-3", seatNumber: 3, x: 75, y: 75 },
        ], updatedAt: new Date(),
      });
      for (const chairId of ["chair-1", "chair-2", "chair-3"]) {
        await firestore.setDoc(firestore.doc(db, `weddings/event-a/seatOccupancy/table-1~${chairId}`), {
          weddingId: "event-a", tableId: "table-1", chairId, occupied: false, updatedAt: new Date(),
        });
      }
    });

    const limitedMemberRef = firestore.doc(ownerBootstrap, "weddings/event-a/dashboardUsers/guest-editor");
    const limitedMembership = membership("guest-editor", {
      canViewDashboard: true,
      canEditGuests: true,
      canEditSeating: true,
      canEditEventDetails: true,
      canViewEventSettings: true,
      canExport: true,
      allowedViews: ["overview", "guests", "seating", "settings", "exports"],
      allowedSide: "all",
    });
    await assertSucceeds(firestore.setDoc(limitedMemberRef, {
      ...limitedMembership,
      updatedAt: firestore.serverTimestamp(),
    }));
    const limitedAccount = env.authenticatedContext("guest-editor").firestore();
    const limitedSnapshot = await assertSucceeds(firestore.getDoc(
      firestore.doc(limitedAccount, "weddings/event-a/dashboardUsers/guest-editor"),
    ));
    assert.deepEqual(limitedSnapshot.data().allowedViews, ["overview", "guests", "seating", "settings", "exports"]);
    await assertFails(firestore.updateDoc(
      firestore.doc(env.authenticatedContext("bride-a").firestore(), "weddings/event-a/dashboardUsers/guest-editor"),
      { canExport: false, updatedAt: firestore.serverTimestamp() },
    ));
    await assertFails(firestore.setDoc(limitedMemberRef, {
      ...limitedMembership,
      allowedViews: ["billing"],
      updatedAt: firestore.serverTimestamp(),
    }));

    const brideA = env.authenticatedContext("bride-a").firestore();
    const brideB = env.authenticatedContext("bride-b").firestore();
    const groomSeat = env.authenticatedContext("groom-seat").firestore();
    const checkin = env.authenticatedContext("groom-checkin").firestore();
    const anonymous = env.unauthenticatedContext().firestore();

    await assertSucceeds(firestore.getDoc(firestore.doc(brideA, "weddings/event-a/dashboardUsers/bride-a")));
    await assertFails(firestore.getDoc(firestore.doc(brideA, "weddings/event-a")));
    await assertFails(firestore.getDoc(firestore.doc(brideA, "weddings/event-b")));
    await assertFails(firestore.getDoc(firestore.doc(brideA, "weddings/event-a/guests/bride-1")));
    await assertSucceeds(firestore.getDoc(firestore.doc(brideA, "weddings/event-a/seatingGuests/bride-1")));
    await assertFails(firestore.getDoc(firestore.doc(brideA, "weddings/event-a/seatingGuests/groom-1")));
    await assertFails(firestore.getDocs(firestore.query(
      firestore.collection(brideA, "weddings/event-a/seatingGuests"), firestore.where("side", "==", "groom"),
    )));
    await assertSucceeds(firestore.getDoc(firestore.doc(brideA, "weddings/event-a/seatAssignments/table-1~chair-1")));
    await assertFails(firestore.setDoc(firestore.doc(brideA, "weddings/event-a/dashboardUsers/bride-a"), {
      ...membership("bride-a", { canViewDashboard: true, canManageUsers: true, seatingOnly: true, allowedSide: "all" }),
    }));

    // Simultaneous clients compete for the same chair. Transaction conflict
    // retries plus deterministic seat/person documents allow only one winner.
    const assignment = (db, uid, guestId, chairId = "chair-1", partyMemberIndex = 0) => mutateSeating({
      api, db, uid, weddingId: "event-a", permission: { canEditSeating: true, allowedSide: "bride" },
      type: "assign", source: { guestId, partyMemberIndex },
      destination: { tableId: "table-1", chairId },
    });
    const raced = await Promise.allSettled([
      assignment(brideA, "bride-a", "bride-1"), assignment(brideB, "bride-b", "bride-2"),
    ]);
    assert.equal(raced.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(raced.filter((result) => result.status === "rejected").length, 1);
    const occupiedSeat = await firestore.getDoc(firestore.doc(brideA, "weddings/event-a/seatAssignments/table-1~chair-1"));
    assert.ok(["bride-1", "bride-2"].includes(occupiedSeat.data().guestId));
    await assert.rejects(assignment(groomSeat, "groom-seat", "bride-1", "chair-2"), /other side|permissions|denied|unavailable/i);

    // Additional guests obey the RSVP party size. Exercise assign, move, swap,
    // and unassign against the same canonical seat/person records.
    await assignment(brideA, "bride-a", occupiedSeat.data().guestId, "chair-2", 1);
    await mutateSeating({ api, db: brideA, uid: "bride-a", weddingId: "event-a",
      permission: { canEditSeating: true, allowedSide: "bride" }, type: "move",
      source: { tableId: "table-1", chairId: "chair-2" },
      destination: { tableId: "table-1", chairId: "chair-3" } });
    await mutateSeating({ api, db: brideA, uid: "bride-a", weddingId: "event-a",
      permission: { canEditSeating: true, allowedSide: "bride" }, type: "swap",
      source: { tableId: "table-1", chairId: "chair-1" },
      destination: { tableId: "table-1", chairId: "chair-3" } });
    await mutateSeating({ api, db: brideA, uid: "bride-a", weddingId: "event-a",
      permission: { canEditSeating: true, allowedSide: "bride" }, type: "unassign",
      source: { tableId: "table-1", chairId: "chair-1" } });
    const clearedChair = await firestore.getDoc(firestore.doc(brideA, "weddings/event-a/seatAssignments/table-1~chair-1"));
    assert.equal(clearedChair.exists(), false);
    assert.equal((await firestore.getDoc(firestore.doc(brideA, "weddings/event-a/seatOccupancy/table-1~chair-1"))).data().occupied, false);

    // A legacy layout assignment can be migrated by the event owner once; its
    // table/chair identity survives and its nested mirrors are then cleared.
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await firestore.updateDoc(firestore.doc(db, "weddings/event-a"), { seatingSchemaVersion: 1 });
      for (const guestId of ["bride-1", "bride-2", "groom-1"]) {
        await firestore.deleteDoc(firestore.doc(db, `weddings/event-a/seatedPeople/${guestId}~main`));
      }
      for (const chairId of ["chair-1", "chair-2"]) {
        await firestore.deleteDoc(firestore.doc(db, `weddings/event-a/seatAssignments/table-1~${chairId}`));
        await firestore.updateDoc(firestore.doc(db, `weddings/event-a/seatOccupancy/table-1~${chairId}`), { occupied: false });
      }
      await firestore.deleteDoc(firestore.doc(db, "weddings/event-a/seatAssignments/table-1~chair-3"));
      await firestore.updateDoc(firestore.doc(db, "weddings/event-a/seatOccupancy/table-1~chair-3"), { occupied: false });
      await firestore.updateDoc(firestore.doc(db, "weddings/event-a/tables/table-1"), {
        chairs: [
          { id: "chair-1", seatNumber: 1, x: 25, y: 25, assignment: { guestId: "bride-1", partyMemberIndex: 0 } },
          { id: "chair-2", seatNumber: 2, x: 75, y: 25 },
          { id: "chair-3", seatNumber: 3, x: 75, y: 75 },
        ], guestIds: ["bride-1"],
      });
      await firestore.updateDoc(firestore.doc(db, "weddings/event-a/guests/bride-1"), {
        seatingAssignments: [{ tableId: "table-1", chairId: "chair-1", partyMemberIndex: 0 }],
        qrCodeValue: "legacy-qr-fixture",
        inviteLink: "https://example.test/legacy-invite#fixture-token",
        fullNameAr: "اسم قديم",
        guestToken: "legacy-guest-token-fixture",
        token: "legacy-token-fixture",
        id: "legacy-id-fixture",
      });
    });
    const ownerApi = { ...firestore };
    const migrationResult = await migrateLegacySeating({ api: ownerApi, db: ownerBootstrap, weddingId: "event-a", uid: "owner-a" });
    assert.equal(migrationResult.migrated, 1);
    const migratedTable = await firestore.getDoc(firestore.doc(ownerBootstrap, "weddings/event-a/tables/table-1"));
    assert.equal(migratedTable.data().chairs[0].id, "chair-1");
    assert.equal(Object.hasOwn(migratedTable.data().chairs[0], "assignment"), false);
    const migratedLegacyGuest = await firestore.getDoc(firestore.doc(ownerBootstrap, "weddings/event-a/guests/bride-1"));
    assert.deepEqual(migratedLegacyGuest.data().seatingAssignments, []);
    for (const [field, value] of Object.entries({
      qrCodeValue: "legacy-qr-fixture",
      inviteLink: "https://example.test/legacy-invite#fixture-token",
      fullNameAr: "اسم قديم",
      guestToken: "legacy-guest-token-fixture",
      token: "legacy-token-fixture",
      id: "legacy-id-fixture",
    })) assert.equal(migratedLegacyGuest.data()[field], value);
    await assertSucceeds(firestore.updateDoc(firestore.doc(ownerBootstrap, "weddings/event-a/guests/bride-1"), {
      fullName: "Updated fixture name", updatedAt: firestore.serverTimestamp(),
    }));
    await assertFails(firestore.updateDoc(firestore.doc(ownerBootstrap, "weddings/event-a/guests/bride-1"), {
      token: "replacement-token-must-not-be-allowed", updatedAt: firestore.serverTimestamp(),
    }));
    await assertFails(firestore.setDoc(firestore.doc(ownerBootstrap, "weddings/event-a/guests/new-legacy-guest"), {
      ...guest("new-legacy-guest", "bride"),
      token: "new-record-legacy-token-must-not-be-allowed",
      createdAt: firestore.serverTimestamp(), updatedAt: firestore.serverTimestamp(),
    }));
    assert.equal((await migrateLegacySeating({ api: ownerApi, db: ownerBootstrap, weddingId: "event-a", uid: "owner-a" })).migrated, 0);

    // Stable token creation remains client-side and survives a fresh service
    // instance. The bearer reads exactly one minimized public projection.
    const token = Buffer.from(new Uint8Array(32).fill(41)).toString("base64url");
    const scope = {
      uid: "owner-a", weddingId: "event-a", guestId: "bride-1",
      wedding: { eventTitle: "A & B", eventCategory: "wedding_engagement", eventDateISO: "2027-05-20T18:00:00.000Z" },
      tables: [],
    };
    const service = createInvitationTokenService({ db: ownerBootstrap, firestore, tokenFactory: () => token });
    const tokenCopied = await service.ensure(scope);
    assert.equal(await service.ensure(scope), tokenCopied);
    const freshService = createInvitationTokenService({ db: ownerBootstrap, firestore, tokenFactory: () => "B".repeat(43) });
    assert.equal(await freshService.ensure(scope), tokenCopied);
    const invitationRef = firestore.doc(anonymous, `weddings/event-a/publicGuests/${token}`);
    const publicInvitation = await assertSucceeds(firestore.getDoc(invitationRef));
    assert.equal(publicInvitation.data().guest.fullName, "Updated fixture name");
    assert.equal(Object.hasOwn(publicInvitation.data(), "phone"), false);
    assert.equal(Object.hasOwn(publicInvitation.data(), "guestId"), false);
    await assertFails(firestore.getDocs(firestore.collection(anonymous, "weddings/event-a/publicGuests")));
    await assertFails(firestore.getDoc(firestore.doc(anonymous, "weddings/event-a/guests/bride-1")));

    // Invitation RSVP updates the canonical guest and the exact-token public
    // projection in the same commit; allowance and field limits are enforced.
    const rsvp = firestore.writeBatch(anonymous);
    const rsvpPatch = {
      rsvpStatus: "confirmed", additionalGuests: 2, rsvpMessage: "See you there!",
      updatedAt: firestore.serverTimestamp(),
    };
    rsvp.update(invitationRef, rsvpPatch);
    rsvp.update(firestore.doc(anonymous, "weddings/event-a/guests/bride-1"), rsvpPatch);
    await assertSucceeds(rsvp.commit());
    const overAllowance = firestore.writeBatch(anonymous);
    const invalidPatch = { ...rsvpPatch, additionalGuests: 3, updatedAt: firestore.serverTimestamp() };
    overAllowance.update(invitationRef, invalidPatch);
    overAllowance.update(firestore.doc(anonymous, "weddings/event-a/guests/bride-1"), invalidPatch);
    await assertFails(overAllowance.commit());

    // A check-in account can resolve the active token index and the matching
    // side-scoped check-in projection, then change check-in state only.
    await assertFails(firestore.getDoc(firestore.doc(checkin, `weddings/event-a/invitationTokens/${token}`)));
    await assertSucceeds(firestore.getDoc(firestore.doc(checkin, "weddings/event-a/checkinGuests/groom-1")));
    await assertFails(firestore.getDoc(firestore.doc(checkin, "weddings/event-a/checkinGuests/bride-1")));
    const checkinQuery = firestore.query(
      firestore.collection(checkin, "weddings/event-a/checkinGuests"), firestore.where("side", "==", "groom"),
    );
    await assertSucceeds(firestore.getDocs(checkinQuery));
    await assertFails(firestore.getDocs(firestore.collection(anonymous, "weddings/event-a/checkinGuests")));
    await assertFails(firestore.getDoc(firestore.doc(anonymous, `weddings/event-a/invitationTokens/${token}`)));
    await assertSucceeds(firestore.updateDoc(firestore.doc(checkin, "weddings/event-a/checkinGuests/groom-1"), {
      checkedIn: true, checkedInAt: firestore.serverTimestamp(), updatedAt: firestore.serverTimestamp(),
    }));
    await assertFails(firestore.updateDoc(firestore.doc(checkin, "weddings/event-a/checkinGuests/groom-1"), { phone: "attacker" }));

    const groomToken = Buffer.from(new Uint8Array(32).fill(42)).toString("base64url");
    const groomTokenService = createInvitationTokenService({
      db: ownerBootstrap, firestore, tokenFactory: () => groomToken,
    });
    const groomScope = { ...scope, guestId: "groom-1" };
    assert.equal(await groomTokenService.ensure(groomScope), groomToken);
    await assertSucceeds(firestore.getDoc(firestore.doc(checkin, `weddings/event-a/invitationTokens/${groomToken}`)));
    await assertSucceeds(firestore.getDoc(firestore.doc(anonymous, `weddings/event-a/publicGuests/${groomToken}`)));

    // Sender recipients are stored under a strong random capability in small
    // chunks. A bearer may get the capability and exact chunk, never list.
    const senderToken = Buffer.from(new Uint8Array(32).fill(77)).toString("base64url");
    const senderRef = firestore.doc(ownerBootstrap, `weddings/event-a/senderCapabilities/${senderToken}`);
    await assertSucceeds(firestore.setDoc(senderRef, {
      weddingId: "event-a", purpose: "whatsapp-sender", status: "preparing", createdBy: "owner-a",
      side: "bride", eventTitle: "A & B", eventCategory: "wedding_engagement", recipientCount: 1,
      chunkCount: 1, expiresAt: null, createdAt: firestore.serverTimestamp(), updatedAt: firestore.serverTimestamp(),
    }));
    await assertSucceeds(firestore.setDoc(firestore.doc(ownerBootstrap, `weddings/event-a/senderCapabilities/${senderToken}/recipients/0000`), {
      weddingId: "event-a", capabilityId: senderToken, chunkIndex: 0,
      recipients: [{ i: "bride-1", n: "bride-1 Guest", p: "971500000001", s: "bride", t: token }],
      createdAt: firestore.serverTimestamp(),
    }));
    await assertSucceeds(firestore.updateDoc(senderRef, { status: "active", updatedAt: firestore.serverTimestamp() }));
    const publicSenderRef = firestore.doc(anonymous, `weddings/event-a/senderCapabilities/${senderToken}`);
    await assertSucceeds(firestore.getDoc(publicSenderRef));
    await assertSucceeds(firestore.getDoc(firestore.doc(anonymous, `weddings/event-a/senderCapabilities/${senderToken}/recipients/0000`)));
    await assertFails(firestore.getDocs(firestore.collection(anonymous, "weddings/event-a/senderCapabilities")));
    await assertFails(firestore.getDocs(firestore.collection(anonymous, `weddings/event-a/senderCapabilities/${senderToken}/recipients`)));

    const senderRecipient = { i: "bride-1", n: "bride-1 Guest", p: "971500000001", s: "bride", t: token };
    const senderInviteUrl = new URL("https://weddinginvitaion-b4f36.web.app/index.html?wedding=event-a");
    senderInviteUrl.hash = new URLSearchParams({ guest: senderRecipient.t, recipient: senderRecipient.i }).toString();
    const senderHash = new URLSearchParams(senderInviteUrl.hash.slice(1));
    assert.equal(senderHash.get("guest"), token);
    assert.equal(senderHash.get("recipient"), senderRecipient.i);
    const senderRsvp = firestore.writeBatch(anonymous);
    const senderRsvpPatch = {
      rsvpStatus: "confirmed", additionalGuests: 1, rsvpMessage: "Sender link RSVP works.",
      updatedAt: firestore.serverTimestamp(),
    };
    senderRsvp.update(firestore.doc(anonymous, `weddings/event-a/publicGuests/${senderHash.get("guest")}`), senderRsvpPatch);
    senderRsvp.update(firestore.doc(anonymous, `weddings/event-a/guests/${senderHash.get("recipient")}`), senderRsvpPatch);
    await assertSucceeds(senderRsvp.commit());

    // Revocation removes the invitation projection and blocks the token index;
    // sender revocation blocks both the capability and its recipient chunks.
    await service.revoke(scope);
    await assertFails(firestore.getDoc(invitationRef));
    await assertFails(firestore.getDoc(firestore.doc(checkin, `weddings/event-a/invitationTokens/${token}`)));
    await groomTokenService.revoke(groomScope);
    await assertFails(firestore.getDoc(firestore.doc(checkin, `weddings/event-a/invitationTokens/${groomToken}`)));
    await assertSucceeds(firestore.updateDoc(senderRef, { status: "revoked", updatedAt: firestore.serverTimestamp() }));
    await assertFails(firestore.getDoc(publicSenderRef));
    await assertFails(firestore.getDoc(firestore.doc(anonymous, `weddings/event-a/senderCapabilities/${senderToken}/recipients/0000`)));

    const summary = await assertSucceeds(firestore.getDoc(firestore.doc(anonymous, "weddings/event-a/publicSummary/summary")));
    assert.deepEqual(summary.data().stats, { total: 3, bride: 2, groom: 1 });
    await assertFails(firestore.getDoc(firestore.doc(anonymous, "weddings/event-a/publicStats/summary")));
    await assertFails(firestore.getDoc(firestore.doc(brideA, "weddings/event-a/publicStats/summary")));
  } finally {
    await env.cleanup();
  }
});

test("retired email-based owner claim is denied even to legacy admin memberships", {
  skip: emulatorAvailable ? false : "Run with the Firestore Emulator to verify security rules.",
}, async () => {
  const [{ assertFails, assertSucceeds, initializeTestEnvironment }, firestore] = await Promise.all([
    import("@firebase/rules-unit-testing"), import("firebase/firestore"),
  ]);
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  const env = await initializeTestEnvironment({ projectId: "demo-wedding-rules", firestore: { rules } });
  const designatedOwner = env.authenticatedContext("designated-owner", { email: "test@gmail.com" }).firestore();
  const otherAdmin = env.authenticatedContext("other-admin", { email: "other@example.test" }).firestore();
  const eventRef = firestore.doc(designatedOwner, "weddings/luxury-wedding-demo");

  try {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await firestore.setDoc(firestore.doc(db, "weddings/luxury-wedding-demo"), event("pending-auth-setup"));
      const designatedMembership = membership("designated-owner", {
        role: "admin", canViewDashboard: true, canManageUsers: true,
      });
      delete designatedMembership.email;
      await firestore.setDoc(firestore.doc(db, "weddings/luxury-wedding-demo/dashboardUsers/designated-owner"), {
        ...designatedMembership,
      });
      await firestore.setDoc(firestore.doc(db, "weddings/luxury-wedding-demo/dashboardUsers/other-admin"), {
        ...membership("other-admin", {
          email: "other@example.test", role: "admin", canViewDashboard: true, canManageUsers: true,
        }),
      });
    });

    await assertFails(firestore.updateDoc(eventRef, {
      ownerUserId: "other-admin", updatedAt: firestore.serverTimestamp(),
    }));
    await assertFails(firestore.updateDoc(eventRef, {
      ownerUserId: "designated-owner", updatedAt: firestore.serverTimestamp(),
    }));
    await assertFails(firestore.updateDoc(eventRef, {
      ownerUserId: "other-admin", updatedAt: firestore.serverTimestamp(),
    }));
  } finally {
    await env.cleanup();
  }
});
