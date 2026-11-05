import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const js = () => readFile(new URL("../dashboard.js", import.meta.url), "utf8");

test("a signed-in non-admin who opens someone else's event goes back to My events, with no admin menu", async () => {
  const s = await js();
  assert.match(s, /const customer = state\.isAdmin === false \|\|/);
  assert.match(s, /const backLabel = customer \? "My events" : "All Events";/);
});

test("the seating page warns when more people need seats than are free", async () => {
  const s = await js();
  assert.match(s, /function seatShortageNotice\(\)[\s\S]{0,700}if \(needing <= free\) return "";[\s\S]{0,400}Not enough seats\./);
  assert.equal((s.match(/\$\{seatShortageNotice\(\)\}/g) || []).length, 2, "desktop and phone seating both show it");
});

test("guest and table names follow their own text direction (Arabic or English)", async () => {
  const s = await js();
  const unmarked = s.split("\n").filter((line) => /<(strong|span|h2|h3|small|p)[^>]*>\$\{escapeHtml\((guest\??\.fullName|table\.name)/.test(line) && !/dir="auto"/.test(line));
  assert.deepEqual(unmarked, []);
});

test("export and check-in section headings sit at level 2 under the page title", async () => {
  const s = await js();
  assert.match(s, /<h3 aria-level="2">\$\{escapeHtml\(title\)\}<\/h3>/);
  for (const t of ["Checked in guests", "Check-in URL", "Latest arrivals"]) assert.match(s, new RegExp(`<h3 aria-level="2">${t}</h3>`));
});

test("a photo bucket can be created with uploader names switched off (the switch is never required)", async () => {
  const w = await readFile(new URL("../weddings.js", import.meta.url), "utf8");
  assert.match(w, /input\.required = photoBucket && input\.type !== "checkbox";/);
});
