import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");

test("planner zoom scales the complete map layer and keeps zoom controls outside it", async () => {
  const [dashboard, css] = await Promise.all([
    read("dashboard.js"),
    read("dashboard.css"),
  ]);
  const tableRenderer = dashboard.slice(
    dashboard.indexOf("function renderPlannerTable("),
    dashboard.indexOf("function renderPlannerChair("),
  );
  const zoomSetter = dashboard.slice(
    dashboard.indexOf("function setPlannerZoom("),
    dashboard.indexOf("function loadSeatingTestGuests("),
  );
  const seatingRenderer = dashboard.slice(
    dashboard.indexOf("function renderSeatingPage("),
    dashboard.indexOf("function renderPlannerStatCard("),
  );

  assert.doesNotMatch(tableRenderer, /scale\(\$\{state\.plannerZoom\}\)/);
  assert.match(seatingRenderer, /planner-canvas-viewport/);
  assert.match(seatingRenderer, /planner-map-extent/);
  assert.match(seatingRenderer, /planner-canvas-controls/);
  assert.match(css, /body\.is-seating-view \.planner-canvas\s*\{[\s\S]*?transform: scale\(var\(--planner-zoom\)\)/);
  assert.match(css, /\.planner-canvas-viewport\s*\{[\s\S]*?overflow: auto/);
  assert.match(zoomSetter, /capturePlannerViewportCenter\(\)/);
  assert.match(zoomSetter, /state\.plannerZoom = clamp\(nextZoom, 0\.7, 1\.6\)/);
  assert.doesNotMatch(zoomSetter, /updateDoc|setDoc|writeBatch|persistDemoDashboardState/);
});

test("drag conversion uses logical map dimensions and does not rerender while moving", async () => {
  const dashboard = await read("dashboard.js");
  const pointerMove = dashboard.slice(
    dashboard.indexOf("function handlePlannerPointerMove("),
    dashboard.indexOf("async function handlePlannerPointerUp("),
  );

  assert.match(pointerMove, /\/ state\.dragState\.zoom \/ logicalWidth/);
  assert.match(pointerMove, /\/ state\.dragState\.zoom \/ logicalHeight/);
  assert.match(pointerMove, /state\.dragState\.node\.style\.left/);
  assert.doesNotMatch(pointerMove, /renderActiveView\(\)/);
});

test("guest inspector locates by guest ID and keeps incomplete parties in needs-seats", async () => {
  const dashboard = await read("dashboard.js");
  const inspector = dashboard.slice(
    dashboard.indexOf("function renderSeatingGuestsTab("),
    dashboard.indexOf("function openSeatingGuestFlow("),
  );
  const locate = dashboard.slice(
    dashboard.indexOf("function locateSeatingGuest("),
    dashboard.indexOf("function openSeatingGuestFlow("),
  );

  assert.match(inspector, /summarizePartySeating\(guest, assignments\)/);
  assert.match(inspector, /state\.seatingGuestFilter === "unassigned"\) return needsSeats\(\{ seating \}\)/);
  assert.match(inspector, /data-action="locate-seating-guest" data-guest-id="\$\{escapeAttribute\(guest\.id\)\}"/);
  assert.match(inspector, /data-action="open-seating-for-guest"/);
  assert.match(locate, /state\.activePartyGuestId = guest\.id/);
  assert.match(locate, /state\.selectedTableId = assignments\[0\]\.tableId/);
  assert.match(locate, /scrollPlannerToElement/);
  assert.match(dashboard, /assignment\?\.guestId && assignment\.guestId === state\.activePartyGuestId/);
});

test("desktop sidebar preference is separate from the accessible mobile drawer", async () => {
  const [dashboard, html, css] = await Promise.all([
    read("dashboard.js"),
    read("dashboard.html"),
    read("dashboard.css"),
  ]);

  assert.match(html, /id="desktopSidebarToggleButton" aria-controls="dashboardSidebar" aria-expanded="true"/);
  assert.match(html, /id="sidebarCloseButton" aria-label="Close navigation"/);
  assert.match(dashboard, /dashboardSidebarStorageKey,[\s\S]*?state\.sidebarCollapsed \? "1" : "0"/);
  assert.match(dashboard, /event\.key === "Tab"[\s\S]*?state\.sidebarOpen[\s\S]*?focusable/);
  assert.match(dashboard, /function closeMobileSidebar\(\)[\s\S]*?elements\.seatingMobileNavButton[\s\S]*?elements\.navToggleButton\)\?\.focus\(\)/);
  assert.match(css, /\.da3wa-app\.is-sidebar-collapsed\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 1180px\)[\s\S]*?\.da3wa-sidebar-desktop-toggle\s*\{\s*display: none/);
});
