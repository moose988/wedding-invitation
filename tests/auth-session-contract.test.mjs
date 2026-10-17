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
  assert.match(invitation, /loadInvitationContext\(/);
  assert.doesNotMatch(invitation, /initFirebase\(\)|signInWithEmailAndPassword|signOut\(/);
  assert.match(publicData, /getDoc\(doc\(db, "weddings", weddingId, "publicGuests", guestToken\)\)/);
  assert.doesNotMatch(publicData, /httpsCallable/);

  const dashboardInitializer = firebase.match(/export function initFirebase\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(dashboardInitializer, "dashboard initializer exists");
  assert.match(dashboardInitializer, /getConfiguredApp\("planner-session"\)/);
  assert.match(dashboardInitializer, /initializeAuth\(app, \{ persistence: browserSessionPersistence \}\)/);
  assert.match(dashboardInitializer, /auth\.authStateReady\(\)/);
});

test("each custom invitation design routes through the public data initializer", async () => {
  const [layla, ali, fallback, fallbackHtml] = await Promise.all([
    read("../invitations/wedding-designs/layla-zaid/invitation.js"),
    read("../invitations/wedding-designs/ali-salma/invitation.js"),
    read("../invitations/wedding-designs/fallback/invitation.js"),
    read("../invitations/wedding-designs/fallback/index.html"),
  ]);
  assert.match(layla, /\.\.\/\.\.\/\.\.\/script\.js/);
  assert.match(ali, /\.\.\/\.\.\/shared\/invitation-data\.js/);
  const redirect = await read("../fallback-redirect.js");
  assert.match(redirect, /target\.hash = window\.location\.hash/);
  assert.match(redirect, /window\.location\.replace/);
  for (const entry of [layla, ali, fallback, fallbackHtml]) {
    assert.doesNotMatch(entry, /signOut|signInAnonymously|signInWithCustomToken|localStorage\.clear|sessionStorage\.clear/);
  }
});

test("planner sessions are tab-scoped and public invitations stay separate", () => {
  assert.match(firebase, /getConfiguredApp\("planner-session"\)/);
  assert.match(firebase, /initializeAuth\(app, \{ persistence: browserSessionPersistence \}\)/);
  assert.match(firebase, /resolveFirebaseApp\(\{ getApps, initializeApp \}, config, "public-invitation"\)/);
  assert.match(dashboard, /initializeFirebaseServicesForRoute\(\{\}, \{ dashboard: initFirebase \}\)/);
  assert.match(dashboard, /await waitForFirebaseSessionPersistence\(state\.services\)/);
  assert.match(login, /initializeFirebaseServicesForRoute\([\s\S]*?\{ dashboard: initFirebase \}/);
  assert.match(login, /servicesReady = waitForFirebaseSessionPersistence\(services\)/);
  assert.match(dashboard, /state\.permissions\.seatingOnly === true/);
  assert.match(side, /state\.services\.auth\.authStateReady\(\)/);
  assert.match(side, /dashboardUsers", user\.uid/);
  assert.doesNotMatch(side, /signInWithCustomToken|httpsCallable|setInterval/);
  assert.doesNotMatch(firebase, /firebase\/functions|httpsCallable|getFunctions/);
  assert.match(dashboard, /signOut\(state\.services\.auth\)/);
  assert.match(login, /params\.get\("workspace"\) === "side"/);
});

test("only explicit dashboard action signs out and login preserves restored sessions", () => {
  assert.doesNotMatch(login, /\bsignOut\b/);
  assert.match(dashboard, /signOutButton\?\.addEventListener\("click"/);
  assert.match(dashboard, /await signOut\(state\.services\.auth\)/);
});

test("default and public Firebase apps resolve correctly in either initialization order", () => {
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
  const publicApp = resolveFirebaseApp(api, config, "public-invitation");
  const dashboard = resolveFirebaseApp(api, config);

  assert.equal(publicApp.name, "public-invitation");
  assert.equal(dashboard.name, "[DEFAULT]");
  assert.notEqual(publicApp, dashboard);
  assert.equal(resolveFirebaseApp(api, config, "public-invitation"), publicApp);
  assert.equal(resolveFirebaseApp(api, config), dashboard);

  const namedFirst = [{ name: "public-invitation" }];
  const defaultApp = resolveFirebaseApp({
    getApps: () => namedFirst,
    initializeApp: (appConfig, name) => ({ name: name || "[DEFAULT]", config: appConfig }),
  }, config);
  assert.equal(defaultApp.name, "[DEFAULT]");
});

test("all authenticated routes use the same per-tab dashboard Auth session", () => {
  const cache = createScopedServiceCache();
  let dashboardCreates = 0;
  let publicCreates = 0;
  const dashboardApp = { name: "[DEFAULT]" };
  const createDashboard = () => {
    dashboardCreates += 1;
    return { app: dashboardApp, auth: { app: dashboardApp }, db: { app: dashboardApp } };
  };
  const createPublic = () => {
    publicCreates += 1;
    return { app: { name: "public-invitation" }, db: {} };
  };
  const cachedDashboard = cache.get("dashboard", createDashboard);
  const cachedPublic = cache.get("public", createPublic);
  assert.equal(cache.get("dashboard", createDashboard), cachedDashboard);
  assert.equal(cache.get("public", createPublic), cachedPublic);
  assert.equal(dashboardCreates, 1);
  assert.equal(publicCreates, 1);

  const select = (route) => initializeFirebaseServicesForRoute(route, {
    dashboard: () => cachedDashboard,
    public: () => cachedPublic,
  });
  assert.equal(select({}).auth.app, dashboardApp);
  assert.equal(select({ seatingOnly: true }).auth.app, dashboardApp);
  assert.equal(select({ seatingEditor: true }).auth.app, dashboardApp);
  assert.equal(select({}).db.app, dashboardApp);
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

test("successful login preserves the authorized event workspace context", () => {
  const dashboardUrl = buildAuthRouteUrl("./dashboard.html", {
    weddingId: "event-42",
    side: "bride",
  });
  const loginUrl = buildAuthRouteUrl("./dashboard-login.html", {
    weddingId: "event-42",
    side: "groom",
    workspace: "side",
    message: "access-denied",
  });
  assert.equal(dashboardUrl, "./dashboard.html?wedding=event-42&side=bride");
  assert.equal(loginUrl, "./dashboard-login.html?wedding=event-42&side=groom&workspace=side&message=access-denied");
  assert.equal(buildAuthRouteUrl("./dashboard.html", { weddingId: "event-42", side: "admin" }), "./dashboard.html?wedding=event-42");
  assert.match(login, /params\.get\("workspace"\) === "side"/);
  assert.match(login, /target\.searchParams\.set\("wedding", weddingId\)/);
  assert.doesNotMatch(login, /signOut\(/);
  assert.doesNotMatch(dashboard, /httpsCallable|getFunctions/);
});
