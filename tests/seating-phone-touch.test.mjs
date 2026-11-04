import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("phones open the floor plan at a readable zoom, centred on the tables", async () => {
  const js = await read("dashboard.js");
  assert.match(js, /const MOBILE_MIN_FIT_ZOOM = 1;/);
  assert.match(js, /max-width: 700px\)"\)\.matches && fit\.zoom < MOBILE_MIN_FIT_ZOOM\)[\s\S]{0,300}getPlannerTablesCenter\(\)/);
  assert.match(js, /function getPlannerTablesCenter\(\)/);
});

test("every seat keeps a 44 px touch area sized from how big it really renders", async () => {
  const js = await read("dashboard.js"), css = await read("dashboard.css");
  assert.match(js, /function updateChairHitArea\([\s\S]*44 \/ Math\.min\(\.\.\.scales\)/);
  assert.match(js, /function setPlannerCanvasZoom\([\s\S]{0,300}updateChairHitArea\(canvas\)/, "recomputed on every zoom change");
  assert.match(css, /\.mobile-seating-map \.planner-chair::after \{[^}]*width: var\(--chair-hit[^}]*pointer-events: auto;/);
});

test("on phones the header actions wrap below the title instead of squeezing it", async () => {
  const css = await read("dashboard.css");
  assert.match(css, /@media \(max-width: 700px\) \{\s*\.da3wa-main > \.da3wa-topbar \{ flex-wrap: wrap; \}/);
});
