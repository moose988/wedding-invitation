import test from "node:test";
import assert from "node:assert/strict";
import { EVENT_CATEGORIES, eventUsesGuestSides, getDefaultGuestSide, getEventCategory, getEventDisplayTitle, isCelebrationEvent, isWeddingEvent } from "../event-utils.js";

test("legacy event documents default to wedding behavior and derive a safe title", () => {
  assert.equal(getEventCategory({}), EVENT_CATEGORIES.WEDDING_ENGAGEMENT);
  assert.equal(isWeddingEvent({}), true);
  assert.equal(isCelebrationEvent({}), false);
  assert.equal(eventUsesGuestSides({}), true);
  assert.equal(getDefaultGuestSide({}), "bride");
  assert.equal(getEventDisplayTitle({ coupleName: "Layla & Zaid" }), "Layla & Zaid");
  assert.equal(getEventDisplayTitle({ brideName: "Layla", groomName: "Zaid" }), "Layla & Zaid");
  assert.equal(getEventDisplayTitle({}), "Untitled event");
});

test("celebrations use their title and neutral guest grouping", () => {
  const event = { eventCategory: "celebration", eventTitle: "Ahmed’s Graduation" };
  assert.equal(getEventCategory(event), EVENT_CATEGORIES.CELEBRATION);
  assert.equal(isCelebrationEvent(event), true);
  assert.equal(isWeddingEvent(event), false);
  assert.equal(eventUsesGuestSides(event), false);
  assert.equal(getDefaultGuestSide(event), "general");
  assert.equal(getEventDisplayTitle(event), "Ahmed’s Graduation");
  assert.equal(getEventDisplayTitle({ ...event, eventTitle: "  ", coupleName: "Made Up Couple", brideName: "Bride", groomName: "Groom" }), "Untitled event");
});

test("unknown category values safely retain legacy wedding behavior", () => {
  assert.equal(getEventCategory({ eventCategory: "other" }), EVENT_CATEGORIES.WEDDING_ENGAGEMENT);
});
