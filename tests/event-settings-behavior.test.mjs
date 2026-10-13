import assert from "node:assert/strict";
import test from "node:test";
import {
  attemptEventSettingsSave,
  bindEventSettingsSubmit,
  canEditEventSettings,
  commitEventSettingsBatch,
  eventSettingsFeedback,
  eventSettingsHaveChanges,
  isEventSettingsSaveDisabled,
  updateEventSettingsSaveControl,
} from "../event-settings-state.mjs";

function fakeButton() {
  return {
    disabled: false,
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
  };
}

test("Event Settings synchronizes native and accessible save state, including reverted edits", () => {
  const original = { venueEn: "Pearl Ballroom", schedule: "[]" };
  const button = fakeButton();
  let draft = { ...original };
  let dirty = eventSettingsHaveChanges(draft, original);
  updateEventSettingsSaveControl(button, { dirty, saving: false, canEdit: true });
  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute("aria-disabled"), "true");

  draft = { ...draft, venueEn: "Garden Ballroom" };
  dirty = eventSettingsHaveChanges(draft, original);
  updateEventSettingsSaveControl(button, { dirty, saving: false, canEdit: true });
  assert.equal(button.disabled, false);
  assert.equal(button.getAttribute("aria-disabled"), "false");
  assert.match(eventSettingsFeedback({ dirty, canEdit: true }), /Unsaved changes/);

  draft.venueEn = original.venueEn;
  dirty = eventSettingsHaveChanges(draft, original);
  updateEventSettingsSaveControl(button, { dirty, saving: false, canEdit: true });
  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute("aria-disabled"), "true");
  assert.match(eventSettingsFeedback({ dirty, canEdit: true }), /All changes are saved/);
});

test("Event Settings keeps permission checks distinct from seating-only access", () => {
  assert.equal(canEditEventSettings({ isOwner: true, seatingOnly: true, hasEventDetailsPermission: false }), true);
  assert.equal(canEditEventSettings({ isOwner: false, seatingOnly: false, hasEventDetailsPermission: true }), true);
  assert.equal(canEditEventSettings({ isOwner: false, seatingOnly: true, hasEventDetailsPermission: true }), false);
  assert.equal(canEditEventSettings({ isOwner: false, seatingOnly: false, hasEventDetailsPermission: false }), false);
  assert.equal(isEventSettingsSaveDisabled({ dirty: true, saving: true, canEdit: true }), true);
});

test("the delegated form listener submits once for a submit event and ignores other forms", () => {
  const listeners = new Map();
  const container = { addEventListener(type, callback) { listeners.set(type, callback); } };
  const form = { id: "eventSettingsForm" };
  let submissions = 0;
  bindEventSettingsSubmit(container, (event) => {
    submissions += 1;
    event.preventDefault();
  });
  const listener = listeners.get("submit");
  listener({ target: { id: "guestForm" }, preventDefault() {} });
  assert.equal(submissions, 0);
  let prevented = false;
  listener({ target: form, preventDefault() { prevented = true; } });
  assert.equal(submissions, 1);
  assert.equal(prevented, true);
});

test("event and workspace index writes share one atomic batch, including missing-index creation", async () => {
  const writes = [];
  let committed = false;
  const batch = {
    update(ref, data) { writes.push({ type: "update", ref, data }); },
    set(ref, data, options) { writes.push({ type: "set", ref, data, options }); },
    async commit() { committed = true; },
  };
  const eventRef = { path: "weddings/event-1" };
  const indexRef = { path: "users/user-1/weddingAccess/event-1" };
  await commitEventSettingsBatch({
    db: {},
    writeBatch: () => batch,
    eventRef,
    indexRef,
    eventData: { venueEn: "Garden" },
    indexData: { venueEn: "Garden" },
  });
  assert.deepEqual(writes.map((write) => [write.type, write.ref.path]), [
    ["update", "weddings/event-1"],
    ["set", "users/user-1/weddingAccess/event-1"],
  ]);
  assert.deepEqual(writes[1].options, { merge: true });
  assert.equal(committed, true);
});

test("a failed save retains the draft, allows retry, and reports success only after commit", async () => {
  const draft = { venueEn: "Garden Hall" };
  let successMessage = "";
  let errorMessage = "";
  let attempts = 0;
  let button = fakeButton();
  updateEventSettingsSaveControl(button, { dirty: true, saving: true, canEdit: true });

  const firstResult = await attemptEventSettingsSave(async () => {
    attempts += 1;
    throw Object.assign(new Error("denied"), { code: "permission-denied" });
  }, {
    onSuccess() { successMessage = "saved"; },
    onFailure(error) { errorMessage = error.code; },
  });
  assert.equal(firstResult, false);
  assert.deepEqual(draft, { venueEn: "Garden Hall" });
  assert.equal(successMessage, "");
  assert.equal(errorMessage, "permission-denied");
  updateEventSettingsSaveControl(button, { dirty: true, saving: false, canEdit: true });
  assert.equal(button.disabled, false);

  let resolveCommit;
  const retry = attemptEventSettingsSave(() => {
    attempts += 1;
    return new Promise((resolve) => { resolveCommit = resolve; });
  }, {
    onSuccess() { successMessage = "saved"; },
    onFailure() { errorMessage = "retry failed"; },
  });
  await Promise.resolve();
  assert.equal(successMessage, "", "pending commits do not show success");
  resolveCommit();
  assert.equal(await retry, true);
  assert.equal(successMessage, "saved");
  assert.equal(attempts, 2);
});
