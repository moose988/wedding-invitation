import { collection, doc, getDoc, getDocs, initFirebase, isFirebaseConfigured, onAuthStateChanged, serverTimestamp, setDoc, signOut, updateDoc, writeBatch, httpsCallable } from "./firebase-config.js?v=20261016-tab-session-isolation-1";
import { EVENT_CATEGORIES, getEventCategory, getEventDisplayTitle, isCelebrationEvent } from "./event-utils.js";
import { paginateRows } from "./workspace-pagination.js";

const state = { services: null, user: null, weddings: [], filter: "all", currentPage: 1, pageSize: 6, editId: "", deleteId: "", workspaceTimer: null, unsubscribeAuth: null, initialized: false, snapshotGeneration: 0, workspaceRequest: 0 };
const el = Object.fromEntries(["workspace","loadingState","userEmail","signOutButton","createWeddingButton","sampleInvitationPanel","workspaceControls","sampleInvitationUrl","searchInput","sortSelect","filterRow","workspaceStatus","weddingGrid","paginationControls","paginationStatus","emptyState","weddingDialog","weddingForm","formKicker","formTitle","formError","saveWeddingButton","categoryStep","eventFeaturesStep","eventInformationStep","continueEventButton","continueFeaturesButton","backEventButton","deleteDialog","deleteForm","deletePhrase","deleteConfirmation","deleteError"].map((id) => [id, document.getElementById(id)]));

init();
function init() {
  if (state.initialized) return;
  state.initialized = true;
  if (!isFirebaseConfigured()) return showFatal("Firebase is not configured. Add your Firebase configuration before opening the workspace.");
  state.services = initFirebase();
  el.signOutButton.addEventListener("click", async () => { await signOut(state.services.auth); location.replace("./dashboard-login.html?message=signed-out"); });
  el.createWeddingButton.addEventListener("click", () => openForm());
  el.sampleInvitationUrl.value = sampleInvitationUrl();
  el.sampleInvitationPanel.addEventListener("click", handleSamplePanelAction);
  document.querySelectorAll("[data-create-wedding]").forEach((button) => button.addEventListener("click", () => openForm()));
  el.searchInput.addEventListener("input", () => { state.currentPage = 1; render(); }); el.sortSelect.addEventListener("change", () => { state.currentPage = 1; render(); });
  el.filterRow.addEventListener("click", (event) => { const button = event.target.closest("[data-filter]"); if (!button) return; state.filter = button.dataset.filter; state.currentPage = 1; document.querySelectorAll("[data-filter]").forEach((item) => item.classList.toggle("is-active", item === button)); render(); });
  el.paginationControls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-page-direction]");
    if (!button || button.disabled) return;
    state.currentPage += button.dataset.pageDirection === "next" ? 1 : -1;
    render();
    el.paginationControls.querySelector(`[data-page-direction="${button.dataset.pageDirection}"]`)?.focus();
  });
  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.close).close()));
  el.weddingForm.addEventListener("submit", saveWedding); el.deleteForm.addEventListener("submit", deleteWedding);
  el.weddingForm.querySelectorAll('[name="eventCategory"]').forEach((input) => input.addEventListener("change", updateCategoryFields));
  el.continueEventButton.addEventListener("click", continueToEventInformation);
  el.continueFeaturesButton.addEventListener("click", continueToEventInformation);
  el.backEventButton.addEventListener("click", backEventStep);
  el.weddingGrid.addEventListener("click", handleCardAction);
  document.addEventListener("click", (event) => { if (!event.target.closest(".menu-wrap")) closeActionMenus(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeActionMenus(); });
  state.unsubscribeAuth?.();
  state.unsubscribeAuth = onAuthStateChanged(state.services.auth, (user) => {
    if (state.user?.uid !== user?.uid) {
      state.weddings = [];
      state.currentPage = 1;
      state.workspaceRequest += 1;
      if (user) render();
    }
    if (!user) return location.replace("./dashboard-login.html?message=session-required");
    state.user = user;
    el.userEmail.textContent = user.email || "Planner";
    el.loadingState.hidden = true;
    el.workspace.hidden = false;
    watchWorkspace();
  });
  window.addEventListener("pagehide", disposeListeners, { once: true });
}

function showFatal(message) { el.loadingState.textContent = message; }
function watchWorkspace() {
  state.workspaceTimer && clearInterval(state.workspaceTimer);
  const generation = ++state.snapshotGeneration;
  const refresh = () => void refreshWorkspaceEvents(generation);
  refresh();
  state.workspaceTimer = setInterval(refresh, 15000);
}

async function refreshWorkspaceEvents(generation = state.snapshotGeneration) {
  const request = ++state.workspaceRequest;
  try {
    const result = await httpsCallable(state.services.functions, "getAccessibleWorkspaceEvents")({});
    if (generation !== state.snapshotGeneration || request !== state.workspaceRequest || !state.user) return;
    state.weddings = replaceRowsById(result.data?.events || []);
    const onlySeating = state.weddings.length > 0 && state.weddings.every((wedding) => wedding.seatingOnly === true);
    el.createWeddingButton.hidden = onlySeating;
    el.sampleInvitationPanel.hidden = onlySeating;
    el.workspaceControls.hidden = false;
    el.filterRow.hidden = false;
    await enrichStats();
    render();
  } catch (error) {
    if (generation !== state.snapshotGeneration || request !== state.workspaceRequest) return;
    console.error("Accessible event list could not be loaded.", error?.code || "unavailable");
    state.weddings = [];
    render();
    el.workspaceStatus.textContent = "We could not load your accessible events. Please refresh and try again.";
  }
}

function replaceRowsById(rows) {
  const byId = new Map();
  rows.forEach((row) => {
    const id = String(row?.id || "").trim();
    if (id) byId.set(id, { ...row, id });
  });
  return [...byId.values()];
}

function disposeListeners() {
  state.snapshotGeneration += 1;
  state.workspaceRequest += 1;
  if (state.workspaceTimer) clearInterval(state.workspaceTimer);
  state.unsubscribeAuth?.();
  state.workspaceTimer = null;
  state.unsubscribeAuth = null;
}

async function enrichStats() {
  await Promise.all(state.weddings.map(async (wedding) => {
    if (wedding.seatingOnly === true) {
      wedding.stats = null;
      return;
    }
    try {
      const guests = await getDocs(collection(state.services.db, "weddings", wedding.id, "guests"));
      const rows = guests.docs.map((row) => row.data());
      wedding.stats = { total: rows.length, confirmed: rows.filter((g) => g.rsvpStatus === "confirmed").length, pending: rows.filter((g) => !["confirmed", "declined"].includes(g.rsvpStatus)).length, declined: rows.filter((g) => g.rsvpStatus === "declined").length, checkedIn: rows.filter((g) => g.checkedIn).length };
    } catch (_) { wedding.stats = wedding.stats || { total: 0, confirmed: 0, pending: 0, declined: 0, checkedIn: 0 }; }
  }));
}

function render() {
  closeActionMenus();
  const term = el.searchInput.value.trim().toLowerCase();
  let rows = state.weddings.filter((w) => {
    const oldEvent = isOldEvent(w);
    const matchesFilter = state.filter === "all"
      ? w.status !== "archived"
      : state.filter === "old"
        ? oldEvent && w.status !== "archived"
        : w.status === state.filter;
    return matchesFilter && `${w.eventTitle || ""} ${w.coupleName || ""} ${w.brideName || ""} ${w.groomName || ""} ${w.venueEn || ""} ${w.location || ""}`.toLowerCase().includes(term);
  });
  const sortKey = el.sortSelect.value === "event" ? "eventDateISO" : el.sortSelect.value === "updated" ? "updatedAt" : "createdAt";
  rows.sort((a,b) => timestampValue(b[sortKey]) - timestampValue(a[sortKey]));
  const page = paginateRows(rows, state.currentPage, state.pageSize);
  state.currentPage = page.page;
  el.workspaceStatus.textContent = rows.length > state.pageSize
    ? `Showing ${page.start + 1}–${Math.min(page.start + state.pageSize, rows.length)} of ${rows.length} events`
    : state.weddings.length ? `${rows.length} event${rows.length === 1 ? "" : "s"} shown` : "";
  el.emptyState.hidden = Boolean(state.weddings.length || term || state.filter !== "all");
  el.weddingGrid.innerHTML = page.items.map(card).join("");
  el.paginationControls.hidden = page.pageCount <= 1;
  el.paginationStatus.textContent = `Page ${state.currentPage} of ${page.pageCount}`;
  el.paginationControls.querySelector('[data-page-direction="previous"]').disabled = state.currentPage <= 1;
  el.paginationControls.querySelector('[data-page-direction="next"]').disabled = state.currentPage >= page.pageCount;
}

function isOldEvent(wedding) {
  if (wedding.status === "completed") return true;
  const eventTime = timestampValue(wedding.eventDateISO);
  return Number.isFinite(eventTime) && eventTime < Date.now();
}

function card(w) {
  const stats = w.stats || {}; const active = ["active", "completed"].includes(w.status); const isOwner = w.isOwner === true && w.seatingOnly !== true;
  const eventId = escape(w.id);
  const eventStatus = ["draft", "active", "completed", "archived"].includes(w.status) ? w.status : "draft";
  const ownerActions = isOwner ? `<button data-action="edit" data-id="${eventId}" type="button">Edit details</button><button data-action="duplicate" data-id="${eventId}" type="button">Duplicate setup</button><button data-action="archive" data-id="${eventId}" type="button">${w.status === "archived" ? "Restore event" : "Archive event"}</button><button class="menu-delete" data-action="delete" data-id="${eventId}" type="button">Delete event</button>` : `<p class="action-menu__notice">Only the event owner can manage this event.</p>`;
  const title = getEventDisplayTitle(w);
  const category = isCelebrationEvent(w) ? "Celebration" : "Wedding / Engagement";
  const cardMenu = isOwner ? `<div class="menu-wrap"><button class="card-menu-toggle" data-action="menu" data-id="${eventId}" type="button" aria-label="More actions for ${escape(title)}" aria-expanded="false" aria-controls="menu-${eventId}">⋯</button><div class="action-menu" id="menu-${eventId}" hidden>${ownerActions}</div></div>` : "";
  const statsMarkup = w.seatingOnly === true
    ? `<span class="stat">Seating access · ${escape(w.allowedSide || "restricted")}</span>`
    : `<span class="stat"><strong>${stats.total || 0}</strong> guests</span><span class="stat"><strong>${stats.confirmed || 0}</strong> confirmed</span><span class="stat"><strong>${stats.pending || 0}</strong> pending</span><span class="stat"><strong>${stats.declined || 0}</strong> declined</span>${active ? `<span class="stat"><strong>${stats.checkedIn || 0}/${stats.total || 0}</strong> checked in</span>` : ""}`;
  const openLabel = w.seatingOnly === true ? "Open seating" : "Open dashboard";
  const copyAction = w.seatingOnly === true ? "" : `<button data-action="copy" data-id="${eventId}" type="button" title="Copy guest invitation link template">Copy guest link</button>`;
  return `<article class="wedding-card"><div class="card-head"><div><p class="workspace-kicker">${escape(w.venueEn || "Venue not set")}</p><h2>${escape(title)}</h2><span class="category-badge">${category}</span></div><div class="card-head__actions"><span class="status-badge status-badge--${eventStatus}">${escape(eventStatus)}</span>${cardMenu}</div></div><div class="card-meta">${formatEvent(w.eventDateISO)}${w.location ? ` · ${escape(w.location)}` : ""}</div><div class="card-stats">${statsMarkup}</div><div class="card-footer"><span>Updated ${formatRelative(w.updatedAt || w.createdAt)}</span></div><div class="card-actions"><button class="open-button" data-action="open" data-id="${eventId}" type="button">${openLabel}</button>${copyAction}</div></article>`;
}

function sampleInvitationUrl() {
  return new URL("./index.html?wedding=luxury-wedding-demo&sample=1", window.location.href).href;
}

async function handleCardAction(event) {
  const button = event.target.closest("[data-action]"); if (!button) return; const wedding = state.weddings.find((w) => w.id === button.dataset.id); if (!wedding) return;
  if (button.dataset.action === "menu") { const menu = document.getElementById(`menu-${wedding.id}`); const shouldOpen = menu.hidden; closeActionMenus(menu); menu.hidden = !shouldOpen; button.setAttribute("aria-expanded", String(shouldOpen)); return; }
  if (button.dataset.action === "open") {
    if (wedding.seatingOnly === true) {
      location.href = `./side.html?wedding=${encodeURIComponent(wedding.id)}`;
      return;
    }
    localStorage.setItem("da3wa:lastDashboardWeddingId", wedding.id);
    location.href = `./dashboard.html?wedding=${encodeURIComponent(wedding.id)}`;
  }
  if (button.dataset.action === "copy") { await navigator.clipboard.writeText(new URL(`index.html?wedding=${encodeURIComponent(wedding.id)}#guest={guestToken}`, location.href)); flash("Guest invitation base link copied."); }
  if (button.dataset.action === "edit") {
    const current = await loadFullWedding(wedding.id);
    if (current) openForm(current);
  }
  if (button.dataset.action === "archive") await setArchived(wedding);
  if (button.dataset.action === "duplicate") {
    const current = await loadFullWedding(wedding.id);
    if (current) await duplicate(current);
  }
  if (button.dataset.action === "delete") openDelete(wedding);
}

async function loadFullWedding(weddingId) {
  try {
    const snapshot = await getDoc(doc(state.services.db, "weddings", weddingId));
    return snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } : null;
  } catch (error) {
    console.error("Event details could not be loaded.", error?.code || "unavailable");
    flash("You no longer have access to this event.");
    return null;
  }
}

async function handleSamplePanelAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  if (button.dataset.action === "preview-sample") {
    window.open(sampleInvitationUrl(), "_blank", "noopener,noreferrer");
    return;
  }
  if (button.dataset.action === "copy-sample") await copySampleInvitationLink(button);
}

async function copySampleInvitationLink(button) {
  const input = el.sampleInvitationUrl;
  const feedback = el.sampleInvitationPanel.querySelector("[data-sample-feedback]");
  if (!input || !feedback) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(input.value);
    } else {
      input.focus();
      input.select();
      if (!document.execCommand("copy")) throw new Error("Clipboard is unavailable.");
      input.setSelectionRange(0, 0);
    }
    feedback.textContent = "Sample invitation link copied.";
    feedback.dataset.state = "success";
  } catch (error) {
    console.warn("Sample invitation link could not be copied.", error);
    feedback.textContent = "Copy failed. Select and copy the URL above.";
    feedback.dataset.state = "error";
    input.focus();
    input.select();
  }
}

function closeActionMenus(except = null) {
  document.querySelectorAll(".action-menu").forEach((menu) => {
    if (menu === except) return;
    menu.hidden = true;
    document.querySelector(`[aria-controls="${menu.id}"]`)?.setAttribute("aria-expanded", "false");
  });
}

function getSelectedEventCategory() { return el.weddingForm.querySelector('[name="eventCategory"]:checked')?.value || ""; }
function openForm(wedding) { state.editId = wedding?.id || ""; el.weddingForm.reset(); el.formError.textContent = ""; el.formKicker.textContent = wedding ? "Event details" : "New event"; el.formTitle.textContent = wedding ? "Edit event" : "Create an event"; el.saveWeddingButton.textContent = wedding ? "Save changes" : "Create event"; el.categoryStep.hidden = false; el.eventFeaturesStep.hidden = true; el.eventInformationStep.hidden = true; el.backEventButton.hidden = true; el.saveWeddingButton.hidden = true; const f = el.weddingForm.elements; if (wedding) { el.weddingForm.querySelectorAll('[name="eventCategory"]').forEach((input) => { input.checked = input.value === getEventCategory(wedding); }); ["brideName","groomName","eventTitle","venueEn","location","mapsUrl","whatsAppCountryCode","invitationLanguage","status","plannerNotes"].forEach((key) => f[key].value = wedding[key] || ""); const date = new Date(wedding.eventDateISO); if (!Number.isNaN(+date)) { f.eventDate.value = date.toISOString().slice(0,10); f.eventTime.value = date.toTimeString().slice(0,5); } } updateCategoryFields(); el.weddingDialog.showModal(); }
function updateCategoryFields() { const category = getSelectedEventCategory(); el.continueEventButton.disabled = !category; const wedding = category !== EVENT_CATEGORIES.CELEBRATION; el.weddingForm.querySelectorAll(".wedding-identity").forEach((label) => { label.hidden = !wedding; label.querySelector("input").disabled = !wedding; label.querySelector("input").required = wedding; }); const celebration = el.weddingForm.querySelector(".celebration-identity"); celebration.hidden = wedding; celebration.querySelector("input").disabled = wedding; celebration.querySelector("input").required = !wedding && Boolean(category); }
function continueToEventInformation() { if (!getSelectedEventCategory()) return; if (!state.editId && !el.eventFeaturesStep.hidden) { el.eventFeaturesStep.hidden = true; el.eventInformationStep.hidden = false; el.saveWeddingButton.hidden = false; return; } el.categoryStep.hidden = true; if (state.editId) { el.eventInformationStep.hidden = false; el.saveWeddingButton.hidden = false; } else { el.eventFeaturesStep.hidden = false; } el.backEventButton.hidden = false; }
function backEventStep() { if (!state.editId && !el.eventInformationStep.hidden) { el.eventInformationStep.hidden = true; el.eventFeaturesStep.hidden = false; el.saveWeddingButton.hidden = true; return; } if (!state.editId && !el.eventFeaturesStep.hidden) { el.eventFeaturesStep.hidden = true; } el.eventInformationStep.hidden = true; el.categoryStep.hidden = false; el.backEventButton.hidden = true; el.saveWeddingButton.hidden = true; }
async function saveWedding(event) { event.preventDefault(); const f = el.weddingForm.elements; const category = getSelectedEventCategory(); if (![EVENT_CATEGORIES.WEDDING_ENGAGEMENT, EVENT_CATEGORIES.CELEBRATION].includes(category)) return; const oldEvent = state.weddings.find((item) => item.id === state.editId); if (oldEvent && getEventCategory(oldEvent) !== category && !window.confirm("Changing this event category changes the dashboard experience. Existing guest side values will be preserved. Continue?")) return; const brideName = f.brideName.value.trim(), groomName = f.groomName.value.trim(); const eventDateISO = new Date(`${f.eventDate.value}T${f.eventTime.value}`).toISOString(); const data = { eventCategory: category, eventDateISO, venueEn: f.venueEn.value.trim(), location: f.location.value.trim(), mapsUrl: f.mapsUrl.value.trim(), whatsAppCountryCode: f.whatsAppCountryCode.value.trim(), invitationLanguage: f.invitationLanguage.value, plannerNotes: f.plannerNotes.value.trim(), status: f.status.value, updatedAt: serverTimestamp() }; if (category === EVENT_CATEGORIES.CELEBRATION) data.eventTitle = f.eventTitle.value.trim(); else Object.assign(data, { brideName, groomName, coupleName: `${brideName} & ${groomName}`, eventTitle: `${brideName} & ${groomName}` }); el.formError.textContent = ""; el.saveWeddingButton.disabled = true;
  try { if (state.editId) { await updateDoc(doc(state.services.db,"weddings",state.editId), data); await setDoc(doc(state.services.db,"users",state.user.uid,"weddingAccess",state.editId), { ...indexData(data), weddingId: state.editId }, { merge:true }); } else { const weddingRef = doc(collection(state.services.db,"weddings")); const batch = writeBatch(state.services.db); batch.set(weddingRef, { ...data, seatingEnabled:f.seatingEnabled.checked, showInvitationQr:f.showInvitationQr.checked, ownerUserId:state.user.uid, createdAt:serverTimestamp() }); batch.set(doc(state.services.db,"weddings",weddingRef.id,"dashboardUsers",state.user.uid), { userId:state.user.uid, email:state.user.email || "", canViewDashboard:true, canEditGuests:true, canEditSeating:true, canCheckIn:true, canManageUsers:true, role:"owner", createdAt:serverTimestamp(), updatedAt:serverTimestamp() }); batch.set(doc(state.services.db,"users",state.user.uid,"weddingAccess",weddingRef.id), { ...indexData(data), weddingId:weddingRef.id, ownerUserId:state.user.uid, createdAt:serverTimestamp(), updatedAt:serverTimestamp() }); await batch.commit(); } el.weddingDialog.close(); void refreshWorkspaceEvents(); } catch (error) { console.error(error); el.formError.textContent = "We could not save this event. Please check your access and try again."; } finally { el.saveWeddingButton.disabled=false; } }
function indexData(data) { return Object.fromEntries(Object.entries({ eventCategory:data.eventCategory, eventTitle:data.eventTitle, coupleName:data.coupleName, brideName:data.brideName, groomName:data.groomName, eventDateISO:data.eventDateISO, venueEn:data.venueEn, location:data.location, status:data.status, updatedAt:data.updatedAt }).filter(([, value]) => value !== undefined)); }
async function setArchived(wedding) { const status = wedding.status === "archived" ? "draft" : "archived"; try { await updateDoc(doc(state.services.db,"weddings",wedding.id), { status, updatedAt:serverTimestamp() }); await setDoc(doc(state.services.db,"users",state.user.uid,"weddingAccess",wedding.id), { status, updatedAt:serverTimestamp() }, {merge:true}); void refreshWorkspaceEvents(); } catch (_) { flash("We could not update this event. Please try again."); } }
async function duplicate(wedding) { const { id, stats, legacy, isOwner, seatingOnly, allowedSide, createdAt, updatedAt, completedAt, statusBeforeCompletion, ...source } = wedding; const title = `${getEventDisplayTitle(wedding)} (Copy)`; const copy = { ...source, seatingEnabled:wedding.seatingEnabled !== false, eventTitle:title, status:"draft", ownerUserId:state.user.uid, createdAt:serverTimestamp(), updatedAt:serverTimestamp() }; if (!isCelebrationEvent(wedding)) copy.coupleName = title; try { const ref = doc(collection(state.services.db,"weddings")); const batch = writeBatch(state.services.db); batch.set(ref, copy); batch.set(doc(state.services.db,"weddings",ref.id,"dashboardUsers",state.user.uid), { userId:state.user.uid, email:state.user.email || "", canViewDashboard:true, canEditGuests:true, canEditSeating:true, canCheckIn:true, canManageUsers:true, role:"owner", createdAt:serverTimestamp(), updatedAt:serverTimestamp() }); batch.set(doc(state.services.db,"users",state.user.uid,"weddingAccess",ref.id), { ...indexData(copy), weddingId:ref.id, ownerUserId:state.user.uid, createdAt:serverTimestamp(), updatedAt:serverTimestamp() }); await batch.commit(); flash("Event setup duplicated as a draft."); void refreshWorkspaceEvents(); } catch (e) { console.error(e); flash("We could not duplicate this event."); } }
function openDelete(wedding) { state.deleteId=wedding.id; el.deletePhrase.textContent=`DELETE ${wedding.id}`; el.deleteConfirmation.value=""; el.deleteError.textContent=""; el.deleteDialog.showModal(); }
async function deleteWedding(event) { event.preventDefault(); const phrase=`DELETE ${state.deleteId}`; if (el.deleteConfirmation.value !== phrase) { el.deleteError.textContent=`Type “${phrase}” exactly to delete.`; return; } try { await httpsCallable(state.services.functions,"deleteWedding")({ weddingId:state.deleteId, confirmation:phrase }); el.deleteDialog.close(); void refreshWorkspaceEvents(); } catch (error) { console.error(error); el.deleteError.textContent="We could not delete this event. Only its owner can do this."; } }
function timestampValue(value) { return value?.toMillis?.() || value?.seconds * 1000 || (value ? new Date(value).getTime() : 0); } function formatEvent(value) { const date=new Date(value); return Number.isNaN(+date) ? "Event date to be set" : new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(date); } function formatRelative(value) { const ms=Date.now()-timestampValue(value); if (!ms) return "just now"; const days=Math.floor(ms/86400000); return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`; } function escape(value) { const node=document.createElement("span"); node.textContent=value; return node.innerHTML; } function flash(message) { el.workspaceStatus.textContent=message; }
