import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");

test("Groom and Bride side links require authenticated, side-scoped seating access", async () => {
  const dashboard = await read("dashboard.js");
  const login = await read("dashboard-login.js");

  assert.match(dashboard, /\["bride", "groom"\]\.includes\(side\)/);
  assert.match(dashboard, /dashboard-login\.html\?\$\{managerParams\.toString\(\)\}/);
  assert.match(dashboard, /seatingOnly: "1"/);
  assert.match(dashboard, /requestedSeatingSide && requestedSeatingSide !== allowedSide/);
  assert.match(login, /nextParams\.set\("side", requestedSeatingSide\)/);
});

test("seat-only guest writes are restricted to seating fields and the allowed side", async () => {
  const rules = await read("firestore.rules");

  assert.match(rules, /function isSeatingOnlyDashboardAccount/);
  assert.match(rules, /allowedSide in \["bride", "groom"\]/);
  assert.match(rules, /normalizedGuestSide\(guest\) == dashboardUser\(weddingId\)\.data\.allowedSide/);
  assert.match(rules, /affectedKeys\(\)\.hasOnly\(\[\s*"tableId",\s*"tableName",\s*"seatNumber",\s*"seatingAssignments",\s*"updatedAt"/s);
  assert.match(rules, /isSeatingOnlyDashboardAccount\(weddingId\)[\s\S]*?hasOnly\(\["chairs", "guestIds", "updatedAt"\]\)/);
  assert.doesNotMatch(rules, /affectedKeys\(\)\.hasOnly\(\[[^\]]*"phone"/s);
});

test("Family remains a public status page and cannot receive a manager link", async () => {
  const dashboard = await read("dashboard.js");

  assert.match(dashboard, /if \(\["bride", "groom"\]\.includes\(side\) && state\.mode !== "demo"\)/);
  assert.match(dashboard, /`side\.html\?\$\{linkParams\.toString\(\)\}`/);
});
