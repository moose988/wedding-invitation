import * as api from "./firebase-config.js";
import { isPlatformAdmin } from "./account-access.js";
import { getEventDisplayTitle } from "./event-utils.js";
import { loadAllAdminEvents, truncationNote } from "./admin-events.js";
import { skeleton } from "./skeleton.js";
import { runFromEvent } from "./action-feedback.js";
import { mountAdminHealth } from "./admin-health.js";
import { loadNotesMeta, mountNotes, openNoteComposer } from "./client-notes.js";
import { esc, timeText } from "./admin-api.js";
import { quoteHtml } from "./quote-print.js";
import { DEFAULT_TERMS, MAX_QUOTE_LINES, buildLineItems, computeTotals, filsToInput, formatAed, parseAedToFils, validateLines } from "./admin-money.js";

const $ = id => document.getElementById(id);
const PAGE = 25;
const state = { user: null, meta: new Map(), services: null, clients: [], cursor: null, more: false, events: [], current: null, quotes: [], editingQuote: null };
const errorText = error => error?.message || error?.code || "Please try again.";
const setError = (form, text) => { form.querySelector(".form-error").textContent = text; };

if (!api.isFirebaseConfigured()) $("loading").textContent = "Firebase is not configured.";
else {
  state.services = api.initFirebase();
  api.onAuthStateChanged(state.services.auth, async user => {
    if (!user) { location.replace("./dashboard-login.html?message=session-required"); return; }
    try {
      if (!await isPlatformAdmin(api, state.services.db, user.uid)) { location.replace("./customer-events.html"); return; }
      state.user = user; void mountAdminHealth(state.services.auth); $("userEmail").textContent = user.email || "Admin";
      $("loading").hidden = true; $("workspace").hidden = false;
      await Promise.all([loadClients(true), loadEvents()]);
    } catch (error) { $("loading").textContent = `Workspace could not load: ${errorText(error)}`; }
  });
}
$("signOut").onclick = async event => { await runFromEvent(event, async () => { await api.signOut(state.services.auth); location.replace("./dashboard-login.html?message=signed-out"); }, { what: "Signing out", busyLabel: "Signing out…" }); };
document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => button.closest("dialog").close()));

/* ------------------------------------------------------------------ list */
async function loadClients(reset) {
  $("status").textContent = "Loading clients…"; $("retry").hidden = true; if (reset) $("clientList").innerHTML = skeleton.rows(4, "Loading clients…");
  try {
    const parts = [api.collection(state.services.db, "clients"), api.orderBy("name"), ...(!reset && state.cursor ? [api.startAfter(state.cursor)] : []), api.limit(PAGE)];
    const snapshot = await api.getDocs(api.query(...parts));
    const rows = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    state.clients = reset ? rows : [...state.clients, ...rows];
    state.cursor = snapshot.docs.at(-1) || state.cursor; state.more = snapshot.docs.length === PAGE;
    renderList(); void loadMeta(state.clients);
  } catch (error) { $("status").textContent = `Clients could not load: ${errorText(error)}`; $("retry").hidden = false; $("clientList").innerHTML = ""; }
}
async function loadEvents() {
  try {
    const { rows, truncated } = await loadAllAdminEvents(api, state.services.db);
    state.events = rows.filter(d => d.deleting !== true).map(d => ({ id: d.id, title: getEventDisplayTitle(d) }));
    state.eventsError = ""; state.eventsTruncated = truncated;
  } catch (error) { state.events = []; state.eventsError = errorText(error); }
}
const eventTitle = id => state.events.find(e => e.id === id)?.title || `Event ${id}`;

function renderList() {
  const term = $("search").value.trim().toLowerCase();
  const rows = state.clients.filter(c => `${c.name} ${c.phone || ""} ${c.email || ""}`.toLowerCase().includes(term));
  $("status").textContent = state.clients.length ? `${rows.length} client${rows.length === 1 ? "" : "s"} shown${state.more ? " · search covers loaded clients only" : ""}` : "";
  $("loadMore").hidden = !state.more;
  $("clientList").innerHTML = rows.length ? rows.map(c => `<article class="customer-card"><div class="customer-identity"><div class="customer-avatar" aria-hidden="true">${esc(c.name.slice(0, 1).toUpperCase())}</div><div class="customer-info"><h2>${esc(c.name)}</h2><p>${esc([c.phone, c.email].filter(Boolean).join(" · ") || "No contact details")}</p>${noteLine(c.id)}<div class="customer-tags"><span class="customer-tag">${esc(formatAed(c.priceFils))}</span><span class="customer-tag">${(c.linkedEventIds || []).length} linked event${(c.linkedEventIds || []).length === 1 ? "" : "s"}</span></div></div></div><div class="customer-actions"><button class="secondary-button" data-quick-note="${esc(c.id)}" type="button" aria-label="Add a note for ${esc(c.name)}">Add note</button><button class="secondary-button" data-open="${esc(c.id)}" type="button" aria-label="Open ${esc(c.name)}">Open</button></div></article>`).join("")
    : `<div class="customer-empty"><strong>${state.clients.length ? "No matching clients" : "No clients yet"}</strong><p>${state.clients.length ? "Try another name, phone or email." : "Add a client to track their events, price and quotations."}</p></div>`;
}
// Latest note and count per row, read four at a time after the list is drawn.
const noteLine = id => { const m = state.meta.get(id); return !m ? "" : m.error ? "" : `<p class="client-note-line">${m.count ? `<strong>${m.count} note${m.count === 1 ? "" : "s"}</strong> · ${esc(m.latest)}` : "No notes yet"}</p>`; };
async function loadMeta(rows) {
  const queue = rows.filter(c => !state.meta.has(c.id));
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let c; (c = queue.shift());) {
      try { state.meta.set(c.id, await loadNotesMeta(api, state.services.db, c.id)); } catch { state.meta.set(c.id, { error: true }); }
      renderList();
    }
  }));
}
$("search").oninput = renderList;
$("retry").onclick = () => loadClients(true);
$("loadMore").onclick = () => loadClients(false);
$("clientList").onclick = event => {
  const q = event.target.closest("[data-quick-note]");
  if (q) { const c = state.clients.find(x => x.id === q.dataset.quickNote); if (c) openNoteComposer({ api, db: state.services.db, user: state.user, clientId: c.id, clientName: c.name, onSaved: () => { state.meta.delete(c.id); void loadMeta([c]); } }); return; }
  const b = event.target.closest("[data-open]"); if (b) void openClient(b.dataset.open);
};
$("backToList").onclick = () => { $("detailView").hidden = true; $("listView").hidden = false; state.current = null; };

/* ---------------------------------------------------------------- client form */
function openClientForm(client) {
  const form = $("clientForm"); form.reset(); setError(form, "");
  form.dataset.id = client?.id || ""; $("clientFormTitle").textContent = client ? "Edit client" : "Add client";
  if (client) { form.elements.name.value = client.name; form.elements.phone.value = client.phone || ""; form.elements.email.value = client.email || ""; form.elements.notes.value = client.notes || ""; form.elements.price.value = client.priceFils ? filsToInput(client.priceFils) : ""; }
  $("clientDialog").showModal(); form.elements.name.focus();
}
$("addClient").onclick = () => openClientForm();
$("clientForm").onsubmit = async event => {
  event.preventDefault(); const form = event.currentTarget, f = form.elements;
  const name = f.name.value.trim(), email = f.email.value.trim();
  const priceText = f.price.value.trim(), priceFils = priceText === "" ? 0 : parseAedToFils(priceText);
  if (!name) return setError(form, "Enter the client's name."), f.name.focus();
  if (priceFils === null) return setError(form, "Enter the price as dirhams, for example 4500 or 4500.50."), f.price.focus();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError(form, "That email address does not look right."), f.email.focus();
  const id = form.dataset.id, existing = state.clients.find(c => c.id === id);
  const data = { name, phone: f.phone.value.trim(), email, notes: f.notes.value.trim(), linkedEventIds: existing?.linkedEventIds || [], priceFils, currency: "AED", updatedAt: api.serverTimestamp() };
  const submit = form.querySelector('[type="submit"]'); submit.disabled = true; setError(form, "");
  try {
    if (id) { await api.updateDoc(api.doc(state.services.db, "clients", id), data); }
    else { const ref = await api.addDoc(api.collection(state.services.db, "clients"), { ...data, createdAt: api.serverTimestamp() }); form.dataset.id = ref.id; }
    $("clientDialog").close();
    await loadClients(true);
    if (state.current && id) await openClient(id);
    $("status").textContent = "Client saved.";
  } catch (error) { setError(form, `Could not save: ${errorText(error)}`); }
  finally { submit.disabled = false; }
};

/* --------------------------------------------------------------------- detail */
async function openClient(id) {
  $("listView").hidden = true; $("detailView").hidden = false;
  $("detailBody").innerHTML = skeleton.lines(6, "Loading client…");
  let client = state.clients.find(c => c.id === id);
  try { client ||= { id, ...(await api.getDoc(api.doc(state.services.db, "clients", id))).data() }; }
  catch (error) { $("detailBody").innerHTML = `<div class="notes-empty" role="alert"><p>The client could not load: ${esc(errorText(error))}</p><button class="secondary-button" type="button" id="retryClient">Try again</button></div>`; $("retryClient").onclick = () => void openClient(id); return; }
  state.current = client;
  try {
    const snapshot = await api.getDocs(api.query(api.collection(state.services.db, "clients", id, "quotes"), api.orderBy("createdAt", "desc"), api.limit(50)));
    state.quotes = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderDetail();
  } catch (error) { $("detailBody").innerHTML = `<p class="workspace-status" role="alert">Quotations could not load: ${esc(errorText(error))}</p>`; }
}
function renderDetail() {
  const c = state.current, linked = c.linkedEventIds || [];
  const available = state.events.filter(e => !linked.includes(e.id));
  $("detailBody").innerHTML = `<section class="workspace-hero customer-hero"><div><h1>${esc(c.name)}</h1><p>${esc(formatAed(c.priceFils))} agreed price</p></div><div class="customer-actions"><button class="secondary-button" id="editClient" type="button">Edit client</button><button class="secondary-button delete-customer" id="deleteClient" type="button">Delete</button></div></section>
    <dl class="client-facts"><div><dt>Phone</dt><dd>${esc(c.phone || "Not set")}</dd></div><div><dt>Email</dt><dd>${esc(c.email || "Not set")}</dd></div><div class="wide"><dt>Notes</dt><dd class="pre">${esc(c.notes || "No notes")}</dd></div></dl>
    <section class="admin-card" aria-labelledby="linkedTitle"><h2 id="linkedTitle">Linked events</h2>
      ${linked.length ? `<ul class="chip-list">${linked.map(id => `<li><span>${esc(eventTitle(id))}</span><button type="button" class="text-button" data-unlink="${esc(id)}" aria-label="Unlink ${esc(eventTitle(id))}">Remove</button></li>`).join("")}</ul>` : `<p class="admin-note">No events linked yet.</p>`}
      ${state.eventsError ? `<p class="form-error" role="alert">The event list could not load (${esc(state.eventsError)}). Reload the page to try again.</p>` : ""}${state.eventsTruncated ? `<p class="admin-note">${esc(truncationNote(state.events.length))}</p>` : ""}
      <div class="inline-form"><label>Link an event<select id="linkSelect"><option value="">Choose an event</option>${available.map(e => `<option value="${esc(e.id)}">${esc(e.title)}</option>`).join("")}</select></label><button class="secondary-button" id="linkEvent" type="button" ${linked.length >= 20 ? "disabled" : ""}>Link</button></div>
      <p class="form-error" id="linkError" role="alert"></p></section>
    <div id="notesHost"></div>
    <section class="admin-card" aria-labelledby="quotesTitle"><div class="admin-panel__head"><h2 id="quotesTitle">Quotations</h2><button class="primary-button" id="newQuote" type="button">New quotation</button></div>
      ${state.quotes.length ? `<ul class="quote-list">${state.quotes.map(q => `<li><div><strong>${esc(q.number)}</strong><span class="category-badge">${esc(q.status)}</span><small>${esc(timeText(q.createdAt))}</small></div><strong>${esc(formatAed(q.totals?.totalFils))}</strong><div class="customer-actions"><button class="secondary-button" data-quote-edit="${esc(q.id)}" type="button">Edit</button><button class="secondary-button" data-quote-print="${esc(q.id)}" type="button">Print</button></div></li>`).join("")}</ul>` : `<p class="admin-note">No quotations yet. Create one to print or send to ${esc(c.name)}.</p>`}</section>`;
  mountNotes({ api, db: state.services.db, user: state.user, client: c, host: $("notesHost") });
  $("editClient").onclick = () => openClientForm(c);
  $("deleteClient").onclick = () => { $("deleteName").textContent = c.name; setError($("deleteForm"), ""); $("deleteDialog").showModal(); };
  $("newQuote").onclick = () => openQuote(null);
  $("linkEvent").onclick = () => saveLinks([...linked, $("linkSelect").value].filter(Boolean));
  $("detailBody").querySelectorAll("[data-unlink]").forEach(b => b.onclick = () => saveLinks(linked.filter(id => id !== b.dataset.unlink)));
  $("detailBody").querySelectorAll("[data-quote-edit]").forEach(b => b.onclick = () => openQuote(state.quotes.find(q => q.id === b.dataset.quoteEdit)));
  $("detailBody").querySelectorAll("[data-quote-print]").forEach(b => b.onclick = () => printQuote(quoteView(state.quotes.find(q => q.id === b.dataset.quotePrint))));
}
async function saveLinks(ids) {
  const error = $("linkError"); error.textContent = "";
  if (ids.length > 20) { error.textContent = "A client can have at most 20 linked events."; return; }
  try { await api.updateDoc(api.doc(state.services.db, "clients", state.current.id), { linkedEventIds: ids, updatedAt: api.serverTimestamp() }); state.current.linkedEventIds = ids; const row = state.clients.find(c => c.id === state.current.id); if (row) row.linkedEventIds = ids; renderDetail(); }
  catch (failure) { error.textContent = `Could not update links: ${errorText(failure)}`; }
}
async function deleteAll(collectionRef) {
  for (;;) {
    const snapshot = await api.getDocs(api.query(collectionRef, api.limit(400)));
    if (snapshot.empty) return;
    const batch = api.writeBatch(state.services.db);
    snapshot.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}
$("deleteForm").onsubmit = async event => {
  event.preventDefault(); const form = event.currentTarget, button = form.querySelector('[type="submit"]'); button.disabled = true; setError(form, "");
  try {
    const id = state.current.id;
    // Firestore does not cascade: remove the notes and quotations first, in batches, then the client.
    for (const sub of ["notes", "quotes"]) await deleteAll(api.collection(state.services.db, "clients", id, sub));
    await api.deleteDoc(api.doc(state.services.db, "clients", id));
    $("deleteDialog").close(); $("backToList").click(); await loadClients(true); $("status").textContent = "Client deleted.";
  } catch (error) { setError(form, `Could not delete: ${errorText(error)} You can try again.`); }
  finally { button.disabled = false; }
};

/* ------------------------------------------------------------- quotation builder */
let lines = [];
const newLine = () => ({ description: "", quantity: "1", unitPrice: "" });
function openQuote(quote) {
  const form = $("quoteForm"); form.reset(); setError(form, ""); $("linesError").textContent = "";
  state.editingQuote = quote || null;
  $("quoteTitle").textContent = quote ? `Edit ${quote.number}` : "New quotation";
  lines = quote ? quote.lineItems.map(l => ({ description: l.description, quantity: String(l.quantity), unitPrice: filsToInput(l.unitPriceFils) })) : [newLine()];
  form.elements.terms.value = quote ? (quote.terms ?? "") : DEFAULT_TERMS;
  form.elements.status.value = quote?.status || "draft";
  form.elements.discount.value = quote?.totals?.discountFils ? filsToInput(quote.totals.discountFils) : "";
  form.elements.vat.checked = Boolean(quote?.totals?.vatFils);
  form.elements.validUntil.value = quote?.validUntil?.toDate ? quote.validUntil.toDate().toISOString().slice(0, 10) : (quote ? "" : new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  drawLines(); recalc(); $("quoteDialog").showModal();
}
function drawLines() {
  $("lineRows").innerHTML = lines.map((l, i) => `<div class="quote-line" data-line="${i}"><label>Item ${i + 1}<input data-f="description" value="${esc(l.description)}" maxlength="500" aria-describedby="lerr${i}" /></label><label>Qty<input data-f="quantity" inputmode="numeric" value="${esc(l.quantity)}" /></label><label>Unit price (AED)<input data-f="unitPrice" inputmode="decimal" value="${esc(l.unitPrice)}" placeholder="0.00" /></label><output class="line-total" aria-label="Line ${i + 1} total"></output><button class="text-button" type="button" data-remove="${i}" aria-label="Remove item ${i + 1}" ${lines.length === 1 ? "disabled" : ""}>Remove</button><p class="line-error" id="lerr${i}" role="alert"></p></div>`).join("");
  $("lineCount").textContent = `(${lines.length} of ${MAX_QUOTE_LINES})`;
  $("addLine").disabled = lines.length >= MAX_QUOTE_LINES;
}
// Parses what is typed into line items in fils. Anything unparseable becomes NaN so validateLines reports it.
function parsedLines() {
  return lines.map(l => ({ description: l.description, quantity: /^\d{1,5}$/.test(l.quantity.trim()) ? Number(l.quantity.trim()) : NaN, unitPriceFils: l.unitPrice.trim() === "" ? NaN : (parseAedToFils(l.unitPrice) ?? NaN) }));
}
function discountFils() { const t = $("quoteForm").elements.discount.value.trim(); return t === "" ? 0 : parseAedToFils(t); }
function recalc(showErrors) {
  const parsed = parsedLines(), result = validateLines(parsed), good = parsed.filter((_, i) => !result.errors.some(e => e.index === i));
  const rowErrors = {}; result.errors.forEach(e => { if (e.index >= 0) (rowErrors[e.index] ||= []).push(e.message); });
  document.querySelectorAll("#lineRows .quote-line").forEach((row, i) => {
    row.querySelector(".line-error").textContent = showErrors ? (rowErrors[i] || []).join(" ") : "";
    row.classList.toggle("has-error", Boolean(showErrors && rowErrors[i]));
    row.querySelector(".line-total").textContent = rowErrors[i] ? "" : formatAed(parsed[i].quantity * parsed[i].unitPriceFils);
  });
  const d = discountFils(), vat = $("quoteForm").elements.vat.checked, totals = computeTotals(good, { discountFils: d ?? 0, vat });
  $("tSubtotal").textContent = formatAed(totals.subtotalFils); $("tDiscount").textContent = `- ${formatAed(totals.discountFils)}`; $("tVat").textContent = formatAed(totals.vatFils); $("tTotal").textContent = formatAed(totals.totalFils);
  $("tDiscountRow").hidden = totals.discountFils === 0; $("tVatRow").hidden = !vat;
  return { parsed, result, totals, discount: d };
}
$("lineRows").addEventListener("input", event => { const row = event.target.closest("[data-line]"); if (!row || !event.target.dataset.f) return; lines[Number(row.dataset.line)][event.target.dataset.f] = event.target.value; recalc(); });
$("lineRows").addEventListener("click", event => { const b = event.target.closest("[data-remove]"); if (!b || lines.length < 2) return; const i = Number(b.dataset.remove); lines.splice(i, 1); drawLines(); recalc(); $("lineRows").querySelector(`[data-line="${Math.min(i, lines.length - 1)}"] input`)?.focus(); });
$("addLine").onclick = () => { if (lines.length >= MAX_QUOTE_LINES) return; lines.push(newLine()); drawLines(); recalc(); $("lineRows").lastElementChild.querySelector("input").focus(); };
$("quoteForm").elements.discount.addEventListener("input", () => recalc());
$("quoteForm").elements.vat.addEventListener("change", () => recalc());

// Validates everything and returns the data to save, or null after showing errors.
function collectQuote() {
  const form = $("quoteForm"), f = form.elements, { parsed, result, totals, discount } = recalc(true);
  $("linesError").textContent = result.errors.find(e => e.index < 0)?.message || "";
  if (!result.ok) { setError(form, `Fix ${new Set(result.errors.filter(e => e.index >= 0).map(e => e.index)).size || "the"} highlighted line(s) first.`); document.querySelector(".quote-line.has-error input")?.focus(); return null; }
  if (discount === null) { setError(form, "Enter the discount as dirhams, for example 100 or 100.50."); f.discount.focus(); return null; }
  if (discount > totals.subtotalFils) { setError(form, "The discount cannot be more than the subtotal."); f.discount.focus(); return null; }
  if (f.terms.value.length > 10000) { setError(form, "The terms are too long (10,000 characters at most)."); return null; }
  setError(form, "");
  return { lineItems: buildLineItems(parsed), totals, terms: f.terms.value, status: f.status.value, validUntil: f.validUntil.value };
}
function quoteView(q, client = state.current) {
  return { number: q.number, client, lineItems: q.lineItems, totals: q.totals, terms: q.terms || "", validUntil: q.validUntil?.toDate ? q.validUntil.toDate() : (q.validUntilDate ? new Date(`${q.validUntilDate}T00:00:00`) : null), date: q.createdAt?.toDate ? q.createdAt.toDate() : new Date() };
}
$("quotePrint").onclick = () => {
  const data = collectQuote(); if (!data) return;
  printQuote({ number: state.editingQuote?.number || "DRAFT", client: state.current, lineItems: data.lineItems, totals: data.totals, terms: data.terms, validUntil: data.validUntil ? new Date(`${data.validUntil}T00:00:00`) : null, date: new Date() });
};
$("quoteForm").onsubmit = async event => {
  event.preventDefault(); const data = collectQuote(); if (!data) return;
  const form = event.currentTarget, button = form.querySelector('[type="submit"]'); button.disabled = true;
  const quotes = api.collection(state.services.db, "clients", state.current.id, "quotes");
  const body = { lineItems: data.lineItems, totals: data.totals, status: data.status, currency: "AED", terms: data.terms, validUntil: data.validUntil ? api.Timestamp.fromDate(new Date(`${data.validUntil}T12:00:00`)) : null, updatedAt: api.serverTimestamp() };
  try {
    if (state.editingQuote) await api.updateDoc(api.doc(quotes, state.editingQuote.id), { ...body, number: state.editingQuote.number });
    else await api.addDoc(quotes, { ...body, number: `QD-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`, createdAt: api.serverTimestamp() });
    $("quoteDialog").close(); await openClient(state.current.id);
  } catch (error) { setError(form, `Could not save: ${errorText(error)}`); }
  finally { button.disabled = false; }
};

/* ----------------------------------------------------------------------- print */
function printQuote(view) { $("printSheet").innerHTML = quoteHtml(view); window.print(); }
