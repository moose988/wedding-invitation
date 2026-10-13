export function eventSettingsHaveChanges(draft, original) {
  return Object.keys(original || {}).some(
    (key) => draft?.[key] !== original[key],
  );
}

export function canEditEventSettings({ isOwner, seatingOnly, hasEventDetailsPermission }) {
  return Boolean(isOwner || hasEventDetailsPermission);
}

export function isEventSettingsSaveDisabled({ dirty, saving, canEdit }) {
  return !dirty || saving || !canEdit;
}

export function updateEventSettingsSaveControl(button, state) {
  const disabled = isEventSettingsSaveDisabled(state);
  button.disabled = disabled;
  button.setAttribute("aria-disabled", String(disabled));
  button.classList?.toggle("is-ready-to-save", !disabled);
  return disabled;
}

export function bindEventSettingsFieldTracking(form, onChange) {
  const update = (event) => {
    const field = event.target?.closest?.("[data-event-setting-field]");
    if (field && form.contains(field)) onChange(field);
  };
  form.addEventListener("input", update);
  form.addEventListener("change", update);
}

export function eventSettingsFeedback({ message, canEdit, dirty, saving }) {
  if (message) return message;
  if (!canEdit) {
    return "Read-only: only the event owner or an account with Event Details permission can edit these settings.";
  }
  if (saving) return "Saving event details…";
  if (dirty) return "Unsaved changes. Save changes when you are ready.";
  return "All changes are saved. Edit a field to make a change.";
}

export function bindEventSettingsSubmit(container, onSubmit) {
  container.addEventListener("submit", (event) => {
    if (event.target?.id === "eventSettingsForm") onSubmit(event);
  });
}

export async function commitEventSettingsBatch({ db, writeBatch, eventRef, indexRef, eventData, indexData }) {
  const batch = writeBatch(db);
  batch.update(eventRef, eventData);
  batch.set(indexRef, indexData, { merge: true });
  await batch.commit();
}

export async function attemptEventSettingsSave(commit, { onSuccess, onFailure }) {
  try {
    await commit();
  } catch (error) {
    onFailure(error);
    return false;
  }
  onSuccess();
  return true;
}
