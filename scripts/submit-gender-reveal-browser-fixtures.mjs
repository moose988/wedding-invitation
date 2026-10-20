import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase/app";
import {
  connectAuthEmulator, initializeAuth, inMemoryPersistence, signInAnonymously,
  signInWithEmailAndPassword, signOut,
} from "firebase/auth";
import {
  collection, connectFirestoreEmulator, doc, getDoc, getDocFromServer, getDocs, getFirestore, increment,
  query, runTransaction, serverTimestamp,
} from "firebase/firestore";
import { createGenderRevealSubmissionService } from "../gender-reveal-submission.js";

const projectId = process.env.GCLOUD_PROJECT || "";
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || "";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "";
const password = process.env.GENDER_REVEAL_TEST_PASSWORD || "";
const runId = process.env.GENDER_REVEAL_BROWSER_RUN_ID || "";
if (projectId !== "demo-wedding-security" || firestoreHost !== "127.0.0.1:8080" || authHost !== "127.0.0.1:9099") {
  throw new Error("Refusing to submit fixtures. This script requires the demo project and loopback Auth/Firestore emulators.");
}
if (!/^[a-z0-9-]{1,40}$/.test(runId)) throw new Error("Set a lowercase alphanumeric GENDER_REVEAL_BROWSER_RUN_ID.");
if (password.length < 8) throw new Error("Set the disposable GENDER_REVEAL_TEST_PASSWORD used by the emulator seed script.");

const eventId = `gr-browser-event-${runId}`;
const guests = [
  { fullName: "Synthetic Guest A", attendance: "attending", prediction: "boy", message: "Synthetic QA note A" },
  { fullName: "ضيف تجريبي ب", attendance: "attending", prediction: "girl", message: "تهانينا للوالدين" },
  { fullName: "Synthetic Guest C", attendance: "not_attending", prediction: "girl", message: "" },
  { fullName: "سارة تجريبية", attendance: "attending", prediction: "boy", message: "نتطلع إلى المفاجأة" },
  { fullName: "ضيف تجريبي هـ", attendance: "not_attending", prediction: "girl", message: "ألف مبروك" },
];
const firebaseConfig = { apiKey: "demo-key", authDomain: "localhost", projectId };
const sessionIds = new Set();
const appNames = [];
let responseNumber = 0;

try {
  for (const [index, guest] of guests.entries()) {
    const app = initializeApp(firebaseConfig, `gr-fixture-guest-${runId}-${index}`);
    appNames.push(app);
    const auth = initializeAuth(app, { persistence: inMemoryPersistence });
    connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
    const db = getFirestore(app);
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    await signInAnonymously(auth);
    const sessionId = auth.currentUser.uid;
    assert.equal(sessionIds.has(sessionId), false, "each synthetic browser session must have a distinct anonymous user");
    sessionIds.add(sessionId);
    const submit = createGenderRevealSubmissionService({
      api: { doc, getDocFromServer, increment, runTransaction, serverTimestamp },
      db,
      weddingId: eventId,
      ensureAnonymousUser: async () => auth.currentUser?.uid || "",
      createResponseId: () => {
        responseNumber += 1;
        return `fixture-response-${String(responseNumber).padStart(20, "0")}`;
      },
    });
    await submit(guest);
    await signOut(auth);
  }

  const adminApp = initializeApp(firebaseConfig, `gr-fixture-admin-${runId}`);
  appNames.push(adminApp);
  const adminAuth = initializeAuth(adminApp, { persistence: inMemoryPersistence });
  connectAuthEmulator(adminAuth, `http://${authHost}`, { disableWarnings: true });
  const db = getFirestore(adminApp);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const email = `gr-admin-${runId}@example.test`;
  await signInWithEmailAndPassword(adminAuth, email, password);
  const [responses, aggregate] = await Promise.all([
    getDocs(query(collection(db, "weddings", eventId, "genderRevealResponses"))),
    getDoc(doc(db, "weddings", eventId, "genderRevealResults", "aggregate")),
  ]);
  const data = responses.docs.map((row) => row.data());
  const totals = data.reduce((counts, response) => {
    counts.total += 1;
    counts[response.attendance] += 1;
    counts[response.prediction] += 1;
    return counts;
  }, { total: 0, attending: 0, not_attending: 0, boy: 0, girl: 0 });
  assert.equal(aggregate.exists(), true);
  assert.deepEqual(totals, { total: 5, attending: 3, not_attending: 2, boy: 2, girl: 3 });
  assert.deepEqual(aggregate.data(), {
    boyCount: 2, girlCount: 3, totalCount: 5, updatedAt: aggregate.data().updatedAt,
  });
  console.log(JSON.stringify({ eventId, projectId, sessions: sessionIds.size, totals, names: data.map((response) => response.fullName).sort() }));
  await signOut(adminAuth);
} finally {
  await Promise.all(appNames.map((app) => deleteApp(app).catch(() => {})));
}
