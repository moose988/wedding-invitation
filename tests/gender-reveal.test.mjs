import assert from "node:assert/strict";
import test from "node:test";
import { eventDateTimeParts, localDateTimeToIso } from "../event-date-time.js";
import { EVENT_CATEGORIES, eventUsesGuestSides, getDefaultGuestSide, getEventCategory, getEventDisplayTitle, isGenderRevealEvent } from "../event-utils.js";
import { publicEventData } from "../event-publishing.js";
import { buildInvitationProjection } from "../invitations/shared/invitation-token.js";
import { validateGenderRevealResponse } from "../gender-reveal-submission.js";
import { genderRevealEmulatorFixture } from "./fixtures/gender-reveal-event.mjs";

test("Gender Reveal category uses general attendees and preserves legacy category defaults", () => {
  const event = { eventCategory: "gender_reveal", eventTitle: "Gender Reveal Party" };
  assert.equal(getEventCategory(event), EVENT_CATEGORIES.GENDER_REVEAL);
  assert.equal(isGenderRevealEvent(event), true);
  assert.equal(eventUsesGuestSides(event), false);
  assert.equal(getDefaultGuestSide(event), "general");
  assert.equal(getEventDisplayTitle(event), "Gender Reveal Party");
  assert.equal(getEventCategory({ eventCategory: "celebration" }), EVENT_CATEGORIES.CELEBRATION);
  assert.equal(getEventCategory({}), EVENT_CATEGORIES.WEDDING_ENGAGEMENT);
  assert.equal(getDefaultGuestSide({}), "bride");
});

test("shared response validates types, lengths, attendance and prediction while allowing a declined attendee to predict", () => {
  assert.deepEqual(validateGenderRevealResponse({
    fullName: "  Example Guest ", attendance: "not_attending", prediction: "girl", message: "Congratulations!",
  }), {
    fullName: "Example Guest", attendance: "not_attending",
    prediction: "girl", message: "Congratulations!",
  });
  assert.throws(() => validateGenderRevealResponse({ fullName: " ", attendance: "attending", prediction: "boy" }), /Full name/);
  assert.throws(() => validateGenderRevealResponse({ fullName: "A", attendance: "maybe", prediction: "boy" }), /attend/);
  assert.throws(() => validateGenderRevealResponse({ fullName: "A", attendance: "attending", prediction: "unknown" }), /boy or girl/);
  assert.throws(() => validateGenderRevealResponse({ fullName: "A", attendance: "attending", prediction: "boy", message: "x".repeat(1001) }), /1,000/);
  assert.equal(Object.hasOwn(validateGenderRevealResponse({ fullName: "A", attendance: "attending", prediction: "boy" }), "phoneE164"), false);
});

test("fixture date is stored as Dubai local time without a UTC date shift", () => {
  assert.equal(genderRevealEmulatorFixture.eventDateISO, "2026-11-15T10:00:00.000Z");
  assert.equal(genderRevealEmulatorFixture.eventTimeZone, "Asia/Dubai");
  assert.deepEqual(eventDateTimeParts(genderRevealEmulatorFixture.eventDateISO, "Asia/Dubai"), { date: "2026-11-15", time: "14:00" });
  assert.equal(localDateTimeToIso("2026-11-15", "14:00", "Asia/Dubai"), "2026-11-15T10:00:00.000Z");
  assert.equal(genderRevealEmulatorFixture.venueEn, "");
  assert.equal(genderRevealEmulatorFixture.mapsUrl, "");
});

test("public event projection exposes only sanitized event configuration and never couple identities for this category", () => {
  const projection = publicEventData({ ...genderRevealEmulatorFixture, brideName: "Private Bride", groomName: "Private Groom", coupleName: "Private Couple" });
  assert.equal(projection.eventTitle, "Gender Reveal Party");
  assert.equal(projection.eventTitleAr, "حفل الكشف عن جنس المولود");
  assert.equal(projection.eventCategory, "gender_reveal");
  assert.equal(projection.eventStatus, "active");
  assert.equal(projection.coupleName, "");
  assert.equal(projection.brideName, "");
  assert.equal(projection.groomName, "");
  assert.equal(projection.showInvitationQr, false);
  assert.equal(projection.seatingEnabled, false);
  assert.equal("guestGroupMode" in projection, false);
  assert.deepEqual(Object.keys(projection).sort(), [
    "brideName", "brideNameAr", "coupleName", "eventCategory", "eventDateISO", "eventStatus", "eventTimeZone",
    "eventTitle", "eventTitleAr", "genderRevealArtworkUrl", "genderRevealMessageAr", "genderRevealMessageEn",
    "genderRevealMusicUrl", "genderRevealOpeningVideoUrl", "groomName", "groomNameAr", "invitationLanguage",
    "invitationMessageAr", "invitationMessageEn", "location", "locationEn", "mapsUrl", "rsvpDeadlineISO",
    "schedule", "scheduleCount", "seatingEnabled", "showInvitationQr", "subtitleAr", "subtitleEn", "timeAr",
    "timeEn", "venueEn", "venueMapEmbedUrl",
  ].sort());
});

test("legacy bearer invitation projection preserves category accuracy without exposing couple identity", () => {
  const projection = buildInvitationProjection("event", {
    ...genderRevealEmulatorFixture, brideName: "Private Bride", groomName: "Private Groom", coupleName: "Private Couple",
  }, { fullName: "Guest", additionalGuests: 0, additionalGuestAllowance: 0 }, [], { canonicalLayout: true });
  assert.equal(projection.wedding.eventCategory, "gender_reveal");
  assert.equal(projection.wedding.coupleName, "");
  assert.equal(projection.wedding.brideName, "");
  assert.equal(projection.wedding.groomName, "");
  assert.equal(projection.wedding.showInvitationQr, false);
  assert.equal(projection.wedding.seatingEnabled, false);
});
