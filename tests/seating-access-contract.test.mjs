import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildAuthRouteUrl } from "../firebase-service-scopes.js";

const root = new URL("../", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");

test("Groom and Bride side links require authenticated, side-scoped seating access", async () => {
  const dashboard = await read("dashboard.js");
  const login = await read("dashboard-login.js");

  assert.match(dashboard, /\["bride", "groom"\]\.includes\(side\)/);
  assert.match(dashboard, /dashboard-login\.html\?\$\{managerParams\.toString\(\)\}/);
  assert.doesNotMatch(dashboard, /seatingOnly: "1"/);
  assert.match(dashboard, /requestedSeatingSide && allowedSide !== "all" && requestedSeatingSide !== allowedSide/);
  assert.match(login, /window\.location\.replace\("\.\/all-events\.html"\)/);
  assert.doesNotMatch(login, /Event Seating Editor|Open seating editor|seatingOnlyMode/);
  assert.equal(buildAuthRouteUrl("./dashboard.html", {
    weddingId: "event-42",
    side: "bride",
  }), "./dashboard.html?wedding=event-42&side=bride");
});

test("seat-only guest writes are restricted to seating fields and the allowed side", async () => {
  const [rules, dashboard] = await Promise.all([read("firestore.rules"), read("dashboard.js")]);

  assert.match(rules, /function isSeatingOnlyDashboardAccount/);
  assert.match(rules, /request\.auth\.token\.get\("seatingEditor", false\) == true/);
  assert.match(rules, /request\.auth\.token\.get\("seatingWeddingId", ""\) == weddingId/);
  assert.match(rules, /data\.get\("seatingOnly", false\) == true/);
  assert.match(rules, /allowedSide in \["bride", "groom", "all"\]/);
  assert.match(rules, /allowedSide == "all"\s*\|\| normalizedGuestSide\(guest\) == dashboardUser\(weddingId\)\.data\.allowedSide/);
  assert.match(rules, /function canManageGuestRecords\(weddingId\)[\s\S]*?data\.get\("seatingOnly", false\) != true/);
  assert.match(rules, /function isGuestSeatingUpdate\(weddingId\)[\s\S]*?return canEditSeating\(weddingId\) &&\s*!isSeatingOnlyDashboardAccount\(weddingId\)/);
  assert.match(rules, /allow update: if canManageSeatingLayout\(weddingId\) &&\s*!isSeatingOnlyDashboardAccount\(weddingId\)/);
  assert.match(rules, /eventCategory", "wedding_engagement"\) == "wedding_engagement"/);
  assert.match(rules, /function seatingAccountMayReadGuest/);
  assert.match(rules, /category == "celebration"\s*\? \(side == "general" \|\| unchangedSide\)/);
  assert.match(rules, /allow create, delete: if canManageSeatingLayout\(weddingId\) &&\s*!isSeatingOnlyDashboardAccount\(weddingId\)/);
  assert.match(rules, /allow update: if canManageSeatingLayout\(weddingId\) &&\s*!isSeatingOnlyDashboardAccount\(weddingId\)/);
  assert.match(dashboard, /function canManageSeatingLayout\(\)\s*\{\s*const explicitLayoutAccess = state\.permissions\?\.canManageSeatingLayout === true;/);
  assert.doesNotMatch(dashboard + rules, /girl@gmail\.com/);
  const sideMutation = (await read("functions/index.js")).slice(
    (await read("functions/index.js")).indexOf("exports.mutateSideSeating"),
  );
  assert.match(sideMutation, /sideMatches\(sourceGuest, access\.role\)/);
  assert.match(sideMutation, /sideMatches\(otherGuest, access\.role\)/);
  assert.match(sideMutation, /partyMemberIndex/);
  assert.match(sideMutation, /personKeys\.has\(key\)/);
});

test("Family remains a public status page and cannot receive a manager link", async () => {
  const dashboard = await read("dashboard.js");

  assert.match(dashboard, /if \(\["bride", "groom"\]\.includes\(side\) && state\.mode !== "demo"\)/);
  assert.match(dashboard, /`side\.html\?\$\{linkParams\.toString\(\)\}`/);
});
