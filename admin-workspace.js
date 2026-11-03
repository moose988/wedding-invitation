// Platform-admin sections of the All Events page: Photo Buckets, Demos and the
// per-event customer activity log. Loaded only for platform admins.
import { collection, getDocs, limit, orderBy, query, startAfter, where } from "./firebase-config.js";
import { createOwnerAdapter } from "./photo-bucket/adapters.js";
import { ensureGenderRevealPublished } from "./gender-reveal-publication.js";
import { skeleton } from "./skeleton.js";
import { mountAdminHealth } from "./admin-health.js";
import { DEFAULT_DEMO_HOURS, DEMO_DURATIONS, DEMO_NOTICE, DEMO_TYPES, adminPost, bucketOverdue, esc, formatCountdown, timeText } from "./admin-api.js";

const $ = id => document.getElementById(id);
const SECTIONS = ["events", "buckets", "demos"];
let ctx = null;
let ticker = null;

export function mountAdminWorkspace(context) {
  ctx = context;
  void mountAdminHealth(context.state.services.auth);
  const route = () => {
    const hash = location.hash.replace("#", "");
    const section = SECTIONS.includes(hash) ? hash : "events";
    $("workspace").dataset.section = section;
    $("adminBuckets").hidden = section !== "buckets";
    $("adminDemos").hidden = section !== "demos";
    document.querySelectorAll("#workspaceTabs [data-section]").forEach(link => {
      const active = link.dataset.section === section;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
    });
    if (section === "buckets" && !$("adminBuckets").dataset.ready) { $("adminBuckets").dataset.ready = "1"; buildBuckets(); }
    if (section === "demos" && !$("adminDemos").dataset.ready) { $("adminDemos").dataset.ready = "1"; buildDemos(); }
  };
  window.addEventListener("hashchange", route);
  route();
  // Load the bucket list up front so the tab can show overdue and failed-backup counts.
  if (!$("adminBuckets").dataset.ready) { $("adminBuckets").dataset.ready = "1"; buildBuckets(); }
  ticker = setInterval(() => {
    document.querySelectorAll("[data-expires]").forEach(node => { node.textContent = formatCountdown(Number(node.dataset.expires)); });
  }, 1000);
}

const copyText = async (text, button) => {
  const original = button.textContent;
  try { await navigator.clipboard.writeText(text); button.textContent = "Copied"; }
  catch { button.textContent = "Press Ctrl+C"; const input = button.closest(".secret-row")?.querySelector("input"); input?.select(); }
  setTimeout(() => { button.textContent = original; }, 2000);
};
const msOf = value => value?.toMillis?.() ?? (typeof value?.seconds === "number" ? value.seconds * 1000 : Number(value) || 0);
const bytesText = bytes => bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(1)} GB` : `${Math.max(0, Math.round((bytes || 0) / 1048576))} MB`;

/* ---------------------------------------------------------------- Photo Buckets */
const buckets = { rows: [], loaded: false, backups: new Map(), notes: new Map(), platform: null, platformError: "" };

function buildBuckets() {
  const host = $("adminBuckets");
  host.innerHTML = `<div class="admin-panel__head"><div><h2 id="adminBucketsTitle">Photo Buckets</h2><p>Every photo bucket on the platform. A bucket is flagged when it is more than 48 hours past its event.</p></div><button class="primary-button" id="bucketCreate" type="button">Create photo bucket</button></div>
    <div class="workspace-controls"><label class="search-field"><span class="sr-only">Search photo buckets</span><input id="bucketSearch" type="search" placeholder="Search by name or location" /></label><label class="sort-field">Show <select id="bucketFilter"><option value="all">All buckets</option><option value="overdue">Overdue only</option><option value="backups">Failed backups</option><option value="demo">Demos only</option></select></label></div>
    <p class="admin-alert" id="overdueAlert" role="status" hidden></p>
    <p class="workspace-status" id="bucketStatus" role="status">Loading photo buckets…</p>
    <button class="secondary-button" id="bucketRetry" type="button" hidden>Try again</button>
    <div class="wedding-grid" id="bucketList">${skeleton.cards(3, "Loading photo buckets…")}</div>`;
  $("bucketCreate").addEventListener("click", () => {
    ctx.openCreate();
    const radio = document.querySelector('#weddingForm [name="eventCategory"][value="photo_bucket"]');
    if (radio) { radio.checked = true; radio.dispatchEvent(new Event("change", { bubbles: true })); }
  });
  $("bucketSearch").addEventListener("input", renderBuckets);
  $("bucketFilter").addEventListener("change", renderBuckets);
  $("bucketRetry").addEventListener("click", loadBuckets);
  $("overdueAlert").addEventListener("click", event => { if (event.target.closest("[data-show-overdue]")) { $("bucketFilter").value = "overdue"; renderBuckets(); } });
  $("bucketList").addEventListener("click", bucketAction);
  void loadBuckets();
}

async function loadBuckets() {
  $("bucketStatus").textContent = "Loading photo buckets…"; $("bucketRetry").hidden = true; $("bucketList").innerHTML = skeleton.cards(3, "Loading photo buckets…");
  try {
    buckets.rows = await (await createOwnerAdapter(ctx.user)).list();
    buckets.loaded = true;
    renderBuckets();
    void loadBackups();
  } catch (error) {
    $("bucketStatus").textContent = `Photo buckets could not load: ${error?.message || "network error"}.`;
    $("bucketRetry").hidden = false; $("bucketList").innerHTML = "";
  }
}

function renderBuckets() {
  const term = $("bucketSearch").value.trim().toLowerCase(), filter = $("bucketFilter").value;
  const rows = buckets.rows.filter(b => (filter === "all" || (filter === "overdue" ? bucketOverdue(b) : filter === "backups" ? (buckets.backups.get(b.id)?.failed > 0) : b.demo === true))
    && `${b.name || ""} ${b.location || ""} ${b.id}`.toLowerCase().includes(term));
  paintBucketSummary();
  $("bucketStatus").textContent = !buckets.rows.length ? "" : `${rows.length} of ${buckets.rows.length} photo bucket${buckets.rows.length === 1 ? "" : "s"} shown`;
  if (!rows.length) {
    $("bucketList").innerHTML = `<div class="admin-empty"><strong>${buckets.rows.length ? "No buckets match" : "No photo buckets yet"}</strong><p>${buckets.rows.length ? "Change the search or filter." : "Create a photo bucket to collect guest photos for an event."}</p></div>`;
    return;
  }
  $("bucketList").innerHTML = rows.map(b => {
    const id = esc(b.id), overdue = bucketOverdue(b);
    const badges = [overdue ? `<span class="status-badge status-badge--overdue">Overdue: over 48 hours past the event</span>` : "", b.demo ? `<span class="status-badge status-badge--demo">Demo</span>` : "", b.status === "deleting" ? `<span class="status-badge status-badge--deleting">Deleting</span>` : "", b.frozen ? `<span class="status-badge">Frozen</span>` : "", b.paused ? `<span class="status-badge">Paused</span>` : ""].join("");
    const usage = Number.isFinite(b.usedBytes) ? `${bytesText(b.usedBytes)} of ${b.limitGb ?? "?"} GB · ${b.photoCount ?? 0} photos` : "";
    const expiry = b.demo && b.expiresAt ? `<span class="countdown" data-expires="${esc(b.expiresAt)}">${esc(formatCountdown(b.expiresAt))}</span>` : "";
    return `<article class="wedding-card${overdue ? " wedding-card--overdue" : ""}"><div class="card-head"><div><h3>${esc(b.name || "Untitled bucket")}</h3><span class="category-badge">Photo Bucket</span></div></div><div class="admin-badges">${badges}</div><p class="admin-meta">${esc(b.date || "No date")} · ${esc(b.location || "No location")}</p><p class="admin-meta">${esc(usage)} ${expiry}</p>${b.demo ? "" : backupLine(b.id)}
      <div class="card-actions admin-actions"><a class="open-button primary-button" href="./photo-bucket-manage.html?bucket=${encodeURIComponent(b.id)}">Manage photos</a><button class="secondary-button" data-bucket-action="customers" data-id="${id}" type="button">Customers</button><button class="secondary-button" data-bucket-action="deleted" data-id="${id}" type="button">Deleted photos</button>${b.demo ? "" : `<button class="secondary-button" data-bucket-action="redrive" data-id="${id}" type="button" ${buckets.backups.get(b.id)?.failed > 0 ? "" : "disabled"}>Re-drive backups</button>`}<button class="secondary-button danger-text" data-bucket-action="delete" data-id="${id}" type="button">Delete bucket</button></div></article>`;
  }).join("");
}

async function bucketAction(event) {
  const button = event.target.closest("[data-bucket-action]"); if (!button) return;
  const bucket = buckets.rows.find(b => b.id === button.dataset.id); if (!bucket) return;
  const action = button.dataset.bucketAction;
  if (action === "customers") location.href = `./customers.html?bucket=${encodeURIComponent(bucket.id)}`;
  if (action === "deleted") openDeletedPhotos(bucket);
  if (action === "redrive") void redrive(bucket);
  if (action === "delete") openBucketDelete(bucket);
}

const backupLine = id => {
  const info = buckets.backups.get(id), note = buckets.notes.get(id);
  const text = !info ? "Backups: checking…" : info.error ? `Backups: could not check (${info.error})` : `Backups: ${info.pending} pending, ${info.failed} failed${info.unbacked ? `, ${info.unbacked} not yet backed up` : ""}`;
  return `<p class="admin-meta${info?.failed > 0 ? " admin-meta--bad" : ""}" aria-live="polite">${esc(text)}${note ? ` ${esc(note)}` : ""}</p>`;
};
function paintBucketSummary() {
  // The platform-wide route counts every bucket, not only the ones listed here; the per-bucket sum is the fallback.
  const overdue = buckets.rows.filter(b => bucketOverdue(b)), failed = Number.isInteger(buckets.platform?.failed) ? buckets.platform.failed : [...buckets.backups.values()].reduce((n, i) => n + (i?.failed || 0), 0);
  const alert = $("overdueAlert");
  const platformNote = buckets.platformError ? ` The platform-wide backup check failed: ${buckets.platformError}. The failed-backup total may be incomplete.` : "";
  alert.hidden = overdue.length === 0;
  alert.innerHTML = overdue.length ? `<strong>${overdue.length} bucket${overdue.length === 1 ? " is" : "s are"} overdue</strong>, more than 48 hours past the event. Nothing is deleted automatically. <button class="secondary-button" type="button" data-show-overdue>Show overdue buckets</button>` : "";
  if (platformNote) { alert.hidden = false; alert.insertAdjacentText("beforeend", platformNote); }
  const filter = $("bucketFilter"); if (filter) { filter.options[1].textContent = `Overdue only (${overdue.length})`; filter.options[2].textContent = `Failed backups (${failed})`; }
  const tab = document.querySelector('#workspaceTabs [data-section="buckets"]');
  if (tab) { tab.querySelector(".tab-badge")?.remove(); const n = overdue.length + (failed ? 1 : 0); if (overdue.length || failed) tab.insertAdjacentHTML("beforeend", ` <span class="tab-badge" title="${esc(`${overdue.length} overdue, ${failed} failed backups`)}">${overdue.length ? `${overdue.length} overdue` : ""}${overdue.length && failed ? ", " : ""}${failed ? `${failed} failed backup${failed === 1 ? "" : "s"}` : ""}</span>`); void n; }
}
// Backup counts are read four buckets at a time. The API has no platform-wide count yet,
// per-bucket lines below are read here; the tab total comes from GET /admin/backups.
async function loadBackups() {
  const adapter = await createOwnerAdapter(ctx.user), queue = buckets.rows.filter(b => !b.demo);
  try { buckets.platform = await adapter.platformBackups(); buckets.platformError = ""; } catch (error) { buckets.platform = null; buckets.platformError = error?.message || "network error"; }
  paintBucketSummary();
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let b; (b = queue.shift());) {
      try { buckets.backups.set(b.id, await adapter.backups(b.id)); } catch (error) { buckets.backups.set(b.id, { error: error?.message || "network error" }); }
      renderBuckets();
    }
  }));
}
async function redrive(bucket) {
  buckets.notes.set(bucket.id, "Re-driving…"); renderBuckets();
  try {
    const adapter = await createOwnerAdapter(ctx.user); let cursor, queued = 0;
    for (let i = 0; i < 20; i += 1) { const r = await adapter.redriveBackups(bucket.id, cursor ? { cursor } : {}); queued += r.queued || 0; cursor = r.nextCursor; if (!cursor) break; }
    buckets.notes.set(bucket.id, `Queued ${queued} backup${queued === 1 ? "" : "s"}. Check again in a few minutes.`);
    buckets.backups.set(bucket.id, await adapter.backups(bucket.id));
  } catch (error) { buckets.notes.set(bucket.id, `Re-drive failed: ${error?.message || "network error"}`); }
  renderBuckets();
}

function dialogShell(id, html) {
  let dialog = $(id);
  if (!dialog) { dialog = document.createElement("dialog"); dialog.id = id; dialog.className = "workspace-dialog admin-dialog"; document.body.append(dialog); }
  dialog.innerHTML = html;
  dialog.querySelectorAll("[data-dialog-close]").forEach(b => b.addEventListener("click", () => dialog.close()));
  if (!dialog.open) dialog.showModal();
  return dialog;
}

function openBucketDelete(bucket) {
  const phrase = `DELETE ${bucket.id}`;
  const dialog = dialogShell("bucketDeleteDialog", `<form class="workspace-modal workspace-modal--small"><header><div><p class="workspace-kicker">Permanent action</p><h2>Delete photo bucket?</h2></div><button class="icon-close" type="button" data-dialog-close aria-label="Close">×</button></header><div class="workspace-modal__body"><p>This permanently removes <strong>${esc(bucket.name)}</strong> and every photo in it. It cannot be undone, and the data is gone within about five minutes.</p><p>Type <strong>${esc(phrase)}</strong> to continue.</p><label>Confirmation<input name="phrase" autocomplete="off" /></label><p class="form-error" role="alert"></p></div><footer><button class="secondary-button" type="button" data-dialog-close>Cancel</button><button class="danger-button" type="submit">Delete permanently</button></footer></form>`);
  const form = dialog.querySelector("form"), error = form.querySelector(".form-error");
  form.addEventListener("submit", async submit => {
    submit.preventDefault();
    if (form.elements.phrase.value !== phrase) { error.textContent = `Type “${phrase}” exactly to delete.`; return; }
    const go = form.querySelector('[type="submit"]'); go.disabled = true; error.textContent = "";
    try { await (await createOwnerAdapter(ctx.user)).deleteBucket(bucket.id); buckets.rows = buckets.rows.filter(b => b.id !== bucket.id); dialog.close(); renderBuckets(); ctx.flash("Photo bucket deleted. Its data is removed within about five minutes."); }
    catch (failure) { error.textContent = failure?.message || "The bucket could not be deleted."; go.disabled = false; }
  });
}

const RESTORE_NOTES = { BACKUP_NOT_READY: "The backup is still being made. Try again in a few minutes.", ALREADY_RESTORED: "This photo was already restored.", PHOTO_EXISTS: "A photo with this file number already exists.", BUCKET_FULL: "The bucket is full. Increase its size first.", BACKUP_MISSING: "No backup exists for this photo, so it cannot be restored." };

async function openDeletedPhotos(bucket) {
  const dialog = dialogShell("deletedDialog", `<div class="workspace-modal"><header><div><p class="workspace-kicker">Admin only</p><h2>Deleted photos: ${esc(bucket.name)}</h2></div><button class="icon-close" type="button" data-dialog-close aria-label="Close">×</button></header><div class="workspace-modal__body"><p class="admin-note">Restoring puts the photo back using its saved <strong>quality 80 backup copy</strong>, not the original file. It uses storage space again. Photos deleted by guests are permanent and are not listed.</p><p class="workspace-status" role="status" id="deletedStatus">Loading deleted photos…</p><div id="deletedList">${skeleton.rows(3, "Loading deleted photos…")}</div></div><footer><button class="secondary-button" type="button" data-dialog-close>Close</button></footer></div>`);
  const status = dialog.querySelector("#deletedStatus"), list = dialog.querySelector("#deletedList");
  let records = [];
  const paint = () => {
    status.textContent = records.length ? `${records.length} deleted photo${records.length === 1 ? "" : "s"}` : "No deleted photos. Photos removed by owners or admins appear here.";
    list.innerHTML = records.length ? `<table class="admin-table"><thead><tr><th scope="col">File number</th><th scope="col">Name</th><th scope="col">Deleted</th><th scope="col">By</th><th scope="col"><span class="sr-only">Action</span></th></tr></thead><tbody>${records.map(r => {
      const restored = Boolean(r.restoredAt);
      const note = restored ? `Restored ${esc(timeText(r.restoredAt))}` : r.restorable === false ? esc(r.backupState === "failed" ? "Backup failed" : "Backup not ready yet") : "";
      return `<tr><th scope="row">${esc(r.photoId)}</th><td>${esc(r.name || "Untitled")}</td><td>${esc(timeText(r.deletedAt))}</td><td>${esc(r.actorRole || "")}</td><td>${note ? `<span class="admin-note">${note}</span>` : ""}<button class="secondary-button" type="button" data-restore="${esc(r.deletedId)}" ${restored || r.restorable === false ? "disabled" : ""} aria-label="Restore photo ${esc(r.photoId)}">Restore</button></td></tr>`;
    }).join("")}</tbody></table>` : "";
  };
  try { records = await (await createOwnerAdapter(ctx.user)).deleted(bucket.id); paint(); }
  catch (error) { list.innerHTML = ""; status.textContent = `Deleted photos could not load: ${error?.message || "network error"}.`; return; }
  list.addEventListener("click", async click => {
    const button = click.target.closest("[data-restore]"); if (!button) return;
    button.disabled = true; status.textContent = "Restoring…";
    try { await (await createOwnerAdapter(ctx.user)).restoreDeleted(bucket.id, button.dataset.restore); records = await (await createOwnerAdapter(ctx.user)).deleted(bucket.id); paint(); status.textContent = "Photo restored from its quality 80 backup copy."; }
    catch (error) { button.disabled = false; status.textContent = RESTORE_NOTES[error?.code] || error?.message || "The photo could not be restored."; }
  });
}

/* ------------------------------------------------------------------------ Demos */
let shownSecret = null;
const beforeUnload = event => { event.preventDefault(); event.returnValue = ""; };

function buildDemos() {
  $("adminDemos").innerHTML = `<div class="admin-panel__head"><div><h2 id="adminDemosTitle">Demos</h2><p>Make a throwaway event or photo bucket to show a customer. ${esc(DEMO_NOTICE)}</p></div></div>
    <form class="admin-card" id="demoForm" novalidate><fieldset><legend>Demo type</legend><div class="demo-types">${DEMO_TYPES.map((t, i) => `<label class="demo-type"><input type="radio" name="demoType" value="${t.value}" ${i === 0 ? "checked" : ""} /><span><strong>${esc(t.label)}</strong><small>${esc(t.note)}</small></span></label>`).join("")}</div></fieldset>
      <label>Demo name<input name="demoName" maxlength="100" required placeholder="For example: Spring wedding demo" /></label>
      <label>End access after<select name="demoHours" required aria-describedby="demoHoursHelp">${DEMO_DURATIONS.map(d => `<option value="${d.hours}" ${d.hours === DEFAULT_DEMO_HOURS ? "selected" : ""}>${esc(d.label)}</option>`).join("")}</select><small id="demoHoursHelp">Access ends at this time. The demo, its sign-in account and its data are removed soon after.</small></label>
      <p class="form-error" id="demoError" role="alert"></p>
      <button class="primary-button" id="demoSubmit" type="submit">Create demo</button></form>
    <div id="demoResult" aria-live="polite"></div>
    <section class="admin-card" aria-labelledby="demoListTitle"><div class="admin-panel__head"><h3 id="demoListTitle">Active demos</h3><div class="admin-actions"><button class="secondary-button" id="demoRefresh" type="button">Refresh</button><button class="secondary-button" id="demoCleanup" type="button">Remove expired demos now</button></div></div><p class="workspace-status" id="demoStatus" role="status">Loading demos…</p><div id="demoList" class="demo-list">${skeleton.rows(2, "Loading demos…")}</div></section>`;
  $("demoForm").addEventListener("submit", createDemo);
  $("demoRefresh").addEventListener("click", loadDemos);
  $("demoCleanup").addEventListener("click", runCleanup);
  void loadDemos();
}

async function createDemo(event) {
  event.preventDefault();
  const form = event.currentTarget, error = $("demoError"), submit = $("demoSubmit");
  const type = form.elements.demoType.value, name = form.elements.demoName.value.trim(), expiresInHours = Number(form.elements.demoHours.value);
  if (!DEMO_DURATIONS.some(d => d.hours === expiresInHours)) { error.textContent = "Choose when the demo should be deleted."; form.elements.demoHours.focus(); return; }
  if (!name || name.length > 100) { error.textContent = "Enter a name of 1 to 100 characters."; form.elements.demoName.focus(); return; }
  error.textContent = ""; submit.disabled = true; submit.textContent = "Creating…";
  try {
    const demo = await adminPost(ctx.state.services.auth, "/api/admin-demos", { type, name, expiresInHours }, undefined, { what: "Creating the demo" });
    form.reset();
    showSecret(demo, name);
    void loadDemos();
  } catch (failure) {
    // No automatic retry: a second request would make a second demo.
    error.textContent = failure.status || failure.code === "NETWORK" ? `${failure.message}${failure.data?.rolledBack === false ? " Part of it could not be removed now; the scheduled cleanup removes it once it expires." : ""}` : "The connection failed. Check the Active demos list before trying again, because the demo may have been created.";
  } finally { submit.disabled = false; submit.textContent = "Create demo"; }
}

function showSecret(demo, name) {
  clearSecret(true);
  shownSecret = { demo, copied: false };
  window.addEventListener("beforeunload", beforeUnload);
  const isBucket = demo.kind === "photo_bucket";
  const openLink = isBucket ? `./photo-bucket-manage.html?bucket=${encodeURIComponent(demo.bucketId)}` : `./dashboard.html?wedding=${encodeURIComponent(demo.eventId)}`;
  const signIn = isBucket ? "Sign in on the photo bucket owner page." : "Sign in at /customer-login.";
  $("demoResult").innerHTML = `<section class="admin-card admin-card--secret" role="group" aria-labelledby="secretTitle"><h3 id="secretTitle">Demo ready: ${esc(name)}</h3>
    <p class="admin-warning" role="alert"><strong>Copy this sign-in now.</strong> It is shown only once and cannot be shown again. Closing this card or leaving the page erases it.</p>
    <div class="secret-row"><label for="secretEmail">Email</label><input id="secretEmail" readonly value="${esc(demo.credentials?.email)}" /><button class="secondary-button" type="button" data-copy="secretEmail">Copy email</button></div>
    <div class="secret-row"><label for="secretPassword">Password</label><input id="secretPassword" readonly value="${esc(demo.credentials?.password)}" /><button class="secondary-button" type="button" data-copy="secretPassword">Copy password</button></div>
    <p class="admin-meta"><strong class="countdown" data-expires="${esc(demo.expiresAt)}">${esc(formatCountdown(demo.expiresAt))}</strong> · access ends ${esc(timeText(demo.expiresAt))}, and the data is removed soon after. ${esc(isBucket ? "This bucket holds 1 GB." : "")} Access ends at the time shown and the data is removed soon after. ${esc(signIn)} The email address cannot receive mail, so password reset will not work.</p>
    <div class="admin-actions"><a class="secondary-button" href="${openLink}">${isBucket ? "Open the bucket" : "Open the dashboard"}</a>${demo.type === "gender_reveal" ? `<button class="secondary-button" type="button" id="demoInvite">Copy invitation link</button>` : ""}<button class="primary-button" type="button" id="secretDone">I have saved the sign-in</button></div><p class="workspace-status" id="secretStatus" role="status"></p></section>`;
  $("demoResult").querySelectorAll("[data-copy]").forEach(button => button.addEventListener("click", () => { shownSecret.copied = true; void copyText($(button.dataset.copy).value, button); }));
  $("secretDone").addEventListener("click", () => { if (!shownSecret.copied && !window.confirm("You have not copied the sign-in. It cannot be shown again. Close anyway?")) return; clearSecret(); });
  if (demo.type === "gender_reveal") prepareGenderReveal(demo.eventId);
  $("secretTitle").setAttribute("tabindex", "-1"); $("secretTitle").focus();
}

// Contract: the server cannot publish the gender reveal invitation, so the admin's browser does.
async function prepareGenderReveal(eventId) {
  const status = $("secretStatus"), button = $("demoInvite");
  const publish = async () => { await ensureGenderRevealPublished(ctx.accountApi, ctx.state.services.db, eventId); };
  status.textContent = "Preparing the shared invitation…";
  try { await publish(); status.textContent = "The shared invitation is ready."; } catch { status.textContent = "The invitation needs preparing. Use Copy invitation link to retry."; }
  button?.addEventListener("click", async () => {
    try { await publish(); await navigator.clipboard.writeText(new URL(`gender-reveal.html?wedding=${encodeURIComponent(eventId)}`, location.href).href); status.textContent = "Invitation link copied."; }
    catch { status.textContent = "Could not prepare the invitation. Check your access and try again."; }
  });
}

function clearSecret(silent) {
  window.removeEventListener("beforeunload", beforeUnload);
  shownSecret = null;
  const host = $("demoResult"); if (host) host.innerHTML = silent ? "" : `<p class="workspace-status" role="status">The sign-in has been cleared. It cannot be shown again.</p>`;
}

async function loadDemos() {
  const status = $("demoStatus"), list = $("demoList"); status.textContent = "Loading demos…"; list.innerHTML = skeleton.rows(2, "Loading demos…");
  try {
    const [events, bucketResult] = await Promise.all([
      getDocs(query(collection(ctx.state.services.db, "weddings"), where("isDemo", "==", true), limit(50))),
      createOwnerAdapter(ctx.user).then(a => a.list()).then(rows => ({ rows }), error => ({ rows: [], error })),
    ]);
    const items = [
      ...events.docs.map(d => ({ kind: "event", id: d.id, name: d.data().eventTitle || d.data().coupleName || "Demo event", type: d.data().eventCategory, expires: msOf(d.data().demoExpiresAt) })),
      ...bucketResult.rows.filter(b => b.demo).map(b => ({ kind: "bucket", id: b.id, name: b.name, type: "photo_bucket", expires: Number(b.expiresAt) || 0 })),
    ].sort((a, b) => a.expires - b.expires);
    status.textContent = (items.length ? `${items.length} active demo${items.length === 1 ? "" : "s"}` : "No demos right now.") + (bucketResult.error ? ` Demo photo buckets could not be listed (${bucketResult.error.message || "network error"}), so this list may be missing some.` : "");
    list.innerHTML = items.map(i => `<article class="demo-item"><div><strong>${esc(i.name)}</strong><span class="category-badge">${esc(DEMO_TYPES.find(t => t.value === i.type)?.label || i.type || "Event")}</span></div><span class="countdown" data-expires="${esc(i.expires)}">${esc(formatCountdown(i.expires))}</span><a class="secondary-button" href="${i.kind === "bucket" ? `./photo-bucket-manage.html?bucket=${encodeURIComponent(i.id)}` : `./dashboard.html?wedding=${encodeURIComponent(i.id)}`}">Open</a></article>`).join("");
  } catch (error) { status.textContent = `Demos could not load (${error?.code || "network error"}). Use Refresh to try again.`; list.innerHTML = ""; }
}

async function runCleanup() {
  const status = $("demoStatus"), button = $("demoCleanup"); button.disabled = true; status.textContent = "Removing expired demos…";
  try {
    const r = await adminPost(ctx.state.services.auth, "/api/demo-cleanup", {}, undefined, { what: "Removing expired demos" });
    const failed = (r.events?.failed?.length || 0) + (r.accounts?.failed?.length || 0);
    status.textContent = `Removed ${r.events?.deleted?.length || 0} expired event${(r.events?.deleted?.length || 0) === 1 ? "" : "s"} and ${r.accounts?.deleted?.length || 0} account${(r.accounts?.deleted?.length || 0) === 1 ? "" : "s"}.${failed || r.done === false ? " Some items did not finish. Run it again." : ""}`;
    void loadDemos();
  } catch (error) { status.textContent = `Cleanup failed: ${error.message}`; }
  finally { button.disabled = false; }
}

/* ------------------------------------------------------- Customer activity log */
export function openEventAudit(wedding, { db, title }) {
  const dialog = dialogShell("auditDialog", `<div class="workspace-modal"><header><div><p class="workspace-kicker">Admin only</p><h2>Customer activity: ${esc(title)}</h2></div><button class="icon-close" type="button" data-dialog-close aria-label="Close">×</button></header><div class="workspace-modal__body"><p class="admin-note">Newest first. This records what signed-in customers did on this event. Guest and invitation activity is not recorded. Entries are written by the customer's browser, so treat the list as a best-effort record.</p><p class="workspace-status" id="auditStatus" role="status">Loading activity…</p><ol class="audit-list" id="auditList">${skeleton.rows(4, "Loading activity…")}</ol><button class="secondary-button" id="auditMore" type="button" hidden>Load older activity</button></div><footer><button class="secondary-button" type="button" data-dialog-close>Close</button></footer></div>`);
  const status = dialog.querySelector("#auditStatus"), list = dialog.querySelector("#auditList"), more = dialog.querySelector("#auditMore");
  let cursor = null, count = 0;
  const load = async () => {
    more.disabled = true;
    if (!cursor) list.innerHTML = skeleton.rows(4, "Loading activity…");
    try {
      const parts = [collection(db, "weddings", wedding.id, "customerAudit"), orderBy("createdAt", "desc"), ...(cursor ? [startAfter(cursor)] : []), limit(25)];
      const snapshot = await getDocs(query(...parts));
      if (count === 0) list.innerHTML = "";
      count += snapshot.docs.length; cursor = snapshot.docs.at(-1) || cursor;
      list.insertAdjacentHTML("beforeend", snapshot.docs.map(d => { const e = d.data(); return `<li><time>${esc(timeText(e.createdAt))}</time><strong>${esc(e.actorEmail || "Unknown customer")}</strong> <span class="audit-action">${esc(e.action)}</span> ${esc(e.targetType)}${e.targetId ? ` <code>${esc(e.targetId)}</code>` : ""}${e.summary ? `<p>${esc(e.summary)}</p>` : ""}</li>`; }).join(""));
      more.hidden = snapshot.docs.length < 25;
      status.textContent = count ? `${count} entr${count === 1 ? "y" : "ies"} loaded` : "No customer activity has been recorded for this event.";
    } catch (error) { if (!cursor) list.innerHTML = ""; status.textContent = `Activity could not load (${error?.code || "network error"}).`; more.hidden = false; more.textContent = "Try again"; }
    finally { more.disabled = false; }
  };
  more.addEventListener("click", load);
  void load();
}
