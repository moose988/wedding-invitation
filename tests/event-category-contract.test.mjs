import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("event creation collects a category and disables hidden identity fields", async () => {
  const [html, js] = await Promise.all([read("weddings.html"), read("weddings.js")]);
  assert.match(html, /value="wedding_engagement"/);
  assert.match(html, /value="celebration"/);
  assert.match(html, /name="eventTitle" placeholder="Ahmed’s Graduation"/);
  assert.match(js, /label\.querySelector\("input"\)\.disabled = !wedding/);
  assert.match(js, /celebration\.querySelector\("input"\)\.required = !wedding && Boolean\(category\)/);
  assert.match(js, /eventCategory: category/);
  assert.match(js, /data\.eventTitle = f\.eventTitle\.value\.trim\(\)/);
});

test("celebration dashboard hides side controls and creates neutral guest values", async () => {
  const [js, rules, functions] = await Promise.all([read("dashboard.js"), read("firestore.rules"), read("functions/index.js")]);
  assert.match(js, /usesSides \? selectInput\("side"/);
  assert.match(js, /existingGuest\?\.side \|\| "general"/);
  assert.match(js, /: "general";/);
  assert.match(rules, /side == "general"/);
  assert.match(functions, /if \(side === "general"\) return "general"/);
  assert.match(functions, /eventCategory === "celebration"/);
});
