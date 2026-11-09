// Admin-only: the "Download backup" and "Restore from backup" actions on the All Events page.
// Loaded on first use. The work itself is in event-backup.js and api/admin-event-backup.js.
import { adminPost, esc } from "./admin-api.js";
import { showToast } from "./action-feedback.js";
import { backupFileName, downloadEventBackup, readBackupText, restoreEventBackup, summarizeBackup } from "./event-backup.js";

const API = "/api/admin-event-backup";
const CONFIRM_WORD = "RESTORE";
const poster = (auth, what) => (body) => adminPost(auth, API, body, undefined, { what });

function saveFile(name, backup) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const when = (iso) => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); };

export async function downloadBackupFor(wedding, { auth, flash = () => {} }) {
  flash("Preparing the backup…");
  const backup = await downloadEventBackup({ post: poster(auth, "Downloading the backup"), eventId: wedding.id, onProgress: ({ records }) => flash(`Preparing the backup… ${records} records read`) });
  const name = backupFileName(backup);
  saveFile(name, backup);
  flash(`Backup downloaded: ${name}. Keep it somewhere private: it holds guest names and phone numbers.`);
  showToast("Backup downloaded.", "success");
  return backup;
}

function summaryHtml(summary, exists) {
  const rows = [
    ["Event", summary.title], ["Backup taken", `${when(summary.exportedAt)}${summary.exportedBy ? ` by ${summary.exportedBy}` : ""}`],
    ...(summary.responses ? [["Responses", summary.responses]] : [["Guests", summary.guests], ["Tables", summary.tables]]),
    ["People with access", summary.members], ["Records in the file", summary.records],
  ];
  const warning = exists
    ? `Restoring replaces everything in this event with the file. Any change made after ${esc(when(summary.exportedAt))} is lost: new guests, RSVPs, seating and check-ins. A safety copy of the event as it is now is downloaded first.`
    : "This event does not exist at the moment. Restoring creates it again from the file.";
  return `<dl class="backup-summary">${rows.map(([label, value]) => `<dt>${esc(label)}</dt><dd dir="auto">${esc(String(value))}</dd>`).join("")}</dl><p class="backup-warning">${warning}</p><p class="admin-note">Sign-in accounts and photos are not part of a backup. Nobody should edit this event while it is being restored.</p><label>Type ${CONFIRM_WORD} to continue<input name="phrase" autocomplete="off" autocapitalize="characters" /></label>`;
}

export function openRestoreDialog({ auth, wedding = null, eventExists, onDone = () => {}, flash = () => {} }) {
  let dialog = document.getElementById("eventRestoreDialog");
  if (!dialog) { dialog = document.createElement("dialog"); dialog.id = "eventRestoreDialog"; dialog.className = "workspace-dialog admin-dialog"; document.body.append(dialog); }
  dialog.innerHTML = `<form class="workspace-modal workspace-modal--small"><header><div><p class="workspace-kicker">Admin only</p><h2>Restore from backup</h2></div><button class="icon-close" type="button" data-dialog-close aria-label="Close">×</button></header><div class="workspace-modal__body"><p>Choose a backup file made with <strong>Download backup</strong>${wedding ? " for this event" : ". It can also bring back an event that was deleted"}.</p><label>Backup file<input name="file" type="file" accept="application/json,.json" /></label><div data-backup-details></div><p class="workspace-status" role="status" data-backup-status></p><p class="form-error" role="alert"></p></div><footer><button class="secondary-button" type="button" data-dialog-close>Cancel</button><button class="danger-button" type="submit" disabled>Restore event</button></footer></form>`;
  const form = dialog.querySelector("form"), details = form.querySelector("[data-backup-details]"), status = form.querySelector("[data-backup-status]");
  const error = form.querySelector(".form-error"), go = form.querySelector('[type="submit"]'), closers = [...dialog.querySelectorAll("[data-dialog-close]")];
  let backup = null, exists = false, busy = false, started = false;
  closers.forEach((button) => button.addEventListener("click", () => { if (!busy) dialog.close(); }));
  dialog.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); }); // Escape must not hide a running restore

  form.elements.file.addEventListener("change", async () => {
    backup = null; go.disabled = true; details.innerHTML = ""; error.textContent = ""; status.textContent = "";
    const file = form.elements.file.files[0];
    if (!file) return;
    status.textContent = "Checking the file…";
    try {
      const parsed = await readBackupText(await file.text());
      if (wedding && parsed.eventId !== wedding.id) throw new Error("This file is a backup of a different event. Open Restore from backup on that event, or use the Restore event from backup button at the top of the page.");
      exists = await eventExists(parsed.eventId);
      if (form.elements.file.files[0] !== file) return; // another file was chosen meanwhile
      backup = parsed;
      details.innerHTML = summaryHtml(summarizeBackup(parsed), exists);
      status.textContent = ""; go.disabled = false;
    } catch (failure) { status.textContent = ""; error.textContent = failure?.message || "The file could not be read."; }
  });

  form.addEventListener("submit", async (submit) => {
    submit.preventDefault();
    if (!backup || busy) return;
    if (form.elements.phrase.value.trim() !== CONFIRM_WORD) { error.textContent = `Type ${CONFIRM_WORD} exactly to restore.`; return; }
    busy = true; go.disabled = true; form.elements.file.disabled = true; closers.forEach((button) => { button.disabled = true; }); error.textContent = "";
    try {
      if (exists) {
        status.textContent = "Saving a safety copy of the event as it is now…";
        const current = await downloadEventBackup({ post: poster(auth, "Saving the safety copy"), eventId: backup.eventId });
        saveFile(backupFileName(current, "before-restore"), current);
      }
      started = true;
      const result = await restoreEventBackup({
        post: poster(auth, "Restoring the event"), backup,
        onProgress: ({ phase, records, total }) => { status.textContent = phase === "clear" ? "Clearing the event's current data…" : phase === "write" ? `Restoring… ${records} of ${total} records` : "Checking and finishing…"; },
      });
      busy = false; dialog.close();
      const note = result.ownerChanged ? " The original owner is no longer an admin, so you are now its owner." : "";
      flash(`Event restored from the backup taken ${when(backup.exportedAt)}.${note}`);
      showToast("Event restored.", "success");
      await onDone(backup.eventId);
    } catch (failure) {
      busy = false; go.disabled = false; form.elements.file.disabled = false; closers.forEach((button) => { button.disabled = false; });
      status.textContent = "";
      error.textContent = started
        ? `${failure?.message || "The restore did not finish."} The event is not usable until a restore finishes: press Restore event again with the same file.`
        : `${failure?.message || "The safety copy could not be saved."} Nothing was changed. Try again.`;
    }
  });
  if (!dialog.open) dialog.showModal();
  return dialog;
}
