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
const kpiSource = extractFunction("renderKpiCard", "renderDistributionRow");
const distributionRowSource = extractFunction("renderDistributionRow", "progressRow");

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
    calculateDashboardStats: () => ({
      total: 3, totalPeople: 5, accompanyingGuests: 2,
      confirmed: 1, confirmedPct: 33, pending: 1, pendingPct: 33,
      declined: 1, declinedPct: 33, checkedIn: 1, checkinPct: 33,
      withoutSeat: 1, withoutSeatPct: 100, assignedSeats: 1, remainingSeats: 1,
    }),
    calculateAttention: () => [],
    deriveRecentActivity: () => [],
    calculateSideStats: () => ({
      groom: { guestCount: 1, confirmed: 1, pending: 0, seated: 0 },
      bride: { guestCount: 1, confirmed: 0, pending: 1, seated: 0 },
      other: { guestCount: 1, confirmed: 0, pending: 0, seated: 0 },
    }),
    eventUsesGuestSides: () => true,
    escapeHtml: (value) => String(value),
    getEventDisplayTitle: () => "Test event",
    prettifyShape: (value) => value,
    formatEventDate: () => "Dec 28, 2026",
    progressRow: () => "",
  });
  vm.runInContext(`${kpiSource}; ${distributionRowSource}; ${overviewSource}; renderOverviewPage();`, context);
  return elements.pageContent.innerHTML;
}

test("overview summary reflects RSVP statuses and hides disabled feature summaries", () => {
  const allEnabled = renderOverview({ seatingEnabled: true, checkInEnabled: true });
  assert.match(allEnabled, /<p class="da3wa-eyebrow">Declined<\/p>[\s\S]*?<div class="kpi-card__value">1<\/div>/);
  assert.match(allEnabled, /<p class="da3wa-eyebrow">Seating attention<\/p>[\s\S]*?<div class="kpi-card__value">1<\/div>/);
  assert.match(allEnabled, /<p class="da3wa-eyebrow">Checked in<\/p>[\s\S]*?<div class="kpi-card__value">1<\/div>/);
  assert.match(allEnabled, /Seating readiness/);
  assert.match(allEnabled, /data-label="Seating"/);

  const disabledOptions = renderOverview({ seatingEnabled: false, checkInEnabled: false });
  assert.match(disabledOptions, /<p class="da3wa-eyebrow">Declined<\/p>/);
  assert.doesNotMatch(disabledOptions, /Seating attention/);
  assert.doesNotMatch(disabledOptions, /Checked in/);
  assert.doesNotMatch(disabledOptions, /Seating readiness/);
  assert.doesNotMatch(disabledOptions, /data-label="Seating"/);
  assert.match(disabledOptions, /overview-operational--no-seating/);
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
  assert.ok(enabled.some((issue) => /without tables/.test(issue.title)));
  assert.ok(enabled.some((issue) => /over capacity/.test(issue.title)));
  assert.ok(enabled.some((issue) => /still seated/.test(issue.title)));
  assert.ok(!disabled.some((issue) => /without tables|over capacity|still seated/.test(issue.title)));
  assert.ok(disabled.some((issue) => /pending RSVP/.test(issue.title)));
});
