import { collection, deleteDoc, doc, getDoc, getDocs, initFirebase, isFirebaseConfigured, limit, onAuthStateChanged, query, serverTimestamp, setDoc, signOut, updateDoc, writeBatch } from "./firebase-config.js";
import * as accountApi from "./firebase-config.js";
import { isPlatformAdmin, redeemCustomerGrants } from "./account-access.js";
import { EVENT_CATEGORIES, eventUsesGuestSides, getEventCategory, getEventDisplayTitle, isCelebrationEvent, isGenderRevealEvent } from "./event-utils.js";
import { eventDateTimeParts, localDateTimeToIso } from "./event-date-time.js";
import { paginateRows } from "./workspace-pagination.js";
import { ownerAdapter } from "./photo-bucket/adapter.js";
import { renderLocalBuckets } from "./photo-bucket/workspace.js";

const state = { services: null, user: null, weddings: [], workspaceLoaded: false, canSeeSampleInvitation: false, isAdmin: false, roleResolved: false, filter: "all", currentPage: 1, pageSize: 6, editId: "", deleteId: "", workspaceTimer: null, unsubscribeAuth: null, initialized: false, snapshotGeneration: 0, workspaceRequest: 0 };
const el = Object.fromEntries(["workspace","loadingState","userEmail","signOutButton","createWeddingButton","sampleInvitationPanel","workspaceControls","sampleInvitationUrl","searchInput","sortSelect","filterRow","workspaceStatus","retryLoadButton","weddingGrid","paginationControls","paginationStatus","emptyState","weddingDialog","weddingForm","formKicker","formTitle","formError","saveWeddingButton","categoryStep","eventFeaturesStep","eventInformationStep","continueEventButton","continueFeaturesButton","backEventButton","deleteDialog","deleteForm","deletePhrase","deleteConfirmation","deleteError"].map((id) => [id, document.getElementById(id)]));

init();
function init() {
  if (state.initialized) return;
  state.initialized = true;
  if (!isFirebaseConfigured()) return showFatal("Firebase is not configured. Add your Firebase configuration before opening the workspace.");
  state.services = initFirebase();
  // Keep role-dependent controls inaccessible until the authenticated role is known.
  setEventControlsVisibility(false);
  // The sample invitation is an owner/admin demonstration tool. Keep it
  // hidden until the signed-in account's actual event permissions are read.
  el.sampleInvitationPanel.hidden = true;
  el.signOutButton.addEventListener("click", async () => {
    state.signingOut = true;
    state.workspaceRequest += 1;
    state.unsubscribeAuth?.(); state.unsubscribeAccess?.();
    clearTimeout(state.workspaceTimer);
    await signOut(state.services.auth);
    location.replace(document.body.dataset.accountSurface === "customer" ? "./customer-login.html?message=signed-out" : "./dashboard-login.html?message=signed-out");
  });
  window.addEventListener("pagehide", () => { state.signingOut = true; state.workspaceRequest += 1; clearTimeout(state.workspaceTimer); state.unsubscribeAuth?.(); state.unsubscribeAccess?.(); }, { once: true });
  el.createWeddingButton.addEventListener("click", () => openForm());
  el.retryLoadButton.addEventListener("click", () => watchWorkspace());
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
  state.unsubscribeAuth = onAuthStateChanged(state.services.auth, async (user) => {
    if (state.signingOut) return;
    if (state.user?.uid !== user?.uid) {
      state.weddings = [];
      state.canSeeSampleInvitation = false;
      state.isAdmin = false;
      state.roleResolved = false;
      el.sampleInvitationPanel.hidden = true;
      state.workspaceLoaded = false;
      state.currentPage = 1;
      state.workspaceRequest += 1;
      setEventControlsVisibility(false);
      if (user) {
        el.workspace.hidden = true;
        el.loadingState.hidden = false;
        el.loadingState.textContent = "Loading workspace…";
        render();
      }
    }
    if (!user) return location.replace(document.body.dataset.accountSurface === "customer" ? "./customer-login.html?message=session-required" : "./dashboard-login.html?message=session-required");
    state.user = user;
    void renderLocalBuckets(user.uid);
    try {
      state.isAdmin = await isPlatformAdmin(accountApi, state.services.db, user.uid);
      state.roleResolved = true;
      try { await redeemCustomerGrants(accountApi, state.services.db, user); }
      catch (error) { el.workspaceStatus.textContent = "Your account is signed in. Event linking needs a retry or administrator assistance."; }
    } catch (error) { showFatal(`Account access could not be loaded (${error.code || "unavailable"}).`); return; }
    if (state.signingOut || state.services.auth.currentUser?.uid !== user.uid) return;
    const customerSurface = document.body.dataset.accountSurface === "customer";
    if (!state.isAdmin && !customerSurface) return location.replace("./customer-events.html");
    if (state.isAdmin && customerSurface) return location.replace("./all-events.html");
    syncEventControls();
    el.createWeddingButton.hidden = !state.isAdmin;
    document.getElementById("verifyCustomerEmail")?.addEventListener("click", async () => {
      const status = document.getElementById("verificationStatus");
      try {
        await accountApi.reload(user); await user.getIdToken(true);
        if (!user.emailVerified) { await accountApi.sendEmailVerification(user); status.textContent = "Verification email sent. Open it, then click here again to refresh access."; }
        else { await redeemCustomerGrants(accountApi, state.services.db, user); watchWorkspace(); status.textContent = "Access refreshed."; }
      } catch (error) { status.textContent = `Verification could not complete (${error.code || "unavailable"}).`; }
    });
    el.userEmail.textContent = user.email || "Planner";
    el.loadingState.hidden = true;
    el.workspace.hidden = false;
    if (new URLSearchParams(location.search).get("message") === "access-denied") el.workspaceStatus.textContent = "That event is not assigned to your account. Choose one of your events below.";
    state.unsubscribeAccess?.();
    state.unsubscribeAccess = accountApi.onSnapshot(collection(state.services.db, "users", user.uid, "weddingAccess"), () => watchWorkspace(), (error) => {
      state.weddings = []; state.workspaceLoaded = false; render();
      el.workspaceStatus.textContent = `Event access could not refresh (${error.code || "unavailable"}).`;
    });
  });
  window.addEventListener("pagehide", disposeListeners, { once: true });
  window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
}

function showFatal(message) { el.loadingState.textContent = message; }
function isCustomerView() {
  return state.roleResolved && !state.isAdmin && document.body.dataset.accountSurface === "customer";
}
function setEventControlsVisibility(visible) {
  el.workspaceControls.hidden = !visible;
  el.filterRow.hidden = !visible;
}
function syncEventControls() {
  const customerView = isCustomerView();
  if (customerView) {
    // Ignore any values retained in this document from a prior account/session.
    el.searchInput.value = "";
    el.sortSelect.value = "event";
    state.filter = "all";
    state.currentPage = 1;
    el.filterRow.querySelectorAll("[data-filter]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.filter === "all");
    });
  }
  setEventControlsVisibility(state.roleResolved && !customerView);
}
function watchWorkspace() {
  state.workspaceTimer && clearInterval(state.workspaceTimer);
  const generation = ++state.snapshotGeneration;
  void refreshWorkspaceEvents(generation);
}

async function refreshWorkspaceEvents(generation = state.snapshotGeneration) {
  const request = ++state.workspaceRequest;
  state.canSeeSampleInvitation = false;
  el.sampleInvitationPanel.hidden = true;
  try {
    // The index is only a discovery hint. Every event is re-read from its
    // membership document first; full dashboard accounts then read the
    // canonical event, whose Firestore rules enforce the same boundary.
    // Never query the global weddings collection and filter it in this client.
    const access = await getDocs(collection(state.services.db, "users", state.user.uid, "weddingAccess"));
    const indexed = await Promise.all(access.docs.map(async (entry) => {
      try {
        const membership = await getDoc(doc(state.services.db, "weddings", entry.id, "dashboardUsers", state.user.uid));
        const permissions = membership.data();
        const eventSummary = entry.data();
        if (!membership.exists()) {
          // A deletion interrupted after membership cleanup remains resumable
          // through the owner's private index until the parent and index are
          // removed. A stale index for an already deleted event is harmless.
          if (eventSummary.ownerUserId !== state.user.uid) return null;
          const ownerEvent = await getDoc(doc(state.services.db, "weddings", entry.id));
          if (!ownerEvent.exists() || ownerEvent.data().ownerUserId !== state.user.uid) {
            await deleteDoc(doc(state.services.db, "users", state.user.uid, "weddingAccess", entry.id)).catch(() => {});
            return null;
          }
          return { ...ownerEvent.data(), id: ownerEvent.id, isOwner: true, cleanupPending: ownerEvent.data().deleting === true };
        }
        if (permissions.canViewDashboard !== true) return null;
        // Seating-only accounts receive only their own index metadata. Do not
        // fetch the full event document (which contains organizer settings).
        if (permissions.seatingOnly === true) {
          return { ...eventSummary, id: entry.id, isOwner: false, seatingOnly: true, allowedSide: permissions.allowedSide || "restricted" };
        }
        const snapshot = await getDoc(doc(state.services.db, "weddings", entry.id));
        if (!snapshot.exists()) return null;
        const wedding = snapshot.data();
        const isOwner = state.isAdmin;
        if (state.isAdmin) state.canSeeSampleInvitation = true;
        return {
          ...wedding,
          id: snapshot.id,
          isOwner,
          canManageUsers: permissions.canManageUsers === true,
          ...(Array.isArray(permissions.allowedViews) ? { allowedViews: permissions.allowedViews } : {}),
        };
      } catch (error) {
        // A stale or forged index row is not authorization. Ignore only an
        // authorization denial for that candidate; surface actual outages.
        if (["permission-denied", "not-found"].includes(error?.code)) return null;
        throw error;
      }
    }));
    if (generation !== state.snapshotGeneration || request !== state.workspaceRequest || !state.user) return;
    state.weddings = replaceRowsById(indexed.filter(Boolean));
    state.workspaceLoaded = true;
    const onlySeating = state.weddings.length > 0 && state.weddings.every((wedding) => wedding.seatingOnly === true);
    el.createWeddingButton.hidden = !state.isAdmin;
    el.sampleInvitationPanel.hidden = !state.canSeeSampleInvitation;
    syncEventControls();
    el.retryLoadButton.hidden = true;
    await enrichStats();
    render();
  } catch (error) {
    if (generation !== state.snapshotGeneration || request !== state.workspaceRequest) return;
    console.error("Accessible event list could not be loaded.", error?.code || "unavailable");
    state.weddings = [];
    state.canSeeSampleInvitation = false;
    el.sampleInvitationPanel.hidden = true;
    state.workspaceLoaded = false;
    el.emptyState.hidden = true;
    el.weddingGrid.replaceChildren();
    el.paginationControls.hidden = true;
    el.workspaceStatus.textContent = `Couldn’t load events (${error?.code || "network error"}). Check your connection and try again.`;
    el.retryLoadButton.hidden = false;
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
  state.unsubscribeAccess?.();
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
  const customerView = isCustomerView();
  const term = customerView ? "" : el.searchInput.value.trim().toLowerCase();
  let rows = state.weddings.filter((w) => {
    if (customerView) return true;
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
  el.emptyState.hidden = Boolean(!state.workspaceLoaded || state.weddings.length || term || state.filter !== "all" || el.retryLoadButton.hidden === false);
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
  const category = isGenderRevealEvent(w) ? "Gender Reveal Party · حفل الكشف عن جنس المولود" : isCelebrationEvent(w) ? "Celebration" : "Wedding / Engagement";
  const cardMenu = isOwner ? `<div class="menu-wrap"><button class="card-menu-toggle" data-action="menu" data-id="${eventId}" type="button" aria-label="More actions for ${escape(title)}" aria-expanded="false" aria-controls="menu-${eventId}">⋯</button><div class="action-menu" id="menu-${eventId}" hidden>${ownerActions}</div></div>` : "";
  const statsMarkup = isGenderRevealEvent(w)
    ? `<span class="stat">Shared RSVP · no guest list</span>`
    : w.seatingOnly === true
    ? `<span class="stat">Seating access · ${escape(w.allowedSide || "restricted")}</span>`
    : `<span class="stat"><strong>${stats.total || 0}</strong> guests</span><span class="stat"><strong>${stats.confirmed || 0}</strong> confirmed</span><span class="stat"><strong>${stats.pending || 0}</strong> pending</span><span class="stat"><strong>${stats.declined || 0}</strong> declined</span>${active ? `<span class="stat"><strong>${stats.checkedIn || 0}/${stats.total || 0}</strong> checked in</span>` : ""}`;
  const openLabel = w.seatingOnly === true ? "Open seating" : "Open dashboard";
  const canCopyGuestLink = state.isAdmin && w.seatingOnly !== true &&
    (!Array.isArray(w.allowedViews) || w.allowedViews.includes("share"));
  const copyAction = canCopyGuestLink ? `<button data-action="${isGenderRevealEvent(w) ? "copy-shared" : "copy"}" data-id="${eventId}" type="button" title="${isGenderRevealEvent(w) ? "Copy shared event invitation link" : "Copy guest invitation link template"}">${isGenderRevealEvent(w) ? "Copy shared link" : "Copy guest link"}</button>` : "";
  return `<article class="wedding-card"><div class="card-head"><div><p class="workspace-kicker">${escape(w.venueEn || "Venue not set")}</p><h2>${escape(title)}</h2><span class="category-badge">${category}</span></div><div class="card-head__actions"><span class="status-badge status-badge--${eventStatus}">${escape(eventStatus)}</span>${cardMenu}</div></div><div class="card-meta">${formatEvent(w)}${w.location ? ` · ${escape(w.location)}` : ""}</div><div class="card-stats">${statsMarkup}</div><div class="card-footer"><span>Updated ${formatRelative(w.updatedAt || w.createdAt)}</span></div><div class="card-actions"><button class="open-button" data-action="open" data-id="${eventId}" type="button">${openLabel}</button>${copyAction}</div></article>`;
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
  if (button.dataset.action === "copy-shared") { await navigator.clipboard.writeText(new URL(`gender-reveal.html?wedding=${encodeURIComponent(wedding.id)}`, location.href)); flash("Shared event invitation link copied."); }
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
function openForm(wedding) {
  if (!state.isAdmin) return;
  state.editId = wedding?.id || "";
  el.weddingForm.reset();
  document.getElementById("photoBucketStep").hidden = true;
  el.weddingForm.querySelector('[value="photo_bucket"]').closest("label").hidden = Boolean(wedding);
  el.formError.textContent = "";
  el.formKicker.textContent = wedding ? "Event details" : "New event";
  el.formTitle.textContent = wedding ? "Edit event" : "Create an event";
  el.saveWeddingButton.textContent = wedding ? "Save changes" : "Create event";
  el.categoryStep.hidden = false;
  el.eventFeaturesStep.hidden = true;
  el.eventInformationStep.hidden = true;
  el.backEventButton.hidden = true;
  el.saveWeddingButton.hidden = true;
  const f = el.weddingForm.elements;
  if (wedding) {
    el.weddingForm.querySelectorAll('[name="eventCategory"]').forEach((input) => { input.checked = input.value === getEventCategory(wedding); });
    ["brideName", "groomName", "eventTitle", "eventTitleAr", "venueEn", "location", "mapsUrl", "whatsAppCountryCode", "invitationLanguage", "status", "plannerNotes"].forEach((key) => { if (f[key]) f[key].value = wedding[key] || ""; });
    const parts = eventDateTimeParts(wedding.eventDateISO, wedding.eventTimeZone || "");
    f.eventDate.value = parts.date;
    f.eventTime.value = parts.time;
  }
  updateCategoryFields();
  el.weddingDialog.showModal();
}
function updateCategoryFields() {
  const category = getSelectedEventCategory();
  const photoBucket = category === "photo_bucket";
  const bucketStep = document.getElementById("photoBucketStep");
  bucketStep?.querySelectorAll("input").forEach(input => { input.disabled = !photoBucket; input.required = photoBucket; });
  el.eventInformationStep.querySelectorAll("input,select,textarea").forEach(input => { input.disabled = photoBucket; });
  if (photoBucket) { el.continueEventButton.disabled = false; return; }
  const wedding = category === EVENT_CATEGORIES.WEDDING_ENGAGEMENT;
  const genderReveal = category === EVENT_CATEGORIES.GENDER_REVEAL;
  el.continueEventButton.disabled = !category;
  el.weddingForm.querySelectorAll(".wedding-identity").forEach((label) => {
    label.hidden = !wedding;
    label.querySelector("input").disabled = !wedding;
    label.querySelector("input").required = wedding;
  });
  const title = el.weddingForm.querySelector(".celebration-identity");
  title.hidden = wedding;
  title.querySelector("input").disabled = wedding;
  title.querySelector("input").required = !wedding && Boolean(category);
  const sourceEvent = state.weddings.find((item) => item.id === state.editId);
  if (genderReveal && !isGenderRevealEvent(sourceEvent)) {
    title.querySelector("input").value = "Gender Reveal Party";
    el.weddingForm.elements.eventTitleAr.value = "حفل الكشف عن جنس المولود";
  }
  const venue = el.weddingForm.querySelector(".event-venue-field input");
  venue.disabled = !category;
  venue.required = Boolean(category) && !genderReveal;
  el.weddingForm.querySelector(".gender-reveal-ar-title").hidden = !genderReveal;
  const senderControl = el.weddingForm.querySelector(".sender-control");
  senderControl.hidden = genderReveal;
  senderControl.querySelector("input").disabled = genderReveal;
  for (const name of ["seatingEnabled", "showInvitationQr"]) {
    const checkbox = el.weddingForm.elements[name];
    checkbox.closest(".event-feature-option").hidden = genderReveal;
    checkbox.disabled = genderReveal;
    checkbox.checked = genderReveal ? false : (state.editId ? Boolean(state.weddings.find((item) => item.id === state.editId)?.[name]) : true);
  }
}
function continueToEventInformation() {
  const category = getSelectedEventCategory();
  if (!category) return;
  if (category === "photo_bucket") {
    el.categoryStep.hidden = true; el.eventFeaturesStep.hidden = true; el.eventInformationStep.hidden = true;
    document.getElementById("photoBucketStep").hidden = false;
    el.saveWeddingButton.hidden = false; el.backEventButton.hidden = false;
    return;
  }
  if (!state.editId && !el.eventFeaturesStep.hidden) {
    el.eventFeaturesStep.hidden = true;
    el.eventInformationStep.hidden = false;
    el.saveWeddingButton.hidden = false;
    return;
  }
  el.categoryStep.hidden = true;
  if (state.editId || category === EVENT_CATEGORIES.GENDER_REVEAL) {
    el.eventInformationStep.hidden = false;
    el.saveWeddingButton.hidden = false;
    el.eventFeaturesStep.hidden = true;
  } else {
    el.eventFeaturesStep.hidden = false;
  }
  el.backEventButton.hidden = false;
}
function backEventStep() {
  if (getSelectedEventCategory() === "photo_bucket") {
    document.getElementById("photoBucketStep").hidden = true; el.categoryStep.hidden = false;
    el.backEventButton.hidden = true; el.saveWeddingButton.hidden = true; return;
  }
  if (!state.editId && !el.eventInformationStep.hidden && getSelectedEventCategory() !== EVENT_CATEGORIES.GENDER_REVEAL) {
    el.eventInformationStep.hidden = true;
    el.eventFeaturesStep.hidden = false;
    el.saveWeddingButton.hidden = true;
    return;
  }
  el.eventFeaturesStep.hidden = true;
  el.eventInformationStep.hidden = true;
  el.categoryStep.hidden = false;
  el.backEventButton.hidden = true;
  el.saveWeddingButton.hidden = true;
}
async function saveWedding(event) {
  // Photo Buckets MUST return before the legacy Firebase creation path.
  if (getSelectedEventCategory() === "photo_bucket") {
    event.preventDefault();
    if (!state.isAdmin || state.editId) return;
    el.saveWeddingButton.disabled = true;
    const status = document.getElementById("photoBucketCreateError"); status.textContent = "";
    try {
      const f = el.weddingForm.elements;
      const bucket = await ownerAdapter(state.user.uid).create({ name: f.bucketName.value, date: f.bucketDate.value, location: f.bucketLocation.value });
      location.href = `./photo-bucket-manage.html?bucket=${encodeURIComponent(bucket.id)}`;
    } catch (error) { status.textContent = error.name === "QuotaExceededError" ? "This browser is out of storage. Free some space and try again." : error.message; }
    finally { el.saveWeddingButton.disabled = false; }
    return;
  }
  if (!state.isAdmin) return;
 event.preventDefault(); const f = el.weddingForm.elements; const category = getSelectedEventCategory(); if (!Object.values(EVENT_CATEGORIES).includes(category)) return; const oldEvent = state.weddings.find((item) => item.id === state.editId); if (oldEvent && getEventCategory(oldEvent) !== category && !window.confirm("Changing this event category changes the dashboard experience. Existing guest side values will be preserved. Continue?")) return; const brideName = f.brideName.value.trim(), groomName = f.groomName.value.trim(); const genderReveal = category === EVENT_CATEGORIES.GENDER_REVEAL; const leavingGenderReveal = isGenderRevealEvent(oldEvent) && !genderReveal; const timeZone = genderReveal ? "Asia/Dubai" : (oldEvent?.eventTimeZone || ""); const eventDateISO = localDateTimeToIso(f.eventDate.value, f.eventTime.value, timeZone); const openingVideoDefault = oldEvent && Object.hasOwn(oldEvent, "genderRevealOpeningVideoUrl") ? oldEvent.genderRevealOpeningVideoUrl : "/videos/gender-reveal-opening.mp4"; const data = { eventCategory: category, eventDateISO, ...(genderReveal ? { eventTimeZone: "Asia/Dubai", guestGroupMode: "general", genderRevealArtworkUrl: oldEvent?.genderRevealArtworkUrl || "/images/gender-reveal-cover.png", genderRevealOpeningVideoUrl: openingVideoDefault, genderRevealMusicUrl: oldEvent?.genderRevealMusicUrl || "/music/gender-reveal-party.mp3", genderRevealMessageEn: oldEvent?.genderRevealMessageEn || "A little surprise is on the way…", genderRevealMessageAr: oldEvent?.genderRevealMessageAr || "مفاجأة جميلة بانتظارنا…", eventTitleAr: f.eventTitleAr.value.trim() || "حفل الكشف عن جنس المولود", seatingEnabled: false, showInvitationQr: false } : leavingGenderReveal ? { eventTitleAr: "", genderRevealArtworkUrl: "", genderRevealOpeningVideoUrl: "", genderRevealMusicUrl: "", genderRevealMessageEn: "", genderRevealMessageAr: "" } : {}), venueEn: f.venueEn.value.trim(), location: f.location.value.trim(), mapsUrl: f.mapsUrl.value.trim(), whatsAppCountryCode: genderReveal ? "971" : f.whatsAppCountryCode.value.trim(), invitationLanguage: genderReveal ? (f.invitationLanguage.value === "ar" ? "ar" : "en") : f.invitationLanguage.value, plannerNotes: f.plannerNotes.value.trim(), status: f.status.value, updatedAt: serverTimestamp() }; if (genderReveal) data.eventTitle = f.eventTitle.value.trim() || "Gender Reveal Party"; else if (category === EVENT_CATEGORIES.CELEBRATION) data.eventTitle = f.eventTitle.value.trim(); else Object.assign(data, { brideName, groomName, coupleName: `${brideName} & ${groomName}`, eventTitle: `${brideName} & ${groomName}` }); el.formError.textContent = ""; el.saveWeddingButton.disabled = true;
  try { if (state.editId) { await updateDoc(doc(state.services.db,"weddings",state.editId), data); await setDoc(doc(state.services.db,"users",state.user.uid,"weddingAccess",state.editId), { ...indexData(data), weddingId: state.editId }, { merge:true }); } else { const weddingRef = doc(collection(state.services.db,"weddings")); const batch = writeBatch(state.services.db); batch.set(weddingRef, { ...data, seatingEnabled:f.seatingEnabled.checked, showInvitationQr:f.showInvitationQr.checked, ownerUserId:state.user.uid, createdAt:serverTimestamp() }); batch.set(doc(state.services.db,"weddings",weddingRef.id,"dashboardUsers",state.user.uid), { userId:state.user.uid, email:state.user.email || "", canViewDashboard:true, canEditGuests:true, canEditSeating:true, canCheckIn:true, canManageUsers:true, role:"owner", createdAt:serverTimestamp(), updatedAt:serverTimestamp() }); batch.set(doc(state.services.db,"users",state.user.uid,"weddingAccess",weddingRef.id), { ...indexData(data), weddingId:weddingRef.id, ownerUserId:state.user.uid, createdAt:serverTimestamp(), updatedAt:serverTimestamp() }); await batch.commit(); } el.weddingDialog.close(); void refreshWorkspaceEvents(); } catch (error) { console.error(error); el.formError.textContent = "We could not save this event. Please check your access and try again."; } finally { el.saveWeddingButton.disabled=false; } }
function indexData(data) { return Object.fromEntries(Object.entries({ eventCategory:data.eventCategory, eventTitle:data.eventTitle, coupleName:data.coupleName, brideName:data.brideName, groomName:data.groomName, eventDateISO:data.eventDateISO, venueEn:data.venueEn, location:data.location, status:data.status, updatedAt:data.updatedAt }).filter(([, value]) => value !== undefined)); }
async function setArchived(wedding) {
  if (!state.isAdmin) return; const status = wedding.status === "archived" ? "draft" : "archived"; try { await updateDoc(doc(state.services.db,"weddings",wedding.id), { status, updatedAt:serverTimestamp() }); await setDoc(doc(state.services.db,"users",state.user.uid,"weddingAccess",wedding.id), { status, updatedAt:serverTimestamp() }, {merge:true}); void refreshWorkspaceEvents(); } catch (_) {
 flash("We could not update this event. Please try again."); } }
async function duplicate(wedding) {
 if (!state.isAdmin) return; const { id, stats, legacy, isOwner, seatingOnly, allowedSide, createdAt, updatedAt, completedAt, statusBeforeCompletion, ...source } = wedding; const title = `${getEventDisplayTitle(wedding)} (Copy)`; const copy = { ...source, seatingEnabled:wedding.seatingEnabled !== false, eventTitle:title, status:"draft", ownerUserId:state.user.uid, createdAt:serverTimestamp(), updatedAt:serverTimestamp() }; if (eventUsesGuestSides(wedding)) copy.coupleName = title; if (isGenderRevealEvent(wedding)) { delete copy.coupleName; delete copy.brideName; delete copy.groomName; delete copy.brideNameAr; delete copy.groomNameAr; copy.seatingEnabled = false; copy.showInvitationQr = false; } try { const ref = doc(collection(state.services.db,"weddings")); const batch = writeBatch(state.services.db); batch.set(ref, copy); batch.set(doc(state.services.db,"weddings",ref.id,"dashboardUsers",state.user.uid), { userId:state.user.uid, email:state.user.email || "", canViewDashboard:true, canEditGuests:true, canEditSeating:true, canCheckIn:true, canManageUsers:true, role:"owner", createdAt:serverTimestamp(), updatedAt:serverTimestamp() }); batch.set(doc(state.services.db,"users",state.user.uid,"weddingAccess",ref.id), { ...indexData(copy), weddingId:ref.id, ownerUserId:state.user.uid, createdAt:serverTimestamp(), updatedAt:serverTimestamp() }); await batch.commit(); flash("Event setup duplicated as a draft."); void refreshWorkspaceEvents(); } catch (e) {
 console.error(e); flash("We could not duplicate this event."); } }
function openDelete(wedding) { state.deleteId=wedding.id; el.deletePhrase.textContent=`DELETE ${wedding.id}`; el.deleteConfirmation.value=""; el.deleteError.textContent=""; el.deleteDialog.showModal(); }
async function deleteEventCollection(weddingId, collectionId) {
  const source = collection(state.services.db, "weddings", weddingId, collectionId);
  while (true) {
    const snapshot = await getDocs(query(source, limit(400)));
    if (snapshot.empty) return;
    const batch = writeBatch(state.services.db);
    snapshot.docs.forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }
}

async function deleteWedding(event) {
  if (!state.isAdmin) return;

  event.preventDefault();
  const weddingId = state.deleteId;
  const phrase = `DELETE ${weddingId}`;
  if (el.deleteConfirmation.value !== phrase) {
    el.deleteError.textContent = `Type “${phrase}” exactly to delete.`;
    return;
  }
  const submit = el.deleteForm.querySelector('[type="submit"]');
  submit.disabled = true;
  el.deleteError.textContent = "Checking event ownership…";
  try {
    const eventRef = doc(state.services.db, "weddings", weddingId);
    const eventSnapshot = await getDoc(eventRef);
    if (!eventSnapshot.exists()) {
      await deleteDocIfPresent(["users", state.user.uid, "weddingAccess", weddingId]);
      state.weddings = state.weddings.filter((item) => item.id !== weddingId);
      el.deleteDialog.close();
      render();
      flash("The event was already removed. Its workspace index is now cleared.");
      return;
    }
    if (eventSnapshot.data().ownerUserId !== state.user?.uid) {
      throw new Error("Only the event owner can delete this event.");
    }
    const membersSnapshot = await getDocs(collection(state.services.db, "weddings", weddingId, "dashboardUsers"));
    const memberIds = new Set([state.user.uid, ...membersSnapshot.docs.map((item) => item.id)]);

    // This first write makes every invitation and sender capability unusable
    // before any subcollection cleanup begins. The owner can resume if a batch
    // later fails or the browser closes.
    if (eventSnapshot.data().deleting !== true) {
      await updateDoc(eventRef, { deleting: true, updatedAt: serverTimestamp() });
    }
    el.deleteError.textContent = "Invalidating and removing event data… keep this page open.";

    const senderCapabilities = await getDocs(collection(state.services.db, "weddings", weddingId, "senderCapabilities"));
    for (const capability of senderCapabilities.docs) {
      await deleteEventCollectionPath(["weddings", weddingId, "senderCapabilities", capability.id, "recipients"]);
    }

    const childCollections = [
      "seatingAccess", "tables", "guests", "seatingGuests", "checkinGuests",
      "seatAssignments", "seatOccupancy", "seatedPeople", "invitationSecrets",
      "invitationTokens", "publicGuests", "publicSummary", "publicStats",
      "genderRevealResponses", "genderRevealPhoneKeys", "genderRevealState", "genderRevealResults",
      "publicEvent", "publicScene", "publicLayouts", "publicVenue", "publicSchedule",
      "seatingMigrations", "eventMaintenance", "senderCapabilities",
    ];
    for (const collectionId of childCollections) {
      await deleteEventCollection(weddingId, collectionId);
    }

    // Workspace indexes are private to each user. The deletion rule permits
    // the event owner to clean those known member indexes after invalidation.
    // Remove delegated workspace hints while preserving the owner's own index
    // and membership until all event data is gone. This keeps retries reachable.
    for (const userId of memberIds) {
      if (userId !== state.user.uid) await deleteDocIfPresent(["users", userId, "weddingAccess", weddingId]);
    }
    for (const userId of memberIds) {
      if (userId !== state.user.uid) await deleteDocIfPresent(["weddings", weddingId, "dashboardUsers", userId]);
    }
    await deleteDocIfPresent(["weddings", weddingId, "dashboardUsers", state.user.uid]);
    await deleteDocIfPresent(["weddings", weddingId]);
    // This is the owner's own index, so it remains deletable after the parent
    // disappears and is removed only after the event cleanup has completed.
    await deleteDocIfPresent(["users", state.user.uid, "weddingAccess", weddingId]);
    el.deleteDialog.close();
    state.weddings = state.weddings.filter((item) => item.id !== weddingId);
    render();
    flash("Event and its known data were deleted.");
  } catch (error) {
    console.error("Event cleanup stopped; the owner can retry to resume it.", error);
    el.deleteError.textContent = `${error?.message || "Event cleanup could not finish."} The event has been marked unavailable and you can retry this cleanup.`;
  } finally {
    submit.disabled = false;
  }
}

async function deleteEventCollectionPath(path) {
  while (true) {
    const source = collection(state.services.db, ...path);
    const snapshot = await getDocs(query(source, limit(400)));
    if (snapshot.empty) return;
    const batch = writeBatch(state.services.db);
    snapshot.docs.forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }
}

async function deleteDocIfPresent(path) {
  const ref = doc(state.services.db, ...path);
  await deleteDoc(ref);
}
function timestampValue(value) { return value?.toMillis?.() || value?.seconds * 1000 || (value ? new Date(value).getTime() : 0); } function formatEvent(event) { const date=new Date(event.eventDateISO); return Number.isNaN(+date) ? "Event date to be set" : new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short",...(event.eventTimeZone ? {timeZone:event.eventTimeZone} : {})}).format(date); } function formatRelative(value) { const ms=Date.now()-timestampValue(value); if (!ms) return "just now"; const days=Math.floor(ms/86400000); return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`; } function escape(value) { const node=document.createElement("span"); node.textContent=value; return node.innerHTML; } function flash(message) { el.workspaceStatus.textContent=message; }

window.addEventListener("pageshow", (event) => { if (event.persisted) location.reload(); });
