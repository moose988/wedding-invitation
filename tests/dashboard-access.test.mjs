import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canViewSeatingAccountPage, resolveSeatingAccountPage } from "../dashboard-access.js";

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
  assert.match(dashboard, /button\.hidden = !canViewSeatingAccountPage\(button\.dataset\.navView, state\.permissions\)/);
  assert.match(dashboard, /state\.activeView === "seating"/);
  assert.match(dashboard, /const guestSource = scopeGuestsToEditorSide[\s\S]*?: collection\(state\.services\.db, "weddings", state\.weddingId, "guests"\)/);
});
