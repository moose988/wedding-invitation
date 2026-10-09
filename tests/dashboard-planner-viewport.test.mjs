import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");

test("planner zoom and pan operate on the complete map layer with a stable logical center", async () => {
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
  assert.match(css, /\.planner-canvas-viewport\s*\{[\s\S]*?overflow: hidden/);
  assert.match(seatingRenderer, /Reset view/);
  // Mobile intentionally permits a wider minimum zoom so the full seating
  // canvas can be explored on narrow viewports; desktop keeps its 0.7 floor.
  assert.match(zoomSetter, /const minimumZoom = window\.matchMedia\("\(max-width: 700px\)"\)\.matches \? 0\.35 : 0\.7/);
  assert.match(zoomSetter, /state\.plannerZoom = clamp\(nextZoom, minimumZoom, 1\.6\)/);
  assert.match(dashboard, /type: "pan"[\s\S]*?startCenter: \{ \.\.\.state\.plannerViewCenter \}/);
  assert.match(dashboard, /x: state\.dragState\.startCenter\.x - dx \/ state\.dragState\.zoom/);
  assert.match(dashboard, /function resetPlannerView\(\)[\s\S]*?state\.plannerViewCenter =/);
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

test("guest selection highlights the party while preserving the planner view", async () => {
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
  assert.match(inspector, /all: total\.all \+ seating\.requiredCount/);
  assert.match(inspector, /assigned: total\.assigned \+ seating\.assignedCount/);
  assert.match(inspector, /unassigned: total\.unassigned \+ seating\.remainingCount/);
  assert.match(inspector, /state\.seatingGuestFilter === "assigned"\) return seating\.assignedCount > 0/);
  assert.match(inspector, /state\.seatingGuestFilter === "unassigned"\) return needsSeats\(\{ seating \}\)/);
  assert.match(inspector, /data-action="locate-seating-guest" data-guest-id="\$\{escapeAttribute\(guest\.id\)\}"/);
  assert.match(inspector, /data-action="open-seating-for-guest"/);
  assert.match(locate, /state\.activePartyGuestId = guest\.id/);
  assert.match(locate, /const pageScroll = \{ x: window\.scrollX, y: window\.scrollY \}/);
  assert.match(locate, /const plannerViewCenter = state\.plannerViewCenter/);
  assert.match(locate, /focus\(\{ preventScroll: true \}\)/);
  assert.match(locate, /window\.scrollTo\(pageScroll\.x, pageScroll\.y\)/);
  assert.doesNotMatch(locate, /state\.selectedTableId\s*=|scrollPlannerToElement/);
  assert.match(dashboard, /assignment\?\.guestId && assignment\.guestId === state\.activePartyGuestId/);
});

test("mobile seating modes keep the desktop planner markup and selected venue list accessible", async () => {
  const [dashboard, css] = await Promise.all([
    read("dashboard.js"),
    read("dashboard.css"),
  ]);
  const seatingRenderer = dashboard.slice(
    dashboard.indexOf("function renderSeatingPage("),
    dashboard.indexOf("function renderPlannerStatCard("),
  );
  const library = dashboard.slice(
    dashboard.indexOf("function renderLayoutLibrary("),
    dashboard.indexOf("function renderAssignmentLibrary("),
  );
  assert.match(dashboard, /mobileSeatingMode: "assign"/);
  assert.match(dashboard, /function renderMobileSeatingPage\(/);
  assert.match(dashboard, /renderMobileSeatingPage\(\{ selectedTable, selectedHallObject, seatingStats, sideStats, isSaving \}\)/);
  assert.match(dashboard, /function handleMobileMapTouchMove\(/);
  assert.match(dashboard, /session\.mobileDirectAssignment/);
  assert.doesNotMatch(dashboard, /state\.seatingMode|data-action="set-seating-mode"|planner-toggle/);
  assert.doesNotMatch(seatingRenderer, /planner-canvas__header|Venue canvas|Ballroom layout builder|Seat assignment workspace/);
  assert.match(library, /aria-pressed="\$\{table\.id === state\.selectedTableId\}"/);
  assert.match(library, /aria-pressed="\$\{item\.id === state\.selectedHallObjectId\}"/);
  assert.match(css, /\.planner-table-list__button\.is-selected\s*\{[\s\S]*?background: linear-gradient/);
  assert.match(css, /\.planner-table-list__button:focus-visible\s*\{[\s\S]*?outline: 3px solid/);
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
  assert.match(css, /\.da3wa-app\.is-sidebar-collapsed\s*\{\s*grid-template-columns: 76px minmax\(0, 1fr\)/);
  assert.match(css, /\.da3wa-app\.is-sidebar-collapsed > \.da3wa-sidebar\s*\{\s*display: grid/);
  assert.match(css, /\.da3wa-app\.is-sidebar-collapsed \.da3wa-nav-label,/);
  assert.match(html, /data-nav-view="settings" title="Event Settings" aria-label="Event Settings"/);
  assert.match(css, /@media \(max-width: 1180px\)[\s\S]*?\.da3wa-sidebar-desktop-toggle\s*\{\s*display: none/);
});
