// "Link or unlink access" panel on the Customers page: look a customer up by email,
// choose several events and photo buckets, and see the result for each one.
import * as api from "./firebase-config.js";
import { getEventDisplayTitle } from "./event-utils.js";
import { createOwnerAdapter } from "./photo-bucket/adapters.js";
import { loadAdminEventsShared, truncationNote } from "./admin-events.js";
import { skeleton } from "./skeleton.js";
import { adminPost, describeTargetResult, esc, targetRetryable } from "./admin-api.js";

const $ = id => document.getElementById(id);
const MAX_TARGETS = 50;
const selected = new Map(); // "event:ID" -> { kind, id, label }
let services, user, customer = null, events = [], eventTruncated = false, bucketRows = [], busy = false;
let lookupVersion = 0, eventsLoaded = false, bucketsLoaded = false, lookingUp = false;

export function mountCustomerLink(context) {
  services = context.services; user = context.user;
  selected.clear();
  $("linkPanel").dataset.feedbackManaged = "true";
  const params = new URLSearchParams(location.search);
  for (const id of params.getAll("event")) selected.set(`event:${id}`, { kind: "event", id, label: `Event ${id}` });
  for (const id of params.getAll("bucket")) selected.set(`bucket:${id}`, { kind: "bucket", id, label: `Bucket ${id}` });
  $("linkPanel").innerHTML = `<div class="access-heading"><div><h2 id="linkTitle">Customer access</h2><p class="admin-note">Choose who can open each event and photo bucket.</p></div><span class="access-context">Events &amp; photo buckets</span></div>
    <form id="lookupForm" class="inline-form" novalidate><label for="lookupEmail">Customer email<input id="lookupEmail" type="email" autocomplete="off" required /></label><button class="secondary-button" type="submit">Look up</button></form>
    <div class="access-customer"><p id="lookupStatus" role="status">Find a customer to view and change their access.</p></div>
    <div class="access-toolbar"><label for="accessFilter">Show access<select id="accessFilter"><option value="all">All</option><option value="linked">Linked</option><option value="available">Not linked</option></select></label><button class="text-button" id="clearSelection" type="button">Clear selection</button></div>
    <div class="link-targets"><fieldset><legend>Events</legend><label class="search-field"><span class="sr-only">Filter events</span><input id="eventFilter" type="search" placeholder="Filter events" /></label><div id="eventChoices" class="choice-list" aria-live="polite">${skeleton.lines(4, "Loading events…")}</div></fieldset>
    <fieldset><legend>Photo buckets</legend><label class="search-field"><span class="sr-only">Filter photo buckets</span><input id="bucketFilterLink" type="search" placeholder="Filter photo buckets" /></label><div id="bucketChoices" class="choice-list" aria-live="polite">${skeleton.lines(3, "Loading photo buckets…")}</div></fieldset></div>
    <div class="access-footer"><div><strong id="selectedCount" role="status"></strong><p class="admin-note" id="selectionHint"></p></div><div class="admin-actions"><button class="primary-button" id="doLink" type="button" disabled>Link selected</button><button class="secondary-button danger-text" id="doUnlink" type="button" disabled>Unlink selected</button></div></div>
    <div id="linkResults" aria-live="polite"></div>
    <dialog id="unlinkAccessDialog" class="workspace-dialog"><form class="workspace-modal workspace-modal--small" id="unlinkAccessForm"><header><h2>Unlink access?</h2><button class="icon-close" id="closeUnlink" type="button" aria-label="Close">×</button></header><div class="workspace-modal__body"><p id="unlinkSummary"></p><ul id="unlinkTargets"></ul><p>The customer account and all event data will be kept.</p></div><footer><button class="secondary-button" id="cancelUnlink" type="button">Cancel</button><button class="danger-button" type="submit">Unlink access</button></footer></form></dialog>`;
  $("lookupForm").addEventListener("submit", lookup);
  $("eventFilter").addEventListener("input", drawEvents);
  $("bucketFilterLink").addEventListener("input", drawBuckets);
  $("lookupEmail").setAttribute("aria-describedby", "lookupStatus");
  $("lookupEmail").placeholder = "customer@example.com"; // taste-skill-ignore: an email input format hint, never presented as customer data.
  $("lookupForm").querySelector("button").textContent = "Find customer";
  $("lookupEmail").addEventListener("input", () => {
    if (customer || lookingUp) selected.clear();
    lookupVersion += 1; lookingUp = false; customer = null;
    $("lookupStatus").textContent = "Find this customer to view their access.";
    $("linkResults").replaceChildren(); drawEvents(); drawBuckets();
  });
  $("accessFilter").addEventListener("change", () => { drawEvents(); drawBuckets(); });
  $("clearSelection").addEventListener("click", () => { selected.clear(); drawEvents(); drawBuckets(); });
    $("linkPanel").addEventListener("change", event => {
    const box = event.target.closest("[data-target]"); if (!box || busy) return;
    if (box.checked && selected.size >= MAX_TARGETS) { box.checked = false; $("selectionHint").textContent = `Choose at most ${MAX_TARGETS} at a time.`; return; }
    const key = box.dataset.target;
    if (box.checked) selected.set(key, { kind: box.dataset.kind, id: box.dataset.id, label: box.dataset.label }); else selected.delete(key);
    sync();
  });
  $("doLink").addEventListener("click", () => run("link"));
  $("doUnlink").addEventListener("click", () => {
    const targets = eligible("unlink"); if (!targets.length) return;
    $("unlinkSummary").textContent = `${customer.email} will lose access to ${targets.length} selected ${targets.length === 1 ? "item" : "items"}:`;
    $("unlinkTargets").innerHTML = targets.map(t => `<li>${esc(t.label)} <small>(${t.kind === "event" ? "Event" : "Photo bucket"})</small></li>`).join("");
    $("unlinkAccessDialog").showModal();
  });
  for (const id of ["closeUnlink", "cancelUnlink"]) $(id).addEventListener("click", () => $("unlinkAccessDialog").close());
  $("unlinkAccessForm").addEventListener("submit", event => { event.preventDefault(); $("unlinkAccessDialog").close(); void run("unlink"); });
  $("linkPanel").addEventListener("click", event => {
    const retry = event.target.closest("[data-retry]");
    if (retry) void (retry.dataset.retry === "event" ? loadEvents() : loadBuckets());
  });
  void loadEvents(); void loadBuckets(); sync();
}

const labelFor = (kind, id) => selected.get(`${kind}:${id}`)?.label || id;

async function loadEvents() {
  try {
    const { rows, truncated } = await loadAdminEventsShared(api, services.db);
    events = rows.filter(d => d.deleting !== true).map(d => ({ id: d.id, title: getEventDisplayTitle(d), location: d.venueEn || d.location || "", demo: d.isDemo === true, expired: d.isDemo === true && (d.demoExpiresAt?.toMillis?.() || d.demoExpiresAt?.seconds * 1000) <= Date.now() }));
    eventsLoaded = true;
    eventTruncated = truncated;
    for (const [key, target] of selected) if (target.kind === "event" && !events.some(e => e.id === target.id)) selected.delete(key);
    for (const e of events) if (selected.has(`event:${e.id}`)) selected.get(`event:${e.id}`).label = e.title;
    drawEvents();
  } catch (error) { $("eventChoices").innerHTML = `<p class="form-error" role="alert">Events could not load (${esc(error?.code || error?.message || "network error")}).</p><button class="secondary-button" type="button" data-retry="event">Retry events</button>`; }
}
async function loadBuckets() {
  try { bucketRows = (await (await createOwnerAdapter(user)).list()).filter(b => b.status !== "deleting"); bucketsLoaded = true; for (const b of bucketRows) if (selected.has(`bucket:${b.id}`)) selected.get(`bucket:${b.id}`).label = b.name; drawBuckets(); }
  catch (error) { $("bucketChoices").innerHTML = `<p class="form-error" role="alert">Photo buckets could not load: ${esc(error?.message || "network error")}.</p><button class="secondary-button" type="button" data-retry="bucket">Retry photo buckets</button>`; }
}
function accessFor(kind, id) {
  if (!customer) return { state: "unknown", label: "Find customer first" };
  if (kind === "bucket" && customer.access.bucketError) return { state: "unknown", label: "Access unavailable" };
  const member = customer.access[kind === "event" ? "events" : "buckets"].find(r => r.id === id);
  if (member && kind === "event" && member.role !== "customer") return { state: "protected", label: member.role === "owner" ? "Owner · protected" : "Specialized · protected" };
  return member ? { state: "linked", label: "Linked" } : { state: "available", label: "Not linked" };
}
function isExpired(kind, id) {
  const row = (kind === "event" ? events : bucketRows).find(r => r.id === id);
  return row?.expired || (row?.demo && Number(row.expiresAt) > 0 && Number(row.expiresAt) <= Date.now());
}
function choice(kind, id, label) {
  const access = accessFor(kind, id), expired = isExpired(kind, id);
  const disabled = busy || access.state === "unknown" || access.state === "protected" || (expired && access.state !== "linked");
  const row = (kind === "event" ? events : bucketRows).find(r => r.id === id);
  const detail = [row?.demo ? "Demo" : kind === "event" ? "Event" : "Photo bucket", row?.location].filter(Boolean).join(" · ");
  return `<label class="choice access-choice"><input type="checkbox" data-target="${esc(`${kind}:${id}`)}" data-kind="${kind}" data-id="${esc(id)}" data-label="${esc(label)}" ${selected.has(`${kind}:${id}`) ? "checked" : ""} ${disabled ? "disabled" : ""} /><span class="access-item-name" title="${esc(id)}">${esc(label)}<small>${esc(detail)}</small></span><span class="access-state access-state--${access.state}">${expired ? "Expired · " : ""}${access.label}</span></label>`;
}
function matchesAccess(kind, id) {
  const filter = $("accessFilter").value, state = accessFor(kind, id).state;
  return filter === "all" || (filter === "linked" ? ["linked", "protected"].includes(state) : state === "available");
}
function drawEvents() {
  if (!eventsLoaded) { sync(); return; }
  const term = $("eventFilter").value.trim().toLowerCase();
  const rows = events.filter(e => (e.title.toLowerCase().includes(term) || e.id.toLowerCase().includes(term)) && matchesAccess("event", e.id));
  $("eventChoices").closest("fieldset").querySelector("legend").textContent = `Events · ${rows.length}${rows.length !== events.length ? ` of ${events.length}` : ""}`;
  $("eventChoices").innerHTML = rows.length ? rows.map(e => choice("event", e.id, e.title)).join("") : `<p class="admin-note">${events.length ? "No events match." : "No events yet."}</p>`;
  if (eventTruncated) $("eventChoices").insertAdjacentHTML("beforeend", `<p class="admin-note">${esc(truncationNote(events.length))}</p>`);
  sync();
}
function drawBuckets() {
  if (!bucketsLoaded) { sync(); return; }
  const term = $("bucketFilterLink").value.trim().toLowerCase();
  const rows = bucketRows.filter(b => `${b.name} ${b.id} ${b.location || ""}`.toLowerCase().includes(term) && matchesAccess("bucket", b.id));
  $("bucketChoices").closest("fieldset").querySelector("legend").textContent = `Photo buckets · ${rows.length}${rows.length !== bucketRows.length ? ` of ${bucketRows.length}` : ""}`;
  $("bucketChoices").innerHTML = rows.length ? rows.map(b => choice("bucket", b.id, b.name || b.id)).join("") : `<p class="admin-note">${bucketRows.length ? "No photo buckets match." : "No photo buckets yet."}</p>`;
  sync();
}
function eligible(action) {
  return [...selected.values()].filter(t => (t.kind === "event" ? events : bucketRows).some(r => r.id === t.id) && accessFor(t.kind, t.id).state === (action === "link" ? "available" : "linked") && (action !== "link" || !isExpired(t.kind, t.id)));
}
function sync() {
  const n = selected.size, links = eligible("link").length, unlinks = eligible("unlink").length;
  $("selectedCount").textContent = n ? `${n} selected${n > MAX_TARGETS ? `. Choose at most ${MAX_TARGETS} at a time.` : ""}` : "Nothing selected yet.";
  const ready = Boolean(customer) && n > 0 && n <= MAX_TARGETS && !busy;
  $("doLink").disabled = !ready || !links; $("doUnlink").disabled = !ready || !unlinks;
  $("doLink").textContent = links ? `Link selected (${links})` : "Link selected";
  $("doUnlink").textContent = unlinks ? `Unlink selected (${unlinks})` : "Unlink selected";
  $("selectionHint").textContent = busy ? "Updating access…" : !customer ? "Find a customer, then select the access to change." : n ? `${links} can be linked · ${unlinks} can be unlinked. Selections stay when you filter.` : "Select events or photo buckets. Protected roles cannot be changed here.";
  $("clearSelection").disabled = busy || !n; $("lookupEmail").disabled = busy;
  const lookupButton = $("lookupForm").querySelector("button");
  lookupButton.disabled = busy || lookingUp;
  lookupButton.classList.toggle("is-busy", lookingUp);
  lookupButton.setAttribute("aria-busy", String(lookingUp));
}

async function lookup(event) {
  event.preventDefault();
  if (busy) return;
  const version = ++lookupVersion;
  if (customer && customer.email.toLowerCase() !== $("lookupEmail").value.trim().toLowerCase()) selected.clear();
  const email = $("lookupEmail").value.trim(), status = $("lookupStatus"); customer = null; drawEvents(); drawBuckets();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { status.textContent = "Enter a full email address."; return; }
  status.textContent = "Looking up…"; lookingUp = true; sync();
  try {
    const found = await adminPost(services.auth, "/api/admin-customer-access", { action: "lookup", email }, undefined, { what: "Looking up the customer" });
    if (version !== lookupVersion) return;
    if (found.isAdmin) { status.textContent = `${found.email} is a platform admin and cannot be linked as a customer.`; return; }
    if (found.disabled) status.textContent = `Found ${found.email}, but the account is disabled.`;
    else status.textContent = `Found ${found.email}.${found.inDirectory ? "" : " They are not in the customer list yet; linking will add them."}`;
    if (!found.access) throw new Error("Current access is unavailable. Find the customer again to retry.");
    if (found.access.bucketError) status.textContent += ` ${found.access.bucketError}`;
    customer = found;
  } catch (error) { if (version === lookupVersion) status.textContent = error.code === "CUSTOMER_NOT_FOUND" ? "No customer account has that email. Create the account first with Add customer." : error.message; }
  finally { if (version === lookupVersion) { lookingUp = false; drawEvents(); drawBuckets(); } }
}

async function run(action) {
  if (busy || !customer || selected.size > MAX_TARGETS) return;
  const targets = eligible(action).map(({ kind, id }) => ({ kind, id }));
  if (!targets.length) return;
  const current = customer;
  $(action === "link" ? "doLink" : "doUnlink").classList.add("is-busy");
  busy = true; drawEvents(); drawBuckets();
  const out = $("linkResults"); out.innerHTML = `<p class="workspace-status" role="status">${action === "link" ? "Linking" : "Unlinking"} ${targets.length} item${targets.length === 1 ? "" : "s"}…</p>`;
  try {
    const response = await adminPost(services.auth, "/api/admin-customer-access", { action, userId: customer.uid, targets }, undefined, { what: action === "link" ? "Linking" : "Unlinking" });
    const results = response.results || [];
    out.innerHTML = `<p class="workspace-status" role="status"><strong>${response.succeeded} succeeded, ${response.failed} failed.</strong> ${response.failed ? "Failed items stay ticked so you can try again." : ""}</p><table class="admin-table"><thead><tr><th scope="col">Item</th><th scope="col">Type</th><th scope="col">Result</th></tr></thead><tbody>${results.map(r => `<tr><th scope="row">${esc(labelFor(r.kind, r.id))}</th><td>${r.kind === "bucket" ? "Photo bucket" : "Event"}</td><td class="${r.ok ? "result-ok" : "result-fail"}">${r.ok ? "OK: " : "Failed: "}${esc(describeTargetResult(r))}${targetRetryable(r) ? " (can retry)" : ""}${r.warning ? " (customer list not updated)" : ""}</td></tr>`).join("")}</tbody></table>`;
    for (const r of results) if (r.ok) {
      selected.delete(`${r.kind}:${r.id}`);
      const key = r.kind === "event" ? "events" : "buckets";
      current.access[key] = current.access[key].filter(item => item.id !== r.id);
      if (action === "link") current.access[key].push({ id: r.id, role: r.status === "preserved" ? r.role || "specialized" : "customer" });
    }
    if (response.succeeded) document.dispatchEvent(new CustomEvent("customer-access-changed", { detail: { uid: customer.uid } }));
    drawEvents(); drawBuckets();
  } catch (error) {
    out.innerHTML = `<p class="form-error" role="alert">${esc(error.message)} Some changes may have completed. Find the customer again to verify access before retrying.</p>`;
    customer = null;
  }
  finally {
    busy = false; drawEvents(); drawBuckets();
    // Linked items are unticked, so the buttons can stay disabled with nothing selected; the click spinner must still stop.
    for (const id of ["doLink", "doUnlink"]) $(id).classList.remove("is-busy", "is-auto-busy");
  }
}
