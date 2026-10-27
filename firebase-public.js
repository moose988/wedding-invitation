import { getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { createScopedServiceCache, resolveFirebaseApp } from "./firebase-service-scopes.js";
import { getFirebaseConfig, isFirebaseConfigAvailable } from "./firebase-settings.js";

const serviceCache = createScopedServiceCache();
const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
if (localHost && new URLSearchParams(window.location.search).get("emulator") === "1") {
  sessionStorage.setItem("wedding:localEmulators", "1");
}
const localEmulators = localHost && sessionStorage.getItem("wedding:localEmulators") === "1";

export function isFirebaseConfigured() {
  return isFirebaseConfigAvailable();
}

export function initPublicFirebase() {
  return serviceCache.get("public-invitation", () => {
    if (!isFirebaseConfigured()) throw new Error("Firebase config is missing.");
    const config = getFirebaseConfig(localEmulators ? { projectId: "demo-wedding-security", apiKey: "demo-key" } : {});
    const app = resolveFirebaseApp({ getApps, initializeApp }, config, "public-invitation");
    const db = getFirestore(app);
    if (localEmulators) connectFirestoreEmulator(db, "127.0.0.1", 8080);
    return { app, db, config };
  });
}

export { collection, doc, getDoc, onSnapshot, serverTimestamp, writeBatch };
