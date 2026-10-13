import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { assignmentsForGuest, summarizePartySeating } from "../seating-utils.js";

const source = await readFile(new URL("../dashboard.js", import.meta.url), "utf8");

function extractFunction(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`\nfunction ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `${name} function exists`);
  return source.slice(start, end);
}

const functionSources = [
  extractFunction("normalizeAdditionalGuests", "getPartySize"),
  extractFunction("getPartySize", "personKeyForIndex"),
  extractFunction("getGuestDocumentId", "uniqueGuestsFromAssignments"),
  extractFunction("calculateGuestDirectoryCounts", "hydrateHallObjects"),
  extractFunction("calculateGuestDirectoryCounts", "hydrateHallObjects"),
  extractFunction("calculateDashboardStats", "calculateAttention"),
  extractFunction("calculateAttention", "deriveRecentActivity"),
  extractFunction("deriveRecentActivity", "calculateSideStats"),
  extractFunction("calculateSideStats", "emptySideBucket"),
  extractFunction("emptySideBucket", "getFilteredGuests"),
  extractFunction("percentage", "formatEventDate"),
  extractFunction("toTimeValue", "getInitials"),
  extractFunction("formatTimestamp", "toTimeValue"),
  extractFunction("renderKpiCard", "renderDistributionRow"),
  extractFunction("renderDistributionRow", "progressRow"),
  extractFunction("progressRow", "renderGuestRow"),
  extractFunction("renderOverviewPage", "renderGuestPage"),
];

function makeHarness(guests, tables, { seatingEnabled = true, checkInEnabled = true } = {}) {
  const state = {
    loadingGuests: false,
    loadingTables: false,
    guests,
    tables,
    wedding: {
      id: "fixture-event",
      eventType: "wedding",
      status: "active",
      eventDateISO: "2026-12-28T17:30:00.000Z",
      venueEn: "Pearl Ballroom",
      seatingEnabled,
      showInvitationQr: checkInEnabled,
    },
  };
  const elements = { pageContent: { innerHTML: "" } };
  const allAssignments = tables.flatMap((table) =>
    (table.chairs || []).filter((chair) => chair.guestId).map((chair) => ({
      ...chair,
      tableId: table.id,
    })),
  );
  const getGuestAssignedSeats = (guestId, selectedTables = state.tables) =>
    assignmentsForGuest(
      selectedTables.flatMap((table) =>
        (table.chairs || []).filter((chair) => chair.guestId).map((chair) => ({
          ...chair,
          tableId: table.id,
        })),
      ),
      guestId,
    );
  const getGuestRemainingSeats = (guest, selectedTables = state.tables) =>
    summarizePartySeating(guest, getGuestAssignedSeats(guest.id, selectedTables)).remainingCount;
  const context = vm.createContext({
    state,
    elements,
    assignmentsForGuest,
    summarizePartySeating,
    getGuestAssignedSeats,
    getGuestRemainingSeats,
    getTableAssignments: (tableId) => allAssignments.filter((assignment) => assignment.tableId === tableId),
    countAssignedSeats: (selectedTables) => selectedTables.reduce((sum, table) => sum + (table.chairs || []).filter((chair) => chair.guestId).length, 0),
    isSeatingEnabled: () => seatingEnabled,
    isInvitationQrEnabled: () => checkInEnabled,
    eventUsesGuestSides: () => true,
    getEventDisplayTitle: (wedding) => wedding?.eventTitle || "Test event",
    formatEventDate: () => "Dec 28, 2026",
    prettifyShape: (value) => value,
    escapeHtml: (value) => String(value),
  });
  vm.runInContext(functionSources.join("\n"), context);
  return { context, state, elements };
}

function fixtureData() {
  const guests = [
    { id: "g1", fullName: "Same Name", phone: "1", side: "groom", rsvpStatus: "confirmed", additionalGuests: 1, checkedIn: true },
    { id: "g2", fullName: "Same Name", phone: "2", side: "bride", rsvpStatus: "confirmed", additionalGuests: 2 },
    { id: "g3", fullName: "Unseated", phone: "", side: "groom", rsvpStatus: "confirmed", additionalGuests: 0 },
    { id: "g4", fullName: "Pending", phone: "4", side: "family", rsvpStatus: "pending", additionalGuests: 1 },
    { id: "g5", fullName: "Declined but seated", phone: "5", side: "family", rsvpStatus: "declined", checkedIn: false },
  ];
  const chairs = [
    { id: "a1", guestId: "g1", partyMemberIndex: 0 },
    { id: "a2", guestId: "g2", partyMemberIndex: 0 },
    { id: "b1", guestId: "g1", partyMemberIndex: 1 },
    { id: "b2", guestId: "g5", partyMemberIndex: 0 },
    { id: "c1", guestId: "g2", partyMemberIndex: 1 },
    { id: "c2", guestId: "", partyMemberIndex: 0 },
  ];
  const tables = [
    { id: "t1", seatCount: 2, chairs: chairs.slice(0, 2) },
    { id: "t2", seatCount: 2, chairs: chairs.slice(2, 4) },
    { id: "t3", seatCount: 2, chairs: chairs.slice(4, 6) },
  ];
  return { guests, tables };
}

test("overview calculations use invitations for RSVP and capacity counts use individual chairs", () => {
  const { guests, tables } = fixtureData();
  const { context } = makeHarness(guests, tables);
  const stats = context.calculateDashboardStats(guests, tables);
  const sides = context.calculateSideStats(guests, tables);

  // These expected values are independently counted from the fixture above:
  // 5 invitation records contain 9 people; 3 parties confirmed, 1 pending,
  // 1 declined; 5 occupied chairs across 6 chairs of capacity.
  assert.deepEqual(JSON.parse(JSON.stringify(stats)), {
    total: 5,
    accompanyingGuests: 4,
    totalPeople: 9,
    confirmed: 3,
    pending: 1,
    declined: 1,
    checkedIn: 1,
    notCheckedIn: 4,
    totalSeats: 6,
    seatedGuests: 3,
    assignedSeats: 5,
    unassignedGuests: 3,
    remainingSeats: 1,
    withoutSeat: 2,
    confirmedPct: 60,
    pendingPct: 20,
    declinedPct: 20,
    checkinPct: 20,
    withoutSeatPct: 67,
  });
  assert.equal(sides.groom.guestCount, 2);
  assert.equal(sides.groom.confirmed, 2);
  assert.equal(sides.groom.seated, 1);
  assert.equal(sides.bride.confirmedSeats, 3);
  assert.equal(sides.bride.seated, 0);
  assert.equal(sides.other.declined, 1);

  context.renderOverviewPage();
  const html = context.elements.pageContent.innerHTML;
  assert.match(html, /Total invited[\s\S]*?<div class="kpi-card__value">5<\/div>[\s\S]*?9 people total/);
  assert.match(html, /Confirmed[\s\S]*?<div class="kpi-card__value">3<\/div>[\s\S]*?60% of parties/);
  assert.match(html, /Seating attention[\s\S]*?<div class="kpi-card__value">2<\/div>[\s\S]*?67% of confirmed/);
  assert.match(html, /Assigned seats<\/span><\/div>[\s\S]*?<strong>2<\/strong><span>Confirmed parties needing seats/);
  assert.match(html, /1 declined guest still seated/);
  assert.match(html, /Guest distribution/);
});

test("empty overview has zero denominators, no false attention, and no NaN percentages", () => {
  const { context, elements } = makeHarness([], []);
  const stats = context.calculateDashboardStats([], []);
  assert.equal(stats.total, 0);
  assert.equal(stats.totalPeople, 0);
  assert.equal(stats.confirmedPct, 0);
  assert.equal(stats.withoutSeatPct, 0);
  assert.deepEqual(Array.from(context.calculateAttention([], [], true)), []);
  context.renderOverviewPage();
  assert.match(elements.pageContent.innerHTML, /Total invited[\s\S]*?<div class="kpi-card__value">0<\/div>/);
  assert.doesNotMatch(elements.pageContent.innerHTML, /NaN|Infinity/);
  assert.match(elements.pageContent.innerHTML, /Everything is in good shape/);
  assert.match(elements.pageContent.innerHTML, /No recent activity yet/);
});

test("missing RSVP status and numeric-string companion counts produce Overview inconsistencies", () => {
  const guest = {
    id: "legacy-guest",
    fullName: "Legacy Guest",
    phone: "123",
    side: "bride",
    additionalGuests: "2",
  };
  const { context, elements } = makeHarness([guest], []);
  const stats = context.calculateDashboardStats([guest], []);
  const sides = context.calculateSideStats([guest], []);

  // The sidebar party-size helper accepts numeric strings, while the people
  // total normalizes numeric strings. A missing RSVP is also treated as
  // pending by the side breakdown but omitted from all three status totals.
  assert.equal(stats.totalPeople, 3);
  assert.equal(sides.bride.partyTotal, 3);
  assert.equal(stats.pending, 0);
  assert.equal(sides.bride.pending, 1);
  context.renderOverviewPage();
  assert.match(elements.pageContent.innerHTML, /3 people total/);
  assert.match(elements.pageContent.innerHTML, /Pending<\/span>[\s\S]*?<td data-label="Pending">1<\/td>/);
});

test("recent activity is a current-timestamp summary and can label a non-RSVP edit as an RSVP", () => {
  const guest = {
    id: "same-name-doc-1",
    fullName: "Same Name",
    rsvpStatus: "pending",
    createdAt: "2026-01-01T10:00:00.000Z",
    // This may have been written by any guest edit; the document has no
    // timestamp or event type that proves an RSVP changed at this time.
    updatedAt: "2026-01-02T10:00:00.000Z",
    reminderSentAt: "2026-01-03T10:00:00.000Z",
  };
  const { context } = makeHarness([guest], []);
  const activity = context.deriveRecentActivity([guest]);
  assert.deepEqual(Array.from(activity, (item) => item.title), [
    "Reminder prepared for Same Name",
    "Same Name RSVP is pending",
    "Same Name added to the event",
  ]);
  assert.equal(activity[1].type, "rsvp");
  assert.equal(activity[1].sortKey, Date.parse("2026-01-02T10:00:00.000Z"));
});

test("relative legacy timestamps are not ordered chronologically", () => {
  const guest = {
    id: "legacy-time-guest",
    fullName: "Legacy Time Guest",
    rsvpStatus: "confirmed",
    checkedInAt: "Today, 7:42 PM",
    updatedAt: "Today, 7:42 PM",
    createdAt: "Today, 1:02 PM",
    reminderSentAt: "Today, 6:20 PM",
  };
  const { context } = makeHarness([guest], []);
  const activity = context.deriveRecentActivity([guest]);
  assert.deepEqual(Array.from(activity, (item) => item.sortKey), [0, 0, 0, 0]);
  assert.deepEqual(Array.from(activity, (item) => item.type), ["checkin", "rsvp", "guest", "reminder"]);
});
