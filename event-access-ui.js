// Admin-only "Access" panel on an event card on the All Events page. Loaded on first use.
// It opens under the Access button, lists who can open the event, and lets an admin add an
// existing user or create a new one. Reads come straight from Firestore; giving and removing
// access goes through the admin API, which keeps owner and staff roles untouched.
import * as api from "./firebase-config.js";
import { adminPost, esc } from "./admin-api.js";
import { confirmAction, showToast } from "./action-feedback.js";
import { getEventDisplayTitle } from "./event-utils.js";
import { MIN_NEW_PASSWORD, accessRows, cleanEmail, existingChoices, linkOutcome, nextStepFor, searchChoices } from "./event-access.js";

const API = "/api/admin-customer-access";
const DIRECTORY_LIMIT = 300;
// An account created here is kept for a retry if linking fails, so a second try never creates another one.
const created = new Map();
let open = null; // { panel, eventId, close }

export function closeEventAccess() { open?.close(); }

// Opens the panel under `anchor`, or closes it when it is already open for this event.
export function toggleEventAccess({ anchor, wedding, services, flash = () => {} }) {
  if (open) { const same = open.eventId === wedding.id; open.close(); if (same) return null; }
  const { db, auth } = services;
  const title = getEventDisplayTitle(wedding);
  const panel = document.createElement("section");
  panel.className = "access-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", `Access to ${title}`);
  panel.innerHTML = `<header><h3>Who has access</h3><button class="icon-close" type="button" data-access-close aria-label="Close">×</button></header><p class="access-panel__event"><bdi>${esc(title)}</bdi></p><ul class="access-list" data-access-list><li>Loading…</li></ul><div data-access-add></div><p class="workspace-status" role="status" data-access-status></p>`;
  document.body.append(panel);
  const list = panel.querySelector("[data-access-list]"), add = panel.querySelector("[data-access-add]"), status = panel.querySelector("[data-access-status]");
  let rows = [], directory = null;
  const call = (body, what) => adminPost(auth, API, body, undefined, { what });
  // The card is redrawn when the list refreshes, so the button is looked up again each time.
  const button = () => document.querySelector(`[data-action="access"][data-id="${CSS.escape(wedding.id)}"]`) || anchor;

  function place() {
    const box = button().getBoundingClientRect();
    const width = Math.min(380, window.innerWidth - 24);
    panel.style.width = `${width}px`;
    panel.style.left = `${Math.max(12, Math.min(box.left + window.scrollX, window.scrollX + window.innerWidth - width - 12))}px`;
    panel.style.top = `${box.bottom + window.scrollY + 8}px`;
  }
  const onOutside = (event) => { if (!panel.contains(event.target) && !event.target.closest?.('[data-action="access"]') && !event.target.closest?.("dialog")) close(); };
  const onKey = (event) => { if (event.key === "Escape" && !document.querySelector("dialog[open]")) { close(); button().focus?.(); } };
  function close() {
    if (open?.panel !== panel) return;
    open = null; panel.remove();
    document.removeEventListener("pointerdown", onOutside, true); document.removeEventListener("keydown", onKey); window.removeEventListener("resize", place);
    document.querySelectorAll('[data-action="access"][aria-expanded="true"]').forEach((item) => item.setAttribute("aria-expanded", "false"));
  }
  open = { panel, eventId: wedding.id, close };
  document.addEventListener("pointerdown", onOutside, true); document.addEventListener("keydown", onKey); window.addEventListener("resize", place);
  panel.querySelector("[data-access-close]").addEventListener("click", close);
  anchor.setAttribute("aria-expanded", "true");
  place();

  async function load(message = "") {
    try {
      const [members, grants] = await Promise.all([
        api.getDocs(api.collection(db, "weddings", wedding.id, "dashboardUsers")),
        api.getDocs(api.query(api.collection(db, "customerGrants"), api.where("weddingId", "==", wedding.id))),
      ]);
      if (!panel.isConnected) return;
      rows = accessRows(members.docs.map((row) => ({ ...row.data(), id: row.id })), wedding.ownerUserId);
      list.innerHTML = rows.map((row) => `<li><div><strong><bdi>${esc(row.email || "No email on record")}</bdi></strong><span class="access-role access-role--${row.kind}">${esc(row.label)}</span></div>${row.removable ? `<button class="text-button danger-text" type="button" data-remove="${esc(row.id)}" aria-label="Remove access for ${esc(row.email || "this person")}">Remove</button>` : ""}</li>`).join("")
        + grants.docs.map((row) => `<li><div><strong><bdi>${esc(row.data().email || "")}</bdi></strong><span class="access-role">Invited, not signed in yet</span></div><button class="text-button danger-text" type="button" data-cancel="${esc(row.id)}" aria-label="Cancel the invitation for ${esc(row.data().email || "this person")}">Cancel</button></li>`).join("")
        || "<li>Nobody has access yet.</li>";
      status.textContent = message;
    } catch (failure) {
      list.innerHTML = "";
      status.textContent = `The access list could not load (${failure?.code || "unavailable"}). Close this and try again.`;
    }
  }

  // The add area has four views: the Add user button, the two choices, and one form for each choice.
  function showAdd(view = "closed") {
    const back = `<button class="text-button" type="button" data-add-view="choose">Back</button>`;
    if (view === "closed") add.innerHTML = `<button class="secondary-button access-panel__add" type="button" data-add-view="choose">+ Add user</button>`;
    if (view === "choose") add.innerHTML = `<div class="access-choice"><button class="secondary-button" type="button" data-add-view="existing"><strong>Add existing user</strong><small>Someone who already has an account</small></button><button class="secondary-button" type="button" data-add-view="new"><strong>Create new user</strong><small>Make a new account for them</small></button><button class="text-button" type="button" data-add-view="closed">Cancel</button></div>`;
    if (view === "existing") {
      add.innerHTML = `<form class="access-form" data-add-form="existing" novalidate><label>Find a user<input name="search" type="search" autocomplete="off" placeholder="Type part of their email" /></label><div class="access-results" data-results aria-live="polite"><p class="admin-note">Loading users…</p></div><p class="form-error" role="alert"></p><div class="access-form__actions">${back}<button class="primary-button" type="submit" disabled>Add to this event</button></div></form>`;
      void fillDirectory();
    }
    if (view === "new") add.innerHTML = `<form class="access-form" data-add-form="new" novalidate><label>Their email<input name="email" type="email" autocomplete="off" maxlength="254" placeholder="name@example.com" /></label><label>A password for them (at least ${MIN_NEW_PASSWORD} characters)<input name="password" type="text" autocomplete="off" maxlength="128" /></label><p class="admin-note">Send them this email and password yourself. They use them at Customer sign-in.</p><p class="form-error" role="alert"></p><div class="access-form__actions">${back}<button class="primary-button" type="submit">Create and add</button></div></form>`;
    if (view !== "closed") add.querySelector("select, input, button")?.focus();
  }

  let choices = [], chosen = null;
  function drawResults() {
    const form = add.querySelector('[data-add-form="existing"]');
    if (!form) return;
    const box = form.querySelector("[data-results]"), go = form.querySelector('[type="submit"]'), term = form.elements.search.value;
    const { shown, more } = searchChoices(choices, term);
    if (chosen && !shown.some((row) => row.id === chosen.id)) chosen = null;
    const typedEmail = cleanEmail(term);
    box.innerHTML = shown.map((row) => `<button class="access-result${chosen?.id === row.id ? " is-chosen" : ""}" type="button" data-pick="${esc(row.id)}" aria-pressed="${chosen?.id === row.id}"><bdi>${esc(row.email)}</bdi></button>`).join("")
      + (more ? `<p class="admin-note">${more} more. Keep typing to narrow the list.</p>` : "")
      || `<p class="admin-note">${!choices.length && !term ? "No other users yet. Go back and choose Create new user." : typedEmail ? "Not in the list. Press the button to look this email up." : "No user matches. Type the full email to look it up."}</p>`;
    go.disabled = !chosen && !(typedEmail && !shown.length);
    go.textContent = chosen ? `Add ${chosen.email}` : "Add to this event";
  }
  async function fillDirectory() {
    chosen = null;
    const error = add.querySelector(".form-error");
    try {
      if (!directory) {
        const snapshot = await api.getDocs(api.query(api.collection(db, "customerDirectory"), api.limit(DIRECTORY_LIMIT)));
        directory = snapshot.docs.map((row) => ({ id: row.id, email: row.data().email || "" }));
      }
      choices = existingChoices(directory, rows);
      drawResults();
    } catch (failure) { const box = add.querySelector("[data-results]"); if (box) box.innerHTML = ""; if (error) error.textContent = `The user list could not load (${failure?.code || "unavailable"}). Type the full email to look it up.`; choices = []; }
  }
  add.addEventListener("input", (event) => { if (event.target.name === "search") { add.querySelector(".form-error").textContent = ""; drawResults(); } });
  add.addEventListener("click", (event) => {
    const pick = event.target.closest("[data-pick]");
    if (!pick) return;
    chosen = choices.find((row) => row.id === pick.dataset.pick) || null;
    drawResults();
  });

  async function link(account) {
    const outcome = linkOutcome(await call({ action: "link", userId: account.userId, targets: [{ kind: "event", id: wedding.id }] }, "Giving access"), "link");
    if (!outcome.ok) throw new Error(created.has(account.email) ? `The account was created, but access was not saved: ${outcome.message} Press the button again.` : outcome.message);
    created.delete(account.email);
    showAdd("closed");
    await load(`${account.email} now has access.`);
    showToast("Access given.", "success"); flash(`Access to ${title} given to ${account.email}.`);
  }

  add.addEventListener("click", (event) => { const view = event.target.closest("[data-add-view]")?.dataset.addView; if (view) { status.textContent = ""; showAdd(view); } });
  add.addEventListener("submit", async (submit) => {
    submit.preventDefault();
    const form = submit.target, go = form.querySelector('[type="submit"]'), error = form.querySelector(".form-error");
    if (go.disabled) return;
    error.textContent = "";
    try {
      if (form.dataset.addForm === "existing") {
        let account = chosen ? { userId: chosen.id, email: chosen.email } : null;
        if (!account) {
          // Not in the loaded list (a long directory, or an account never linked before): ask the server by exact email.
          const email = cleanEmail(form.elements.search.value);
          if (!email) { error.textContent = "Choose a user from the list, or type their full email."; return; }
          go.disabled = true; status.textContent = "Looking up the email…";
          const lookup = await call({ action: "lookup", email }, "Looking up the email").catch((failure) => { if (failure.code === "CUSTOMER_NOT_FOUND") return null; throw failure; });
          const next = nextStepFor(lookup, rows);
          if (next.step !== "link") { status.textContent = ""; error.textContent = next.step === "create" ? "No account uses this email. Go back and choose Create new user." : next.message; return; }
          account = { userId: lookup.uid, email };
        }
        go.disabled = true; status.textContent = "Giving access…";
        await link(account);
        return;
      }
      const email = cleanEmail(form.elements.email.value), password = form.elements.password.value;
      if (!email) { error.textContent = "Enter a valid email address."; return; }
      if (password.length < MIN_NEW_PASSWORD) { error.textContent = `Use a password of at least ${MIN_NEW_PASSWORD} characters.`; return; }
      go.disabled = true; status.textContent = "Checking the email…";
      let account = created.get(email) || null;
      if (!account) {
        const lookup = await call({ action: "lookup", email }, "Looking up the email").catch((failure) => { if (failure.code === "CUSTOMER_NOT_FOUND") return null; throw failure; });
        const next = nextStepFor(lookup, rows);
        if (next.step !== "create") { status.textContent = ""; error.textContent = next.step === "link" ? "This email already has an account. Go back and choose Add existing user." : next.message; return; }
        status.textContent = "Creating the account…";
        account = { ...(await api.createIsolatedCustomer(email, password)), email };
        created.set(email, account);
      }
      status.textContent = "Giving access…";
      await link(account);
    } catch (failure) {
      status.textContent = "";
      error.textContent = failure?.code === "auth/email-already-in-use" ? "This email already has an account. Go back and choose Add existing user." : failure?.message || "Access could not be given. Try again.";
    } finally { if (go.isConnected) go.disabled = false; }
  });

  list.addEventListener("click", async (event) => {
    const item = event.target.closest("[data-remove], [data-cancel]");
    if (!item || item.disabled) return;
    const row = rows.find((entry) => entry.id === item.dataset.remove);
    if (item.dataset.remove && (!row || !await confirmAction({ title: "Remove access?", message: `${row.email || "This person"} will no longer be able to open ${title}. Their account and their other events are not changed.`, confirmLabel: "Remove access", danger: true }))) return;
    item.disabled = true; status.textContent = "Saving…";
    try {
      if (item.dataset.remove) {
        const outcome = linkOutcome(await call({ action: "unlink", userId: row.id, targets: [{ kind: "event", id: wedding.id }] }, "Removing access"), "unlink");
        if (!outcome.ok) throw new Error(outcome.message);
        await load(`${row.email || "That person"} no longer has access.`); showToast("Access removed.", "success");
      } else {
        await api.deleteDoc(api.doc(db, "customerGrants", item.dataset.cancel));
        await load("Invitation cancelled.");
      }
    } catch (failure) { item.disabled = false; status.textContent = failure?.message || "The change could not be saved. Try again."; }
  });

  showAdd("closed");
  void load();
  return panel;
}
