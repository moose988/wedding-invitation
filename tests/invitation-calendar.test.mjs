import test from "node:test";
import assert from "node:assert/strict";
import { buildInvitationCalendar } from "../invitations/shared/calendar.js";

test("calendar output is a valid UTC event with stable identity and escaped data", () => {
  const wedding = {
    eventTitle: "Layla & Zaid",
    eventDateISO: "2026-12-20T20:00:00+04:00",
    venueEn: "Sofitel Dubai The Palm",
    locationEn: "Palm Jumeirah, Dubai",
    mapsUrl: "https://maps.example.test/a,b",
    invitationMessageEn: "Join us;\nwe cannot wait.",
  };
  const first = buildInvitationCalendar(wedding, "wedding-1", "2026-01-01T00:00:00Z");
  const second = buildInvitationCalendar(wedding, "wedding-1", "2026-01-01T00:00:00Z");
  assert.equal(first, second);
  assert.match(first, /BEGIN:VCALENDAR\r\nVERSION:2\.0/);
  assert.match(first, /BEGIN:VEVENT[\s\S]*END:VEVENT/);
  assert.match(first, /UID:wedding-1@invitation\.qdsystems\.ae/);
  assert.match(first, /DTSTART:20261220T160000Z/);
  assert.match(first, /SUMMARY:Layla & Zaid/);
  assert.ok(first.includes(String.raw`Sofitel Dubai The Palm\, Palm Jumeirah\, Dubai`));
  assert.ok(first.includes(String.raw`Join us\;\nwe cannot wait.`));
  assert.doesNotMatch(first, /DTEND:/);
});

test("calendar uses only a configured valid end and folds long UTF-8 lines", () => {
  const ics = buildInvitationCalendar({
    eventDateISO: "2026-12-20T20:00:00+04:00",
    eventEndDateISO: "2026-12-20T23:30:00+04:00",
    eventTitle: "ع".repeat(100),
  }, "wedding-2");
  assert.match(ics, /DTEND:20261220T193000Z/);
  const physicalLines = ics.split("\r\n");
  assert.ok(physicalLines.filter(Boolean).every((line) => new TextEncoder().encode(line).length <= 75));
  assert.ok(physicalLines.some((line) => line.startsWith(" ")));
  assert.throws(() => buildInvitationCalendar({ eventDateISO: "not a date" }), /valid event start date/);
});
