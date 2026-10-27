// Reuse the existing named planner-session and its tab-scoped persistence.
// Importing config does not initialize Firestore/Analytics. Only Auth is started here.
import { isFirebaseConfigured } from '../firebase-config.js';
import { loginWithReturn } from './return-link.js';
import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { initializeAuth, browserSessionPersistence, connectAuthEmulator, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
export async function requireOwnerSession(onRevoked) {
  // Config's opt-in emulator diagnostics are for legacy Firestore screens.
  // This route never starts Firestore and has no use for those controls.
  document.getElementById('localFirestoreDiagnostics')?.remove();
  if (!isFirebaseConfigured()) throw new Error('Configure the existing planner sign-in before opening Photo Bucket management.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (local && new URLSearchParams(location.search).get('emulator') === '1') sessionStorage.setItem('wedding:localEmulators', '1');
  const emulator = local && sessionStorage.getItem('wedding:localEmulators') === '1';
  const config = { ...window.FIREBASE_CONFIG, ...(emulator ? { projectId: 'demo-wedding-security', apiKey: 'demo-key' } : {}) };
  const app = getApps().find(a => a.name === 'planner-session') || initializeApp(config, 'planner-session');
  const auth = initializeAuth(app, { persistence: browserSessionPersistence });
  if (emulator) connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) { location.replace(loginWithReturn()); throw new Error('Sign in with your existing planner account to continue.'); }
  onAuthStateChanged(auth, current => {
    if (current?.uid !== user.uid) { onRevoked?.(); location.replace('./dashboard-login.html?message=session-required'); }
  });
  return user;
}
