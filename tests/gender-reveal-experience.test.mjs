import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  genderRevealLocalValidation, genderRevealResultSummary, genderRevealSubmissionErrorKey,
  safeGenderRevealMediaUrl,
} from "../gender-reveal-experience.js";
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

test("local validation permits a prediction and message from a non-attendee without collecting a phone number", () => {
  assert.deepEqual(genderRevealLocalValidation({
    fullName: "Guest", attendance: "not_attending", prediction: "boy", message: "All the best!",
  }), {});
  assert.deepEqual(genderRevealLocalValidation({
    fullName: "", attendance: "maybe", prediction: "unknown", message: "x".repeat(1001),
  }), {
    fullName: "nameRequired", attendance: "attendanceRequired", prediction: "predictionRequired", message: "messageTooLong",
  });
});

test("submission errors distinguish authorized duplicates from permission failures", () => {
  assert.equal(genderRevealSubmissionErrorKey({ code: "unavailable" }), "networkError");
  assert.equal(genderRevealSubmissionErrorKey({ code: "permission-denied" }), "permissionError");
  assert.equal(genderRevealSubmissionErrorKey({ code: "already-exists" }), "duplicateError");
  assert.equal(genderRevealSubmissionErrorKey({ code: "auth/network-request-failed" }), "networkError");
  assert.equal(genderRevealSubmissionErrorKey({ code: "data-loss" }), "saveError");
  assert.equal(genderRevealSubmissionErrorKey({ code: "resource-exhausted" }), "quotaError");
  assert.equal(genderRevealSubmissionErrorKey({ code: "failed-precondition" }), "closedError");
});

test("Excel cell values retain Arabic and neutralize formula-leading guest content", () => {
  assert.equal(spreadsheetSafeText("رسالة جميلة"), "رسالة جميلة");
  assert.equal(spreadsheetSafeText("  =HYPERLINK(\"https://bad.example\")"), "'  =HYPERLINK(\"https://bad.example\")");
  assert.equal(spreadsheetSafeText("@SUM(1,1)"), "'@SUM(1,1)");
});

test("public invitation defers video and audio sources until the open gesture", async () => {
  const [html, script, invitationCss, firebaseConfig, submissionService] = await Promise.all([
    readFile(new URL("../gender-reveal.html", import.meta.url), "utf8"),
    readFile(new URL("../gender-reveal.js", import.meta.url), "utf8"),
    readFile(new URL("../gender-reveal.css", import.meta.url), "utf8"),
    readFile(new URL("../firebase-config.js", import.meta.url), "utf8"),
    readFile(new URL("../gender-reveal-submission.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /Boy or Girl\?/);
  assert.match(html, /Open invitation/);
  assert.doesNotMatch(html, /gr-button__arrow/);
  assert.match(html, /id="skipOpening"[\s\S]*?class="gr-sr-only gr-opening__status" id="openingStatus"/);
  assert.match(invitationCss, /\.gr-opening__tools \{[\s\S]*?left: max\(20px, env\(safe-area-inset-left\)\)[\s\S]*?direction: ltr/);
  assert.match(invitationCss, /\.gr-cover__content[\s\S]*?background: rgba\(255, 251, 245, \.42\)/);
  assert.match(invitationCss, /\.gr-button--open[\s\S]*?0 0 18px rgba\(255, 250, 235, \.34\)/);
  assert.match(script, /ولد أم بنت؟/);
  assert.match(script, /افتح الدعوة/);
  assert.match(html, /playsinline webkit-playsinline muted preload="none" disablepictureinpicture disableremoteplayback/);
  assert.doesNotMatch(html, /id="openingVideo"[^>]+\scontrols/);
  assert.match(html, /id="retryOpening"[^>]+hidden/);
  assert.match(html, /wedding-vinyl-record\.webp/);
  assert.match(html, /gr-vinyl-toggle/);
  assert.match(html, /<audio id="eventMusic" preload="none" loop><\/audio>/);
  assert.doesNotMatch(html, /<video[^>]+\ssrc=/);
  assert.doesNotMatch(html, /<audio[^>]+\ssrc=/);
  assert.match(script, /elements\.openingVideo\.src = openingUrl/);
  assert.match(script, /elements\.openingVideo\.playsInline = true/);
  assert.match(script, /playOpeningVideoFromGesture\(\)/);
  assert.match(script, /elements\.retry\.hidden = false/);
  assert.match(script, /function retryOpeningFromGesture\(\)/);
  assert.doesNotMatch(script, /pendingFallbackKey = "videoSlow";\s*introSequence\?\.skip\(\)/);
  assert.match(script, /elements\.music\.src = musicUrl/);
  assert.match(script, /function updateMusicButtonLabel\(\)/);
  assert.match(script, /elements\.music\.pause\(\)/);
  assert.match(script, /sessionStorage\.setItem\(languageStorageKey/);
  assert.match(script, /onSnapshot\(doc\(db, "weddings", weddingId, "publicEvent", "details"\)/);
  assert.match(script, /unsubscribeEvent\?\.\(\)/);
  assert.match(script, /prefers-reduced-motion/);
  assert.match(script, /saveData/);
  assert.match(script, /createIntroSequence/);
  assert.match(script, /genderRevealSubmissionErrorKey/);
  assert.match(invitationCss, /\.gr-opening video[\s\S]*?object-fit: cover/);
  assert.match(invitationCss, /\.gr-music \{ position: fixed; z-index: 20; right: max\(18px, env\(safe-area-inset-right\)\); bottom: max\(18px, env\(safe-area-inset-bottom\)\); display: flex; align-items: center; \}/);
  assert.doesNotMatch(invitationCss, /gr-music-lift|gr-mute-toggle/);
  assert.doesNotMatch(script, /adjustMusicPosition|musicPositionFrame|toggleMusicMuted|addEventListener\("scroll"/);
  assert.doesNotMatch(html, /id="musicMute"|gr-mute-toggle/);
  assert.match(invitationCss, /\.gr-button--open[\s\S]*?backdrop-filter: blur/);
  assert.match(invitationCss, /\.gr-details-background[\s\S]*?gender-reveal-details-bg\.webp/);
  assert.match(invitationCss, /\.gr-decoration[\s\S]*?pointer-events: none/);
  assert.match(invitationCss, /html \{ min-width: 0;/);
  assert.match(script, /document\.body\.classList\.add\("gr-opening-active"\)/);
  assert.match(script, /document\.body\.classList\.remove\("gr-opening-active"\)/);
  assert.match(script, /function retryOpeningFromGesture\(\)[\s\S]*?elements\.openingStage\.hidden\) return/);
  assert.doesNotMatch(html, /id="(?:phone|countryCallingCode)"|data-copy="phone"/);
  assert.doesNotMatch(script, /normalizeInternationalPhone|countryCallingCode|phoneInvalid/);
  assert.match(firebaseConfig, /initGenderRevealSubmissionFirebase[\s\S]*?persistence: browserSessionPersistence/);
  assert.match(submissionService, /genderRevealSessionKeys/);
  assert.doesNotMatch(submissionService, /phoneE164|normalizeInternationalPhone/);
  assert.match(html, /gender-reveal-teddy-floating\.png[\s\S]*?alt=""/);
  assert.match(html, /gender-reveal-toys\.png[\s\S]*?alt=""/);
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
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.gr-stat--boy \{ order: 4; \}[\s\S]*?\.gr-stat--girl \{ order: 5; \}/);
  assert.match(dashboard, /Export Excel/);
  assert.match(dashboard, /phoneE164/);
  assert.match(dashboard, /function renderGenderRevealOverviewPage/);
  assert.match(dashboard, /Manage RSVPs and predictions for this event/);
  assert.match(dashboard, /!isGenderRevealEvent\(state\.wedding\) && state\.wedding\?\.seatingEnabled !== false/);
  assert.match(css, /body\.is-gender-reveal/);
  const invitationCss = await readFile(new URL("../gender-reveal.css", import.meta.url), "utf8");
  assert.match(invitationCss, /gr-vinyl-toggle\[data-state="playing"\][\s\S]*?animation: gr-record-spin/);
  assert.match(invitationCss, /prefers-reduced-motion: reduce[\s\S]*?gr-vinyl-toggle\[data-state="playing"\][\s\S]*?animation: none/);
  assert.doesNotMatch(css, /(?:^|\})\s*(?:\.guest-page|\.share-page|body\s*\{)/m);
});
