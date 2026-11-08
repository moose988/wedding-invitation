// "Link or unlink access" panel on the Customers page: look a customer up by email,
// choose several events and photo buckets, and see the result for each one.
import * as api from "./firebase-config.js";
import { getEventDisplayTitle } from "./event-utils.js";
import { createOwnerAdapter } from "./photo-bucket/adapters.js";
import { loadAdminEventsShared, truncationNote } from "./admin-events.js";
import { skeleton } from "./skeleton.js";
import { adminPost, describeTargetResult, esc, targetRetryable } from "./admin-api.js";

const $ = id => document.getElementById(id);
const MAX_TARGETS = 50, PAGE = 50;
const selected = new Map(); // "event:ID" -> { kind, id, label }
let services, user, customer = null, events = [], eventTruncated = false, bucketRows = [], busy = false;

export function mountCustomerLink(context) {
  services = context.services; user = context.user;
  const params = new URLSearchParams(location.search);
  for (const id of params.getAll("event")) selected.set(`event:${id}`, { kind: "event", id, label: `Event ${id}` });
  for (const id of params.getAll("bucket")) selected.set(`bucket:${id}`, { kind: "bucket", id, label: `Bucket ${id}` });
  $("linkPanel").innerHTML = `<h2 id="linkTitle">Link or unlink access</h2><p class="admin-note">Find a customer by email, tick the events and photo buckets, then link or unlink them in one step. Each one gets its own result.</p>
    <form id="lookupForm" class="inline-form" novalidate><label for="lookupEmail">Customer email<input id="lookupEmail" type="email" autocomplete="off" required /></label><button class="secondary-button" type="submit">Look up</button></form>
    <p class="workspace-status" id="lookupStatus" role="status"></p>
    <div class="link-targets"><fieldset><legend>Events</legend><label class="search-field"><span class="sr-only">Filter events</span><input id="eventFilter" type="search" placeholder="Filter events" /></label><div id="eventChoices" class="choice-list" aria-live="polite">${skeleton.lines(4, "Loading events…")}</div></fieldset>
    <fieldset><legend>Photo buckets</legend><label class="search-field"><span class="sr-only">Filter photo buckets</span><input id="bucketFilterLink" type="search" placeholder="Filter photo buckets" /></label><div id="bucketChoices" class="choice-list" aria-live="polite">${skeleton.lines(3, "Loading photo buckets…")}</div></fieldset></div>
    <p class="admin-note" id="selectedCount" role="status"></p>
    <div class="admin-actions"><button class="primary-button" id="doLink" type="button" disabled>Link selected</button><button class="secondary-button danger-text" id="doUnlink" type="button" disabled>Unlink selected</button></div>
    <div id="linkResults" aria-live="polite"></div>`;
  $("lookupForm").addEventListener("submit", lookup);
  $("eventFilter").addEventListener("input", drawEvents);
  $("bucketFilterLink").addEventListener("input", drawBuckets);
    $("linkPanel").addEventListener("change", event => {
    const box = event.target.closest("[data-target]"); if (!box) return;
    const key = box.dataset.target;
    if (box.checked) selected.set(key, { kind: box.dataset.kind, id: box.dataset.id, label: box.dataset.label }); else selected.delete(key);
    sync();
  });
  $("doLink").addEventListener("click", () => run("link"));
  $("doUnlink").addEventListener("click", () => run("unlink"));
  void loadEvents(); void loadBuckets(); sync();
}

const labelFor = (kind, id) => selected.get(`${kind}:${id}`)?.label || id;

async function loadEvents() {
  try {
    const { rows, truncated } = await loadAdminEventsShared(api, services.db);
    events = rows.filter(d => d.deleting !== true).map(d => ({ id: d.id, title: getEventDisplayTitle(d), demo: d.isDemo === true }));
    eventTruncated = truncated;
    for (const e of events) if (selected.has(`event:${e.id}`)) selected.get(`event:${e.id}`).label = e.title;
    drawEvents();
  } catch (error) { $("eventChoices").innerHTML = `<p class="form-error" role="alert">Events could not load (${esc(error?.code || error?.message || "network error")}). Reload the page to try again.</p>`; }
}
async function loadBuckets() {
  try { bucketRows = await (await createOwnerAdapter(user)).list(); for (const b of bucketRows) if (selected.has(`bucket:${b.id}`)) selected.get(`bucket:${b.id}`).label = b.name; drawBuckets(); }
  catch (error) { $("bucketChoices").textContent = `Photo buckets could not load: ${error?.message || "network error"}.`; }
}
const choice = (kind, id, label, extra = "") => `<label class="choice"><input type="checkbox" data-target="${esc(`${kind}:${id}`)}" data-kind="${kind}" data-id="${esc(id)}" data-label="${esc(label)}" ${selected.has(`${kind}:${id}`) ? "checked" : ""} /><span>${esc(label)}${extra}</span></label>`;
function drawEvents() {
  const term = $("eventFilter").value.trim().toLowerCase();
  const rows = events.filter(e => e.title.toLowerCase().includes(term) || e.id.toLowerCase().includes(term));
  $("eventChoices").innerHTML = rows.length ? rows.map(e => choice("event", e.id, e.title, e.demo ? ' <small>(demo)</small>' : "")).join("") : `<p class="admin-note">${events.length ? "No events match." : "No events yet."}</p>`;
  if (eventTruncated) $("eventChoices").insertAdjacentHTML("beforeend", `<p class="admin-note">${esc(truncationNote(events.length))}</p>`);
  sync();
}
function drawBuckets() {
  const term = $("bucketFilterLink").value.trim().toLowerCase();
  const rows = bucketRows.filter(b => `${b.name} ${b.location || ""}`.toLowerCase().includes(term));
  $("bucketChoices").innerHTML = rows.length ? rows.map(b => choice("bucket", b.id, b.name || b.id, b.demo ? ' <small>(demo)</small>' : "")).join("") : `<p class="admin-note">${bucketRows.length ? "No photo buckets match." : "No photo buckets yet."}</p>`;
  sync();
}
function sync() {
  const n = selected.size;
  $("selectedCount").textContent = n ? `${n} selected${n > MAX_TARGETS ? `. Choose at most ${MAX_TARGETS} at a time.` : ""}` : "Nothing selected yet.";
  const ready = Boolean(customer) && n > 0 && n <= MAX_TARGETS && !busy;
  $("doLink").disabled = !ready; $("doUnlink").disabled = !ready;
}

async function lookup(event) {
  event.preventDefault();
  const email = $("lookupEmail").value.trim(), status = $("lookupStatus"); customer = null; sync();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { status.textContent = "Enter a full email address."; return; }
  status.textContent = "Looking up…"; const lookupButton = $("lookupForm").querySelector("button"); lookupButton.disabled = true;
  try {
    const found = await adminPost(services.auth, "/api/admin-customer-access", { action: "lookup", email }, undefined, { what: "Looking up the customer" });
    if (found.isAdmin) { status.textContent = `${found.email} is a platform admin and cannot be linked as a customer.`; return; }
    if (found.disabled) status.textContent = `Found ${found.email}, but the account is disabled.`;
    else status.textContent = `Found ${found.email}.${found.inDirectory ? "" : " They are not in the customer list yet; linking will add them."}`;
    customer = found; sync();
  } catch (error) { status.textContent = error.code === "CUSTOMER_NOT_FOUND" ? "No customer account has that email. Create the account first with Add customer." : error.message; }
  finally { lookupButton.disabled = false; }
}

async function run(action) {
  if (busy || !customer) return;
  const targets = [...selected.values()].map(({ kind, id }) => ({ kind, id }));
  busy = true; sync();
  const out = $("linkResults"); out.innerHTML = `<p class="workspace-status" role="status">${action === "link" ? "Linking" : "Unlinking"} ${targets.length} item${targets.length === 1 ? "" : "s"}…</p>`;
  try {
    const response = await adminPost(services.auth, "/api/admin-customer-access", { action, userId: customer.uid, targets }, undefined, { what: action === "link" ? "Linking" : "Unlinking" });
    const results = response.results || [];
    out.innerHTML = `<p class="workspace-status" role="status"><strong>${response.succeeded} succeeded, ${response.failed} failed.</strong> ${response.failed ? "Failed items stay ticked so you can try again." : ""}</p><table class="admin-table"><thead><tr><th scope="col">Item</th><th scope="col">Type</th><th scope="col">Result</th></tr></thead><tbody>${results.map(r => `<tr><th scope="row">${esc(labelFor(r.kind, r.id))}</th><td>${r.kind === "bucket" ? "Photo bucket" : "Event"}</td><td class="${r.ok ? "result-ok" : "result-fail"}">${r.ok ? "OK: " : "Failed: "}${esc(describeTargetResult(r))}${targetRetryable(r) ? " (can retry)" : ""}${r.warning ? " (customer list not updated)" : ""}</td></tr>`).join("")}</tbody></table>`;
    for (const r of results) if (r.ok) selected.delete(`${r.kind}:${r.id}`);
    if (response.succeeded) document.dispatchEvent(new CustomEvent("customer-access-changed", { detail: { uid: customer.uid } }));
    drawEvents(); drawBuckets();
  } catch (error) { out.innerHTML = `<p class="form-error" role="alert">${esc(error.message)} Nothing was changed on the page; check the customer before trying again.</p>`; }
  finally {
    busy = false; sync();
    // Linked items are unticked, so the buttons can stay disabled with nothing selected; the click spinner must still stop.
    for (const id of ["doLink", "doUnlink"]) $(id).classList.remove("is-busy", "is-auto-busy");
  }
}
