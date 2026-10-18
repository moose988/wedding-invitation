import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../dashboard.js", import.meta.url), "utf8");

function extractFunction(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`\nfunction ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `${name} function exists`);
  return source.slice(start, end);
}

const overviewSource = extractFunction("renderOverviewPage", "renderGuestPage");
const attentionSource = extractFunction("calculateAttention", "deriveRecentActivity");
const usableSeatsSource = extractFunction("getTableUsableSeatCapacity", "deriveRecentActivity");

function renderOverview({ seatingEnabled, checkInEnabled }) {
  const state = {
    loadingGuests: false,
    loadingTables: false,
    guests: [],
    tables: [],
    wedding: { status: "active", eventDateISO: "2026-12-28", venueEn: "Venue" },
  };
  const elements = { pageContent: { innerHTML: "" } };
  const context = vm.createContext({
    state,
    elements,
    isSeatingEnabled: () => seatingEnabled,
    isInvitationQrEnabled: () => checkInEnabled,
    canViewDashboardPage: () => true,
    calculateDashboardStats: () => ({
      total: 3, totalPeople: 5, accompanyingGuests: 2,
      confirmed: 1, confirmedPct: 33, pending: 1, pendingPct: 33,
      declined: 1, declinedPct: 33, checkedIn: 1, checkinPct: 33,
      withoutSeat: 1, withoutSeatPct: 100, assignedSeats: 1, totalSeats: 2, remainingSeats: 1,
    }),
    calculateAttention: () => [],
    normalizeAdditionalGuests: (value) => Math.max(0, Number(value) || 0),
    escapeHtml: (value) => String(value),
    getEventDisplayTitle: () => "Test event",
    prettifyShape: (value) => value,
    formatEventDate: () => "Dec 28, 2026",
  });
  vm.runInContext(`${usableSeatsSource}; ${overviewSource}; renderOverviewPage();`, context);
  return elements.pageContent.innerHTML;
}

test("overview combines invitation counts and hides seating summary when seating is disabled", () => {
  const allEnabled = renderOverview({ seatingEnabled: true, checkInEnabled: true });
  assert.match(allEnabled, /overview-total--invitations[\s\S]*?<strong>3<\/strong><span>Invitations/);
  assert.match(allEnabled, /data-rsvp="confirmed"/);
  assert.match(allEnabled, /data-rsvp="pending"/);
  assert.match(allEnabled, /data-rsvp="declined"/);
  assert.match(allEnabled, /Open seating plan/);
  assert.match(allEnabled, /data-action="nav-checkin">Check-in/);
  assert.doesNotMatch(allEnabled, /Response progress|Guest distribution|Recent activity/);

  const disabledOptions = renderOverview({ seatingEnabled: false, checkInEnabled: false });
  assert.match(disabledOptions, /data-rsvp="declined"/);
  assert.doesNotMatch(disabledOptions, /Open seating plan|overviewSeatingTitle/);
  assert.doesNotMatch(disabledOptions, /data-action="nav-checkin"/);
});

test("seating attention issues disappear when seating is disabled", () => {
  const guests = [
    { id: "confirmed", fullName: "Confirmed", phone: "1", rsvpStatus: "confirmed", remainingSeats: 1 },
    { id: "declined", fullName: "Declined", phone: "2", rsvpStatus: "declined", assigned: true },
    { id: "pending", fullName: "Pending", phone: "3", rsvpStatus: "pending" },
  ];
  const context = vm.createContext({
    getGuestRemainingSeats: (guest) => guest.remainingSeats || 0,
    getTableAssignments: (tableId) => tableId === "full" ? ["a", "b"] : [],
    getGuestAssignedSeats: (guestId) => guestId === "declined" ? ["table::1"] : [],
  });
  vm.runInContext(attentionSource, context);
  const calculateAttention = vm.runInContext("calculateAttention", context);
  const enabled = calculateAttention(guests, [{ id: "full", seatCount: 1 }], true);
  const disabled = calculateAttention(guests, [{ id: "full", seatCount: 1 }], false);
  assert.ok(enabled.some((issue) => issue.kind === "missing-seats" && issue.unit === "invitations"));
  assert.ok(enabled.some((issue) => issue.kind === "capacity" && issue.unit === "tables"));
  assert.ok(enabled.some((issue) => issue.kind === "conflict" && issue.unit === "invitations"));
  assert.ok(!disabled.some((issue) => ["missing-seats", "capacity", "conflict"].includes(issue.kind)));
  assert.ok(disabled.some((issue) => issue.kind === "pending" && issue.rsvp === "pending"));
});
