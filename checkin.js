import {
  collection,
  doc,
  getDoc,
  initFirebase,
  isFirebaseConfigured,
  onAuthStateChanged,
  onSnapshot,
  query,
  serverTimestamp,
  signInWithEmailAndPassword,
  where,
  writeBatch,
} from "./firebase-config.js";
import { getEventDisplayTitle } from "./event-utils.js";
import { bindPasswordVisibility } from "./password-visibility.js?v=1";

bindPasswordVisibility(document);

const params = new URLSearchParams(window.location.search);
const credential = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
const demoWedding = {
  coupleName: "Sara & Khalid",
};

const demoGuests = [
  {
    id: "guest-1",
    fullName: "Noor Ahmed",
    phone: "971500000001",
    side: "bride",
    rsvpStatus: "confirmed",
    tableName: "Moonlight",
    seatNumber: "4",
    checkedIn: true,
    checkedInAt: "Today, 7:42 PM",
    guestToken: "demo-token-1",
  },
  {
    id: "guest-2",
    fullName: "Omar Hassan",
    phone: "971500000002",
    side: "groom",
    rsvpStatus: "pending",
    tableName: "Jasmine",
    seatNumber: "2",
    checkedIn: false,
    checkedInAt: null,
    guestToken: "demo-token-2",
  },
];

const state = {
  weddingId: params.get("wedding") || "",
  guestToken: credential.get("guest") || "",
  mode: params.get("demo") === "1" ? "demo" : "live",
  services: null,
  currentUser: null,
  permissions: null,
  wedding: null,
  guests: [],
  guest: null,
  unsubGuests: null,
  unsubAuth: null,
  guestFetchGeneration: 0,
  unsubMembership: null,
  authStateSeen: false,
  initialized: false,
};

const elements = {
  authGate: document.getElementById("checkinAuthGate"),
  app: document.getElementById("checkinApp"),
  authStatus: document.getElementById("checkinAuthStatus"),
  loginForm: document.getElementById("checkinLoginForm"),
  weddingTitle: document.getElementById("checkinWeddingTitle"),
  counter: document.getElementById("checkinCounter"),
  guestCard: document.getElementById("guestCheckinCard"),
  manualSearchPanel: document.getElementById("manualSearchPanel"),
  manualSearchInput: document.getElementById("manualSearchInput"),
  manualSearchResults: document.getElementById("manualSearchResults"),
  toastRail: document.getElementById("toastRail"),
};

init();

async function init() {
  if (state.initialized) return;
  state.initialized = true;
  bindEvents();
  window.addEventListener("pagehide", disposeListeners, { once: true });

  if (state.mode === "demo") {
    loadDemoCheckin();
    return;
  }

  if (!state.weddingId) {
    showUnavailable("This check-in link is unavailable.");
    return;
  }

  if (!isFirebaseConfigured()) {
    showUnavailable("Check-in is temporarily unavailable.");
    return;
  }

  state.services = initFirebase();
  await state.services.persistenceReady;
  await state.services.auth.authStateReady();
  elements.weddingTitle.textContent = "Check-In Console";
  const stats = await getDoc(doc(state.services.db, "weddings", state.weddingId, "publicSummary", "summary")).catch(() => null);
  if (stats?.exists()) {
    state.wedding = { eventTitle: stats.data().eventTitle || "" };
    elements.weddingTitle.textContent = `${getEventDisplayTitle(state.wedding)} · Check-In`;
  }

  await handleAuthChange(state.services.auth.currentUser);
  state.unsubAuth?.();
  state.unsubAuth = onAuthStateChanged(state.services.auth, handleAuthChange);
}

async function handleAuthChange(user) {
  if (state.authStateSeen && state.currentUser?.uid === user?.uid && (state.permissions || !user)) return;
  state.authStateSeen = true;
  state.currentUser = user || null;
  state.unsubGuests?.();
  state.unsubMembership?.();
  state.unsubGuests = state.unsubMembership = null;
  state.permissions = null;
  state.guest = null;
  state.guests = [];
  elements.counter.textContent = "";
  renderGuestCard();
  renderManualSearchResults();
  if (!user) {
    elements.authGate.hidden = false;
    elements.app.hidden = true;
    elements.authStatus.textContent = "Sign in with an authorized event account to scan or search guests.";
    return;
  }
  const memberRef = doc(state.services.db, "weddings", state.weddingId, "dashboardUsers", user.uid);
  try {
    const permissionDoc = await getDoc(memberRef);
    if (state.currentUser?.uid !== user.uid) return;
    if (!permissionDoc.exists() || permissionDoc.data().canCheckIn !== true) {
      throw new Error("This account does not have check-in access.");
    }
    applyCheckinPermissions(permissionDoc.data());
    state.unsubMembership = onSnapshot(memberRef, (snapshot) => {
      if (state.currentUser?.uid !== user.uid) return;
      if (!snapshot.exists() || snapshot.data().canCheckIn !== true) {
        revokeCheckinAccess();
        return;
      }
      applyCheckinPermissions(snapshot.data());
    }, () => revokeCheckinAccess());
    state.unsubGuests = subscribeCheckinGuests();
    if (state.guestToken) void resolveCheckinToken(state.guestToken, user.uid);
  } catch (error) {
    if (state.currentUser?.uid !== user.uid) return;
    elements.app.hidden = true;
    elements.authGate.hidden = false;
    elements.authStatus.textContent = error.message || "This account does not have check-in access.";
  }
}

function applyCheckinPermissions(permission) {
  const allowedSide = String(permission.allowedSide || "all").toLowerCase();
  if (!permission.canCheckIn || !["all", "bride", "groom", "family"].includes(allowedSide)) {
    revokeCheckinAccess();
    return;
  }
  const previousSide = state.permissions?.allowedSide;
  state.permissions = { ...permission, allowedSide };
  if (state.unsubGuests && previousSide && previousSide !== allowedSide) {
    state.unsubGuests();
    state.unsubGuests = subscribeCheckinGuests();
  }
  elements.authGate.hidden = true;
  elements.app.hidden = false;
  elements.manualSearchPanel.hidden = false;
  renderManualSearchResults();
}

function revokeCheckinAccess() {
  state.unsubGuests?.();
  state.unsubGuests = null;
  state.permissions = null;
  state.guests = [];
  state.guest = null;
  elements.app.hidden = true;
  elements.authGate.hidden = false;
  elements.authStatus.textContent = "This account no longer has check-in access.";
  renderGuestCard();
  renderManualSearchResults();
}

function subscribeCheckinGuests() {
  const guests = collection(state.services.db, "weddings", state.weddingId, "checkinGuests");
  const allowedSide = state.permissions?.allowedSide || "all";
  const source = allowedSide === "all" ? guests : query(guests, where("side", "==", allowedSide));
  const userId = state.currentUser?.uid;
  return onSnapshot(source, (snapshot) => {
    if (state.currentUser?.uid !== userId || !state.permissions) return;
    state.guests = snapshot.docs.map((item) => ({ ...item.data(), id: item.id }));
    elements.counter.textContent = `Checked in ${state.guests.filter((guest) => guest.checkedIn).length} of ${state.guests.length} guests`;
    if (state.guest) {
      const updated = state.guests.find((guest) => guest.id === state.guest.id);
      if (updated) state.guest = updated;
      else if (!checkinSideAllowed(state.guest.side, state.permissions?.allowedSide)) state.guest = null;
    }
    renderGuestCard();
    renderManualSearchResults();
  }, (error) => {
    console.error("Check-in guest access was revoked or could not be refreshed.", error?.code || "unavailable");
    revokeCheckinAccess();
  });
}

function checkinSideAllowed(guestSide, allowedSide) {
  return allowedSide === "all" || normalizeCheckinSide(guestSide) === allowedSide;
}

function normalizeCheckinSide(value) {
  const side = String(value || "").trim().toLowerCase();
  if (side === "bride") return "bride";
  if (side === "groom" || side === "both" || side === "shared") return "groom";
  if (side === "general") return "general";
  return "family";
}

async function resolveCheckinToken(token, expectedUid) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token || "")) {
    showToast("This check-in link is unavailable.", "error");
    return;
  }
  try {
    const tokenRecord = await getDoc(doc(state.services.db, "weddings", state.weddingId, "invitationTokens", token));
    if (!tokenRecord.exists() || state.currentUser?.uid !== expectedUid) throw new Error("Unavailable");
    const guestId = tokenRecord.data().guestId;
    if (typeof guestId !== "string" || !guestId) throw new Error("Unavailable");
    const guestSnapshot = await getDoc(doc(state.services.db, "weddings", state.weddingId, "checkinGuests", guestId));
    if (!guestSnapshot.exists() || state.currentUser?.uid !== expectedUid) throw new Error("Unavailable");
    state.guest = { ...guestSnapshot.data(), id: guestSnapshot.id };
    if (window.location.hash) history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    renderGuestCard();
  } catch {
    if (state.currentUser?.uid !== expectedUid) return;
    state.guest = null;
    renderGuestCard();
    showToast("This check-in link is unavailable.", "error");
  }
}

function loadDemoCheckin(message = "Preview mode is on. Firebase setup can be added later.") {
  state.mode = "demo";
  state.permissions = { canCheckIn: true };
  state.wedding = demoWedding;
  state.guests = demoGuests.map((guest) => ({ ...guest }));
  state.guest = state.guestToken
    ? state.guests.find((guest) => guest.guestToken === state.guestToken) || null
    : state.guests[0] || null;
  elements.weddingTitle.textContent = `${getEventDisplayTitle(state.wedding)} · Check-In`;
  elements.counter.textContent = `Checked in ${state.guests.filter((guest) => guest.checkedIn).length} of ${state.guests.length} guests`;
  elements.authGate.hidden = true;
  elements.app.hidden = false;
  elements.manualSearchPanel.hidden = false;
  renderGuestCard();
  renderManualSearchResults();
  showToast(message, "info");
}

function showUnavailable(message) {
  elements.authGate.hidden = false;
  elements.app.hidden = true;
  elements.authStatus.textContent = message;
}

function bindEvents() {
  elements.loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.services?.auth) {
      elements.authStatus.textContent = "Firebase is not ready yet.";
      return;
    }
    try {
      await signInWithEmailAndPassword(
        state.services.auth,
        event.currentTarget.email.value.trim(),
        event.currentTarget.password.value
      );
    } catch (error) {
      console.error(error);
      elements.authStatus.textContent = "Sign-in failed.";
    }
  });

  elements.manualSearchInput?.addEventListener("input", renderManualSearchResults);

  document.addEventListener("click", async (event) => {
    const checkinButton = event.target.closest("[data-checkin-guest]");
    if (checkinButton) {
      await checkInGuest(checkinButton.dataset.checkinGuest);
    }

    const searchResult = event.target.closest("[data-select-guest]");
    if (searchResult) {
      state.guest = state.guests.find((guest) => guest.id === searchResult.dataset.selectGuest) || null;
      renderGuestCard();
    }
  });
}

function startGuestRefresh() {
  state.unsubGuests?.();
  state.unsubGuests = subscribeCheckinGuests();
}

function disposeListeners() {
  state.unsubGuests?.();
  state.unsubMembership?.();
  state.unsubAuth?.();
  state.unsubGuests = null;
  state.unsubMembership = null;
  state.unsubAuth = null;
}

function renderGuestCard() {
  if (!state.guest) {
    elements.guestCard.innerHTML = '<div class="dashboard-empty">No guest found for this QR link yet.</div>';
    return;
  }

  const checkedInAt = formatTimestamp(state.guest.checkedInAt);
  elements.guestCard.innerHTML = `
    <div class="checkin-card">
      <div class="checkin-card__header">
        <h2>${escapeHtml(state.guest.fullName || "Guest")}</h2>
        <span class="status-pill status-pill--${escapeAttribute(state.guest.rsvpStatus || "pending")}">${escapeHtml(state.guest.rsvpStatus || "pending")}</span>
      </div>
      <div class="dashboard-guest-card__meta">
        <span>Phone: ${escapeHtml(state.guest.phone || "Not set")}</span>
        <span>Side: ${escapeHtml(state.guest.side || "other")}</span>
        <span>Table: ${escapeHtml(state.guest.tableName || "Unassigned")}</span>
        <span>Seat Number: ${escapeHtml(state.guest.seatNumber || "Pending")}</span>
        <span>Check-in Status: ${state.guest.checkedIn ? `Already checked in${checkedInAt ? ` at ${checkedInAt}` : ""}` : "Not checked in yet"}</span>
      </div>
      <div class="dashboard-inline-actions">
        <button
          class="luxury-button luxury-button--primary"
          type="button"
          data-checkin-guest="${escapeAttribute(state.guest.id)}"
          ${state.guest.checkedIn || !state.permissions ? "disabled" : ""}
        >
          <span>${state.guest.checkedIn ? "Already Checked In" : "Check In Guest"}</span>
        </button>
      </div>
    </div>
  `;

  elements.app.hidden = false;
}

function renderManualSearchResults() {
  if (!state.permissions) {
    elements.manualSearchResults.innerHTML = "";
    return;
  }

  const search = (elements.manualSearchInput.value || "").trim().toLowerCase();
  const matches = state.guests.filter((guest) => {
    return !search || [guest.fullName, guest.phone].some((value) => String(value || "").toLowerCase().includes(search));
  });

  elements.manualSearchResults.innerHTML = matches
    .map(
      (guest) => `
        <button class="search-result-card" type="button" data-select-guest="${escapeAttribute(guest.id)}">
          <strong>${escapeHtml(guest.fullName || "Guest")}</strong>
          <span>${escapeHtml(guest.phone || "No phone")} - ${escapeHtml(guest.tableName || "No table")}</span>
        </button>
      `
    )
    .join("");
}

async function checkInGuest(guestId) {
  if (!state.permissions?.canCheckIn) {
    showToast("Your account does not have check-in permission.", "error");
    return;
  }

  const guest = state.guests.find((item) => item.id === guestId) || state.guest;
  if (!guest || guest.checkedIn) {
    showToast("This guest is already checked in.", "info");
    return;
  }

  try {
    if (state.mode === "demo") {
      guest.checkedIn = true;
      guest.checkedInAt = new Date().toLocaleString();
      elements.counter.textContent = `Checked in ${state.guests.filter((item) => item.checkedIn).length} of ${state.guests.length} guests`;
      renderGuestCard();
      renderManualSearchResults();
      showToast("Guest checked in successfully.", "success");
      return;
    }
    const checkedInAt = serverTimestamp();
    const batch = writeBatch(state.services.db);
    batch.update(doc(state.services.db, "weddings", state.weddingId, "guests", guestId), {
      checkedIn: true,
      checkedInAt,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(state.services.db, "weddings", state.weddingId, "checkinGuests", guestId), {
      checkedIn: true,
      checkedInAt,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    guest.checkedIn = true;
    renderGuestCard();
    showToast("Guest checked in successfully.", "success");
  } catch (error) {
    console.error(error);
    showToast("Check-in failed.", "error");
  }
}

function formatTimestamp(value) {
  if (!value) {
    return "";
  }
  if (typeof value.toDate === "function") {
    return value.toDate().toLocaleString();
  }
  return String(value);
}

function showToast(message, tone = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast--${tone}`;
  toast.textContent = message;
  elements.toastRail.appendChild(toast);
  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 260);
  }, 2600);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
