// Row-based editor for the invitation schedule. It saves the same data as the old
// JSON box: a list of up to 12 items with the string keys below. The form keeps the
// list as JSON text in one hidden field, so validation, saving and the rules see
// exactly what they saw before.
import { esc } from "./admin-api.js";

export const SCHEDULE_MAX_ITEMS = 12;
export const SCHEDULE_MAX_TEXT = 240;
export const SCHEDULE_KEYS = Object.freeze(["time", "timeAr", "titleEn", "titleAr", "descriptionEn", "descriptionAr"]);
const FIELDS = [
  ["time", "Time", false, false], ["timeAr", "Time in Arabic", true, false],
  ["titleEn", "Title (English)", false, false], ["titleAr", "Title (Arabic)", true, false],
  ["descriptionEn", "Description (English)", false, true], ["descriptionAr", "Description (Arabic)", true, true],
];

// Existing schedules load into rows. Text that is not a list shows as no rows.
export function scheduleRowsFromJson(text) {
  try {
    const list = JSON.parse(String(text || "[]"));
    return Array.isArray(list) ? list.filter((item) => item && typeof item === "object" && !Array.isArray(item)).slice(0, SCHEDULE_MAX_ITEMS) : [];
  } catch { return []; }
}

// Blank rows are dropped and blank fields are left out, so an empty form is "[]" (no schedule).
export function scheduleJsonFromRows(rows) {
  const items = rows.map((row) => Object.fromEntries(SCHEDULE_KEYS.map((key) => [key, String(row?.[key] ?? "").trim()]).filter(([, value]) => value)))
    .filter((item) => Object.keys(item).length);
  return JSON.stringify(items, null, 2);
}

export function scheduleRowMarkup(item = {}, index = 0, disabled = false) {
  return `<div class="schedule-row" data-schedule-row><div class="schedule-row__head"><strong>Item ${index + 1}</strong><button class="da3wa-button" type="button" data-schedule-remove ${disabled ? "disabled" : ""} aria-label="Remove item ${index + 1}">Remove</button></div><div class="schedule-row__grid">${FIELDS.map(([key, label, rtl, long]) => {
    const attrs = `data-schedule-field="${key}" maxlength="${SCHEDULE_MAX_TEXT}" ${rtl ? 'dir="rtl" lang="ar"' : ""} ${disabled ? 'disabled aria-disabled="true"' : ""}`;
    return `<label class="schedule-row__field${long ? " is-wide" : ""}"><span>${label}</span>${long ? `<textarea class="da3wa-input" rows="2" ${attrs}>${esc(item[key] ?? "")}</textarea>` : `<input class="da3wa-input" type="text" ${attrs} value="${esc(item[key] ?? "")}" />`}</label>`;
  }).join("")}</div></div>`;
}

export function scheduleEditorMarkup(scheduleJson, error = "", canEdit = true) {
  const rows = scheduleRowsFromJson(scheduleJson), disabled = !canEdit;
  return `<fieldset class="event-settings-field is-full schedule-editor" data-schedule-editor><legend>Invitation schedule (optional)</legend>
    <input type="hidden" name="schedule" data-event-setting-field value="${esc(scheduleJson || "[]")}" ${disabled ? "disabled" : ""} />
    <div data-schedule-rows>${rows.map((item, index) => scheduleRowMarkup(item, index, disabled)).join("")}</div>
    <p class="event-settings-timezone" data-schedule-empty ${rows.length ? "hidden" : ""}>No schedule. The invitation will not show one.</p>
    <button class="da3wa-button" type="button" data-schedule-add ${disabled || rows.length >= SCHEDULE_MAX_ITEMS ? "disabled" : ""}>Add item</button>
    <small class="event-setting-error" data-schedule-error role="alert">${esc(error)}</small>
    <small class="event-settings-timezone">Up to ${SCHEDULE_MAX_ITEMS} items. Each needs a title in English or Arabic, and each text can be up to ${SCHEDULE_MAX_TEXT} characters. Remove every item to hide the schedule.</small></fieldset>`;
}

// Wires one editor. Every change rewrites the hidden JSON field and fires an input
// event on it, so the page's normal change tracking runs.
export function bindScheduleEditor(form) {
  const editor = form.querySelector("[data-schedule-editor]"); if (!editor) return;
  const rowsHost = editor.querySelector("[data-schedule-rows]"), hidden = editor.querySelector('input[name="schedule"]');
  const read = () => [...rowsHost.querySelectorAll("[data-schedule-row]")].map((row) => Object.fromEntries([...row.querySelectorAll("[data-schedule-field]")].map((input) => [input.dataset.scheduleField, input.value])));
  const refresh = () => {
    [...rowsHost.querySelectorAll("[data-schedule-row]")].forEach((row, index) => {
      row.querySelector("strong").textContent = `Item ${index + 1}`;
      row.querySelector("[data-schedule-remove]").setAttribute("aria-label", `Remove item ${index + 1}`);
    });
    const count = rowsHost.querySelectorAll("[data-schedule-row]").length;
    editor.querySelector("[data-schedule-add]").disabled = count >= SCHEDULE_MAX_ITEMS || hidden.disabled;
    editor.querySelector("[data-schedule-empty]").hidden = count > 0;
  };
  const sync = () => {
    hidden.value = scheduleJsonFromRows(read());
    editor.querySelector("[data-schedule-error]").textContent = "";
    hidden.dispatchEvent(new Event("input", { bubbles: true }));
  };
  editor.addEventListener("input", (event) => { if (event.target.closest("[data-schedule-field]")) sync(); });
  editor.addEventListener("click", (event) => {
    if (event.target.closest("[data-schedule-add]")) {
      const count = rowsHost.querySelectorAll("[data-schedule-row]").length;
      if (count >= SCHEDULE_MAX_ITEMS) return;
      rowsHost.insertAdjacentHTML("beforeend", scheduleRowMarkup({}, count, false));
      refresh(); rowsHost.lastElementChild.querySelector("input")?.focus();
    }
    const remove = event.target.closest("[data-schedule-remove]");
    if (remove) {
      const row = remove.closest("[data-schedule-row]"), next = row.nextElementSibling || row.previousElementSibling;
      row.remove(); refresh(); sync();
      (next?.querySelector("input") || editor.querySelector("[data-schedule-add]"))?.focus();
    }
  });
  refresh();
}
