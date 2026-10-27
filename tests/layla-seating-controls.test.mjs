import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Layla seating omits My seats and the gold-seat guidance while retaining the other map controls", async () => {
  const script = await readFile(new URL("../script.js", import.meta.url), "utf8");
  const renderer = script.match(/function renderSeatingMap\([\s\S]*?\n\}/)?.[0] || "";

  assert.match(renderer, /isLaylaInvitation\(\) \? "" : `<button type="button" data-seat-plan-control="my-seats"/);
  assert.match(renderer, /isLaylaInvitation\(\) \? \(assignments\.length \? "" : `<p class="seat-plan-caption"/);
  assert.match(renderer, /data-seat-plan-control="zoom-out"/);
  assert.match(renderer, /data-seat-plan-control="fit"/);
  assert.match(renderer, /data-seat-plan-control="zoom-in"/);
  assert.match(renderer, /data-seat-plan-control="my-seats"/); // Other invitation designs keep their existing control.
  assert.doesNotMatch(script, /seatLegend:/);
});
