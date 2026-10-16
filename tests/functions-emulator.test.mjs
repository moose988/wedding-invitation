import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";
import { deleteApp, initializeApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, inMemoryPersistence, initializeAuth, signOut } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";

const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const emulatorAvailable = Boolean(firestoreHost && authHost);
const requireFunctions = createRequire(new URL("../functions/package.json", import.meta.url));

function fixtureGuest({ name, side, allowance = 1, token } = {}) {
  return {
    fullName: name,
    phone: "971500000000",
    side,
    additionalGuests: 0,
    additionalGuestAllowance: allowance,
    rsvpStatus: "pending",
    rsvpMessage: "",
    tableId: "",
    tableName: "",
    seatNumber: "",
    seatingAssignments: [],
    checkedIn: false,
    checkedInAt: null,
    notes: "Synthetic emulator fixture",
    inviteSentAt: null,
    reminderSentAt: null,
    ...(token ? { guestToken: token } : {}),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

test("Functions emulator enforces invitation capabilities, roles, migration, and persisted RSVP state", {
  skip: emulatorAvailable ? false : "Run with Auth, Firestore, and Functions emulators.",
}, async () => {
  const { initializeApp: initializeAdminApp } = requireFunctions("firebase-admin/app");
  const { getAuth: getAdminAuth } = requireFunctions("firebase-admin/auth");
  const { getFirestore, FieldValue } = requireFunctions("firebase-admin/firestore");
  process.env.FIRESTORE_EMULATOR_HOST = firestoreHost;
  const projectId = process.env.GCLOUD_PROJECT || "demo-wedding-security";
  const suffix = randomBytes(5).toString("hex");
  const eventId = `sec-test-${suffix}`;
  const legacyEventId = `sec-legacy-${suffix}`;
  const adminApp = initializeAdminApp({ projectId }, `functions-security-test-${suffix}`);
  const db = getFirestore(adminApp);
  const adminAuth = getAdminAuth(adminApp);
  const apps = [];
  const identities = [];

  async function signInAs(label) {
    const app = initializeApp({ apiKey: "emulator-test-key", authDomain: "localhost", projectId }, `functions-client-${label}-${suffix}`);
    apps.push(app);
    const auth = initializeAuth(app, { persistence: inMemoryPersistence });
    connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
    const functions = getFunctions(app, "us-central1");
    const [functionsHost, functionsPort = "5001"] = (process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001").split(":");
    connectFunctionsEmulator(functions, functionsHost, Number(functionsPort));
    const uid = `sec-${label}-${suffix}`;
    const password = randomBytes(32).toString("base64url");
    const credential = await createUserWithEmailAndPassword(auth, `${uid}@example.invalid`, password);
    identities.push({ uid: credential.user.uid, auth });
    return { app, auth, functions, uid: credential.user.uid };
  }

  try {
    const owner = await signInAs("owner");
    const brideEditor = await signInAs("bride");
    const groomCheckin = await signInAs("checkin");
    const weddingRef = db.doc(`weddings/${eventId}`);
    const legacyWeddingRef = db.doc(`weddings/${legacyEventId}`);
    await weddingRef.set({
      ownerUserId: owner.uid,
      eventCategory: "wedding_engagement",
      eventTitle: "Security fixture event",
      coupleName: "A & B",
      eventDateISO: "2027-05-20T18:00:00.000Z",
      venueEn: "Synthetic venue",
      status: "active",
      seatingEnabled: true,
      showInvitationQr: true,
    });
    await legacyWeddingRef.set({
      ownerUserId: owner.uid,
      eventCategory: "wedding_engagement",
      eventTitle: "Synthetic legacy migration fixture",
      eventDateISO: "2027-05-20T18:00:00.000Z",
      venueEn: "Synthetic venue",
      status: "active",
    });
    await Promise.all([
      weddingRef.collection("dashboardUsers").doc(owner.uid).set({
        userId: owner.uid,
        canViewDashboard: true, canManageUsers: true, canEditGuests: true,
        canEditSeating: true, canManageSeatingLayout: true, canCheckIn: true, allowedSide: "all",
      }),
      weddingRef.collection("dashboardUsers").doc(brideEditor.uid).set({
        userId: brideEditor.uid,
        canViewDashboard: true, seatingOnly: true, canEditSeating: true, allowedSide: "bride",
      }),
      weddingRef.collection("dashboardUsers").doc(groomCheckin.uid).set({
        userId: groomCheckin.uid,
        canCheckIn: true, allowedSide: "groom",
      }),
      legacyWeddingRef.collection("dashboardUsers").doc(owner.uid).set({ userId: owner.uid, canViewDashboard: true, canManageUsers: true }),
    ]);

    await Promise.all([
      weddingRef.collection("guests").doc("guest-a").set(fixtureGuest({ name: "Alice Synthetic", side: "bride" })),
      weddingRef.collection("guests").doc("guest-b").set(fixtureGuest({ name: "Bob Synthetic", side: "groom" })),
      legacyWeddingRef.collection("guests").doc("legacy-guest").set(fixtureGuest({ name: "Legacy Synthetic", side: "bride", token: "demo-token-1" })),
      legacyWeddingRef.collection("publicGuests").doc("demo-token-1").set({ guestId: "legacy-guest", fullName: "Legacy Synthetic", guestToken: "demo-token-1" }),
    ]);
    await weddingRef.collection("tables").doc("table-1").set({
      name: "Synthetic table", shape: "round", x: 20, y: 20, width: 180, height: 180,
      seatCount: 3, capacity: 3,
      chairs: [
        { id: "chair-1", seatNumber: 1, x: 50, y: 0, status: "assigned", guestId: "guest-a", assignment: { guestId: "guest-a", tableId: "table-1", tableName: "Synthetic table", seatNumber: 1, partyMemberIndex: 0 } },
        { id: "chair-2", seatNumber: 2, x: 100, y: 50, status: "assigned", guestId: "guest-b", assignment: { guestId: "guest-b", tableId: "table-1", tableName: "Synthetic table", seatNumber: 2, partyMemberIndex: 0 } },
        { id: "chair-3", seatNumber: 3, x: 50, y: 100, status: "available", guestId: "", assignment: null },
      ],
      guestIds: ["guest-a", "guest-b"], updatedAt: FieldValue.serverTimestamp(),
    });

    const ownerCall = (name) => httpsCallable(owner.functions, name);
    const brideCall = (name) => httpsCallable(brideEditor.functions, name);
    const checkinCall = (name) => httpsCallable(groomCheckin.functions, name);
    const manage = ownerCall("manageGuestInvitationAccess");
    const firstIssue = (await manage({ weddingId: eventId, guestId: "guest-a", action: "ensure" })).data;
    const token = firstIssue;
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal((await manage({ weddingId: eventId, guestId: "guest-a", action: "ensure" })).data, token);

    const batchTokens = (await ownerCall("getGuestInvitationTokens")({
      weddingId: eventId, guestIds: ["guest-a", "guest-b"], action: "ensure",
    })).data.tokens;
    assert.equal(batchTokens["guest-a"], token);
    assert.notEqual(batchTokens["guest-a"], batchTokens["guest-b"]);

    const senderSession = (await ownerCall("createSenderSession")({
      weddingId: eventId, guestIds: ["guest-a"], side: "bride",
    })).data;
    assert.match(senderSession.token, /^[A-Za-z0-9_-]{43}$/);
    const senderDocId = createHash("sha256").update(senderSession.token).digest("hex");
    const senderRecord = await db.doc(`senderSessions/${senderDocId}`).get();
    assert.equal(senderRecord.data().purpose, "whatsapp-sender");
    assert.equal(senderRecord.data().status, "active");
    assert.deepEqual(senderRecord.data().guestAccess.map((item) => item.guestId), ["guest-a"]);
    assert.ok(senderRecord.data().expiresAt.toMillis() > Date.now());
    assert.doesNotMatch(JSON.stringify(senderRecord.data()), new RegExp(`${senderSession.token}|${token}|${batchTokens["guest-b"]}`));
    await assert.rejects(
      ownerCall("createSenderSession")({ weddingId: eventId, guestIds: ["guest-b"], side: "bride" }),
      (error) => error.code === "functions/permission-denied",
    );
    const [senderFunctionsHost, senderFunctionsPort = "5001"] = (process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001").split(":");
    const senderResponse = await fetch(
      `http://${senderFunctionsHost}:${senderFunctionsPort}/${projectId}/us-central1/getSenderSession`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: { token: senderSession.token } }) },
    );
    assert.equal(senderResponse.status, 200);
    assert.match(senderResponse.headers.get("cache-control") || "", /no-store/i);
    const senderBody = await senderResponse.json();
    const senderPayload = senderBody.result;
    assert.equal(senderPayload.side, "bride");
    assert.equal(senderPayload.g.length, 1);
    assert.equal(senderPayload.g[0].n, "Alice Synthetic");
    assert.equal(senderPayload.g[0].p, "971500000000");
    assert.equal(senderPayload.g[0].t, token);
    await assert.rejects(
      httpsCallable(owner.functions, "getSenderSession")({ token: "wrong-event-token" }),
      (error) => error.code === "functions/not-found",
    );
    await ownerCall("revokeSenderSession")({ weddingId: eventId, token: senderSession.token });
    await assert.rejects(
      httpsCallable(owner.functions, "getSenderSession")({ token: senderSession.token }),
      (error) => error.code === "functions/not-found",
    );
    const expiringSender = (await ownerCall("createSenderSession")({
      weddingId: eventId, guestIds: ["guest-a"], side: "bride",
    })).data;
    const expiringSenderDocId = createHash("sha256").update(expiringSender.token).digest("hex");
    await db.doc(`senderSessions/${expiringSenderDocId}`).update({ expiresAt: new Date(Date.now() - 1000) });
    await assert.rejects(
      httpsCallable(owner.functions, "getSenderSession")({ token: expiringSender.token }),
      (error) => error.code === "functions/not-found",
    );

    const guestView = (await httpsCallable(owner.functions, "getGuestInvitation")({ weddingId: eventId, token, guestId: "guest-b" })).data;
    assert.equal(guestView.guest.fullName, "Alice Synthetic");
    assert.equal(Object.hasOwn(guestView.guest, "phone"), false);
    assert.equal(Object.hasOwn(guestView.guest, "guestId"), false);
    const [functionsHost, functionsPort = "5001"] = (process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001").split(":");
    const rawInvitationResponse = await fetch(
      `http://${functionsHost}:${functionsPort}/${projectId}/us-central1/getGuestInvitation`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: { weddingId: eventId, token } }) },
    );
    assert.equal(rawInvitationResponse.status, 200);
    assert.match(rawInvitationResponse.headers.get("cache-control") || "", /no-store/i);
    await assert.rejects(
      httpsCallable(owner.functions, "getGuestInvitation")({ weddingId: "unrelated-event", token }),
      (error) => error.code === "functions/not-found",
    );
    await assert.rejects(
      httpsCallable(owner.functions, "getGuestInvitation")({ weddingId: eventId, token: "demo-token-1" }),
      (error) => error.code === "functions/not-found",
    );

    const workspace = (await ownerCall("getAccessibleWorkspaceEvents")({})).data;
    assert.equal(workspace.events.some((event) => event.id === eventId && event.isOwner === true), true);
    const sideWorkspace = (await brideCall("getAccessibleWorkspaceEvents")({})).data;
    const sideEvent = sideWorkspace.events.find((event) => event.id === eventId);
    assert.equal(sideEvent?.seatingOnly, true);
    assert.equal(Object.hasOwn(sideEvent || {}, "guestCount"), false);

    const sideState = (await brideCall("getSideSeatingState")({ weddingId: eventId })).data;
    assert.deepEqual(sideState.guests.map((guest) => guest.id), ["guest-a"]);
    const restrictedChair = sideState.tables[0].chairs.find((chair) => chair.status === "restricted");
    assert.equal(restrictedChair?.guestId, "__restricted__");
    await assert.rejects(
      brideCall("mutateSideSeating")({ weddingId: eventId, type: "unassign", source: { tableId: "table-1", chairId: "chair-2" } }),
      (error) => error.code === "functions/permission-denied",
    );

    await assert.rejects(
      checkinCall("resolveCheckinGuest")({ weddingId: eventId, token }),
      (error) => error.code === "functions/permission-denied",
    );
    const ownerCheckin = (await ownerCall("resolveCheckinGuest")({ weddingId: eventId, token })).data;
    assert.equal(ownerCheckin.guestId, "guest-a");
    assert.equal(Object.hasOwn(ownerCheckin, "token"), false);
    const checkinRoster = (await checkinCall("getCheckinGuestList")({ weddingId: eventId })).data.guests;
    assert.deepEqual(checkinRoster.map((guest) => guest.id), ["guest-b"]);
    assert.equal(checkinRoster[0].fullName, "Bob Synthetic");
    assert.deepEqual(Object.keys(checkinRoster[0]).sort(), [
      "checkedIn", "checkedInAt", "fullName", "id", "phone", "rsvpStatus", "seatNumber", "side", "tableName",
    ]);
    for (const forbiddenField of ["notes", "rsvpMessage", "additionalGuestAllowance", "seatingAssignments", "guestToken"]) {
      assert.equal(Object.hasOwn(checkinRoster[0], forbiddenField), false, `check-in roster exposed ${forbiddenField}`);
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await checkinCall("getCheckinGuestList")({ weddingId: eventId });
    }
    await assert.rejects(
      checkinCall("getCheckinGuestList")({ weddingId: eventId }),
      (error) => error.code === "functions/resource-exhausted",
    );
    await assert.rejects(
      httpsCallable(brideEditor.functions, "getCheckinGuestList")({ weddingId: eventId }),
      (error) => error.code === "functions/permission-denied",
    );
    await weddingRef.collection("dashboardUsers").doc(groomCheckin.uid).update({ canCheckIn: false });
    await assert.rejects(
      checkinCall("getCheckinGuestList")({ weddingId: eventId }),
      (error) => error.code === "functions/permission-denied",
    );
    await weddingRef.collection("dashboardUsers").doc(groomCheckin.uid).update({ canCheckIn: true });

    const rsvp = httpsCallable(owner.functions, "submitGuestInvitationRsvp");
    await assert.rejects(
      rsvp({ weddingId: eventId, token, rsvpStatus: "confirmed", additionalGuests: 2 }),
      (error) => error.code === "functions/not-found",
    );
    const saved = (await rsvp({ weddingId: eventId, token, rsvpStatus: "confirmed", additionalGuests: 1, rsvpMessage: "Synthetic test" })).data;
    assert.equal(saved.guest.rsvpStatus, "confirmed");
    const persisted = await weddingRef.collection("guests").doc("guest-a").get();
    assert.equal(persisted.data().rsvpStatus, "confirmed");
    assert.equal(persisted.data().additionalGuests, 1);
    assert.equal(persisted.data().checkedIn, false);
    const summaryRef = weddingRef.collection("publicSummary").doc("summary");
    let publicSummary = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const summarySnapshot = await summaryRef.get();
      publicSummary = summarySnapshot.exists ? summarySnapshot.data() : null;
      if (publicSummary?.sides?.bride?.confirmed === 1 && publicSummary.sides.bride.confirmedSeats === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(publicSummary?.sides?.bride?.confirmed, 1);
    assert.equal(publicSummary?.sides?.bride?.confirmedSeats, 2);

    const requestId = randomBytes(16).toString("hex");
    const replacement = (await manage({ weddingId: eventId, guestId: "guest-a", action: "regenerate", requestId })).data;
    assert.notEqual(replacement, token);
    assert.equal((await manage({ weddingId: eventId, guestId: "guest-a", action: "regenerate", requestId })).data, replacement);
    await assert.rejects(
      httpsCallable(owner.functions, "getGuestInvitation")({ weddingId: eventId, token }),
      (error) => error.code === "functions/not-found",
    );

    const migrationDryRun = (await ownerCall("migrateInvitationAccess")({
      weddingId: legacyEventId, mode: "dry-run", pageSize: 10,
    })).data;
    assert.equal(migrationDryRun.predictableDemoTokenCount, 1);
    assert.equal(migrationDryRun.done, true);
    assert.equal(JSON.stringify(migrationDryRun).includes("demo-token-1"), false);
    await ownerCall("migrateInvitationAccess")({
      weddingId: legacyEventId, mode: "apply", confirmation: `ROTATE INVITATIONS ${legacyEventId}`, pageSize: 10,
    });
    const migratedGuest = await legacyWeddingRef.collection("guests").doc("legacy-guest").get();
    assert.equal(Object.hasOwn(migratedGuest.data(), "guestToken"), false);
    assert.equal((await legacyWeddingRef.collection("publicGuests").get()).empty, true);
    await assert.rejects(
      httpsCallable(owner.functions, "getGuestInvitation")({ weddingId: legacyEventId, token: "demo-token-1" }),
      (error) => error.code === "functions/not-found",
    );
    assert.match((await ownerCall("getGuestInvitationTokens")({ weddingId: legacyEventId, guestIds: ["legacy-guest"] })).data.tokens["legacy-guest"], /^[A-Za-z0-9_-]{43}$/);

    await manage({ weddingId: eventId, guestId: "guest-a", action: "revoke" });
    await assert.rejects(
      httpsCallable(owner.functions, "getGuestInvitation")({ weddingId: eventId, token: replacement }),
      (error) => error.code === "functions/not-found",
    );
    await assert.rejects(
      rsvp({ weddingId: eventId, token: replacement, rsvpStatus: "declined" }),
      (error) => error.code === "functions/not-found",
    );

    // Public invitation reads are bounded per client IP and failures remain
    // generic after the limit is reached.
    let successfulReads = 0;
    let rateLimited = false;
    for (let attempt = 0; attempt < 70; attempt += 1) {
      try {
        await httpsCallable(owner.functions, "getGuestInvitation")({ weddingId: eventId, token: batchTokens["guest-b"] });
        successfulReads += 1;
      } catch (error) {
        assert.equal(error.code, "functions/not-found");
        rateLimited = true;
        break;
      }
    }
    assert.ok(successfulReads >= 10);
    assert.equal(rateLimited, true);
  } finally {
    for (const id of [eventId, legacyEventId]) {
      await db.recursiveDelete(db.doc(`weddings/${id}`)).catch(() => {});
      const [secrets, indexes] = await Promise.all([
        db.collection("invitationSecrets").get(),
        db.collection("invitationAccessTokens").get(),
      ]);
      const batch = db.batch();
      secrets.docs.filter((snapshot) => snapshot.data().weddingId === id).forEach((snapshot) => batch.delete(snapshot.ref));
      indexes.docs.filter((snapshot) => snapshot.data().weddingId === id).forEach((snapshot) => batch.delete(snapshot.ref));
      const senderSessions = await db.collection("senderSessions").where("weddingId", "==", id).get();
      senderSessions.docs.forEach((snapshot) => batch.delete(snapshot.ref));
      await batch.commit().catch(() => {});
    }
    await Promise.all(identities.map(({ uid }) => adminAuth.deleteUser(uid).catch(() => {})));
    await Promise.all(identities.map(({ auth }) => signOut(auth).catch(() => {})));
    await Promise.all(apps.map((app) => deleteApp(app).catch(() => {})));
    await adminApp.delete().catch(() => {});
  }
});
