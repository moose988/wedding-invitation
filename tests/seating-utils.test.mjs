import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assignmentsForGuest,
  buildChairPositions,
  buildSeatAssignmentKeys,
  defaultTableHeight,
  defaultTableWidth,
  generateTableChairs,
  getSeatPlanFrameBounds,
  normalizeTableShape,
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

test("legacy table shapes map to the supported editable shapes and retain sensible defaults", () => {
  assert.equal(normalizeTableShape("horseshoe"), "u-shape");
  assert.equal(normalizeTableShape("open-u"), "u-shape");
  assert.equal(normalizeTableShape("conference"), "rectangle");
  assert.equal(normalizeTableShape("long-banquet"), "rectangle");
  assert.equal(defaultTableWidth("horseshoe"), defaultTableWidth("u-shape"));
  assert.equal(defaultTableHeight("conference"), defaultTableHeight("rectangle"));
});

test("remaining table geometries create unique, outside chair positions at supported counts", () => {
  for (const shape of ["round", "rectangle", "square", "u-shape", "horseshoe", "conference"]) {
    for (const count of [2, 8, 12, 30]) {
      const width = shape === "round" ? 180 : 120;
      const height = shape === "round" ? 180 : 80;
      const chairs = buildChairPositions(shape, count, width, height);
      assert.equal(chairs.length, count, `${shape} has ${count} chairs`);
      assert.equal(new Set(chairs.map(({ x, y }) => `${x.toFixed(3)}:${y.toFixed(3)}`)).size, count);
      const points = chairs.map((chair) => ({ x: (chair.x - 50) * width / 100, y: (chair.y - 50) * height / 100 }));
      for (let left = 0; left < points.length; left += 1) {
        for (let right = left + 1; right < points.length; right += 1) {
          const distance = Math.hypot(points[left].x - points[right].x, points[left].y - points[right].y);
          assert.ok(distance >= 33, `${shape} ${count}: chairs ${left + 1} and ${right + 1} overlap (${distance.toFixed(1)}px)`);
        }
      }
      if (normalizeTableShape(shape) === "u-shape") {
        assert.ok(chairs.every((chair) => chair.x < 0 || chair.x > 100 || chair.y < 0), "U chairs stay on the outside and leave the opening clear");
      } else if (normalizeTableShape(shape) !== "round") {
        assert.ok(chairs.some((chair) => chair.x < 0 || chair.x > 100 || chair.y < 0 || chair.y > 100), "perimeter chairs sit outside the table edges");
      }
    }
  }
});

test("changing a table shape keeps stable seat IDs and assignment identities", () => {
  const initial = generateTableChairs("square", 4, 170, 170, [], "table-a");
  initial[1].id = "legacy-chair-b";
  initial[1].guestId = "guest-42";
  initial[1].assignment = { guestId: "guest-42", partyMemberIndex: 1, seatNumber: 2 };
  const edited = generateTableChairs("u-shape", 4, 220, 180, initial, "table-a");
  assert.deepEqual(edited.map((chair) => chair.seatNumber), [1, 2, 3, 4]);
  assert.equal(edited[1].id, "legacy-chair-b");
  assert.equal(edited[1].guestId, "guest-42");
  assert.equal(edited[1].assignment.partyMemberIndex, 1);
  assert.deepEqual(edited.map((chair) => chair.id), ["table-a-chair-1", "legacy-chair-b", "table-a-chair-3", "table-a-chair-4"]);
});

test("invitation party keys highlight only that party and frame seats across tables", () => {
  const assignments = [
    { tableId: "table-a", seatNumber: 1 },
    { tableId: "table-a", seatNumber: 2 },
    { tableId: "table-a", seatNumber: 3 },
    { tableId: "table-b", seatNumber: 4 },
    { tableId: "table-b", seatNumber: 5 },
  ];
  const keys = buildSeatAssignmentKeys(assignments);
  assert.deepEqual([...keys], ["table-a::1", "table-a::2", "table-a::3", "table-b::4", "table-b::5"]);
  assert.equal(keys.has("table-a::4"), false);
  const bounds = getSeatPlanFrameBounds([
    { id: "table-a", x: 10, y: 15, width: 170, height: 170, seatCount: 8 },
    { id: "table-b", x: 85, y: 78, width: 220, height: 140, rotation: 90, seatCount: 8 },
    { id: "other", x: 50, y: 50, width: 420, height: 320 },
  ], assignments);
  assert.ok(bounds.minX < 110 && bounds.minY < 108);
  assert.ok(bounds.maxX > 850 && bounds.maxY > 650);
  assert.equal(getSeatPlanFrameBounds([], []), null);
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
  assert.match(dashboard, /function syncGuestSeatingSummaries\(guests, tables\)/);
  assert.match(dashboard, /nextGuests = syncGuestSeatingSummaries\(state\.guests, nextTables\)/);
  assert.doesNotMatch(dashboard, /syncPublicGuest\(/);
  assert.match(invitation, /resolveTableName\(table\)/);
  assert.match(side, /name: resolveTableName\(table\)/);
  assert.match(side, /tableName: resolveTableName\(table\)/);
});
