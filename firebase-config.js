import {
  getApps,
  initializeApp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-analytics.js";
import {
  browserSessionPersistence,
  initializeAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithCustomToken,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
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

const serviceCache = createScopedServiceCache();

function getConfiguredApp(name = DEFAULT_FIREBASE_APP_NAME) {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase config is missing. Add window.FIREBASE_CONFIG in firebase-config.js.");
  }

  const config = { ...defaultConfig, ...(window.FIREBASE_CONFIG || {}) };
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
    // Match the backend's default Cloud Functions region explicitly.
    const functions = getFunctions(app, "us-central1");
    const persistenceReady = auth.authStateReady();

    isSupported()
      .then((supported) => {
        if (supported) getAnalytics(app);
      })
      .catch((error) => {
        console.warn("Firebase Analytics could not be started.", error);
      });

    return { app, auth, db, functions, config, persistenceReady };
  });
}

// Public invitations need Firestore's public-data rules, but must not initialize
// or mutate the planner's tab-scoped Auth session as a side effect.
export function initPublicFirebase() {
  return serviceCache.get("public-invitation", () => {
    if (!isFirebaseConfigured()) {
      throw new Error("Firebase config is missing. Add window.FIREBASE_CONFIG in firebase-config.js.");
    }

    const config = { ...defaultConfig, ...(window.FIREBASE_CONFIG || {}) };
    const app = resolveFirebaseApp({ getApps, initializeApp }, config, "public-invitation");
    return { app, db: getFirestore(app), config };
  });
}

// One-time seating links exchange for a narrowly scoped custom token. Keep that
// identity on its own named app so it cannot replace a planner session.
export function initSeatingEditorFirebase() {
  return serviceCache.get("seating-editor", () => {
    if (!isFirebaseConfigured()) {
      throw new Error("Firebase config is missing. Add window.FIREBASE_CONFIG in firebase-config.js.");
    }

    const config = { ...defaultConfig, ...(window.FIREBASE_CONFIG || {}) };
    const app = resolveFirebaseApp({ getApps, initializeApp }, config, "seating-editor");
    const auth = initializeAuth(app, { persistence: browserSessionPersistence });
    const db = getFirestore(app);
    const functions = getFunctions(app, "us-central1");
    const persistenceReady = auth.authStateReady();

    return { app, auth, db, functions, config, persistenceReady };
  });
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
  signInWithCustomToken,
  signOut,
  httpsCallable,
  updateDoc,
  where,
  writeBatch,
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
