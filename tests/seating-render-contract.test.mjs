import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getContrastingTextColor } from "../seating-utils.js";

const [html, dashboard, invitation, dashboardCss, invitationCss] = await Promise.all([
  readFile(new URL("../dashboard.html", import.meta.url), "utf8"),
  readFile(new URL("../dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../script.js", import.meta.url), "utf8"),
  readFile(new URL("../dashboard.css", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
]);

test("table editor offers only the four supported shapes and no table floor-zone input", () => {
  const form = html.match(/<form[^>]*id="tableForm"[\s\S]*?<\/form>/)?.[0] || "";
  const select = form.match(/<select[^>]*name="shape"[^>]*>([\s\S]*?)<\/select>/)?.[1] || "";
  assert.deepEqual([...select.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]), ["round", "rectangle", "square", "u-shape"]);
  assert.doesNotMatch(form, /floorZone|Floor zone/i);
  assert.match(dashboard, /Object\.prototype\.hasOwnProperty\.call\(existingTable, "floorZone"\)/);
  assert.match(dashboard, /Object\.prototype\.hasOwnProperty\.call\(table, "floorZone"\)/);
});

test("chosen chair colors survive state classes while other states remain outlined", () => {
  assert.equal(getContrastingTextColor("#ffffff"), "#26352f");
  assert.equal(getContrastingTextColor("#183c32"), "#fffdf8");
  assert.match(dashboard, /function resolveChairColor\(status, table\)\s*\{\s*return table\?\.chairColor/);
  assert.match(dashboardCss, /\.planner-chair--warning\s*\{\s*border-color:/);
  assert.match(dashboardCss, /\.planner-chair--conflict\s*\{\s*border-color:/);
  assert.match(dashboardCss, /\.planner-chair--vip\s*\{\s*border-color:/);
  assert.match(invitationCss, /\.seat-plan-chair\.is-yours\s*\{[\s\S]*?box-shadow:/);
  assert.match(invitation, /--table-fill:/);
  assert.match(invitation, /--chair-color:/);
});

test("guest map keeps seat numbers, highlights only assigned party seats, and frames every assigned table", () => {
  assert.match(invitation, /buildSeatAssignmentKeys\(assignments\)/);
  assert.match(invitation, /getSeatPlanFocusBounds\(state\.tables, assignments, 1100, 900\)/);
  assert.match(invitation, /state\.seatPlanHasFitted = true/);
  assert.match(invitation, /seatPlanFocusedAssignments/);
  assert.match(invitation, /hasSavedPosition/);
  assert.match(invitation, /data-party-member-index/);
  assert.match(invitation, /<span>\$\{escapeHtml\(String\(chair\.seatNumber\)\)\}<\/span>/);
  assert.doesNotMatch(invitation, /assignment\?\.label\?\.replace\("Main Guest"/);
  assert.match(invitation, /Your seats have not been assigned yet/);
});

test("planner chairs use static hover and selected feedback without motion", () => {
  const chairRule = dashboardCss.match(/\.planner-chair\s*\{\s*position:\s*absolute;[\s\S]*?\n\}/)?.[0] || "";
  const hoverRule = dashboardCss.match(/\.planner-chair:hover\s*\{[\s\S]*?\n\}/)?.[0] || "";
  const selectedRule = dashboardCss.match(/\.planner-chair\.is-selected\s*\{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(chairRule, /transition:\s*none/);
  assert.doesNotMatch(hoverRule, /transform|animation/);
  assert.match(hoverRule, /box-shadow/);
  assert.match(selectedRule, /outline:\s*3px solid/);
  assert.doesNotMatch(dashboardCss, /planner-party-pulse/);
  assert.doesNotMatch(dashboardCss, /\.planner-chair:hover\s*,\s*\.planner-table:hover/);
});

test("planner camera fits furniture bounds, clamps panning, and uses a continuous ivory floor", () => {
  assert.match(dashboard, /function getPlannerContentBounds\(\)/);
  assert.match(dashboard, /function calculatePlannerFit\(\)/);
  assert.match(dashboard, /function handlePlannerWheel\(event\)/);
  assert.match(dashboard, /function getPlannerMapWidth\(viewportWidth\)/);
  assert.match(dashboard, /const minX = bounds\.maxX - halfWidth \+ margin;[\s\S]*?const maxX = bounds\.minX \+ halfWidth - margin/);
  assert.match(dashboard, /const panMinX = bounds\.minX \+ halfWidth - margin;[\s\S]*?const panMaxX = bounds\.maxX - halfWidth \+ margin/);
  assert.match(dashboard, /const margin = 42;[\s\S]*?clamp\(state\.plannerViewCenter\.x/);
  assert.match(dashboardCss, /\.planner-canvas-viewport\s*\{[\s\S]*?background-image:[\s\S]*?linear-gradient/);
  assert.doesNotMatch(dashboardCss, /radial-gradient\(circle,\s*rgba\(184,\s*145,\s*86,\s*0\.18\) 1px/);
  assert.match(dashboardCss, /body\.is-seating-view \.planner-canvas-shell\s*\{[\s\S]*?padding:\s*0/);
});
