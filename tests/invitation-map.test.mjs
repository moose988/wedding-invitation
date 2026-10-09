import test from "node:test";
import assert from "node:assert/strict";
import { buildSatelliteMapEmbedUrl } from "../invitations/shared/map-embed.js";

test("satellite preview is not emitted without a key or named venue", () => {
  assert.equal(buildSatelliteMapEmbedUrl({ venueEn: "Pearl Ballroom", locationEn: "Dubai" }, ""), "");
  assert.equal(buildSatelliteMapEmbedUrl({ locationEn: "Dubai" }, "restricted-key"), "");
});

test("satellite preview is tied to the current event venue and carries the documented satellite mode", () => {
  const url = new URL(buildSatelliteMapEmbedUrl({ venueEn: "Pearl Ballroom", locationEn: "Dubai, UAE" }, "restricted-key"));
  assert.equal(url.origin, "https://www.google.com");
  assert.equal(url.pathname, "/maps/embed/v1/place");
  assert.equal(url.searchParams.get("q"), "Pearl Ballroom, Dubai, UAE");
  assert.equal(url.searchParams.get("maptype"), "satellite");
  assert.equal(url.searchParams.get("key"), "restricted-key");
});

test("an exact venue place ID takes precedence when one is supplied", () => {
  const url = new URL(buildSatelliteMapEmbedUrl({ venueEn: "Venue", venuePlaceId: "ChIJexact123" }, "restricted-key"));
  assert.equal(url.searchParams.get("q"), "place_id:ChIJexact123");
});

test("an event-specific Google Maps share embed URL works without an API key", () => {
  const supplied = "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3884.645870813754!2d55.12983347537994!3d25.139942477747873!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3e5f154a3af8b24f%3A0x6607557459d2717c!2sSofitel%20Dubai%20The%20Palm!5e1!3m2!1sen!2sae!4v1791536214433!5m2!1sen!2sae";
  assert.equal(buildSatelliteMapEmbedUrl({ venueEn: "Sofitel Dubai The Palm", venueMapEmbedUrl: supplied }, ""), supplied);
});

test("event map embeds reject non-Google hosts and non-embed URLs", () => {
  assert.equal(buildSatelliteMapEmbedUrl({ venueEn: "Venue", venueMapEmbedUrl: "https://example.com/maps/embed?pb=abc" }, ""), "");
  assert.equal(buildSatelliteMapEmbedUrl({ venueEn: "Venue", venueMapEmbedUrl: "https://www.google.com/maps?q=Venue" }, ""), "");
});
