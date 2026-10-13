import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildAuthRouteUrl,
  createScopedServiceCache,
  initializeFirebaseServicesForRoute,
  resolveFirebaseApp,
  waitForFirebaseSessionPersistence,
} from "../firebase-service-scopes.js";

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
  assert.match(publicInitializer, /resolveFirebaseApp\(\{ getApps, initializeApp \}, config, "public-invitation"\)/);
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
  assert.match(firebase, /resolveFirebaseApp\(\{ getApps, initializeApp \}, config, "seating-editor"\)/);
  assert.match(firebase, /setPersistence\(auth, browserSessionPersistence\)/);
  assert.match(dashboard, /initializeFirebaseServicesForRoute\([\s\S]*?seatingOnly: accountSeatingEditorMode[\s\S]*?seatingEditor: state\.secureEditorMode/);
  assert.match(dashboard, /await waitForFirebaseSessionPersistence\(state\.services\)/);
  assert.match(login, /initializeFirebaseServicesForRoute\([\s\S]*?seatingOnly: seatingOnlyMode/);
  assert.match(login, /servicesReady = waitForFirebaseSessionPersistence\(services\)/);
  assert.match(login, /permission\.seatingOnly !== true/);
  assert.match(side, /initializeFirebaseServicesForRoute\([\s\S]*?seatingEditor: Boolean\(editorToken\)/);
  assert.match(side, /signInWithCustomToken\(services\.auth/);
  assert.match(dashboard, /signOut\(state\.services\.auth\)/);
  assert.match(dashboard, /else if \(accountSeatingEditorMode\)[\s\S]*?redirectToLogin\("access-denied"\)/);
});

test("only explicit dashboard action signs out and login preserves restored sessions", () => {
  assert.doesNotMatch(login, /\bsignOut\b/);
  assert.match(dashboard, /signOutButton\?\.addEventListener\("click"/);
  assert.match(dashboard, /await signOut\(state\.services\.auth\)/);
});

test("default and named Firebase apps resolve correctly in either initialization order", () => {
  const apps = [];
  const api = {
    getApps: () => [...apps],
    initializeApp(config, name) {
      const app = { name: name || "[DEFAULT]", config };
      apps.push(app);
      return app;
    },
  };
  const config = { projectId: "test-project" };
  const seating = resolveFirebaseApp(api, config, "seating-editor");
  const dashboard = resolveFirebaseApp(api, config);

  assert.equal(seating.name, "seating-editor");
  assert.equal(dashboard.name, "[DEFAULT]");
  assert.notEqual(seating, dashboard);
  assert.equal(resolveFirebaseApp(api, config, "seating-editor"), seating);
  assert.equal(resolveFirebaseApp(api, config), dashboard);

  const namedFirst = [{ name: "public-invitation" }];
  const defaultApp = resolveFirebaseApp({
    getApps: () => namedFirst,
    initializeApp: (appConfig, name) => ({ name: name || "[DEFAULT]", config: appConfig }),
  }, config);
  assert.equal(defaultApp.name, "[DEFAULT]");
});

test("service caches and route selection keep dashboard and seating Auth, Firestore, and Functions together", () => {
  const cache = createScopedServiceCache();
  let dashboardCreates = 0;
  let seatingCreates = 0;
  const dashboardApp = { name: "[DEFAULT]" };
  const seatingApp = { name: "seating-editor" };
  const createDashboard = () => {
    dashboardCreates += 1;
    return { app: dashboardApp, auth: { app: dashboardApp }, db: { app: dashboardApp }, functions: { app: dashboardApp } };
  };
  const createSeating = () => {
    seatingCreates += 1;
    return { app: seatingApp, auth: { app: seatingApp }, db: { app: seatingApp }, functions: { app: seatingApp } };
  };
  const cachedDashboard = cache.get("dashboard", createDashboard);
  const cachedSeating = cache.get("seating", createSeating);
  assert.equal(cache.get("dashboard", createDashboard), cachedDashboard);
  assert.equal(cache.get("seating", createSeating), cachedSeating);
  assert.equal(dashboardCreates, 1);
  assert.equal(seatingCreates, 1);

  const select = (route) => initializeFirebaseServicesForRoute(route, {
    dashboard: () => cachedDashboard,
    seating: () => cachedSeating,
  });
  assert.equal(select({}).auth.app, dashboardApp);
  assert.equal(select({ seatingOnly: true }).auth.app, seatingApp);
  assert.equal(select({ seatingEditor: true }).db.app, seatingApp);
  assert.equal(select({ seatingOnly: true }).functions.app, seatingApp);
});

test("seating service readiness blocks until session persistence has completed", async () => {
  let finishPersistence;
  let ready = false;
  const persistenceReady = new Promise((resolve) => {
    finishPersistence = () => { ready = true; resolve(); };
  });
  let resolved = false;
  const readyResult = waitForFirebaseSessionPersistence({ persistenceReady }).then(() => {
    resolved = true;
  });
  await Promise.resolve();
  assert.equal(resolved, false);
  finishPersistence();
  await readyResult;
  assert.equal(ready, true);
  assert.equal(resolved, true);
});

test("login and failure redirects preserve the event, seating mode, side, and message", () => {
  const dashboardUrl = buildAuthRouteUrl("./dashboard.html", {
    weddingId: "event-42",
    seatingOnly: true,
    side: "bride",
  });
  const loginUrl = buildAuthRouteUrl("./dashboard-login.html", {
    weddingId: "event-42",
    seatingOnly: true,
    side: "groom",
    message: "access-denied",
  });
  assert.equal(dashboardUrl, "./dashboard.html?wedding=event-42&seatingOnly=1&side=bride");
  assert.equal(loginUrl, "./dashboard-login.html?wedding=event-42&seatingOnly=1&side=groom&message=access-denied");
  assert.equal(buildAuthRouteUrl("./dashboard.html", { weddingId: "event-42", side: "admin" }), "./dashboard.html?wedding=event-42");
  assert.match(dashboard, /window\.history\.replaceState\([\s\S]*?buildAuthRouteUrl\("\.\/dashboard\.html", \{[\s\S]*?seatingOnly: accountSeatingEditorMode[\s\S]*?side: requestedSeatingSide/);
});
