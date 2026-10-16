import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");

function extractFunction(source, name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `could not locate ${name}`);
  return source.slice(start, end);
}

test("directory counts include each primary guest and normalised additional guest exactly once", async () => {
  const dashboard = await read("dashboard.js");
  const normalize = extractFunction(dashboard, "normalizeAdditionalGuests", "getPartySize");
  const counts = extractFunction(dashboard, "calculateGuestDirectoryCounts", "hydrateHallObjects");
  const actual = vm.runInNewContext(`${normalize}\n${counts}\ncalculateGuestDirectoryCounts`, {});

  assert.deepEqual(
    { ...actual([{ additionalGuests: 0 }, { additionalGuests: 2 }, { additionalGuests: "3" }]) },
    { primary: 3, accompanying: 5, people: 8 },
  );
  assert.deepEqual({ ...actual([]) }, { primary: 0, accompanying: 0, people: 0 });
});

test("one pagination group is rendered after both list representations and zero results have a valid range", async () => {
  const dashboard = await read("dashboard.js");
  const render = extractFunction(dashboard, "renderGuestPage", "renderGuestDirectoryList");
  const list = extractFunction(dashboard, "renderGuestDirectoryList", "renderGuestDirectoryPagination");
  const pages = extractFunction(dashboard, "renderGuestDirectoryPagination", "renderGuestDirectoryResults");

  assert.match(render, /data-guest-directory-list[\s\S]*?renderGuestDirectoryPagination\(/);
  assert.doesNotMatch(render, /guest-page-controls/);
  assert.match(list, /guest-table-wrap[\s\S]*?guest-cards/);
  assert.match(pages, /const first = total \? pageStart \+ 1 : 0/);
  assert.match(pages, /Showing \$\{first\}-\$\{last\} of \$\{total\}/);
});

test("directory counts use the complete matching dataset and clarify filtered totals", async () => {
  const dashboard = await read("dashboard.js");
  const render = extractFunction(dashboard, "renderGuestPage", "renderGuestDirectoryList");
  const countMarkup = extractFunction(dashboard, "renderGuestDirectoryCounts", "renderGuestDirectoryList");
  const update = extractFunction(dashboard, "renderGuestDirectoryResults", "renderSeatingPage");

  assert.match(render, /calculateGuestDirectoryCounts\(state\.guests\)/);
  assert.match(render, /calculateGuestDirectoryCounts\(guests\)/);
  assert.match(render, /Matching guests/);
  assert.match(countMarkup, /People, including additional guests/);
  assert.match(update, /calculateGuestDirectoryCounts\(matching \? guests : state\.guests\)/);
});

test("mobile guest directory stacks totals, filters, action buttons, guests, then pagination", async () => {
  const [dashboard, css] = await Promise.all([read("dashboard.js"), read("dashboard.css")]);
  const render = extractFunction(dashboard, "renderGuestPage", "renderGuestDirectoryCounts");
  const mobileRules = css.slice(css.indexOf("  .guest-page-actions {"));
  assert.match(mobileRules, /\.guest-toolbar \{\s*order: 0;/);
  assert.match(mobileRules, /\.guest-bulkbar \{\s*order: 1;/);
  assert.match(mobileRules, /\.guest-page-actions \{\s*order: 2;/);
  assert.match(mobileRules, /\.guest-directory-list \{\s*order: 3;/);
  assert.match(mobileRules, /\.guest-page-controls \{\s*order: 4;/);
  assert.ok(render.indexOf("guest-directory-counts") < render.indexOf("guest-toolbar__search"));
  assert.ok(render.indexOf("guest-toolbar__search") < render.indexOf('selectInput("rsvp"'));
});

test("assignment and seating searches update result regions without replacing or refocusing the input", async () => {
  const dashboard = await read("dashboard.js");
  const handler = extractFunction(dashboard, "handleDocumentInput", "updateEventSettingsDraftState");
  const resultUpdater = extractFunction(dashboard, "renderAssignmentCandidateList", "refreshAssignmentCandidatesAfterSnapshot");
  const seatingUpdater = extractFunction(dashboard, "renderSeatingGuestResults", "renderSeatingGuestRow");

  assert.match(handler, /state\.guestAssignmentSearch = seatSearch\.value;[\s\S]*?renderAssignmentCandidateList\(\)/);
  assert.match(handler, /state\.seatingGuestSearch = seatingGuestSearch\.value;\s*renderSeatingGuestResults\(\)/);
  assert.doesNotMatch(handler, /nextSearch\?\.focus|search\.focus|requestAnimationFrame/);
  assert.match(resultUpdater, /list\.outerHTML = renderAssignmentCandidates/);
  assert.doesNotMatch(resultUpdater, /assignmentContent\.innerHTML/);
  assert.match(seatingUpdater, /rows\.innerHTML = nextRows\.innerHTML/);
  assert.doesNotMatch(seatingUpdater, /renderActiveView\(\);[\s\S]*?currentSearch\.isConnected/);
});

test("assignment picker keeps eligibility and partial-party semantics while removing the redundant filter", async () => {
  const dashboard = await read("dashboard.js");
  const modal = extractFunction(dashboard, "renderAssignmentModal", "getAssignmentDestinationSummary");
  const candidateView = extractFunction(dashboard, "renderAssignmentCandidates", "renderAssignmentCandidateList");
  const choose = extractFunction(dashboard, "chooseGuestForAssignment", "toggleTemporaryChair");
  const candidates = extractFunction(dashboard, "getSeatCandidates", "guestPriorityScore");
  const css = await read("dashboard.css");

  assert.doesNotMatch(modal, /mobile-assignment-filters|Needs seats|All eligible/);
  assert.match(modal, /Choose a guest/);
  assert.match(modal, /Assign seat/);
  assert.match(modal, /Assigns 1 person;/);
  assert.match(candidateView, /No matching guests\./);
  assert.match(candidateView, /All eligible guests are seated\./);
  assert.match(choose, /if \(!remainingSeats\)/);
  assert.match(candidates, /getGuestRemainingSeats\(guest\) > 0 \|\| guest\.id === currentGuestId/);
  assert.match(dashboard, /refreshAssignmentCandidatesAfterSnapshot\(\)/);
  assert.match(css, /\.assignment-guest-list \{ min-height: 72px; max-height: none; flex: 1;[^}]*align-content: start; grid-auto-rows: max-content; overflow: auto;/);
});

test("sender introduction scrolls naturally and progress updates do not rebuild rows", async () => {
  const [html, script] = await Promise.all([read("send.html"), read("send.js")]);
  assert.match(html, /\.sender-header\s*\{[\s\S]*?position: static/);
  assert.doesNotMatch(html, /\.sender-header\s*\{[^}]*position:\s*(?:sticky|fixed)/s);
  assert.match(script, /function updateProgress\(\)/);
  assert.match(script, /sendLink\.textContent = "Sent ✓ · Resend"/);
  assert.doesNotMatch(script, /setTimeout\(render, 300\)|undoButton[\s\S]{0,180}render\(\)/);
});

test("mobile cards retain all actions and fit the compact right action rail", async () => {
  const [dashboard, css] = await Promise.all([read("dashboard.js"), read("dashboard.css")]);
  const card = extractFunction(dashboard, "renderGuestCard", "renderGuestCardActions");
  const actions = extractFunction(dashboard, "renderGuestCardActions", "renderSeatingAccessCard");

  assert.match(card, /renderGuestRsvpSelect\(guest\)/);
  assert.match(card, /renderReservationReadinessBadge\(guest\)/);
  assert.match(card, /Message for the couple/);
  assert.match(card, /renderGuestMenuToggle\(guest, "card"/);
  assert.match(actions, /copy-guest-invite/);
  assert.match(actions, /data-action="edit-guest"/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) 44px/);
  assert.match(css, /\.guest-card__actions \.guest-row__menu-toggle[\s\S]{0,180}width: 44px/);
});
