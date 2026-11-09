// Admin-only "People with access" dialog for one event on the All Events page. Loaded on first use.
// Reads come straight from Firestore; giving and removing access goes through the admin API,
// which keeps owner and staff roles untouched.
import * as api from "./firebase-config.js";
import { adminPost, esc } from "./admin-api.js";
import { confirmAction, showToast } from "./action-feedback.js";
import { getEventDisplayTitle } from "./event-utils.js";
import { MIN_NEW_PASSWORD, accessRows, cleanEmail, linkOutcome, nextStepFor } from "./event-access.js";

const API = "/api/admin-customer-access";
// An account created here is kept for a retry if linking fails, so a second try never creates another one.
const created = new Map();

export function openEventAccess({ wedding, services, flash = () => {} }) {
  const { db, auth } = services;
  const title = getEventDisplayTitle(wedding);
  let dialog = document.getElementById("eventAccessDialog");
  if (!dialog) { dialog = document.createElement("dialog"); dialog.id = "eventAccessDialog"; dialog.className = "workspace-dialog admin-dialog"; document.body.append(dialog); }
  dialog.innerHTML = `<div class="workspace-modal workspace-modal--small"><header><div><p class="workspace-kicker">Admin only</p><h2>People with access: <bdi>${esc(title)}</bdi></h2></div><button class="icon-close" type="button" data-dialog-close aria-label="Close">×</button></header><div class="workspace-modal__body"><p class="workspace-status" role="status" data-access-status>Loading…</p><ul class="access-list" data-access-list><li>Loading people with access…</li></ul><form class="access-add" data-access-form novalidate><h3>Give someone access</h3><p class="admin-note">They get customer access: guests, seating, event details and exports for this event only.</p><label>Email<input name="email" type="email" autocomplete="off" maxlength="254" required /></label><label data-password-row hidden>First password (at least ${MIN_NEW_PASSWORD} characters)<input name="password" type="text" autocomplete="off" minlength="${MIN_NEW_PASSWORD}" maxlength="128" /></label><p class="form-error" role="alert"></p><button class="primary-button" type="submit">Give access</button></form></div><footer><button class="secondary-button" type="button" data-dialog-close>Close</button></footer></div>`;
  dialog.querySelectorAll("[data-dialog-close]").forEach((button) => button.addEventListener("click", () => dialog.close()));
  const status = dialog.querySelector("[data-access-status]"), list = dialog.querySelector("[data-access-list]"), form = dialog.querySelector("[data-access-form]");
  const error = form.querySelector(".form-error"), passwordRow = form.querySelector("[data-password-row]"), go = form.querySelector('[type="submit"]');
  let rows = [];
  const call = (body, what) => adminPost(auth, API, body, undefined, { what });

  async function load(message = "") {
    try {
      const [members, grants] = await Promise.all([
        api.getDocs(api.collection(db, "weddings", wedding.id, "dashboardUsers")),
        api.getDocs(api.query(api.collection(db, "customerGrants"), api.where("weddingId", "==", wedding.id))),
      ]);
      if (!dialog.isConnected) return;
      rows = accessRows(members.docs.map((row) => ({ ...row.data(), id: row.id })), wedding.ownerUserId);
      list.innerHTML = rows.map((row) => `<li><div><strong><bdi>${esc(row.email || "No email on record")}</bdi></strong><span class="access-role access-role--${row.kind}">${esc(row.label)}</span><small>${esc(row.note)}</small></div>${row.removable ? `<button class="secondary-button danger-text" type="button" data-remove="${esc(row.id)}" aria-label="Remove access for ${esc(row.email || "this person")}">Remove</button>` : ""}</li>`).join("")
        + grants.docs.map((row) => `<li><div><strong><bdi>${esc(row.data().email || "")}</bdi></strong><span class="access-role">Invited</span><small>Waiting for this person to sign in with a verified email.</small></div><button class="secondary-button danger-text" type="button" data-cancel="${esc(row.id)}" aria-label="Cancel the invitation for ${esc(row.data().email || "this person")}">Cancel</button></li>`).join("")
        || "<li>Nobody has access yet.</li>";
      const customers = rows.filter((row) => row.kind === "customer").length;
      status.textContent = message || `${rows.length} ${rows.length === 1 ? "person has" : "people have"} access, ${customers} of them ${customers === 1 ? "a customer" : "customers"}.`;
    } catch (failure) {
      list.innerHTML = "";
      status.textContent = `The access list could not load (${failure?.code || "unavailable"}). Close this and try again.`;
    }
  }

  list.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-remove], [data-cancel]");
    if (!button || button.disabled) return;
    const row = rows.find((item) => item.id === button.dataset.remove);
    if (button.dataset.remove) {
      if (!row || !await confirmAction({ title: "Remove access?", message: `${row.email || "This person"} will no longer be able to open ${title}. Their account and their other events are not changed.`, confirmLabel: "Remove access", danger: true })) return;
    }
    button.disabled = true; status.textContent = "Saving…";
    try {
      if (button.dataset.remove) {
        const outcome = linkOutcome(await call({ action: "unlink", userId: row.id, targets: [{ kind: "event", id: wedding.id }] }, "Removing access"), "unlink");
        if (!outcome.ok) throw new Error(outcome.message);
        await load(outcome.message); showToast("Access removed.", "success");
      } else {
        await api.deleteDoc(api.doc(db, "customerGrants", button.dataset.cancel));
        await load("Invitation cancelled.");
      }
    } catch (failure) { button.disabled = false; status.textContent = failure?.message || "The change could not be saved. Try again."; }
  });

  form.addEventListener("submit", async (submit) => {
    submit.preventDefault();
    if (go.disabled) return;
    const email = cleanEmail(form.elements.email.value);
    if (!email) { error.textContent = "Enter a valid email address."; return; }
    go.disabled = true; error.textContent = ""; status.textContent = "Checking the email…";
    try {
      let account = created.get(email) || null;
      if (!account) {
        const lookup = await call({ action: "lookup", email }, "Looking up the email").catch((failure) => { if (failure.code === "CUSTOMER_NOT_FOUND") return null; throw failure; });
        const next = nextStepFor(lookup, rows);
        if (next.step === "stop") { status.textContent = ""; error.textContent = next.message; return; }
        if (next.step === "link") account = { userId: lookup.uid, email };
        if (next.step === "create") {
          const password = form.elements.password.value;
          if (passwordRow.hidden || password.length < MIN_NEW_PASSWORD) {
            passwordRow.hidden = false; status.textContent = ""; error.textContent = passwordRow.dataset.asked ? `Use a password of at least ${MIN_NEW_PASSWORD} characters.` : next.message;
            passwordRow.dataset.asked = "1"; form.elements.password.focus(); return;
          }
          status.textContent = "Creating the account…";
          account = await api.createIsolatedCustomer(email, password);
          created.set(email, account);
        }
      }
      status.textContent = "Giving access…";
      const outcome = linkOutcome(await call({ action: "link", userId: account.userId, targets: [{ kind: "event", id: wedding.id }] }, "Giving access"), "link");
      if (!outcome.ok) throw new Error(created.has(email) ? `The account was created, but access was not saved: ${outcome.message} Press Give access again.` : outcome.message);
      created.delete(email);
      form.reset(); passwordRow.hidden = true; delete passwordRow.dataset.asked;
      await load(`Access given to ${email}.`);
      showToast("Access given.", "success"); flash(`Access to ${title} given to ${email}.`);
    } catch (failure) {
      status.textContent = "";
      error.textContent = failure?.code === "auth/email-already-in-use" ? "An account with this email already exists. Press Give access again." : failure?.message || "Access could not be given. Try again.";
    } finally { go.disabled = false; }
  });

  if (!dialog.open) dialog.showModal();
  void load();
  return dialog;
}
