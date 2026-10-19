import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("event creation collects a category and disables hidden identity fields", async () => {
  const [html, js] = await Promise.all([read("all-events.html"), read("weddings.js")]);
  assert.match(html, /value="wedding_engagement"/);
  assert.match(html, /value="celebration"/);
  assert.match(html, /value="gender_reveal"/);
  assert.match(html, /Gender Reveal Party/);
  assert.match(html, /حفل الكشف عن جنس المولود/);
  assert.match(html, /name="eventTitle" placeholder="Ahmed’s Graduation"/);
  assert.match(js, /label\.querySelector\("input"\)\.disabled = !wedding/);
  assert.match(js, /title\.querySelector\("input"\)\.required = !wedding && Boolean\(category\)/);
  assert.match(js, /eventCategory: category/);
  assert.match(js, /data\.eventTitle = f\.eventTitle\.value\.trim\(\)/);
  assert.match(js, /category === EVENT_CATEGORIES\.GENDER_REVEAL/);
  assert.match(js, /seatingEnabled: false, showInvitationQr: false/);
  assert.match(js, /gender-reveal\.html\?wedding=/);
});

test("celebration dashboard hides side controls and creates neutral guest values", async () => {
  const [js, rules] = await Promise.all([read("dashboard.js"), read("firestore.rules")]);
  assert.match(js, /usesSides \? selectInput\("side"/);
  assert.match(js, /existingGuest\?\.side \|\| "general"/);
  assert.match(js, /: "general";/);
  assert.match(rules, /side == "general"/);
  assert.match(rules, /category in \["celebration", "gender_reveal"\]/);
});

test("gender reveal settings use shared general attendance and hide sender controls", async () => {
  const [dashboard, workspace] = await Promise.all([read("dashboard.js"), read("weddings.js")]);
  assert.match(dashboard, /isGenderRevealEvent\(state\.wedding\) \? \[\] : \[/);
  assert.match(dashboard, /genderReveal \? "" : field\("whatsAppCountryCode"/);
  assert.match(dashboard, /"venueEn", genderReveal \? "Venue name \(optional\)" : "Venue name"/);
  assert.match(dashboard, /guestGroupMode: "general"/);
  assert.match(dashboard, /shared invitation link/);
  assert.match(workspace, /senderControl\.hidden = genderReveal/);
  assert.match(workspace, /venue\.required = Boolean\(category\) && !genderReveal/);
});
