import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sources = Object.fromEntries(await Promise.all(
  ["script.js", "dashboard.js", "checkin.js", "side.js", "send.js", "weddings.js"]
    .map(async (file) => [file, await readFile(new URL(`../${file}`, import.meta.url), "utf8")]),
));

function extractFunction(source, name, dependencies = {}) {
  const match = source.match(new RegExp(`function ${name}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`, "u"));
  assert.ok(match, `expected ${name} helper`);
  return new Function(...Object.keys(dependencies), `${match[0]}; return ${name};`)(...Object.values(dependencies));
}

test("HTML and attribute encoders neutralize stored XSS payload characters", () => {
  const payload = "<img src=x onerror=\"alert(1)\"> ' `&";
  for (const [file, name] of [
    ["script.js", "escapeHtml"],
    ["dashboard.js", "escapeHtml"],
    ["checkin.js", "escapeHtml"],
    ["send.js", "escapeHtml"],
  ]) {
    const escapeHtml = extractFunction(sources[file], name);
    const escaped = escapeHtml(payload);
    assert.doesNotMatch(escaped, /</, file);
    assert.match(escaped, /&lt;img/);
  }
  const sideEscape = extractFunction(sources["side.js"], "esc");
  assert.doesNotMatch(sideEscape(payload), /</);
  for (const file of ["dashboard.js", "checkin.js"]) {
    const escapeHtml = extractFunction(sources[file], "escapeHtml");
    const escapeAttribute = extractFunction(sources[file], "escapeAttribute", { escapeHtml });
    const escaped = escapeAttribute(payload);
    assert.doesNotMatch(escaped, /<|`/i, file);
    assert.match(escaped, /&#096;/);
  }
});

test("invitation, dashboard, check-in, seating, sender, and event-card render paths encode user data", () => {
  assert.match(sources["script.js"], /<h3 class="detail-card__title">\$\{escapeHtml\(detail\.title\)\}<\/h3>/);
  assert.match(sources["script.js"], /<p class="detail-card__english[^>]*>\$\{escapeHtml\(detail\.en\)\}<\/p>/);
  assert.match(sources["script.js"], /<h3 \$\{state\.laylaLanguage[\s\S]{0,300}escapeHtml\(state\.guest\.fullName/);
  assert.match(sources["dashboard.js"], /value="\$\{escapeAttribute\(guest\.id\)\}" data-guest-select/);
  assert.match(sources["dashboard.js"], /data-guest-id="\$\{escapeAttribute\(guest\.id\)\}"/);
  assert.match(sources["checkin.js"], /<h2>\$\{escapeHtml\(state\.guest\.fullName/);
  assert.match(sources["side.js"], /<b>\$\{esc\(p\.guest\.fullName/);
  assert.match(sources["send.js"], /sender-row__name">\$\{escapeHtml\(names\.displayName\)\}/);
  assert.match(sources["weddings.js"], /const eventId = escape\(w\.id\)/);
  assert.match(sources["weddings.js"], /<h2>\$\{escape\(title\)\}<\/h2>/);
});
