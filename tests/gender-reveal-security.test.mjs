import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { initializeApp, deleteApp } from "firebase/app";
import { connectAuthEmulator, initializeAuth, inMemoryPersistence, signInAnonymously, signOut } from "firebase/auth";
import { collection, connectFirestoreEmulator, deleteDoc, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { publicEventData } from "../event-publishing.js";
import { createGenderRevealSubmissionService } from "../gender-reveal-submission.js";
import { genderRevealEmulatorFixture } from "./fixtures/gender-reveal-event.mjs";

const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

test("Gender Reveal Spark rules enforce category creation, atomic RSVP uniqueness, privacy, counters, and customer boundaries", {
  skip: emulatorAvailable ? false : "Run with the demo-project Auth and Firestore emulators.",
}, async () => {
  const projectId = "demo-wedding-security";
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  const env = await initializeTestEnvironment({ projectId, firestore: { rules } });
  const eventId = "gender-reveal-fixture";
  const otherEventId = "gender-reveal-other";
  const event = { ...genderRevealEmulatorFixture, ownerUserId: "event-owner", createdAt: new Date(), updatedAt: new Date() };
  let app;
  let secondApp;
  let auth;
  let secondAuth;
  let db;
  let secondDb;
  const additionalSessions = [];
  try {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, "platformAdmins/platform-admin"), { enabled: true });
      await setDoc(doc(adminDb, `weddings/${eventId}`), event);
      await setDoc(doc(adminDb, `weddings/${eventId}/publicEvent/details`), { ...publicEventData(event), updatedAt: new Date() });
      await setDoc(doc(adminDb, `weddings/${eventId}/dashboardUsers/event-customer`), {
        userId: "event-customer", role: "customer", canViewDashboard: true, canEditEventDetails: true, seatingOnly: false,
      });
      const other = { ...event, eventTitle: "Other event", ownerUserId: "other-owner" };
      await setDoc(doc(adminDb, `weddings/${otherEventId}`), other);
      await setDoc(doc(adminDb, `weddings/${otherEventId}/publicEvent/details`), { ...publicEventData(other), updatedAt: new Date() });
    });

    const adminDb = env.authenticatedContext("platform-admin").firestore();
    const created = {
      ...genderRevealEmulatorFixture,
      ownerUserId: "platform-admin",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await assertSucceeds(setDoc(doc(adminDb, "weddings/gender-reveal-created-without-venue"), created));
    await assertSucceeds(setDoc(doc(adminDb, "weddings/legacy-wedding-create"), {
      ownerUserId: "platform-admin", eventCategory: "wedding_engagement",
    }));
    await assertSucceeds(setDoc(doc(adminDb, "weddings/legacy-celebration-create"), {
      ownerUserId: "platform-admin", eventCategory: "celebration",
    }));

    app = initializeApp({ apiKey: "demo-key", authDomain: "localhost", projectId }, `gender-reveal-${Date.now()}`);
    auth = initializeAuth(app, { persistence: inMemoryPersistence });
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    db = (await import("firebase/firestore")).getFirestore(app);
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    const responseIds = [];
    let responseNumber = 0;
    let anonymousSignIn;
    const submit = createGenderRevealSubmissionService({
      api: { doc, getDoc, runTransaction, serverTimestamp }, db, weddingId: eventId,
      ensureAnonymousUser: async () => {
        if (auth.currentUser) return auth.currentUser.uid;
        anonymousSignIn ||= signInAnonymously(auth);
        await anonymousSignIn;
        return auth.currentUser.uid;
      },
      createResponseId: () => { responseNumber += 1; const id = `gender-response-${String(responseNumber).padStart(20, "0")}`; responseIds.push(id); return id; },
    });
    const createAdditionalSession = async () => {
      const sessionApp = initializeApp({ apiKey: "demo-key", authDomain: "localhost", projectId }, `gender-reveal-extra-session-${Date.now()}-${additionalSessions.length}`);
      const sessionAuth = initializeAuth(sessionApp, { persistence: inMemoryPersistence });
      connectAuthEmulator(sessionAuth, "http://127.0.0.1:9099", { disableWarnings: true });
      const sessionDb = (await import("firebase/firestore")).getFirestore(sessionApp);
      connectFirestoreEmulator(sessionDb, "127.0.0.1", 8080);
      const sessionSubmit = createGenderRevealSubmissionService({
        api: { doc, getDoc, runTransaction, serverTimestamp }, db: sessionDb, weddingId: eventId,
        ensureAnonymousUser: async () => {
          if (!sessionAuth.currentUser) await signInAnonymously(sessionAuth);
          return sessionAuth.currentUser.uid;
        },
        createResponseId: () => { responseNumber += 1; const id = `gender-response-${String(responseNumber).padStart(20, "0")}`; responseIds.push(id); return id; },
      });
      additionalSessions.push({ app: sessionApp, auth: sessionAuth });
      return { auth: sessionAuth, submit: sessionSubmit };
    };

    await assert.rejects(submit({ fullName: "Test", attendance: "maybe", prediction: "boy" }), /attend/);
    await assert.rejects(submit({ fullName: "T".repeat(121), attendance: "attending", prediction: "boy" }), /120 characters/);
    assert.equal(auth.currentUser, null, "invalid data must not initialize anonymous auth or write");
    await assertFails(setDoc(doc(db, `weddings/${eventId}/genderRevealResponses/direct-write-attempt-0001`), {
      fullName: "Public bypass", attendance: "attending", prediction: "boy", message: "", createdAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(db, `weddings/${eventId}/genderRevealResponses/direct-write-phone-attempt-0001`), {
      fullName: "Phone field bypass", phoneE164: "+971501234567", attendance: "attending", prediction: "boy", message: "", createdAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(db, `weddings/${eventId}/genderRevealPhoneKeys/+971501234567`), { createdAt: serverTimestamp() }));
    const publicDb = env.unauthenticatedContext().firestore();
    const aggregatePath = `weddings/${eventId}/genderRevealResults/aggregate`;
    const beforeFirstSubmission = await assertSucceeds(getDoc(doc(publicDb, aggregatePath)));
    assert.equal(beforeFirstSubmission.exists(), false, "the public result path is readable, but is not created before the first valid response");

    const duplicateForm = {
      fullName: "Guest One",
      attendance: "attending", prediction: "boy", message: "Hello parents",
    };
    const duplicateResults = await Promise.allSettled([submit(duplicateForm), submit({ ...duplicateForm, message: "Second attempt" })]);
    assert.equal(duplicateResults.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(duplicateResults.filter((result) => result.status === "rejected").length, 1);
    const duplicateError = duplicateResults.find((result) => result.status === "rejected").reason;
    assert.equal(duplicateError.code, "permission-denied", "the private session key blocks repeat submissions without exposing prior data");
    const firstSessionId = auth.currentUser.uid;

    const publicResultsBeforeNextSubmission = await assertSucceeds(getDoc(doc(publicDb, aggregatePath)));
    assert.deepEqual(publicResultsBeforeNextSubmission.data(), {
      boyCount: 1, girlCount: 0, totalCount: 1, updatedAt: publicResultsBeforeNextSubmission.data().updatedAt,
    }, "existing aggregate results are publicly readable before a visitor submits");

    secondApp = initializeApp({ apiKey: "demo-key", authDomain: "localhost", projectId }, `gender-reveal-second-session-${Date.now()}`);
    secondAuth = initializeAuth(secondApp, { persistence: inMemoryPersistence });
    connectAuthEmulator(secondAuth, "http://127.0.0.1:9099", { disableWarnings: true });
    secondDb = (await import("firebase/firestore")).getFirestore(secondApp);
    connectFirestoreEmulator(secondDb, "127.0.0.1", 8080);
    const submitFromSecondSession = createGenderRevealSubmissionService({
      api: { doc, getDoc, runTransaction, serverTimestamp }, db: secondDb, weddingId: eventId,
      ensureAnonymousUser: async () => {
        if (!secondAuth.currentUser) await signInAnonymously(secondAuth);
        return secondAuth.currentUser.uid;
      },
      createResponseId: () => { responseNumber += 1; const id = `gender-response-${String(responseNumber).padStart(20, "0")}`; responseIds.push(id); return id; },
    });
    await submitFromSecondSession({
      fullName: "ضيف ثانٍ", attendance: "not_attending", prediction: "girl", message: "مبروك للعائلة",
    });
    assert.notEqual(secondAuth.currentUser.uid, firstSessionId, "separate anonymous sessions have different identities");
    const thirdSession = await createAdditionalSession();
    const fourthSession = await createAdditionalSession();
    const fifthSession = await createAdditionalSession();
    await thirdSession.submit({ fullName: "Guest Three", attendance: "attending", prediction: "girl", message: "" });
    await fourthSession.submit({ fullName: "سارة", attendance: "attending", prediction: "boy", message: "نتمنى لكم الفرح" });
    await fifthSession.submit({ fullName: "فاطمة", attendance: "not_attending", prediction: "girl", message: "ألف مبروك" });
    const aggregateRef = doc(db, `weddings/${eventId}/genderRevealResults/aggregate`);
    const aggregateSnapshot = await getDoc(aggregateRef);
    assert.deepEqual(aggregateSnapshot.data(), {
      boyCount: 2, girlCount: 3, totalCount: 5, updatedAt: aggregateSnapshot.data().updatedAt,
    });
    assert.equal(aggregateSnapshot.data().updatedAt?.toDate instanceof Function, true);
    assert.deepEqual(Object.keys(aggregateSnapshot.data()).sort(), ["boyCount", "girlCount", "totalCount", "updatedAt"].sort());

    const anonymousDb = db;
    await assertFails(updateDoc(aggregateRef, { boyCount: 99, totalCount: 100, updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, `weddings/${eventId}/genderRevealState/summary`), {
      boyCount: 99, girlCount: 0, totalCount: 99, lastResponseId: "malicious-counter-write-1234", updatedAt: serverTimestamp(),
    }));
    await assertFails(getDoc(doc(publicDb, `weddings/${eventId}/genderRevealResponses/${responseIds[0]}`)));
    await assertFails(getDocs(query(collection(publicDb, `weddings/${eventId}/genderRevealResponses`))));
    await assertFails(getDocs(query(collection(anonymousDb, `weddings/${eventId}/genderRevealResponses`))));
    await assertFails(getDoc(doc(anonymousDb, `weddings/${eventId}/genderRevealState/summary`)));
    await assertFails(getDocs(query(collection(anonymousDb, `weddings/${eventId}/genderRevealPhoneKeys`))));
    await assertFails(getDoc(doc(anonymousDb, `weddings/${eventId}/genderRevealSessionKeys/${firstSessionId}`)));
    await assertFails(getDocs(query(collection(anonymousDb, `weddings/${eventId}/genderRevealSessionKeys`))));
    await assertSucceeds(getDoc(doc(publicDb, aggregatePath)));

    const customerDb = env.authenticatedContext("event-customer").firestore();
    const customerRows = await assertSucceeds(getDocs(query(collection(customerDb, `weddings/${eventId}/genderRevealResponses`))));
    assert.equal(customerRows.size, 5);
    assert.equal(customerRows.docs.every((row) => !Object.hasOwn(row.data(), "phoneE164")), true);
    assert.deepEqual(customerRows.docs.reduce((totals, row) => {
      const response = row.data();
      totals[response.attendance] += 1;
      totals[response.prediction] += 1;
      return totals;
    }, { attending: 0, not_attending: 0, boy: 0, girl: 0 }), { attending: 3, not_attending: 2, boy: 2, girl: 3 });
    assert.deepEqual(customerRows.docs.map((row) => row.data().fullName).sort(), ["Guest One", "Guest Three", "ضيف ثانٍ", "سارة", "فاطمة"].sort());
    const eventRef = doc(customerDb, `weddings/${eventId}`);
    await assertSucceeds(updateDoc(eventRef, { genderRevealMessageAr: "رسالة تجريبية", updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(eventRef, { genderRevealArtworkUrl: "/images/custom-cover.png", updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(eventRef, { genderRevealArtworkUrl: "/images/../private.png", updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(eventRef, { seatingEnabled: true, updatedAt: serverTimestamp() }));
    await assertFails(getDoc(doc(anonymousDb, `weddings/${eventId}/genderRevealResponses/${customerRows.docs[0].id}`)));
    await assertFails(getDocs(query(collection(customerDb, `weddings/${otherEventId}/genderRevealResponses`))));
    const responseRef = doc(customerDb, `weddings/${eventId}/genderRevealResponses/${responseIds[0]}`);
    await assertFails(updateDoc(responseRef, { message: "Changed" }));
    await assertFails(deleteDoc(responseRef));

    await assertFails(getDoc(doc(anonymousDb, `weddings/${eventId}/genderRevealPhoneKeys/+971501234567`)));
    await assertFails(getDoc(doc(publicDb, `weddings/${eventId}/genderRevealPhoneKeys/+971501234567`)));
  } finally {
    if (auth) await signOut(auth).catch(() => {});
    if (secondAuth) await signOut(secondAuth).catch(() => {});
    if (app) await deleteApp(app).catch(() => {});
    if (secondApp) await deleteApp(secondApp).catch(() => {});
    for (const session of additionalSessions) {
      await signOut(session.auth).catch(() => {});
      await deleteApp(session.app).catch(() => {});
    }
    await env.cleanup();
  }
});
