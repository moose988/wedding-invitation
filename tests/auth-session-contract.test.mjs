import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [login, dashboard, firebase, publicData, invitation, side] = await Promise.all([
  read("../dashboard-login.js"),
  read("../dashboard.js"),
  read("../firebase-config.js"),
  read("../invitations/shared/invitation-data.js"),
  read("../script.js"),
  read("../side.js"),
]);

test("public invitation initialization cannot mutate Firebase Auth persistence", () => {
  const publicInitializer = firebase.match(/export function initPublicFirebase\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(publicInitializer, "public Firestore initializer exists");
  assert.match(publicInitializer, /initializeApp\(config, "public-invitation"\)/);
  assert.match(publicInitializer, /getFirestore\(app\)/);
  assert.doesNotMatch(publicInitializer, /getAuth|setPersistence|signIn|signOut|onAuthStateChanged/);
  assert.match(publicData, /initPublicFirebase\(\)/);
  assert.doesNotMatch(publicData, /initFirebase\(\)/);
  assert.match(invitation, /initPublicFirebase\(\)/);
  assert.doesNotMatch(invitation, /initFirebase\(\)/);
  assert.match(invitation, /invitation-data\.js\?v=20261013-auth-session-isolation-2/);

  const dashboardInitializer = firebase.match(/export function initFirebase\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(dashboardInitializer, "dashboard initializer exists");
  assert.match(dashboardInitializer, /getAuth\(app\)/);
  assert.doesNotMatch(dashboardInitializer, /setPersistence\(/);
});

test("each custom invitation design routes through the public data initializer", async () => {
  const [layla, ali, fallback, fallbackHtml] = await Promise.all([
    read("../invitations/wedding-designs/layla-zaid/invitation.js"),
    read("../invitations/wedding-designs/ali-salma/invitation.js"),
    read("../invitations/wedding-designs/fallback/invitation.js"),
    read("../invitations/wedding-designs/fallback/index.html"),
  ]);
  assert.match(layla, /\.\.\/\.\.\/\.\.\/script\.js/);
  assert.match(ali, /\.\.\/\.\.\/shared\/invitation-data\.js\?v=20261013-auth-session-isolation-2/);
  assert.match(fallbackHtml, /location\.replace/);
  for (const entry of [layla, ali, fallback, fallbackHtml]) {
    assert.doesNotMatch(entry, /signOut|signInAnonymously|signInWithCustomToken|localStorage\.clear|sessionStorage\.clear/);
  }
});

test("restricted seating-link token auth is isolated from dashboard owner auth", () => {
  assert.match(firebase, /initializeApp\(config, "seating-editor"\)/);
  assert.match(firebase, /setPersistence\(auth, browserSessionPersistence\)/);
  assert.match(dashboard, /state\.services = initSeatingEditorFirebase\(\)/);
  assert.match(dashboard, /state\.services = initFirebase\(\)/);
  assert.match(side, /editorToken\s*\?\s*initSeatingEditorFirebase\(\)/);
  assert.match(side, /signInWithCustomToken\(services\.auth/);
});

test("only explicit dashboard action signs out and login preserves restored sessions", () => {
  assert.doesNotMatch(login, /\bsignOut\b/);
  assert.match(dashboard, /signOutButton\?\.addEventListener\("click"/);
  assert.match(dashboard, /await signOut\(state\.services\.auth\)/);
});
