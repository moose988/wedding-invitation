const defaultFirebaseConfig = {
  apiKey: "AIzaSyAHxFrozdw0Pi8fItdrim18uqtqN4EO-7I",
  authDomain: "weddinginvitaion-b4f36.firebaseapp.com",
  projectId: "weddinginvitaion-b4f36",
  storageBucket: "weddinginvitaion-b4f36.firebasestorage.app",
  messagingSenderId: "868779408613",
  appId: "1:868779408613:web:96b330cb386ec2fcefa80c",
  measurementId: "G-GD5D6WJRB0",
};

export function getFirebaseConfig(overrides = {}) {
  if (typeof window !== "undefined") {
    window.FIREBASE_CONFIG = window.FIREBASE_CONFIG || { ...defaultFirebaseConfig };
  }
  return { ...defaultFirebaseConfig, ...(globalThis.window?.FIREBASE_CONFIG || {}), ...overrides };
}

export function isFirebaseConfigAvailable() {
  const config = getFirebaseConfig();
  return ["apiKey", "authDomain", "projectId", "appId"].every((key) => Boolean(config[key]));
}
