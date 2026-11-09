// The "Access" section: one collapsible panel, the same on every kind of event. It is used on
// the photo bucket page, in the event dashboard's settings and under an event card on All Events.
// Admin only. It has no database connection of its own: everything goes through the admin API
// (/api/admin-customer-access), so it works on pages that never start Firestore.
import { adminPost, esc } from "./admin-api.js";
import { confirmAction, showToast } from "./action-feedback.js";
import { MIN_NEW_PASSWORD, accessRows, bucketRows, cleanEmail, linkOutcome, nextStepFor, withoutMembers } from "./event-access.js";

const API = "/api/admin-customer-access";
const STYLE_ID = "accessSectionStyles";
// An account created here is kept for a retry if linking fails, so a second try never creates another one.
const created = new Map();

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID; link.rel = "stylesheet"; link.href = new URL("./access-section.css?v=1", import.meta.url).href;
  document.head.append(link);
}

// target is { kind: "event" | "bucket", id }. For a bucket, getOwners() returns its current owner ids.
// `bare` drops the collapsible heading, for places that already have their own (the card panel).
export function mountAccessSection(host, { auth, target, title, getOwners = null, open = false, bare = false, flash = () => {} }) {
  ensureStyles();
  const what = target.kind === "bucket" ? "photo bucket" : "event";
  host.innerHTML = `<details class="access-section${bare ? " access-section--bare" : ""}"${open || bare ? " open" : ""}><summary>Access</summary><div class="access-section__body"><p class="ax-note">People who can open this ${what}.</p><ul class="ax-list" data-list><li class="ax-empty">Open to load…</li></ul><div data-add></div><p class="ax-status" role="status" data-status></p></div></details>`;
  const details = host.querySelector("details"), list = host.querySelector("[data-list]"), add = host.querySelector("[data-add]"), status = host.querySelector("[data-status]");
  let rows = [], loaded = false, results = [], chosen = null, searchRun = 0, searchTimer = null, lastTerm = "", lastMore = false;
  const call = (body, label) => adminPost(auth, API, body, undefined, { what: label });

  async function load(message = "") {
    loaded = true;
    if (!rows.length) list.innerHTML = `<li class="ax-empty">Loading…</li>`;
    try {
      let invited = [];
      if (target.kind === "event") {
        const data = await call({ action: "event-access", eventId: target.id }, "Loading the access list");
        rows = accessRows(data.members || [], data.ownerUserId);
        invited = data.invited || [];
      } else {
        const uids = await getOwners();
        rows = bucketRows(uids.length ? (await call({ action: "accounts", uids }, "Loading the access list")).accounts : []);
      }
      if (!host.isConnected) return;
      list.innerHTML = rows.map((row) => `<li><div><strong><bdi>${esc(row.email || "No email on record")}</bdi></strong><span class="ax-role ax-role--${row.kind}">${esc(row.label)}</span></div>${row.removable ? `<button class="ax-link ax-link--danger" type="button" data-remove="${esc(row.id)}" aria-label="Remove access for ${esc(row.email || "this person")}">Remove</button>` : ""}</li>`).join("")
        + invited.map((row) => `<li><div><strong><bdi>${esc(row.email)}</bdi></strong><span class="ax-role">Invited, not signed in yet</span></div><button class="ax-link ax-link--danger" type="button" data-cancel="${esc(row.id)}" aria-label="Cancel the invitation for ${esc(row.email || "this person")}">Cancel</button></li>`).join("")
        || `<li class="ax-empty">${target.kind === "bucket" ? "No customer has access yet. Admins always do." : "Nobody has access yet."}</li>`;
      status.textContent = message;
    } catch (failure) {
      loaded = false; list.innerHTML = "";
      status.textContent = failure?.message || "The access list could not load. Try again.";
    }
  }

  // The add area has four views: the Add user button, the two choices, and one form for each choice.
  function showAdd(view = "closed") {
    chosen = null; results = [];
    const back = `<button class="ax-link" type="button" data-view="choose">Back</button>`;
    if (view === "closed") add.innerHTML = `<button class="ax-button ax-button--wide" type="button" data-view="choose">+ Add user</button>`;
    if (view === "choose") add.innerHTML = `<div class="ax-choice"><button class="ax-button" type="button" data-view="existing"><strong>Add existing user</strong><small>Someone who already has an account</small></button><button class="ax-button" type="button" data-view="new"><strong>Create new user</strong><small>Make a new account for them</small></button><button class="ax-link" type="button" data-view="closed">Cancel</button></div>`;
    if (view === "existing") { add.innerHTML = `<form class="ax-form" data-form="existing" novalidate><label>Find a user<input name="search" type="search" autocomplete="off" placeholder="Type the start of their email" /></label><div class="ax-results" data-results aria-live="polite"><p class="ax-note">Loading users…</p></div><p class="ax-error" role="alert"></p><div class="ax-actions">${back}<button class="ax-button ax-button--primary" type="submit" disabled>Add to this ${what}</button></div></form>`; void search(""); }
    if (view === "new") add.innerHTML = `<form class="ax-form" data-form="new" novalidate><label>Their email<input name="email" type="email" autocomplete="off" maxlength="254" placeholder="name@example.com" /></label><label>A password for them (at least ${MIN_NEW_PASSWORD} characters)<input name="password" type="text" autocomplete="off" maxlength="128" /></label><p class="ax-note">Send them this email and password yourself. They use them at Customer sign-in.</p><p class="ax-error" role="alert"></p><div class="ax-actions">${back}<button class="ax-button ax-button--primary" type="submit">Create and add</button></div></form>`;
    if (view !== "closed") add.querySelector("input, button")?.focus();
  }

  function drawResults(failed = "") {
    const term = lastTerm, more = lastMore;
    const form = add.querySelector('[data-form="existing"]');
    if (!form) return;
    const box = form.querySelector("[data-results]"), go = form.querySelector('[type="submit"]'), typedEmail = cleanEmail(term);
    if (chosen && !results.some((row) => row.uid === chosen.uid)) chosen = null;
    box.innerHTML = failed ? `<p class="ax-note">${esc(failed)}</p>` : results.map((row) => `<button class="ax-result${chosen?.uid === row.uid ? " is-chosen" : ""}" type="button" data-pick="${esc(row.uid)}" aria-pressed="${chosen?.uid === row.uid}"><bdi>${esc(row.email)}</bdi></button>`).join("")
      + (more ? `<p class="ax-note">There are more. Keep typing to narrow the list.</p>` : "")
      || `<p class="ax-note">${!term ? "No other users yet. Go back and choose Create new user." : typedEmail ? "Not in the list. Press the button to look this email up." : "No user's email starts with that. Type the full email to look it up."}</p>`;
    go.disabled = !chosen && !(typedEmail && !results.length);
    go.textContent = chosen ? `Add ${chosen.email}` : `Add to this ${what}`;
  }
  async function search(term) {
    const run = ++searchRun;
    try {
      const data = await call({ action: "search", term }, "Searching users");
      if (run !== searchRun) return; // a newer search has started
      results = withoutMembers(data.results || [], rows); lastTerm = term; lastMore = data.more === true;
      drawResults();
    } catch (failure) { if (run === searchRun) { results = []; lastTerm = term; lastMore = false; drawResults(`${failure?.message || "The search failed."} Type the full email to look it up.`); } }
  }

  async function link(account) {
    const outcome = linkOutcome(await call({ action: "link", userId: account.userId, targets: [target] }, "Giving access"), "link");
    if (!outcome.ok) throw new Error(created.has(account.email) ? `The account was created, but access was not saved: ${outcome.message} Press the button again.` : outcome.message);
    created.delete(account.email);
    showAdd("closed");
    await load(`${account.email} now has access.`);
    showToast("Access given.", "success"); flash(`Access to ${title} given to ${account.email}.`);
  }

  details.addEventListener("toggle", () => { if (details.open && !loaded) void load(); });
  add.addEventListener("input", (event) => {
    if (event.target.name !== "search") return;
    add.querySelector(".ax-error").textContent = "";
    clearTimeout(searchTimer);
    const term = event.target.value.trim();
    searchTimer = setTimeout(() => search(term), 250);
  });
  add.addEventListener("click", (event) => {
    const view = event.target.closest("[data-view]")?.dataset.view;
    if (view) { status.textContent = ""; showAdd(view); return; }
    const pick = event.target.closest("[data-pick]");
    if (pick) { chosen = results.find((row) => row.uid === pick.dataset.pick) || null; drawResults(); }
  });
  add.addEventListener("submit", async (submit) => {
    submit.preventDefault();
    const form = submit.target, go = form.querySelector('[type="submit"]'), error = form.querySelector(".ax-error");
    if (go.disabled) return;
    error.textContent = "";
    try {
      if (form.dataset.form === "existing") {
        let account = chosen ? { userId: chosen.uid, email: chosen.email } : null;
        if (!account) {
          // Not in the results (for example an account that was never a customer before): ask by exact email.
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
      go.disabled = true;
      let account = created.get(email) || null;
      if (!account) {
        status.textContent = "Creating the account…";
        const made = await call({ action: "create", email, password }, "Creating the account");
        account = { userId: made.uid, email: made.email };
        created.set(email, account);
      }
      status.textContent = "Giving access…";
      await link(account);
    } catch (failure) {
      status.textContent = "";
      error.textContent = failure?.code === "EMAIL_EXISTS" ? "This email already has an account. Go back and choose Add existing user." : failure?.message || "Access could not be given. Try again.";
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
        const outcome = linkOutcome(await call({ action: "unlink", userId: row.id, targets: [target] }, "Removing access"), "unlink");
        if (!outcome.ok) throw new Error(outcome.message);
        await load(`${row.email || "That person"} no longer has access.`); showToast("Access removed.", "success");
      } else {
        await call({ action: "cancel-invite", eventId: target.id, grantId: item.dataset.cancel }, "Cancelling the invitation");
        await load("Invitation cancelled.");
      }
    } catch (failure) { item.disabled = false; status.textContent = failure?.message || "The change could not be saved. Try again."; }
  });

  showAdd("closed");
  if (details.open) void load();
  return details;
}
