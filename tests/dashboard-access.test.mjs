import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canViewDashboardPage,
  canViewSeatingAccountPage,
  resolveDashboardPage,
  resolveSeatingAccountPage,
} from "../dashboard-access.js";

test("restricted seating workspace allows only overview, guests, seating, and explicitly granted settings", () => {
  const permissions = {
    seatingOnly: true,
    canViewDashboard: true,
    canEditSeating: true,
    canEditEventDetails: true,
    allowedSide: "bride",
  };

  for (const view of ["overview", "guests", "seating", "settings"]) {
    assert.equal(canViewSeatingAccountPage(view, permissions), true, `${view} should be available`);
  }
  for (const view of ["share", "exports", "checkin", "guestSummary", "allEvents"]) {
    assert.equal(canViewSeatingAccountPage(view, permissions), false, `${view} should stay unavailable`);
  }
  assert.equal(resolveSeatingAccountPage("share", permissions), "seating");
});

test("restricted workspace hides All Events and does not side-filter the Guests or Overview page", async () => {
  const [html, css, dashboard] = await Promise.all([
    readFile(new URL("../dashboard.html", import.meta.url), "utf8"),
    readFile(new URL("../dashboard.css", import.meta.url), "utf8"),
    readFile(new URL("../dashboard.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="allEventsNavLink"/);
  assert.match(css, /\.da3wa-sidebar \[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  assert.match(dashboard, /allEventsNavLink\.hidden = isAccountSeatingWorkspace \|\| state\.secureEditorMode/);
  assert.match(dashboard, /button\.hidden = !canViewDashboardPage\(button\.dataset\.navView, state\.permissions\)/);
  assert.match(dashboard, /state\.activeView === "seating"/);
  assert.match(dashboard, /const guestSource = scopeGuestsToEditorSide[\s\S]*?: collection\(state\.services\.db, "weddings", state\.weddingId, "guests"\)/);
});

test("limited dashboard accounts can open only their explicitly granted sections", () => {
  const permissions = {
    canViewDashboard: true,
    canEditGuests: true,
    canEditSeating: true,
    canCheckIn: false,
    canManageUsers: false,
    canEditEventDetails: false,
    canViewEventSettings: true,
    canExport: true,
    allowedViews: ["overview", "guests", "seating", "settings", "exports"],
  };

  for (const view of permissions.allowedViews) {
    assert.equal(canViewDashboardPage(view, permissions), true, `${view} should be available`);
  }
  for (const view of ["share", "checkin", "guestSummary", "allEvents"]) {
    assert.equal(canViewDashboardPage(view, permissions), false, `${view} should be unavailable`);
  }
  assert.equal(resolveDashboardPage("share", permissions), "overview");
  assert.equal(canViewDashboardPage("settings", { ...permissions, canViewEventSettings: false }), false);
  assert.equal(canViewDashboardPage("exports", { ...permissions, canExport: false }), false);
  assert.equal(canViewDashboardPage("overview", { ...permissions, canViewDashboard: false }), false);
});

test("limited dashboard links are guarded and the owner control writes only event-scoped access", async () => {
  const [dashboard, rules, workspace] = await Promise.all([
    readFile(new URL("../dashboard.js", import.meta.url), "utf8"),
    readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
    readFile(new URL("../weddings.js", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /button\.hidden = !canViewDashboardPage\(button\.dataset\.navView, state\.permissions\)/);
  assert.match(dashboard, /if \(!canViewDashboardPage\(view, state\.permissions\)\) return;/);
  const limitedProfileWriter = dashboard.match(/async function saveLimitedDashboardAccount\(event\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(limitedProfileWriter, "owner-only limited dashboard writer should exist");
  assert.match(limitedProfileWriter, /allowedViews: \["overview", "guests", "seating", "settings", "exports"\]/);
  assert.match(limitedProfileWriter, /canEditGuests: currentPermissions\.canEditGuests === true/);
  assert.match(limitedProfileWriter, /canEditSeating: currentPermissions\.canEditSeating === true/);
  assert.match(limitedProfileWriter, /canEditEventDetails: currentPermissions\.canEditEventDetails === true/);
  assert.match(limitedProfileWriter, /canViewEventSettings: true,[\s\S]*?canExport: true/);
  assert.match(rules, /"canViewEventSettings", "canExport", "allowedViews"/);
  assert.match(rules, /data\.allowedViews\.hasOnly\(\["overview", "guestSummary", "guests", "seating", "share", "exports", "checkin", "settings"\]\)/);
  assert.match(workspace, /w\.allowedViews\.includes\("share"\)/);
});
