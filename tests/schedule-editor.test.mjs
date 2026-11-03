import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SCHEDULE_KEYS, SCHEDULE_MAX_ITEMS, scheduleEditorMarkup, scheduleJsonFromRows, scheduleRowsFromJson } from "../schedule-editor.js";

test("an existing schedule loads into rows and saves back with the same shape", () => {
  const stored = [{ time: "7:00 PM", timeAr: "٧:٠٠ م", titleEn: "Welcome", titleAr: "ترحيب", descriptionEn: "Doors open", descriptionAr: "فتح الأبواب" }, { titleEn: "Dinner" }];
  const rows = scheduleRowsFromJson(JSON.stringify(stored));
  assert.deepEqual(rows, stored);
  assert.deepEqual(JSON.parse(scheduleJsonFromRows(rows)), stored, "same keys, same values, no extra fields");
  for (const item of JSON.parse(scheduleJsonFromRows(rows))) for (const key of Object.keys(item)) assert.ok(SCHEDULE_KEYS.includes(key));
});

test("empty means no schedule, and blank rows are dropped", () => {
  assert.equal(scheduleJsonFromRows([]), "[]");
  assert.equal(scheduleJsonFromRows([{ time: "", titleEn: "  " }]), "[]");
  assert.deepEqual(scheduleRowsFromJson("not json"), []);
  assert.deepEqual(scheduleRowsFromJson(""), []);
  assert.equal(SCHEDULE_MAX_ITEMS, 12);
});

test("the editor has labelled inputs, Arabic fields are right to left, add is capped at 12, text is escaped", () => {
  const html = scheduleEditorMarkup(JSON.stringify([{ titleEn: "<img src=x onerror=1>" }]), "", true);
  assert.doesNotMatch(html, /<img/);
  for (const label of ["Time", "Time in Arabic", "Title (English)", "Title (Arabic)", "Description (English)", "Description (Arabic)"]) assert.match(html, new RegExp(`<span>${label.replace(/[()]/g, "\\$&")}</span>`));
  assert.equal((html.match(/dir="rtl"/g) || []).length, 3);
  assert.match(html, /data-schedule-add/); assert.match(html, /data-schedule-remove/);
  assert.match(html, /<input type="hidden" name="schedule" data-event-setting-field/);
  const full = scheduleEditorMarkup(JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ titleEn: `t${i}` }))), "", true);
  assert.match(full, /data-schedule-add disabled/);
  assert.doesNotMatch(html, /JSON/);
});

test("dashboard keeps the JSON validation and saves the parsed list", async () => {
  const d = await readFile(new URL("../dashboard.js", import.meta.url), "utf8");
  assert.match(d, /schedule: JSON\.parse\(String\(draft\.schedule \|\| "\[\]"\)\)/);
  assert.match(d, /schedule\.length > 12/);
  assert.match(d, /bindScheduleEditor\(eventSettingsForm\)/);
  assert.doesNotMatch(d, /Invitation schedule \(JSON/);
});
