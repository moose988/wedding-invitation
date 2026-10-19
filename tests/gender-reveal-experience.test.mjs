import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  genderRevealLocalValidation, genderRevealResultSummary, genderRevealSubmissionErrorKey,
  safeGenderRevealMediaUrl,
} from "../gender-reveal-experience.js";
import { normalizeInternationalPhone } from "../gender-reveal-phone.js";
import { spreadsheetSafeText } from "../export.js";

test("repository media paths stay within the site's media directories", () => {
  assert.equal(safeGenderRevealMediaUrl("/images/gender-reveal-cover.png", "https://events.example"), "https://events.example/images/gender-reveal-cover.png");
  assert.equal(safeGenderRevealMediaUrl("/music/gender-reveal-party.mp3", "https://events.example"), "https://events.example/music/gender-reveal-party.mp3");
  assert.equal(safeGenderRevealMediaUrl("https://cdn.example/video.mp4", "https://events.example"), "https://cdn.example/video.mp4");
  for (const value of ["/images/../private.png", "/images//cover.png", "/other/cover.png", "images/cover.png", "//cdn.example/cover.png", "javascript:alert(1)", "https://user:pass@cdn.example/a.mp4"]) {
    assert.equal(safeGenderRevealMediaUrl(value, "https://events.example"), "", value);
  }
});

test("public prediction summary handles zero safely and totals only enum counts", () => {
  assert.deepEqual(genderRevealResultSummary({ boyCount: 0, girlCount: 0 }), {
    boyCount: 0, girlCount: 0, totalCount: 0, boyPercent: 0, girlPercent: 0,
  });
  assert.deepEqual(genderRevealResultSummary({ boyCount: 2, girlCount: 1, totalCount: 200 }), {
    boyCount: 2, girlCount: 1, totalCount: 3, boyPercent: 67, girlPercent: 33,
  });
  assert.deepEqual(genderRevealResultSummary({ boyCount: -1, girlCount: 1 }), {
    boyCount: 0, girlCount: 1, totalCount: 1, boyPercent: 0, girlPercent: 100,
  });
});

test("local validation permits a prediction and message from a non-attendee", () => {
  assert.deepEqual(genderRevealLocalValidation({
    fullName: "Guest", phone: "050 123 4567", countryCallingCode: "971",
    attendance: "not_attending", prediction: "boy", message: "All the best!",
  }, normalizeInternationalPhone), {});
  assert.deepEqual(genderRevealLocalValidation({
    fullName: "", phone: "bad", countryCallingCode: "971", attendance: "maybe", prediction: "unknown", message: "x".repeat(1001),
  }, normalizeInternationalPhone), {
    fullName: "nameRequired", phone: "phoneInvalid", attendance: "attendanceRequired", prediction: "predictionRequired", message: "messageTooLong",
  });
});

test("submission errors retain distinct network, permission/duplicate, quota, and closed states", () => {
  assert.equal(genderRevealSubmissionErrorKey({ code: "unavailable" }), "networkError");
  assert.equal(genderRevealSubmissionErrorKey({ code: "permission-denied" }), "permissionOrDuplicateError");
  assert.equal(genderRevealSubmissionErrorKey({ code: "resource-exhausted" }), "quotaError");
  assert.equal(genderRevealSubmissionErrorKey({ code: "failed-precondition" }), "closedError");
});

test("Excel cell values retain Arabic and neutralize formula-leading guest content", () => {
  assert.equal(spreadsheetSafeText("رسالة جميلة"), "رسالة جميلة");
  assert.equal(spreadsheetSafeText("  =HYPERLINK(\"https://bad.example\")"), "'  =HYPERLINK(\"https://bad.example\")");
  assert.equal(spreadsheetSafeText("@SUM(1,1)"), "'@SUM(1,1)");
});

test("public invitation defers video and audio sources until the open gesture", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("../gender-reveal.html", import.meta.url), "utf8"),
    readFile(new URL("../gender-reveal.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /Boy or Girl\?/);
  assert.match(html, /Open invitation/);
  assert.match(script, /ولد أم بنت؟/);
  assert.match(script, /افتح الدعوة/);
  assert.match(html, /playsinline[^>]+preload="none"/);
  assert.match(html, /<audio id="eventMusic" preload="none" loop><\/audio>/);
  assert.doesNotMatch(html, /<video[^>]+\ssrc=/);
  assert.doesNotMatch(html, /<audio[^>]+\ssrc=/);
  assert.match(script, /elements\.openingVideo\.src = openingUrl/);
  assert.match(script, /elements\.music\.src = musicUrl/);
  assert.match(script, /sessionStorage\.setItem\(languageStorageKey/);
  assert.match(script, /onSnapshot\(doc\(db, "weddings", weddingId, "publicEvent", "details"\)/);
  assert.match(script, /unsubscribeEvent\?\.\(\)/);
  assert.match(script, /prefers-reduced-motion/);
  assert.match(script, /saveData/);
  assert.match(script, /createIntroSequence/);
  assert.match(script, /genderRevealSubmissionErrorKey/);
});

test("dashboard styling is gender-scoped and presents assigned event responses read-only", async () => {
  const [dashboard, css] = await Promise.all([
    readFile(new URL("../dashboard.js", import.meta.url), "utf8"),
    readFile(new URL("../gender-reveal-dashboard.css", import.meta.url), "utf8"),
  ]);
  assert.match(dashboard, /collection\(state\.services\.db, "weddings", state\.weddingId, "genderRevealResponses"\)/);
  assert.match(dashboard, /function renderGenderRevealResponsesPage/);
  assert.match(dashboard, /data-gender-response-search/);
  assert.match(dashboard, /data-gender-response-filter/);
  assert.match(dashboard, /Export Excel/);
  assert.match(dashboard, /phoneE164/);
  assert.match(dashboard, /function renderGenderRevealOverviewPage/);
  assert.match(dashboard, /Manage RSVPs and predictions for this event/);
  assert.match(dashboard, /!isGenderRevealEvent\(state\.wedding\) && state\.wedding\?\.seatingEnabled !== false/);
  assert.match(css, /body\.is-gender-reveal/);
  assert.doesNotMatch(css, /(?:^|\})\s*(?:\.guest-page|\.share-page|body\s*\{)/m);
});
