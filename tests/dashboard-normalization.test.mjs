import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../dashboard.js", import.meta.url), "utf8");
const seating = await readFile(new URL("../seating-firestore.js", import.meta.url), "utf8");
const guestEdit = await readFile(new URL("../guest-edit.js", import.meta.url), "utf8");

test("dashboard does not migrate or normalize canonical records during navigation", () => {
  assert.doesNotMatch(source, /void ensureSeatingSchema\(\)/);
  assert.doesNotMatch(source, /void normalizeGuestSidesInBackground\(\)/);
  assert.match(source, /migrateLegacySeating\(/);
  assert.match(source, /state\.wedding = \{ \.\.\.state\.wedding, seatingSchemaVersion: 2 \}/);
  assert.match(seating, /if \(eventSnapshot\.data\(\)\.seatingSchemaVersion === 2\) return \{ migrated: 0 \}/);
  assert.match(seating, /seatAssignments/);
  assert.match(seating, /seatedPeople/);
  assert.match(seating, /seatingSchemaVersion: 2/);
  assert.doesNotMatch(source, /httpsCallable|getFunctions|normalizeSeatingGuestSides/);
});

test("dashboard maintains private guest projections without exposing manual repair controls", () => {
  assert.match(source, /async function syncPublicStats\(/);
  assert.match(source, /"publicSummary", "summary"/);
  assert.match(source, /"publicStats", "summary"/);
  assert.match(source, /buildSeatingGuestProjection\(guest\)/);
  assert.match(source, /buildCheckinGuestProjection/);
  assert.match(source, /commitGuestEdit/);
  assert.match(guestEdit, /"seatingGuests", guestId/);
  assert.match(guestEdit, /"checkinGuests", guestId/);
  assert.doesNotMatch(source, /repair-event-projections|Repair projections|Manage a seating account/);
  assert.match(source, /updatedAt: serverTimestamp\(\)/);
});
