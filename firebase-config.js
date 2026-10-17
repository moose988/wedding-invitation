import {
  getApps,
  initializeApp,
  deleteApp,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-analytics.js";
import {
  browserSessionPersistence,
  inMemoryPersistence,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  reload,
  initializeAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  addDoc as rawAddDoc,
  collection,
  deleteDoc as rawDeleteDoc,
  doc,
  getDoc as rawGetDoc,
  getDocs as rawGetDocs,
  limit,
  onSnapshot as rawOnSnapshot,
  orderBy,
  query,
  runTransaction as rawRunTransaction,
  serverTimestamp,
  setDoc as rawSetDoc,
  updateDoc as rawUpdateDoc,
  where,
  writeBatch as rawWriteBatch,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import {
  createScopedServiceCache,
  DEFAULT_FIREBASE_APP_NAME,
  resolveFirebaseApp,
} from "./firebase-service-scopes.js";

const defaultConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};

import { createLocalFirestoreDiagnostics } from "./local-firestore-diagnostics.js";
const serviceCache = createScopedServiceCache();

// Test endpoints are opt-in, loopback-only, and use a demo project. A production
// hostname can never activate them, even with a crafted URL or storage value.
const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
if (localHost && new URLSearchParams(window.location.search).get("emulator") === "1") {
  sessionStorage.setItem("wedding:localEmulators", "1");
}
const localEmulators = localHost && sessionStorage.getItem("wedding:localEmulators") === "1";
export const firestoreDiagnostics = createLocalFirestoreDiagnostics(localEmulators);
const { addDoc, deleteDoc, getDoc, getDocs, onSnapshot, runTransaction, setDoc, updateDoc, writeBatch } = firestoreDiagnostics.instrument({ addDoc: rawAddDoc, deleteDoc: rawDeleteDoc, getDoc: rawGetDoc, getDocs: rawGetDocs, onSnapshot: rawOnSnapshot, runTransaction: rawRunTransaction, setDoc: rawSetDoc, updateDoc: rawUpdateDoc, writeBatch: rawWriteBatch });

function connectLocalServices(app, auth, db) {
  if (!localEmulators || app.__localConnected) return;
  if (auth) connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  app.__localConnected = true;
}

function getConfiguredApp(name = DEFAULT_FIREBASE_APP_NAME) {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase config is missing. Add window.FIREBASE_CONFIG in firebase-config.js.");
  }

  const config = { ...defaultConfig, ...(window.FIREBASE_CONFIG || {}), ...(localEmulators ? { projectId: "demo-wedding-security", apiKey: "demo-key" } : {}) };
  const app = resolveFirebaseApp({ getApps, initializeApp }, config, name);
  return { app, config };
}

export function isFirebaseConfigured() {
  const config = { ...defaultConfig, ...(window.FIREBASE_CONFIG || {}) };
  return ["apiKey", "authDomain", "projectId", "appId"].every((key) => Boolean(config[key]));
}

export function initFirebase() {
  return serviceCache.get("dashboard", () => {
    // Planner sign-ins are tab-scoped so signing into another account in a
    // different tab cannot replace this tab's active user.
    const { app, config } = getConfiguredApp("planner-session");
    const auth = initializeAuth(app, { persistence: browserSessionPersistence });
    const db = getFirestore(app);
    connectLocalServices(app, auth, db);
    const persistenceReady = auth.authStateReady();

    if (!localEmulators) isSupported()
      .then((supported) => {
        if (supported) getAnalytics(app);
      })
      .catch((error) => {
        console.warn("Firebase Analytics could not be started.", error);
      });

    return { app, auth, db, config, persistenceReady };
  });
}

// Public invitations need Firestore's public-data rules, but must not initialize
// or mutate the planner's tab-scoped Auth session as a side effect.
export function initPublicFirebase() {
  return serviceCache.get("public-invitation", () => {
    if (!isFirebaseConfigured()) {
      throw new Error("Firebase config is missing. Add window.FIREBASE_CONFIG in firebase-config.js.");
    }

    const { app, config } = getConfiguredApp("public-invitation");
    const db = getFirestore(app);
    connectLocalServices(app, null, db);
    return { app, db, config };
  });
}

export async function createIsolatedCustomer(email, password) {
  const { app } = getConfiguredApp(`customer-onboarding-${crypto.randomUUID()}`);
  const auth = initializeAuth(app, { persistence: inMemoryPersistence });
  connectLocalServices(app, auth, getFirestore(app));
  try {
    const { user } = await createUserWithEmailAndPassword(auth, email, password);
    return { userId: user.uid, email: user.email };
  } finally {
    await signOut(auth).catch(() => {});
    await deleteApp(app);
  }
}

export {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onAuthStateChanged,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  signInWithEmailAndPassword,
  signOut,
  updateDoc,
  where,
  writeBatch,
  sendEmailVerification,
  reload,
};

window.FIREBASE_CONFIG = window.FIREBASE_CONFIG || {
  apiKey: "AIzaSyAHxFrozdw0Pi8fItdrim18uqtqN4EO-7I",
  authDomain: "weddinginvitaion-b4f36.firebaseapp.com",
  projectId: "weddinginvitaion-b4f36",
  storageBucket: "weddinginvitaion-b4f36.firebasestorage.app",
  messagingSenderId: "868779408613",
  appId: "1:868779408613:web:96b330cb386ec2fcefa80c",
  measurementId: "G-GD5D6WJRB0",
};

// Optional browser-restricted Google Maps Embed API key. Keep empty until a
// key restricted to Maps Embed API and the public invitation host is supplied.
window.GOOGLE_MAPS_EMBED_API_KEY = window.GOOGLE_MAPS_EMBED_API_KEY || "";
