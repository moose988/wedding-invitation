import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("dashboard and guest map use white empty chairs and table-colored occupied chairs", async () => {
  const [dashboard, script, dashboardCss, invitationCss] = await Promise.all([
    read("dashboard.js"), read("script.js"), read("dashboard.css"), read("styles.css"),
  ]);
  assert.match(dashboard, /const isOccupied = Boolean\(assignment\)/);
  assert.match(dashboard, /\$\{isOccupied \? "is-occupied" : "is-empty"\}/);
  assert.match(dashboardCss, /\.planner-chair\.is-empty\s*\{\s*background:#fff !important/);
  assert.match(dashboardCss, /\.planner-chair\.is-occupied\s*\{\s*background:var\(--chair-color\) !important/);
  assert.match(invitationCss, /\.seat-plan-chair\.is-empty\s*\{\s*background:#fff !important/);
  assert.match(invitationCss, /\.seat-plan-chair\.is-occupied\s*\{\s*background:var\(--chair-color\) !important/);
  assert.match(script, /isAssignedToInvite \? "is-yours is-occupied" : "is-empty"/);
  assert.match(script, /--chair-color:\$\{escapeAttribute\(table\.chairColor/);
  assert.match(dashboardCss, /\.planner-chair\.is-empty\.is-temporary\s*\{\s*background:#fff !important/);
});

test("table selection updates the existing planner DOM without rebuilding the venue", async () => {
  const dashboard = await read("dashboard.js");
  const selection = dashboard.slice(dashboard.indexOf("function selectPlannerTable("), dashboard.indexOf("function handlePlannerPointerDown("));
  assert.match(selection, /classList\.toggle\("is-selected"/);
  assert.match(selection, /header\.innerHTML = renderTableInspector\(table\)/);
  assert.doesNotMatch(selection.slice(selection.indexOf("document\.querySelectorAll")), /renderActiveView\(\)/);
  const up = dashboard.slice(dashboard.indexOf("async function handlePlannerPointerUp("), dashboard.indexOf("function rememberModalFocus("));
  assert.match(up, /if \(drag\.frameId\)[\s\S]*?applyPlannerDragPosition\(drag\)/);
  assert.match(up, /state\.layoutPositionSavePending = true/);
  assert.doesNotMatch(up.slice(up.indexOf("state\.layoutPositionSavePending = true")), /renderActiveView\(\)/);
  assert.match(dashboard, /if \(state\.layoutPositionSavePending\) return/);
  const move = dashboard.slice(dashboard.indexOf("function handlePlannerPointerMove("), dashboard.indexOf("function applyPlannerDragPosition("));
  assert.match(move, /requestAnimationFrame\(/);
  assert.doesNotMatch(move, /state\.tables = state\.tables\.map|renderActiveView\(\)/);
});

test("table drag cancellation and failed saves restore the original persisted position", async () => {
  const dashboard = await read("dashboard.js");
  const up = dashboard.slice(dashboard.indexOf("async function handlePlannerPointerUp("), dashboard.indexOf("function rememberModalFocus("));
  const cancel = dashboard.slice(dashboard.indexOf("function handlePlannerPointerCancel("), dashboard.indexOf("function calculateGuestDirectoryCounts("));
  assert.match(up, /table\.x = originalX;\s*table\.y = originalY/);
  assert.match(up, /Table position could not be saved\. Its original position was restored\./);
  assert.match(cancel, /cancelAnimationFrame\(dragState\.frameId\)/);
  assert.match(cancel, /dragState\.node\.style\.left = `\$\{dragState\.originalX\}%`/);
});
