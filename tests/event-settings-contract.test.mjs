import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("Event Settings is a routed event-scoped dashboard page with one shared navigation item", async () => {
  const [html, dashboard, styles] = await Promise.all([read("dashboard.html"), read("dashboard.js"), read("dashboard.css")]);
  assert.match(html, /data-nav-view="settings"[^>]*title="Event Settings"[^>]*aria-label="Event Settings"/);
  assert.match(dashboard, /settings:\s*\{[\s\S]*?title: "Event Settings"/);
  assert.match(dashboard, /state\.activeView = view;[\s\S]*?nextUrl\.searchParams\.set\("view", view\)/);
  assert.match(dashboard, /case "settings":\s*renderEventSettingsPage\(\)/);
  assert.match(dashboard, /button\.dataset\.navView === state\.activeView/);
  assert.match(dashboard, /sidebarCollapsed: loadDesktopSidebarPreference\(\)/);
  assert.match(styles, /\.da3wa-app\.is-sidebar-collapsed \.da3wa-nav-icon/);
});

test("event details validate and persist to the selected event and workspace index", async () => {
  const [dashboard, rules] = await Promise.all([read("dashboard.js"), read("firestore.rules")]);
  assert.match(dashboard, /function validateEventSettingsDraft\(/);
  assert.match(dashboard, /url\.protocol\) \|\| !url\.hostname/);
  assert.match(dashboard, /eventDateISO,\s*timeEn:/);
  assert.match(dashboard, /batch\.update\(doc\(state\.services\.db, "weddings", state\.weddingId\), data\)/);
  assert.match(dashboard, /"users", state\.currentUser\.uid, "weddingAccess", state\.weddingId/);
  assert.match(dashboard, /state\.dirtyEventSettings && view !== state\.activeView/);
  assert.match(rules, /function validEventDetails\(data\)/);
  assert.match(rules, /function isOwnerEventDetailsUpdate\(weddingId\)/);
  assert.match(rules, /data\.eventDateISO\.matches/);
  assert.match(rules, /mapsUrl\.matches/);
  assert.match(dashboard, /venueMapEmbedUrl/);
  assert.match(rules, /venueMapEmbedUrl/);
});

test("QR and seating toggles live only in Settings and serialize rapid writes", async () => {
  const dashboard = await read("dashboard.js");
  const sharePage = dashboard.slice(dashboard.indexOf("function renderSharePage()"), dashboard.indexOf("function eventSettingsDateParts("));
  assert.doesNotMatch(sharePage, /Guest access and seating|toggle-event-qr|toggle-event-seating/);
  assert.match(dashboard, /function queueEventSettingSave\(/);
  assert.match(dashboard, /if \(version !== mutation\.version\) continue/);
  assert.match(dashboard, /mutation\.desired = mutation\.persisted/);
  assert.match(dashboard, /function renderEventSettingsPage\(/);
  assert.match(dashboard, /Show QR code on invitation/);
  assert.match(dashboard, /Enable seating/);
  assert.match(dashboard, /Changes save automatically/);
});

test("completion is an owner lifecycle write and old-event grouping preserves date history", async () => {
  const [dashboard, workspace, workspaceHtml, rules] = await Promise.all([
    read("dashboard.js"),
    read("weddings.js"),
    read("weddings.html"),
    read("firestore.rules"),
  ]);
  assert.match(dashboard, /Mark event as completed/);
  assert.match(dashboard, /Reopen event/);
  assert.match(dashboard, /statusBeforeCompletion/);
  assert.match(dashboard, /completedAt: serverTimestamp\(\)/);
  assert.match(workspaceHtml, /data-filter="old"/);
  assert.match(workspace, /function isOldEvent\(wedding\)[\s\S]*?wedding\.status === "completed"[\s\S]*?eventTime < Date\.now\(\)/);
  assert.match(rules, /function isOwnerLifecycleUpdate\(weddingId\)/);
  assert.match(rules, /isOwnerLifecycleUpdate\(weddingId\)/);
});
