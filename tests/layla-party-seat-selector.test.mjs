import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getPartySeatSelection,
  resolvePartySeatTarget,
  retainPartySeatSelection,
} from "../invitations/wedding-designs/layla-zaid/party-seat-selector.js";

const tables = [
  { id: "table-east", chairs: [{ id: "east-chair-4", seatNumber: 4 }, { id: "east-chair-7", seatNumber: 7 }] },
  { id: "table-west", chairs: [{ id: "west-chair-2", seatNumber: 2 }, { id: "west-chair-9", seatNumber: 9 }] },
];

test("party member selection resolves the stable chair on the assigned table, independent of selector number", () => {
  const members = [
    { personKey: "main", index: 0, assignment: { tableId: "table-east", chairId: "east-chair-7", seatNumber: "7" } },
    { personKey: "guest-1", index: 1, assignment: { tableId: "table-west", chairId: "west-chair-9", seatNumber: "9" } },
  ];

  assert.deepEqual(getPartySeatSelection("guest-1", members, tables), {
    member: members[1],
    target: { tableId: "table-west", chairId: "west-chair-9", seatNumber: "9" },
  });
  assert.equal(members[1].index + 1, 2);
  assert.equal(getPartySeatSelection("guest-1", members, tables).target.seatNumber, "9");
});

test("legacy assignments resolve by table and seat number, then expose the stable chair id", () => {
  assert.deepEqual(resolvePartySeatTarget({ tableId: "table-west", seatNumber: "2" }, tables), {
    tableId: "table-west", chairId: "west-chair-2", seatNumber: "2",
  });
});

test("unassigned members stay selectable without a map target, and stale chair ids never fall back to another chair", () => {
  const members = [
    { personKey: "guest-2", index: 2, assignment: null },
    { personKey: "guest-3", index: 3, assignment: { tableId: "table-east", chairId: "removed-chair", seatNumber: "7" } },
  ];

  assert.equal(getPartySeatSelection("guest-2", members, tables).member, members[0]);
  assert.equal(getPartySeatSelection("guest-2", members, tables).target, null);
  assert.equal(getPartySeatSelection("guest-3", members, tables).member, members[1]);
  assert.equal(getPartySeatSelection("guest-3", members, tables).target, null);
  assert.equal(resolvePartySeatTarget({ tableId: "deleted-table", seatNumber: "2" }, tables), null);
});

test("selection persists across live member updates while that person remains in the party", () => {
  const before = [{ personKey: "main" }, { personKey: "guest-1" }, { personKey: "guest-2" }];
  const afterAssignmentChange = [{ personKey: "main" }, { personKey: "guest-1" }, { personKey: "guest-2" }];
  const afterPartyReduction = [{ personKey: "main" }, { personKey: "guest-1" }];

  assert.equal(retainPartySeatSelection("guest-2", before), "guest-2");
  assert.equal(retainPartySeatSelection("guest-2", afterAssignmentChange), "guest-2");
  assert.equal(retainPartySeatSelection("guest-2", afterPartyReduction), "");
});

test("Layla selector uses HTML-numbered transparent chair art and focuses exact selected targets", async () => {
  const [script, styles, html] = await Promise.all([
    readFile(new URL("../script.js", import.meta.url), "utf8"),
    readFile(new URL("../invitations/wedding-designs/layla-zaid/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../invitations/wedding-designs/layla-zaid/index.html", import.meta.url), "utf8"),
  ]);
  const section = html.match(/<section[^>]*id="seatingSection"[\s\S]*?<\/section>/)?.[0] || "";

  assert.match(script, /layla-party-chair__number[^>]*>\$\{member\.index \+ 1\}/);
  assert.match(script, /focusInvitationChair\(target\)/);
  assert.match(script, /if \(state\.seatPlanViewMode === "person"\)[\s\S]*?focusInvitationChair/);
  assert.match(script, /state\.seatPlanSelectedTarget/);
  assert.match(script, /\.seat-plan-chair\.is-selected/);
  assert.match(script, /aria-pressed="\$\{selected\}"/);
  assert.doesNotMatch(script.match(/function renderLaylaPartyChairMember[\s\S]*?function bindLaylaPartySeatSelector/)?.[0] || "", /disabled/);
  assert.match(styles, /\.layla-party-seat-selector\s*\{[\s\S]*?flex-wrap:\s*nowrap[\s\S]*?overflow-x:\s*auto/);
  assert.match(styles, /\.layla-party-chair:focus-visible/);
  assert.match(styles, /\.layla-party-chair\.is-selected/);
  assert.match(styles, /\.layla-party-chair\s*\{[\s\S]*?flex:\s*0 0 min\(25vw, 132px\)/);
  assert.match(section, /seating-section-label[\s\S]*?<\/p>[\s\S]*?class="section-heading[\s\S]*?id="seatDetailsMount"[\s\S]*?class="seating-content-outline"/);
  assert.match(section, /seating-content-outline"><div class="seating-map-shell"><div class="seating-map"/);
});
