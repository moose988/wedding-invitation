import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");

test("dashboard snapshots replace ID-keyed guest and table collections", async () => {
  const dashboard = await read("dashboard.js");

  assert.match(dashboard, /state\.guests = uniqueRowsById\(snapshot\.docs\.map/);
  assert.match(dashboard, /const nextTables = hydrateTables\(\s*uniqueRowsById\(snapshot\.docs\.map/s);
  assert.match(dashboard, /state\.tables = nextTables;[\s\S]*?if \(state\.layoutPositionSavePending\) return/);
  assert.match(dashboard, /id: docSnapshot\.id/);
  assert.match(dashboard, /const byId = new Map\(\)/);
});

test("luxury-wedding-demo remains a live Firestore wedding unless demo is explicit", async () => {
  const dashboard = await read("dashboard.js");

  assert.match(dashboard, /mode: params\.get\("demo"\) === "1" \? "demo" : "live"/);
  assert.doesNotMatch(
    dashboard,
    /params\.get\("wedding"\) === "luxury-wedding-demo"/,
  );
  assert.match(
    dashboard,
    /collection\(state\.services\.db, "weddings", state\.weddingId, "guests"\)/,
  );
  assert.match(
    dashboard,
    /if \(state\.mode === "demo"\) \{\s*loadDemoDashboard\(\);\s*return;/s,
  );
  const liveBootstrap = dashboard.slice(
    dashboard.indexOf("async function bootstrapDashboard()"),
    dashboard.indexOf("function isWeddingOwner()"),
  );
  assert.doesNotMatch(liveBootstrap, /localStorage|demoSeedGuests|mergeDemoSeedGuests/);
});

test("directory retains separate primary and accompanying guest calculations", async () => {
  const dashboard = await read("dashboard.js");

  assert.match(dashboard, /function calculateGuestDirectoryCounts\(guests\)/);
  assert.match(dashboard, /const primary = guests\.length/);
  assert.match(dashboard, /const accompanying = guests\.reduce/);
  assert.match(dashboard, /people: primary \+ accompanying/);
  assert.doesNotMatch(dashboard, /primary documents Â· .*accompanying guests Â· .*people/);
});

test("dashboard listeners are replaced and stale callbacks are ignored", async () => {
  const dashboard = await read("dashboard.js");

  assert.match(dashboard, /state\.unsubGuests\?\.\(\);\s*state\.unsubTables\?\.\(\);/s);
  assert.match(dashboard, /const generation = \+\+state\.listenerGeneration/);
  assert.match(dashboard, /generation !== state\.listenerGeneration/);
  assert.match(dashboard, /window\.addEventListener\("pagehide", disposeDashboardListeners/);
});

test("dashboard navigation and seating toolbar keep the requested operational order", async () => {
  const [dashboard, html] = await Promise.all([read("dashboard.js"), read("dashboard.html")]);

  const navigation = ["overview", "guests", "seating", "share", "exports", "checkin"];
  const navigationPositions = navigation.map((view) => html.indexOf(`data-nav-view="${view}"`));
  assert.ok(navigationPositions.every((position) => position >= 0));
  assert.deepEqual([...navigationPositions].sort((a, b) => a - b), navigationPositions);
  assert.match(dashboard, /description: "",/);
  assert.match(dashboard, /elements\.pageDescription\.hidden = !elements\.pageDescription\.textContent/);
  assert.match(dashboard, /state\.guestFilters\.search = search\.value;\s*state\.guestPageIndex = 0;\s*closeGuestMenu\(\{ restoreFocus: false \}\);\s*renderGuestDirectoryResults\(\)/);
  assert.doesNotMatch(dashboard, /function restoreGuestSearchFocus\(/);
  assert.match(dashboard, /setPlannerZoom\(state\.plannerZoom \+ 0\.05\)/);
  assert.match(dashboard, /setPlannerZoom\(state\.plannerZoom - 0\.05\)/);
  assert.match(dashboard, /renderPlannerStatCard\(state\.tables\.length, "Tables"\)/);
  assert.match(dashboard, /class="planner-canvas-controls"[\s\S]*?actionButton\("Add table"/);
});

test("wedding list discovers from the private index and authorizes each canonical document", async () => {
  const [weddings, html] = await Promise.all([read("weddings.js"), read("all-events.html")]);

  assert.match(weddings, /collection\(state\.services\.db, "users", state\.user\.uid, "weddingAccess"\)/);
  assert.match(weddings, /doc\(state\.services\.db, "weddings", entry\.id, "dashboardUsers", state\.user\.uid\)/);
  assert.match(weddings, /membership\.data\(\)\.canViewDashboard !== true/);
  assert.match(weddings, /getDoc\(doc\(state\.services\.db, "weddings", entry\.id\)\)/);
  assert.match(weddings, /if \(permissions\.seatingOnly === true\) \{[\s\S]*?return \{ \.\.\.eventSummary, id: entry\.id, isOwner: false, seatingOnly: true, allowedSide: permissions\.allowedSide \|\| "restricted" \};[\s\S]*?const snapshot = await getDoc/);
  assert.match(weddings, /state\.weddings = replaceRowsById\(indexed\.filter\(Boolean\)\)/);
  const discovery = weddings.slice(weddings.indexOf("async function refreshWorkspaceEvents"), weddings.indexOf("function replaceRowsById"));
  assert.doesNotMatch(discovery, /httpsCallable|collectionGroup|where\("status",\s*"==",\s*"active"\)/);
  assert.match(weddings, /error\?\.code \|\| "network error"/);
  assert.match(weddings, /retryLoadButton\.hidden = false/);
  assert.match(html, /id="retryLoadButton"/);
  assert.match(weddings, /workspaceLoaded: false/);
  assert.match(weddings, /state\.weddings\.every\(\(wedding\) => wedding\.seatingOnly === true\)/);
  assert.match(weddings, /generation !== state\.snapshotGeneration/);
  assert.match(weddings, /state\.unsubscribeAuth\?\.\(\)/);
  assert.match(weddings, /Boolean\(!state\.workspaceLoaded \|\| state\.weddings\.length \|\| term \|\| state\.filter !== "all" \|\| el\.retryLoadButton\.hidden === false\)/);
});

test("wedding action menus obey hidden state and close consistently", async () => {
  const [weddings, css] = await Promise.all([read("weddings.js"), read("weddings.css")]);

  assert.match(css, /\.action-menu\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  assert.match(weddings, /document\.addEventListener\("click", \(event\) => \{ if \(!event\.target\.closest\("\.menu-wrap"\)\) closeActionMenus\(\); \}\)/);
  assert.match(weddings, /event\.key === "Escape"\) closeActionMenus\(\)/);
  assert.match(weddings, /function render\(\) \{\s*closeActionMenus\(\);/);
  assert.match(weddings, /closeActionMenus\(menu\); menu\.hidden = !shouldOpen/);
});

test("successful password login starts at All Events even from an event link", async () => {
  const login = await read("dashboard-login.js");

  assert.match(login, /window\.location\.replace\("\.\/all-events\.html"\)/);
  assert.doesNotMatch(login, /params\.get\("wedding"\)|redirectToDashboard/);
  assert.doesNotMatch(login, /seatingOnlyMode/);
});

test("secondary seating and check-in views dispose live listeners", async () => {
  const [side, checkin] = await Promise.all([read("side.js"), read("checkin.js")]);

  assert.match(side, /state\.unsubs\.forEach\(\(stop\) => stop\(\)\)/);
  assert.match(side, /window\.addEventListener\("pagehide", disposeListeners/);
  assert.match(checkin, /state\.unsubGuests\?\.\(\)/);
  assert.match(checkin, /window\.addEventListener\("pagehide", disposeListeners/);
});
