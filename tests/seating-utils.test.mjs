import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assignmentsForGuest,
  resolveTableName,
  summarizePartySeating,
} from "../seating-utils.js";

test("table names prefer name and use label only for legacy documents", () => {
  assert.equal(resolveTableName({ name: "Orchid", label: "Legacy A" }), "Orchid");
  assert.equal(resolveTableName({ name: "  ", label: "Legacy A" }), "Legacy A");
  assert.equal(resolveTableName({ label: "" }), "Table");
});

test("party seat status counts distinct party members for zero, partial, and full seating", () => {
  const guest = { additionalGuests: 2 };
  assert.deepEqual(summarizePartySeating(guest, []), {
    requiredCount: 3,
    assignedCount: 0,
    remainingCount: 3,
    complete: false,
  });
  assert.deepEqual(
    summarizePartySeating(guest, [
      { partyMemberIndex: 0 },
      { partyMemberIndex: 0 },
      { partyMemberIndex: 2 },
    ]),
    {
      requiredCount: 3,
      assignedCount: 2,
      remainingCount: 1,
      complete: false,
    },
  );
  assert.equal(
    summarizePartySeating(guest, [
      { personKey: "main" },
      { personKey: "guest-1" },
      { personKey: "guest-2" },
    ]).complete,
    true,
  );
});

test("chair assignment joins normalize IDs and keep duplicate-name guests distinct", () => {
  const chairs = [
    { guestId: 42, partyMemberIndex: 0 },
    { guestId: "42", partyMemberIndex: 1 },
    { guestId: "other-id", partyMemberIndex: 0 },
  ];
  assert.equal(assignmentsForGuest(chairs, "42").length, 2);
  assert.equal(assignmentsForGuest(chairs, "other-id").length, 1);
  assert.equal(assignmentsForGuest(chairs, "missing").length, 0);
});

test("dashboard table editor and guest filters use the shared compatibility and party rules", async () => {
  const [html, dashboard, invitation, side] = await Promise.all([
    readFile(new URL("../dashboard.html", import.meta.url), "utf8"),
    readFile(new URL("../dashboard.js", import.meta.url), "utf8"),
    readFile(new URL("../script.js", import.meta.url), "utf8"),
    readFile(new URL("../side.js", import.meta.url), "utf8"),
  ]);
  const tableForm = html.match(/<form[^>]*id="tableForm"[\s\S]*?<\/form>/)?.[0] || "";
  assert.match(tableForm, /name="name" required/);
  assert.doesNotMatch(tableForm, /name="label"/);
  assert.match(dashboard, /summarizePartySeating\(guest, assignments\)/);
  assert.match(dashboard, /const needsSeats = \(\{ seating \}\) => seating\.remainingCount > 0/);
  assert.match(dashboard, /assignmentsForGuest\(getAllAssignments\(tables\), guestId\)/);
  assert.match(dashboard, /name: `\$\{resolveTableName\(table\)\} Copy`/);
  assert.match(dashboard, /nextGuests = syncGuestSeatingSummaries\(state\.guests, nextTables\)/);
  assert.match(dashboard, /syncPublicGuest\(nextGuest\.id, nextGuest,\s*\[\s*"seatingAssignments",\s*"tableId",\s*"tableName"/);
  assert.match(invitation, /resolveTableName\(table\)/);
  assert.match(side, /name: resolveTableName\(table\)/);
  assert.match(side, /tableName: resolveTableName\(table\)/);
});
