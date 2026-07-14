import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  initFirebase,
  isFirebaseConfigured,
  onAuthStateChanged,
  onSnapshot,
  query,
  serverTimestamp,
  signOut,
  updateDoc,
  where,
  writeBatch,
} from "./firebase-config.js";
import { exportGuests } from "./export.js";

const params = new URLSearchParams(window.location.search);
const lastWeddingStorageKey = "da3wa:lastDashboardWeddingId";

const plannerPalette = {
  tableColor: "#F3EBDC",
  borderColor: "#BC9B61",
  chairColor: "#24554A",
};

const pageMeta = {
  overview: {
    eyebrow: "Event command center",
    title: "Overview",
    description: "A live operational snapshot of guest progress, seating readiness, and on-the-day attention items.",
  },
  guests: {
    eyebrow: "Guest management",
    title: "Guest Directory",
    description: "Search, sort, filter, and update every invitee from a single operational directory.",
  },
  seating: {
    eyebrow: "Seat planning workspace",
    title: "Seating Planner",
    description: "Arrange tables, inspect capacity, and assign seats without leaving the hall layout.",
  },
  checkin: {
    eyebrow: "Venue operations",
    title: "Check-In Access",
    description: "Monitor arrivals, open the hostess console, and share the secure on-site check-in link.",
  },
  share: {
    eyebrow: "Invitation sharing",
    title: "Links & Invitations",
    description: "Copy the right public or operational link for planners, hosts, and invited guests.",
  },
  exports: {
    eyebrow: "Data exports",
    title: "Exports",
    description: "Download guest lists and seating views without disturbing live event data.",
  },
};

const demoWedding = {
  coupleName: "Sara & Khalid",
  brideName: "Sara",
  groomName: "Khalid",
  eventDateISO: "2026-12-20T20:00:00+04:00",
  venueEn: "Pearl Ballroom, Dubai",
  venueAr: "قاعة اللؤلؤة، دبي",
  status: "active",
};

const demoTables = [
  createPlannerTable({
    id: "table-a",
    name: "Moonlight",
    label: "VIP 1",
    seatCount: 8,
    shape: "round",
    floorZone: "Grand Hall",
    x: 22,
    y: 34,
    width: 184,
    height: 184,
  }),
  createPlannerTable({
    id: "table-b",
    name: "Jasmine",
    label: "Family A",
    seatCount: 10,
    shape: "round",
    floorZone: "Grand Hall",
    x: 55,
    y: 32,
    width: 196,
    height: 196,
    chairColor: "#275F55",
  }),
  createPlannerTable({
    id: "table-c",
    name: "Rose",
    label: "Bride 3",
    seatCount: 6,
    shape: "horseshoe",
    floorZone: "Family Lounge",
    x: 76,
    y: 58,
    width: 220,
    height: 170,
    chairColor: "#84596A",
  }),
];

const demoGuests = [
  {
    id: "guest-1",
    fullName: "Noor Ahmed",
    fullNameAr: "نور أحمد",
    phone: "971500000001",
    side: "bride",
    rsvpStatus: "confirmed",
    guestToken: "demo-token-1",
    tableId: "table-a",
    tableName: "Moonlight",
    seatNumber: "4",
    checkedIn: true,
    checkedInAt: "Today, 7:42 PM",
    notes: "VIP family guest",
    inviteSentAt: "Today, 4:15 PM",
    reminderSentAt: "Today, 6:20 PM",
    createdAt: "Today, 1:02 PM",
    updatedAt: "Today, 7:42 PM",
  },
  {
    id: "guest-2",
    fullName: "Omar Hassan",
    fullNameAr: "عمر حسن",
    phone: "971500000002",
    side: "groom",
    rsvpStatus: "pending",
    guestToken: "demo-token-2",
    tableId: "table-b",
    tableName: "Jasmine",
    seatNumber: "2",
    checkedIn: false,
    checkedInAt: null,
    notes: "",
    inviteSentAt: "Yesterday, 8:10 PM",
    reminderSentAt: null,
    createdAt: "Yesterday, 8:10 PM",
    updatedAt: "Yesterday, 8:10 PM",
  },
  {
    id: "guest-3",
    fullName: "Layla Saeed",
    fullNameAr: "ليلى سعيد",
    phone: "971500000003",
    side: "bride",
    rsvpStatus: "declined",
    guestToken: "demo-token-3",
    tableId: "",
    tableName: "",
    seatNumber: "",
    checkedIn: false,
    checkedInAt: null,
    notes: "Out of town",
    inviteSentAt: "Yesterday, 2:15 PM",
    reminderSentAt: null,
    createdAt: "Yesterday, 2:15 PM",
    updatedAt: "Yesterday, 5:01 PM",
  },
  {
    id: "guest-4",
    fullName: "Khaled Mansoor",
    fullNameAr: "خالد منصور",
    phone: "971500000004",
    side: "groom",
    rsvpStatus: "confirmed",
    guestToken: "demo-token-4",
    tableId: "table-a",
    tableName: "Moonlight",
    seatNumber: "6",
    checkedIn: false,
    checkedInAt: null,
    notes: "Needs aisle access",
    inviteSentAt: "Yesterday, 9:30 PM",
    reminderSentAt: "Today, 3:18 PM",
    createdAt: "Yesterday, 9:30 PM",
    updatedAt: "Today, 3:18 PM",
  },
  {
    id: "guest-5",
    fullName: "Mira Rahman",
    fullNameAr: "ميرا رحمن",
    phone: "971500000005",
    side: "family",
    rsvpStatus: "pending",
    guestToken: "demo-token-5",
    tableId: "",
    tableName: "",
    seatNumber: "",
    checkedIn: false,
    checkedInAt: null,
    notes: "Vegetarian",
    inviteSentAt: null,
    reminderSentAt: null,
    createdAt: "Today, 10:11 AM",
    updatedAt: "Today, 10:11 AM",
  },
];

const state = {
  weddingId: params.get("wedding") || "",
  mode: params.get("demo") === "1" ? "demo" : "live",
  services: null,
  currentUser: null,
  permissions: null,
  wedding: null,
  guests: [],
  tables: [],
  hallObjects: createHallObjects(),
  selectedGuestId: "",
  selectedGuestIds: [],
  activeView: "overview",
  selectedTableId: "",
  selectedSeatId: "",
  seatingMode: "layout",
  guestAssignmentSearch: "",
  plannerZoom: 1,
  dragState: null,
  guestFilters: {
    search: "",
    rsvp: "all",
    side: "all",
  },
  libraryFilters: {
    rsvp: "all",
    side: "all",
    vipOnly: false,
  },
  activeGuestMenu: null,
  lastGuestMenuTrigger: null,
  sidebarOpen: false,
  authRedirectMessage: "",
  loadingGuests: true,
  loadingTables: true,
  saveState: "saved",
  dirtyGuestForm: false,
  dirtyTableForm: false,
  unsubGuests: null,
  unsubTables: null,
};

const elements = {
  dashboardApp: document.getElementById("dashboardApp"),
  dashboardSidebar: document.getElementById("dashboardSidebar"),
  pageEyebrow: document.getElementById("pageEyebrow"),
  pageTitle: document.getElementById("pageTitle"),
  pageDescription: document.getElementById("pageDescription"),
  liveIndicator: document.getElementById("liveIndicator"),
  globalActions: document.getElementById("globalActions"),
  pageContent: document.getElementById("pageContent"),
  navToggleButton: document.getElementById("navToggleButton"),
  signOutButton: document.getElementById("signOutButton"),
  guestModal: document.getElementById("guestModal"),
  guestForm: document.getElementById("guestForm"),
  guestModalTitle: document.getElementById("guestModalTitle"),
  guestDeleteButton: document.getElementById("guestDeleteButton"),
  tableModal: document.getElementById("tableModal"),
  tableForm: document.getElementById("tableForm"),
  tableModalTitle: document.getElementById("tableModalTitle"),
  toastRail: document.getElementById("toastRail"),
};

init();

async function init() {
  bindEvents();

  if (!isFirebaseConfigured()) {
    redirectToLogin("firebase-not-configured");
    return;
  }

  state.services = initFirebase();

  onAuthStateChanged(state.services.auth, async (user) => {
    state.currentUser = user;
    if (!user) {
      const message = state.authRedirectMessage || "session-required";
      state.authRedirectMessage = "";
      redirectToLogin(message);
      return;
    }
    if (!state.weddingId) {
      state.weddingId = await resolveAccessibleWeddingId(user);
      if (!state.weddingId) {
        redirectToLogin("access-denied");
        return;
      }
      window.history.replaceState(null, "", `./dashboard.html?wedding=${encodeURIComponent(state.weddingId)}`);
    }
    await bootstrapDashboard();
  });
}

function bindEvents() {
  elements.signOutButton?.addEventListener("click", async () => {
    if (state.services?.auth) {
      state.authRedirectMessage = "signed-out";
      await signOut(state.services.auth);
    }
  });
  elements.navToggleButton?.addEventListener("click", () => {
    state.sidebarOpen = !state.sidebarOpen;
    updateSidebarState();
  });
  elements.guestForm?.addEventListener("submit", saveGuest);
  elements.tableForm?.addEventListener("submit", saveTable);
  elements.guestDeleteButton?.addEventListener("click", async () => {
    if (!state.selectedGuestId) {
      return;
    }
    const guest = state.guests.find((item) => item.id === state.selectedGuestId);
    if (!guest) {
      return;
    }
    const confirmed = window.confirm(`Delete ${guest.fullName}? This cannot be undone.`);
    if (!confirmed) {
      return;
    }
    elements.guestModal.close();
    await deleteGuest(guest.id);
  });

  elements.guestForm?.addEventListener("input", () => {
    state.dirtyGuestForm = true;
  });
  elements.tableForm?.addEventListener("input", () => {
    state.dirtyTableForm = true;
  });

  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("input", handleDocumentInput);
  document.addEventListener("change", handleDocumentChange);
  document.addEventListener("keydown", handleDocumentKeydown);
  elements.guestModal?.addEventListener("click", handleDialogBackdropClick);
  elements.tableModal?.addEventListener("click", handleDialogBackdropClick);
  elements.guestModal?.addEventListener("cancel", (event) => {
    if (state.dirtyGuestForm && !window.confirm("Discard guest changes?")) {
      event.preventDefault();
    }
  });
  elements.tableModal?.addEventListener("cancel", (event) => {
    if (state.dirtyTableForm && !window.confirm("Discard table changes?")) {
      event.preventDefault();
    }
  });
  elements.guestModal?.addEventListener("close", () => {
    document.body.classList.remove("is-modal-open");
    state.dirtyGuestForm = false;
  });
  elements.tableModal?.addEventListener("close", () => {
    document.body.classList.remove("is-modal-open");
    state.dirtyTableForm = false;
  });
  window.addEventListener("scroll", closeGuestMenu, true);
  window.addEventListener("resize", closeGuestMenu);

  window.addEventListener("pointermove", handlePlannerPointerMove);
  window.addEventListener("pointerup", handlePlannerPointerUp);
}

function handleDocumentClick(event) {
  const navButton = event.target.closest("[data-nav-view]");
  if (navButton) {
    closeGuestMenu();
    switchView(navButton.dataset.navView);
    return;
  }

  const closeTrigger = event.target.closest("[data-close-modal]");
  if (closeTrigger) {
    const modal = document.getElementById(closeTrigger.dataset.closeModal);
    if (closeTrigger.dataset.closeModal === "guestModal" && state.dirtyGuestForm) {
      const shouldClose = window.confirm("Discard guest changes?");
      if (!shouldClose) {
        return;
      }
      state.dirtyGuestForm = false;
    }
    if (closeTrigger.dataset.closeModal === "tableModal" && state.dirtyTableForm) {
      const shouldClose = window.confirm("Discard table changes?");
      if (!shouldClose) {
        return;
      }
      state.dirtyTableForm = false;
    }
    modal?.close();
    return;
  }

  const actionNode = event.target.closest("[data-action]");
  if (actionNode) {
    const action = actionNode.dataset.action;
    const fromGuestMenu = Boolean(actionNode.closest(".guest-menu"));
    if (fromGuestMenu) {
      closeGuestMenu({ restoreFocus: false });
    }
    void handleAction(action, actionNode.dataset);
    return;
  }

  if (state.activeGuestMenu && !event.target.closest(".guest-menu") && !event.target.closest(".guest-row__menu-toggle")) {
    closeGuestMenu();
  }
}

function handleDialogBackdropClick(event) {
  if (event.target !== event.currentTarget) {
    return;
  }
  const modal = event.currentTarget;
  if (modal.id === "guestModal" && state.dirtyGuestForm && !window.confirm("Discard guest changes?")) {
    return;
  }
  if (modal.id === "tableModal" && state.dirtyTableForm && !window.confirm("Discard table changes?")) {
    return;
  }
  modal.close();
}

function handleDocumentInput(event) {
  if (event.target === elements.guestForm?.fullName) {
    event.target.setCustomValidity(event.target.value.trim() ? "" : "Enter the guest's full name.");
    return;
  }

  if (event.target === elements.guestForm?.additionalGuests) {
    event.target.setCustomValidity(parseAdditionalGuests(event.target.value) === null ? "Enter a whole number of 0 or more." : "");
    return;
  }

  const search = event.target.closest("[data-guest-search]");
  if (search) {
    state.guestFilters.search = search.value.trim();
    closeGuestMenu({ restoreFocus: false });
    renderActiveView();
    return;
  }

  const seatSearch = event.target.closest("[data-seat-search]");
  if (seatSearch) {
    state.guestAssignmentSearch = seatSearch.value.trim().toLowerCase();
    renderActiveView();
  }
}

function handleDocumentChange(event) {
  const guestFilter = event.target.closest("[data-guest-filter]");
  if (guestFilter) {
    state.guestFilters[guestFilter.dataset.guestFilter] = guestFilter.value;
    closeGuestMenu({ restoreFocus: false });
    renderActiveView();
    return;
  }

  const selectedGuest = event.target.closest("[data-guest-select]");
  if (selectedGuest) {
    toggleGuestSelection(selectedGuest.value, selectedGuest.checked);
    renderActiveView();
    return;
  }

  const selectAll = event.target.closest("[data-guest-select-all]");
  if (selectAll) {
    toggleAllVisibleGuests(selectAll.checked);
    renderActiveView();
    return;
  }

  const libraryFilter = event.target.closest("[data-library-filter]");
  if (libraryFilter) {
    const key = libraryFilter.dataset.libraryFilter;
    state.libraryFilters[key] = libraryFilter.type === "checkbox" ? libraryFilter.checked : libraryFilter.value;
    renderActiveView();
  }
}

function handleDocumentKeydown(event) {
  if (state.activeGuestMenu && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    handleGuestMenuKeyboard(event);
    return;
  }

  if (event.key !== "Escape") {
    return;
  }

  if (state.activeGuestMenu) {
    closeGuestMenu();
    return;
  }

  if (state.sidebarOpen) {
    state.sidebarOpen = false;
    updateSidebarState();
  }
}

function loadDemoDashboard(message = "Preview mode is on. Firebase setup can be added later.") {
  state.mode = "demo";
  state.permissions = {
    role: "Demo Admin",
    canViewDashboard: true,
    canEditGuests: true,
    canEditSeating: true,
    canCheckIn: true,
    canExport: true,
    canManageUsers: true,
  };
  state.wedding = demoWedding;
  state.guests = demoGuests.map((guest) => ({
    ...guest,
    inviteLink: buildInviteLink(guest.guestToken),
    qrCodeValue: buildCheckinLink(guest.guestToken),
  }));
  state.loadingGuests = false;
  state.tables = hydrateTables(demoTables);
  state.loadingTables = false;
  state.selectedTableId = state.tables[0]?.id || "";
  showDashboard();
  renderAll();
  showToast(message, "info");
}

async function bootstrapDashboard() {
  const permissionDoc = await getDoc(
    doc(state.services.db, "weddings", state.weddingId, "dashboardUsers", state.currentUser.uid)
  );

  if (!permissionDoc.exists() || !permissionDoc.data().canViewDashboard) {
    redirectToLogin("access-denied");
    return;
  }

  state.permissions = permissionDoc.data();
  rememberWeddingId(state.weddingId);
  const weddingDoc = await getDoc(doc(state.services.db, "weddings", state.weddingId));
  state.wedding = weddingDoc.exists() ? weddingDoc.data() : null;
  showDashboard();
  renderAll();
  startListeners();
}

function startListeners() {
  state.unsubGuests?.();
  state.unsubTables?.();
  state.loadingGuests = true;
  state.loadingTables = true;
  renderActiveView();

  state.unsubGuests = onSnapshot(collection(state.services.db, "weddings", state.weddingId, "guests"), (snapshot) => {
    state.guests = snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
    state.loadingGuests = false;
    renderAll();
  });

  state.unsubTables = onSnapshot(collection(state.services.db, "weddings", state.weddingId, "tables"), (snapshot) => {
    state.tables = hydrateTables(snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })));
    state.selectedTableId = state.selectedTableId || state.tables[0]?.id || "";
    state.loadingTables = false;
    renderAll();
  });
}

function showDashboard() {
  elements.dashboardApp.hidden = false;
}

function renderAll() {
  closeGuestMenu({ restoreFocus: false });
  renderChrome();
  renderActiveView();
}

function renderChrome() {
  const meta = pageMeta[state.activeView];
  elements.pageEyebrow.textContent = meta.eyebrow;
  elements.pageTitle.textContent = meta.title;
  elements.pageDescription.textContent = meta.description;
  elements.liveIndicator.innerHTML = state.mode === "demo" ? "Preview mode" : "Live data";

  document.querySelectorAll("[data-nav-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.navView === state.activeView);
  });

  updateSidebarState();
  renderGlobalActions();
}

function updateSidebarState() {
  elements.dashboardSidebar.classList.toggle("is-open", state.sidebarOpen);
}

function renderGlobalActions() {
  const actions = [];
  if (state.activeView === "overview" || state.activeView === "guests") {
    actions.push(actionButton("Add guest", "open-add-guest", !can("canEditGuests"), "primary"));
  }
  if (state.activeView === "seating") {
    actions.push(actionButton("Add table", "open-add-table", !can("canEditSeating"), "primary"));
  }
  actions.push(actionButton("Refresh", "refresh-dashboard", false, "secondary"));

  elements.globalActions.innerHTML = actions.join("");
}

function switchView(view) {
  if (!pageMeta[view]) {
    return;
  }
  closeGuestMenu({ restoreFocus: false });
  state.activeView = view;
  state.sidebarOpen = false;
  renderAll();
}

function renderActiveView() {
  switch (state.activeView) {
    case "overview":
      renderOverviewPage();
      break;
    case "guests":
      renderGuestPage();
      break;
    case "seating":
      renderSeatingPage();
      break;
    case "checkin":
      renderCheckinPage();
      break;
    case "share":
      renderSharePage();
      break;
    case "exports":
      renderExportsPage();
      break;
    default:
      renderOverviewPage();
  }
}

function renderOverviewPage() {
  if (state.loadingGuests || state.loadingTables) {
    elements.pageContent.innerHTML = '<div class="da3wa-skeleton" aria-hidden="true"></div>';
    return;
  }

  const stats = calculateDashboardStats(state.guests, state.tables);
  const attention = calculateAttention(state.guests, state.tables);
  const recentActivity = deriveRecentActivity(state.guests);
  const distribution = calculateSideDistribution(state.guests);

  elements.pageContent.innerHTML = `
    <section class="overview-page">
      <article class="overview-hero">
        <div class="overview-hero__meta">
          <span class="pill">${escapeHtml(state.wedding?.status || "active")}</span>
          <span class="pill pill--live">${state.mode === "demo" ? "Preview data" : "Realtime updates"}</span>
          <span class="pill">${formatEventDate(state.wedding?.eventDateISO)}</span>
          <span class="pill">${escapeHtml(state.wedding?.venueEn || "Venue not set")}</span>
        </div>
        <div>
          <p class="da3wa-eyebrow">Event status</p>
          <h2>${escapeHtml(state.wedding?.coupleName || "Current Wedding")}</h2>
          <p class="overview-hero__subline">Track invitations, guest readiness, and ballroom setup from a calmer operational view.</p>
        </div>
      </article>

      <section class="overview-kpis">
        ${renderKpiCard("Total invited", stats.total, `${stats.confirmedPct}% confirmed`, "Live guest count")}
        ${renderKpiCard("Confirmed", stats.confirmed, `${stats.confirmedPct}% of total`, "RSVP accepted")}
        ${renderKpiCard("Pending", stats.pending, `${stats.pendingPct}% awaiting response`, "Needs follow-up")}
        ${renderKpiCard("Declined", stats.declined, `${stats.declinedPct}% declined`, "Unavailable")}
        ${renderKpiCard("Checked in", stats.checkedIn, `${stats.checkinPct}% arrived`, "Venue arrivals")}
        ${renderKpiCard("Without seats", stats.withoutSeat, `${stats.withoutSeatPct}% need placement`, "Seating attention")}
      </section>

      <section class="overview-analytics">
        <article class="analytics-card">
          <p class="da3wa-eyebrow">RSVP progress</p>
          <h3>Response completion</h3>
          <div class="progress-stack">
            ${progressRow("Confirmed", stats.confirmed, stats.total, "sage")}
            ${progressRow("Pending", stats.pending, stats.total, "amber")}
            ${progressRow("Declined", stats.declined, stats.total, "rose")}
          </div>
        </article>

        <article class="analytics-card">
          <p class="da3wa-eyebrow">Seating progress</p>
          <h3>Assignment readiness</h3>
          <div class="progress-stack">
            ${progressRow("Assigned guests", stats.seatedGuests, stats.total, "sage")}
            ${progressRow("Unassigned guests", stats.unassignedGuests, stats.total, "amber")}
            ${progressRow("Seats remaining", stats.remainingSeats, Math.max(stats.totalSeats, 1), "rose")}
          </div>
        </article>

        <article class="analytics-card">
          <p class="da3wa-eyebrow">Check-in progress</p>
          <h3>Arrival tracking</h3>
          <div class="progress-stack">
            ${progressRow("Checked in", stats.checkedIn, stats.total, "sage")}
            ${progressRow("Awaiting arrival", stats.notCheckedIn, stats.total, "amber")}
          </div>
        </article>

        <article class="analytics-card">
          <p class="da3wa-eyebrow">Guest-side distribution</p>
          <h3>Balanced coverage</h3>
          <div class="split-meter">
            <div class="split-meter__bar">
              <span style="width:${distribution.bridePct}%; background:#24554A;"></span>
              <span style="width:${distribution.groomPct}%; background:#B89156;"></span>
              <span style="width:${distribution.otherPct}%; background:#B56B63;"></span>
            </div>
            <div class="split-meter__legend">
              ${legendRow("Bride", distribution.bride, distribution.bridePct)}
              ${legendRow("Groom", distribution.groom, distribution.groomPct)}
              ${legendRow("Other / Both / Family", distribution.other, distribution.otherPct)}
            </div>
          </div>
        </article>
      </section>

      <section class="overview-support">
        <article class="attention-card">
          <p class="da3wa-eyebrow">Attention required</p>
          <h3>What needs intervention</h3>
          <div class="attention-list">
            ${attention
              .map(
                (item) => `
                  <div class="attention-item">
                    <strong>${escapeHtml(item.title)}</strong>
                    <span>${escapeHtml(item.description)}</span>
                  </div>
                `
              )
              .join("")}
          </div>
        </article>

        <article class="activity-card">
          <p class="da3wa-eyebrow">Recent activity</p>
          <h3>Latest movement</h3>
          <div class="activity-list">
            ${recentActivity.length
              ? recentActivity
                  .map(
                    (item) => `
                      <div class="activity-item">
                        <strong>${escapeHtml(item.title)}</strong>
                        <span>${escapeHtml(item.subtitle)}</span>
                      </div>
                    `
                  )
                  .join("")
              : `<div class="attention-item"><strong>No recent activity yet</strong><span>Live RSVP, check-in, and reminder timestamps will surface here.</span></div>`}
          </div>
        </article>

        <article class="quick-actions">
          <p class="da3wa-eyebrow">Quick actions</p>
          <h3>Common planner tasks</h3>
          <div class="quick-actions__grid">
            ${quickAction("Add guest", "Create a new invitee with the basic organizer details.", "open-add-guest", !can("canEditGuests"))}
            ${quickAction("Open seating planner", "Jump into table arrangement and seat assignment mode.", "nav-seating")}
            ${quickAction("Export guest list", "Download the full guest roster for coordination and vendors.", "export-all", !can("canExport"))}
            ${quickAction("Copy invitation base", "Share the public invitation pattern with the team.", "copy-invitation-base")}
            ${quickAction("Open check-in console", "Launch the hostess flow with permission-aware access.", "open-checkin")}
          </div>
        </article>
      </section>
    </section>
  `;
}

function renderGuestPage() {
  if (state.loadingGuests) {
    elements.pageContent.innerHTML = '<section class="guest-page"><div class="da3wa-skeleton" aria-hidden="true"></div></section>';
    return;
  }

  const guests = getFilteredGuests();
  const selectedCount = state.selectedGuestIds.length;
  const anySelectedVisible = guests.some((guest) => state.selectedGuestIds.includes(guest.id));

  elements.pageContent.innerHTML = `
    <section class="guest-page">
      <article class="guest-toolbar">
        <div class="guest-toolbar__filters">
          <div class="guest-toolbar__controls">
            <input class="da3wa-input guest-toolbar__search" type="search" placeholder="Search name or phone" value="${escapeAttribute(state.guestFilters.search)}" data-guest-search />
            ${selectInput("rsvp", state.guestFilters.rsvp, [
              ["all", "All RSVP"],
              ["confirmed", "Confirmed"],
              ["pending", "Pending"],
              ["declined", "Declined"],
            ])}
            ${selectInput("side", state.guestFilters.side, [
              ["all", "All Sides"],
              ["bride", "Bride"],
              ["groom", "Groom"],
              ["both", "Both"],
              ["family", "Family"],
              ["other", "Other"],
            ])}
          </div>
          <span class="pill">${guests.length} result${guests.length === 1 ? "" : "s"}</span>
        </div>
      </article>

      ${
        selectedCount
          ? `
            <article class="guest-bulkbar">
              <div>
                <strong>${selectedCount} selected</strong>
                <p>${anySelectedVisible ? "Bulk actions apply to the currently selected guests." : "Selected guests may be outside the current filter."}</p>
              </div>
              <div class="guest-toolbar__summary">
                ${actionButton("Mark confirmed", "bulk-rsvp-confirmed", !can("canEditGuests"))}
                ${actionButton("Mark pending", "bulk-rsvp-pending", !can("canEditGuests"))}
                ${actionButton("Export selected", "bulk-export", !can("canExport"))}
              </div>
            </article>
          `
          : ""
      }

      ${
        !guests.length
          ? `<div class="da3wa-empty">No guests match the current search and filters.</div>`
          : `
            <article class="da3wa-table guest-table-wrap">
              <table class="guest-table">
                <thead>
                  <tr>
                    <th><input type="checkbox" data-guest-select-all ${allVisibleGuestsSelected(guests) ? "checked" : ""} aria-label="Select all visible guests" /></th>
                    <th>Guest</th>
                    <th>Phone</th>
                    <th>Additional guests</th>
                    <th>Side</th>
                    <th>RSVP</th>
                    <th>Invitation</th>
                    <th>Check-In</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${guests.map((guest) => renderGuestRow(guest)).join("")}
                </tbody>
              </table>
            </article>
            <div class="guest-cards">
              ${guests.map((guest) => renderGuestCard(guest)).join("")}
            </div>
          `
      }
    </section>
  `;
}

function renderSeatingPage() {
  if (state.loadingTables) {
    elements.pageContent.innerHTML = '<section class="seating-page"><div class="da3wa-skeleton" aria-hidden="true"></div></section>';
    return;
  }

  const selectedTable = getSelectedTable();
  const selectedSeat = getSelectedSeat();
  const seatingStats = calculateDashboardStats(state.guests, state.tables);
  const unassignedGuests = getAssignableGuests();
  const saveStateLabel = state.saveState === "saving" ? "Saving layout..." : "Saved";

  elements.pageContent.innerHTML = `
    <section class="seating-page">
      <article class="planner-toolbar">
        <div class="planner-toolbar__cluster">
          <div class="planner-toggle" role="tablist" aria-label="Seating mode">
            <button class="${state.seatingMode === "layout" ? "is-active" : ""}" type="button" data-action="set-seating-mode" data-mode="layout">Layout mode</button>
            <button class="${state.seatingMode === "assignment" ? "is-active" : ""}" type="button" data-action="set-seating-mode" data-mode="assignment">Assignment mode</button>
          </div>
          <span class="pill">${state.tables.length} tables</span>
          <span class="pill">${seatingStats.totalSeats} seats</span>
          <span class="pill">${seatingStats.unassignedGuests} unassigned guests</span>
          <span class="pill">${saveStateLabel}</span>
        </div>
        <div class="planner-toolbar__actions">
          ${actionButton("Zoom out", "planner-zoom-out")}
          <span class="pill">${Math.round(state.plannerZoom * 100)}%</span>
          ${actionButton("Zoom in", "planner-zoom-in")}
          ${actionButton("Fit", "planner-fit")}
          ${actionButton("Auto arrange", "planner-auto-arrange", !can("canEditSeating"))}
          ${actionButton("Add table", "open-add-table", !can("canEditSeating"), "primary")}
          ${actionButton("Add hall object", "add-hall-object")}
        </div>
      </article>

      <div class="planner-layout">
        <article class="planner-canvas-shell">
          <div class="planner-canvas__header">
            <div>
              <p class="da3wa-eyebrow">Venue canvas</p>
              <h3 class="planner-panel__title">${state.seatingMode === "layout" ? "Ballroom layout builder" : "Seat assignment workspace"}</h3>
            </div>
            <div class="guest-toolbar__summary">
              <span class="pill">${state.seatingMode === "layout" ? "Drag tables to reposition" : "Select chairs to assign guests"}</span>
            </div>
          </div>
          <div class="planner-canvas" id="plannerCanvas">
            <div class="planner-canvas__floor"></div>
            <div class="planner-floor-marker planner-floor-marker--stage">Stage</div>
            <div class="planner-floor-marker planner-floor-marker--entrance">Entrance</div>
            ${state.hallObjects.map((item) => renderHallObject(item)).join("")}
            ${state.tables.length ? state.tables.map((table) => renderPlannerTable(table)).join("") : `<div class="da3wa-empty">No tables yet. Create your first table to start mapping the hall.</div>`}
          </div>
        </article>

        <div class="planner-panel__stack">
          <article class="planner-panel">
            <div class="planner-panel__header">
              <div>
                <p class="da3wa-eyebrow">Selected table</p>
                <h3 class="planner-panel__title">${escapeHtml(selectedTable?.name || "No table selected")}</h3>
              </div>
              ${selectedTable ? actionButton("Edit", "edit-table", !can("canEditSeating")) : ""}
            </div>
            ${
              selectedTable
                ? renderTableInspector(selectedTable)
                : `<div class="da3wa-empty">Select a table on the canvas to inspect its dimensions, occupancy, and actions.</div>`
            }
          </article>

          <article class="planner-panel">
            <div class="planner-panel__header">
              <div>
                <p class="da3wa-eyebrow">${state.seatingMode === "assignment" ? "Waiting list" : "Planner library"}</p>
                <h3 class="planner-panel__title">${state.seatingMode === "assignment" ? "Unassigned guests" : "Tables & hall objects"}</h3>
              </div>
            </div>
            ${
              state.seatingMode === "assignment"
                ? renderAssignmentLibrary(unassignedGuests)
                : renderLayoutLibrary()
            }
          </article>

          ${
            selectedSeat && state.seatingMode === "assignment"
              ? `
                <article class="seat-assignment">
                  ${renderSeatAssignment(selectedSeat)}
                </article>
              `
              : `
                <article class="planner-panel">
                  <div class="da3wa-empty">Switch to assignment mode and select a chair to open seat assignment controls.</div>
                </article>
              `
          }
        </div>
      </div>
    </section>
  `;

  document.getElementById("plannerCanvas")?.addEventListener("pointerdown", handlePlannerPointerDown, { once: false });
}

function renderCheckinPage() {
  const stats = calculateDashboardStats(state.guests, state.tables);
  const recentCheckins = deriveRecentActivity(state.guests).filter((item) => item.type === "checkin").slice(0, 4);
  const checkinLink = new URL(`checkin.html?wedding=${encodeURIComponent(state.weddingId)}`, window.location.href).toString();

  elements.pageContent.innerHTML = `
    <section class="checkin-page">
      <div class="checkin-grid">
        <article class="checkin-card">
          <p class="da3wa-eyebrow">Arrival count</p>
          <h3>Checked in guests</h3>
          <div class="metric-pair">
            <strong>${stats.checkedIn}</strong>
            <span>${stats.notCheckedIn} still expected at the venue.</span>
          </div>
          <div class="checkin-card__footer">
            ${actionButton("Open console", "open-checkin", !can("canCheckIn"), "primary")}
            ${actionButton("Copy check-in URL", "copy-checkin")}
          </div>
        </article>

        <article class="checkin-card">
          <p class="da3wa-eyebrow">Secure access</p>
          <h3>Check-in URL</h3>
          <p>Use the existing Firebase-protected hostess flow. This redesign keeps the current access rules intact.</p>
          <code>${escapeHtml(checkinLink)}</code>
        </article>

        <article class="checkin-card">
          <p class="da3wa-eyebrow">Recent check-ins</p>
          <h3>Latest arrivals</h3>
          <div class="activity-list">
            ${recentCheckins.length
              ? recentCheckins
                  .map(
                    (item) => `
                      <div class="activity-item">
                        <strong>${escapeHtml(item.title)}</strong>
                        <span>${escapeHtml(item.subtitle)}</span>
                      </div>
                    `
                  )
                  .join("")
              : `<div class="attention-item"><strong>No arrivals recorded yet</strong><span>Recent guest check-ins will appear here.</span></div>`}
          </div>
        </article>
      </div>
    </section>
  `;
}

function renderSharePage() {
  const base = new URL(window.location.href);
  const dashboardLink = new URL(`dashboard.html?wedding=${encodeURIComponent(state.weddingId)}`, base).toString();
  const hostessLink = new URL(`checkin.html?wedding=${encodeURIComponent(state.weddingId)}`, base).toString();
  const invitationBase = new URL(`index.html?wedding=${encodeURIComponent(state.weddingId)}&guest={guestToken}`, base).toString();
  const previewGuest = state.guests[0];
  const previewInvitation = previewGuest?.inviteLink || buildInviteLink(previewGuest?.guestToken || "{guestToken}");

  const cards = [
    {
      title: "Guest invitation base",
      description: "Template for personalized invitation links. Replace `{guestToken}` with the guest's secure token.",
      value: invitationBase,
      copyAction: "copy-invitation-base",
      openAction: previewGuest ? "open-invitation-preview" : "",
    },
    {
      title: "Dashboard link",
      description: "Use this for planners and authorized event staff. Keep it internal.",
      value: dashboardLink,
      copyAction: "copy-dashboard",
      openAction: "open-dashboard",
    },
    {
      title: "Check-in link",
      description: "Direct venue staff to the permission-gated hostess check-in page.",
      value: hostessLink,
      copyAction: "copy-checkin",
      openAction: "open-checkin",
    },
    {
      title: "Invitation preview",
      description: "Open the current invitation experience with the first available guest preview link.",
      value: previewInvitation,
      copyAction: "copy-preview",
      openAction: "open-invitation-preview",
    },
  ];

  elements.pageContent.innerHTML = `
    <section class="share-page">
      <div class="share-grid">
        ${cards
          .map(
            (card) => `
              <article class="share-card">
                <p class="da3wa-eyebrow">Useful link</p>
                <h3>${escapeHtml(card.title)}</h3>
                <p>${escapeHtml(card.description)}</p>
                <code>${escapeHtml(card.value)}</code>
                <div class="share-card__actions">
                  ${actionButton("Copy", card.copyAction)}
                  ${card.openAction ? actionButton("Open", card.openAction, false, "secondary") : ""}
                </div>
              </article>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderExportsPage() {
  const cards = [
    exportCard("All guests", "Guest directory with contact, party size, invitation, RSVP, and attendance data.", "XLSX / CSV", "export-all"),
    exportCard("Confirmed", "Guests with accepted RSVP status.", "XLSX / CSV", "export-confirmed"),
    exportCard("Pending", "Guests still awaiting a response.", "XLSX / CSV", "export-pending"),
    exportCard("Declined", "Guests who cannot attend.", "XLSX / CSV", "export-declined"),
    exportCard("Checked in", "Guests who have arrived at the venue.", "XLSX / CSV", "export-checkedIn"),
    exportCard("Not checked in", "Guests still expected onsite.", "XLSX / CSV", "export-notCheckedIn"),
    exportCard("Table assignments", "Roster sorted by table and seat placement.", "XLSX / CSV", "export-tables"),
    exportCard("Bride side", "Filtered list of bride-side guests.", "XLSX / CSV", "export-bride"),
    exportCard("Groom side", "Filtered list of groom-side guests.", "XLSX / CSV", "export-groom"),
  ];

  elements.pageContent.innerHTML = `
    <section class="exports-page">
      <div class="export-grid">
        ${cards.join("")}
      </div>
    </section>
  `;
}

function renderKpiCard(title, value, meta, note) {
  return `
    <article class="kpi-card">
      <p class="da3wa-eyebrow">${escapeHtml(title)}</p>
      <div class="kpi-card__value">${escapeHtml(String(value))}</div>
      <div class="kpi-card__meta">
        <span>${escapeHtml(meta)}</span>
        <strong>${escapeHtml(note)}</strong>
      </div>
    </article>
  `;
}

function progressRow(label, value, total, tone) {
  const percent = total ? Math.round((value / total) * 100) : 0;
  return `
    <div class="progress-row">
      <div class="progress-row__header">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(String(value))} · ${percent}%</strong>
      </div>
      <div class="progress-track">
        <div class="progress-bar progress-bar--${tone}" style="width:${percent}%"></div>
      </div>
    </div>
  `;
}

function legendRow(label, value, percent) {
  return `
    <div class="legend-row">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))} · ${percent}%</strong>
    </div>
  `;
}

function quickAction(title, description, action, disabled = false) {
  return `
    <button class="quick-action ${disabled ? "is-disabled" : ""}" type="button" data-action="${escapeAttribute(action)}" ${disabled ? 'aria-disabled="true"' : ""}>
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(description)}</span>
    </button>
  `;
}

function renderGuestRow(guest) {
  const inviteLink = guest.inviteLink || buildInviteLink(guest.guestToken);
  const qrLink = guest.qrCodeValue || buildCheckinLink(guest.guestToken);
  const isSelected = state.selectedGuestIds.includes(guest.id);
  const menuOpen = state.activeGuestMenu?.guestId === guest.id;

  return `
    <tr class="guest-row ${isSelected ? "is-selected" : ""}">
      <td><input type="checkbox" value="${guest.id}" data-guest-select ${isSelected ? "checked" : ""} aria-label="Select ${escapeAttribute(guest.fullName || "guest")}" /></td>
      <td>
        <div class="guest-primary">
          <strong>${escapeHtml(guest.fullName || "Guest")}</strong>
        </div>
      </td>
      <td>${escapeHtml(guest.phone || "Not set")}</td>
      <td><span class="guest-count">${escapeHtml(String(normalizeAdditionalGuests(guest.additionalGuests)))}</span></td>
      <td>${badge(guest.side || "other", "plain")}</td>
      <td>${badge(guest.rsvpStatus || "pending", guest.rsvpStatus || "pending")}</td>
      <td>${badge(guest.inviteLink || guest.guestToken ? "Invitation ready" : "Not ready", guest.inviteLink || guest.guestToken ? "invited" : "plain")}</td>
      <td>${badge(guest.checkedIn ? "Checked in" : "Not checked in", guest.checkedIn ? "checked-in" : "plain")}</td>
      <td>
        <div class="guest-row__actions">
          ${actionButton("View", "edit-guest", false, "secondary", guest.id)}
          <button class="guest-row__menu-toggle" id="guest-menu-trigger-${escapeAttribute(guest.id)}" type="button" data-action="toggle-guest-menu" data-guest-id="${guest.id}" aria-label="Open guest actions" aria-haspopup="menu" aria-expanded="${menuOpen ? "true" : "false"}" aria-controls="guestActionMenu">⋯</button>
          <span class="is-hidden" data-invite-link="${escapeAttribute(inviteLink)}"></span>
          <span class="is-hidden" data-qr-link="${escapeAttribute(qrLink)}"></span>
        </div>
      </td>
    </tr>
  `;
}

function renderGuestCard(guest) {
  return `
    <article class="guest-card">
      <div class="guest-card__header">
        <div class="guest-primary">
          <strong>${escapeHtml(guest.fullName || "Guest")}</strong>
        </div>
        ${badge(guest.rsvpStatus || "pending", guest.rsvpStatus || "pending")}
      </div>
      <div class="guest-card__meta">
        <span>Phone: ${escapeHtml(guest.phone || "Not set")}</span>
        <span>Additional guests: ${escapeHtml(String(normalizeAdditionalGuests(guest.additionalGuests)))}</span>
        <span>Side: ${escapeHtml(guest.side || "other")}</span>
        <span>${guest.inviteLink || guest.guestToken ? "Invitation ready" : "Invitation not ready"}</span>
        <span>${guest.checkedIn ? "Checked in" : "Not checked in"}</span>
      </div>
      <div class="guest-card__actions">
        ${actionButton("Edit", "edit-guest", !can("canEditGuests"), "secondary", guest.id)}
        ${actionButton("Copy link", "copy-guest-invite", false, "ghost", guest.id)}
      </div>
    </article>
  `;
}

function renderPlannerTable(table) {
  const isSelected = table.id === state.selectedTableId;
  const guests = getTableGuests(table.id);
  const width = Number(table.width || defaultWidthForShape(table.shape));
  const height = Number(table.height || defaultHeightForShape(table.shape));
  const transform = `translate(-50%, -50%) scale(${state.plannerZoom}) rotate(${Number(table.rotation || 0)}deg)`;
  const shapeClass = `planner-table__surface--${escapeAttribute(table.shape || "round")}`;
  return `
    <div
      class="planner-table ${isSelected ? "is-selected" : ""}"
      style="left:${Number(table.x || 0)}%; top:${Number(table.y || 0)}%; width:${width}px; height:${height}px; transform:${transform};"
      data-table-drag-id="${table.id}"
      data-table-id="${table.id}"
      data-action="select-table"
    >
      <div class="planner-table__inner">
        ${table.chairs.map((chair) => renderPlannerChair(table, chair)).join("")}
        <button
          class="planner-table__surface ${shapeClass}"
          type="button"
          style="--table-fill:${escapeAttribute(table.tableColor || plannerPalette.tableColor)}; --table-border:${escapeAttribute(table.borderColor || plannerPalette.borderColor)};"
          data-action="select-table"
          data-table-id="${table.id}"
        >
          <div class="planner-table__label">
            <strong>${escapeHtml(table.label || table.name)}</strong>
            <span>${guests.length}/${Number(table.seatCount || 0)} seated</span>
          </div>
        </button>
      </div>
    </div>
  `;
}

function renderPlannerChair(table, chair) {
  const guest = chair.guestId ? state.guests.find((item) => item.id === chair.guestId) : null;
  const statusClass = chairStatusClass(chair, guest);
  const isSelected = state.selectedSeatId === buildSeatKey(table.id, chair.id);
  return `
    <button
      class="planner-chair planner-chair--${escapeAttribute(statusClass)} ${isSelected ? "is-selected" : ""}"
      type="button"
      style="left:${chair.x}%; top:${chair.y}%; --chair-color:${escapeAttribute(resolveChairColor(statusClass, table))};"
      title="${escapeAttribute(guest ? `${guest.fullName} · Seat ${chair.seatNumber}` : `Seat ${chair.seatNumber}`)}"
      data-action="select-seat"
      data-table-id="${table.id}"
      data-chair-id="${chair.id}"
    >
      ${escapeHtml(guest ? getInitials(guest.fullName) || String(chair.seatNumber) : String(chair.seatNumber))}
    </button>
  `;
}

function renderHallObject(item) {
  return `
    <div class="hall-object hall-object--${escapeAttribute(item.type)}" style="left:${item.x}%; top:${item.y}%;">
      ${escapeHtml(item.label)}
    </div>
  `;
}

function renderTableInspector(table) {
  const guests = getTableGuests(table.id);
  const brideCount = guests.filter((guest) => guest.side === "bride").length;
  const groomCount = guests.filter((guest) => guest.side === "groom").length;
  const vipCount = guests.filter((guest) => /vip/i.test(guest.notes || "")).length;
  return `
    <div class="planner-inspector__stats">
      ${plannerStat("Shape", prettifyShape(table.shape))}
      ${plannerStat("Zone", table.floorZone || "Main hall")}
      ${plannerStat("Capacity", String(table.seatCount || table.capacity || 0))}
      ${plannerStat("Occupied", String(guests.length))}
      ${plannerStat("Available", String(Math.max(0, Number(table.seatCount || 0) - guests.length)))}
      ${plannerStat("Bride side", String(brideCount))}
      ${plannerStat("Groom side", String(groomCount))}
      ${plannerStat("VIP count", String(vipCount))}
      ${plannerStat("Size", `${Number(table.width || 0)} × ${Number(table.height || 0)}`)}
      ${plannerStat("Rotation", `${Number(table.rotation || 0)}°`)}
    </div>
    <div class="guest-toolbar__summary">
      ${actionButton("Duplicate", "duplicate-table", !can("canEditSeating"), "secondary", table.id)}
      ${actionButton("Delete", "delete-table", !can("canEditSeating"), "ghost", table.id)}
    </div>
  `;
}

function renderLayoutLibrary() {
  const tables = state.tables
    .map((table) => {
      const guests = getTableGuests(table.id);
      return `
        <button class="planner-table-list__button ${table.id === state.selectedTableId ? "is-selected" : ""}" type="button" data-action="select-table" data-table-id="${table.id}">
          <strong>${escapeHtml(table.name)}</strong>
          <small>${escapeHtml(table.label || prettifyShape(table.shape))} · ${guests.length}/${Number(table.seatCount || 0)} seated</small>
        </button>
      `;
    })
    .join("");

  const objects = state.hallObjects
    .map(
      (item) => `
        <div class="planner-object-item">
          <strong>${escapeHtml(item.label)}</strong>
          <small>${escapeHtml(prettifyShape(item.type))} marker · local demo object</small>
        </div>
      `
    )
    .join("");

  return `
    <div class="planner-table-list">${tables || '<div class="da3wa-empty">No tables yet.</div>'}</div>
    <div class="planner-panel__header" style="margin-top:16px;">
      <div>
        <p class="da3wa-eyebrow">Hall objects</p>
        <h3 class="planner-panel__title">Non-persistent markers</h3>
      </div>
    </div>
    <div class="planner-object-list">${objects}</div>
  `;
}

function renderAssignmentLibrary(unassignedGuests) {
  return `
    <div class="planner-filter-group">
      <label>
        <span>RSVP filter</span>
        <select class="da3wa-input" data-library-filter="rsvp">
          <option value="all" ${state.libraryFilters.rsvp === "all" ? "selected" : ""}>All RSVP</option>
          <option value="confirmed" ${state.libraryFilters.rsvp === "confirmed" ? "selected" : ""}>Confirmed first</option>
          <option value="pending" ${state.libraryFilters.rsvp === "pending" ? "selected" : ""}>Pending only</option>
        </select>
      </label>
      <label>
        <span>Side filter</span>
        <select class="da3wa-input" data-library-filter="side">
          <option value="all" ${state.libraryFilters.side === "all" ? "selected" : ""}>All sides</option>
          <option value="bride" ${state.libraryFilters.side === "bride" ? "selected" : ""}>Bride</option>
          <option value="groom" ${state.libraryFilters.side === "groom" ? "selected" : ""}>Groom</option>
          <option value="family" ${state.libraryFilters.side === "family" ? "selected" : ""}>Family</option>
          <option value="other" ${state.libraryFilters.side === "other" ? "selected" : ""}>Other</option>
        </select>
      </label>
      <label>
        <span><input type="checkbox" data-library-filter="vipOnly" ${state.libraryFilters.vipOnly ? "checked" : ""} /> VIP notes only</span>
      </label>
    </div>
    <div class="planner-guest-list">
      ${
        unassignedGuests.length
          ? unassignedGuests
              .map(
                (guest) => `
                  <div class="planner-guest-pill">
                    <strong>${escapeHtml(guest.fullName)}</strong>
                    <small>${escapeHtml(guest.side || "other")} · ${escapeHtml(guest.rsvpStatus || "pending")} · ${escapeHtml(guest.notes || "No notes")}</small>
                  </div>
                `
              )
              .join("")
          : '<div class="da3wa-empty">No matching unassigned guests.</div>'
      }
    </div>
  `;
}

function renderSeatAssignment(selectedSeat) {
  const availableGuests = getSeatCandidates(selectedSeat.guest?.id);
  const warnings = [];
  if (selectedSeat.guest?.rsvpStatus === "declined") {
    warnings.push("Declined guests can be seated, but the planner should confirm this conflict.");
  }
  if (selectedSeat.guest?.rsvpStatus === "pending") {
    warnings.push("Pending RSVP guest seated. Consider following up before finalizing the chart.");
  }
  return `
    <div class="seat-assignment__header">
      <div>
        <p class="da3wa-eyebrow">Seat assignment</p>
        <h3 class="planner-panel__title">${escapeHtml(selectedSeat.table.name)} · Seat ${escapeHtml(String(selectedSeat.chair.seatNumber))}</h3>
      </div>
      ${badge(selectedSeat.guest ? "Assigned" : "Open seat", selectedSeat.guest ? "confirmed" : "pending")}
    </div>

    <div class="seat-assignment__current">
      <div class="seat-assignment__row">
        <span>Current guest</span>
        <strong>${escapeHtml(selectedSeat.guest?.fullName || "Unassigned")}</strong>
      </div>
      <div class="seat-assignment__row">
        <span>Seat details</span>
        <strong>${escapeHtml(selectedSeat.table.label || selectedSeat.table.name)} · Chair ${escapeHtml(String(selectedSeat.chair.seatNumber))}</strong>
      </div>
    </div>

    <div class="seat-assignment__controls">
      <input class="da3wa-input" type="search" placeholder="Search guest, Arabic name, side, RSVP, or phone" value="${escapeAttribute(state.guestAssignmentSearch)}" data-seat-search />
      ${
        selectedSeat.guest
          ? actionButton("Clear seat", "clear-seat", !can("canEditSeating"), "ghost", `${selectedSeat.table.id}::${selectedSeat.chair.id}`)
          : ""
      }
    </div>

    ${
      warnings.length
        ? `<div class="planner-warning-list">${warnings.map((warning) => `<span class="warning-chip">${escapeHtml(warning)}</span>`).join("")}</div>`
        : ""
    }

    <div class="seat-assignment__list">
      ${
        availableGuests.length
          ? availableGuests
              .map((guest) => {
                const existingSeat = findGuestSeat(guest.id);
                const isCurrent = guest.id === selectedSeat.guest?.id;
                return `
                  <button
                    class="seat-assignment__guest ${isCurrent ? "is-selected" : ""}"
                    type="button"
                    data-action="assign-seat"
                    data-table-id="${selectedSeat.table.id}"
                    data-chair-id="${selectedSeat.chair.id}"
                    data-guest-id="${guest.id}"
                  >
                    <strong>${escapeHtml(guest.fullName)}</strong>
                    <small>${escapeHtml(guest.side || "other")} · ${escapeHtml(guest.rsvpStatus || "pending")} · ${existingSeat ? "Move from another seat" : "Assign here"}</small>
                  </button>
                `;
              })
              .join("")
          : '<div class="da3wa-empty">No guests match the current assignment filters.</div>'
      }
    </div>
  `;
}

function plannerStat(label, value) {
  return `
    <div class="planner-stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function exportCard(title, description, format, action) {
  return `
    <article class="export-card">
      <p class="da3wa-eyebrow">Export package</p>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(description)}</p>
      <code>${escapeHtml(format)}</code>
      <div class="export-card__footer">
        ${actionButton("Download", action, !can("canExport"), "primary")}
      </div>
    </article>
  `;
}

function actionButton(label, action, disabled = false, tone = "secondary", id = "") {
  return `
    <button class="da3wa-button da3wa-button--${tone} ${disabled ? "is-disabled" : ""}" type="button" data-action="${escapeAttribute(action)}" ${id ? `data-id="${escapeAttribute(id)}"` : ""} ${disabled ? 'aria-disabled="true"' : ""}>
      ${escapeHtml(label)}
    </button>
  `;
}

function menuItem(label, action, guestId, disabled = false) {
  return `
    <button class="guest-menu__item ${disabled ? "is-disabled" : ""}" type="button" role="menuitem" data-action="${escapeAttribute(action)}" data-guest-id="${escapeAttribute(guestId)}" ${disabled ? 'aria-disabled="true"' : ""}>
      ${escapeHtml(label)}
    </button>
  `;
}

function renderGuestActionMenu(guest, trigger) {
  const reminderLink = buildWhatsAppReminderLink(guest);
  const menu = document.createElement("div");
  menu.className = "guest-menu";
  menu.id = "guestActionMenu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", `Actions for ${guest.fullName || "guest"}`);
  menu.innerHTML = `
    ${menuItem("Edit guest", "edit-guest", guest.id)}
    ${menuItem("Mark confirmed", "mark-confirmed", guest.id)}
    ${menuItem("Mark pending", "mark-pending", guest.id)}
    ${menuItem("Mark declined", "mark-declined", guest.id)}
    ${menuItem("WhatsApp reminder", "open-reminder", guest.id, !reminderLink)}
    ${menuItem("Copy invitation link", "copy-guest-invite", guest.id)}
    ${menuItem("Copy QR link", "copy-guest-qr", guest.id)}
    ${menuItem("Mark checked in", "toggle-checkin", guest.id, !can("canCheckIn"))}
    ${menuItem("Delete guest", "delete-guest", guest.id, !can("canEditGuests"))}
  `;
  document.body.appendChild(menu);
  positionGuestMenu(menu, trigger);
  state.activeGuestMenu = { guestId: guest.id, element: menu };
  state.lastGuestMenuTrigger = trigger;
  trigger.setAttribute("aria-expanded", "true");
  menu.querySelector(".guest-menu__item:not(.is-disabled)")?.focus();
}

function positionGuestMenu(menu, trigger) {
  const triggerRect = trigger.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const gutter = 10;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const openUp = triggerRect.bottom + gutter + menuRect.height > viewportHeight && triggerRect.top > menuRect.height + gutter;
  const top = openUp ? triggerRect.top - menuRect.height - gutter : triggerRect.bottom + gutter;
  const left = Math.min(Math.max(gutter, triggerRect.right - menuRect.width), viewportWidth - menuRect.width - gutter);

  menu.style.top = `${Math.max(gutter, top)}px`;
  menu.style.left = `${left}px`;
}

function closeGuestMenu(options = {}) {
  const { restoreFocus = true } = options;
  state.activeGuestMenu?.element?.remove();
  document.querySelectorAll(".guest-row__menu-toggle[aria-expanded='true']").forEach((button) => {
    button.setAttribute("aria-expanded", "false");
  });
  if (restoreFocus && state.lastGuestMenuTrigger?.isConnected) {
    state.lastGuestMenuTrigger.focus();
  }
  state.activeGuestMenu = null;
  state.lastGuestMenuTrigger = null;
}

function handleGuestMenuKeyboard(event) {
  const items = [...(state.activeGuestMenu?.element?.querySelectorAll(".guest-menu__item:not(.is-disabled)") || [])];
  if (!items.length) {
    return;
  }
  event.preventDefault();
  const currentIndex = Math.max(0, items.indexOf(document.activeElement));
  const nextIndex = (() => {
    switch (event.key) {
      case "ArrowUp":
        return currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
      case "Home":
        return 0;
      case "End":
        return items.length - 1;
      case "ArrowDown":
      default:
        return currentIndex >= items.length - 1 ? 0 : currentIndex + 1;
    }
  })();
  items[nextIndex]?.focus();
}

function selectInput(key, value, options) {
  return `
    <select class="da3wa-input" data-guest-filter="${escapeAttribute(key)}">
      ${options
        .map(
          ([optionValue, label]) => `
            <option value="${escapeAttribute(optionValue)}" ${optionValue === value ? "selected" : ""}>${escapeHtml(label)}</option>
          `
        )
        .join("")}
    </select>
  `;
}

function badge(label, tone) {
  return `<span class="guest-badge guest-badge--${escapeAttribute(String(tone).toLowerCase().replace(/\s+/g, "-"))}">${escapeHtml(label)}</span>`;
}

async function handleAction(action, dataset) {
  switch (action) {
    case "open-add-guest":
      await openGuestModal();
      return;
    case "open-add-table":
      openTableModal();
      return;
    case "refresh-dashboard":
      if (state.mode === "live") {
        await bootstrapDashboard();
      } else {
        renderAll();
      }
      showToast("Dashboard refreshed.", "success");
      return;
    case "nav-seating":
      switchView("seating");
      return;
    case "open-checkin":
      window.open(new URL(`checkin.html?wedding=${encodeURIComponent(state.weddingId)}`, window.location.href).toString(), "_blank", "noopener");
      return;
    case "open-dashboard":
      window.open(new URL(`dashboard.html?wedding=${encodeURIComponent(state.weddingId)}`, window.location.href).toString(), "_blank", "noopener");
      return;
    case "open-invitation-preview": {
      const guest = state.guests[0];
      const url = guest?.inviteLink || buildInviteLink(guest?.guestToken || "{guestToken}");
      window.open(url, "_blank", "noopener");
      return;
    }
    case "copy-invitation-base":
      await copyText(new URL(`index.html?wedding=${encodeURIComponent(state.weddingId)}&guest={guestToken}`, window.location.href).toString());
      return;
    case "copy-dashboard":
      await copyText(new URL(`dashboard.html?wedding=${encodeURIComponent(state.weddingId)}`, window.location.href).toString());
      return;
    case "copy-checkin":
      await copyText(new URL(`checkin.html?wedding=${encodeURIComponent(state.weddingId)}`, window.location.href).toString());
      return;
    case "copy-preview": {
      const guest = state.guests[0];
      await copyText(guest?.inviteLink || buildInviteLink(guest?.guestToken || "{guestToken}"));
      return;
    }
    case "export-all":
      await handleExport("all");
      return;
    case "export-confirmed":
      await handleExport("confirmed");
      return;
    case "export-pending":
      await handleExport("pending");
      return;
    case "export-declined":
      await handleExport("declined");
      return;
    case "export-checkedIn":
      await handleExport("checkedIn");
      return;
    case "export-notCheckedIn":
      await handleExport("notCheckedIn");
      return;
    case "export-tables":
      await handleExport("tables");
      return;
    case "export-bride":
      await handleExport("bride");
      return;
    case "export-groom":
      await handleExport("groom");
      return;
    case "bulk-export":
      await handleExport("selected");
      return;
    case "bulk-rsvp-confirmed":
      await updateBulkRsvp("confirmed");
      return;
    case "bulk-rsvp-pending":
      await updateBulkRsvp("pending");
      return;
    case "edit-guest":
      await openGuestModal(state.guests.find((item) => item.id === dataset.id || item.id === dataset.guestId));
      return;
    case "delete-guest":
      await confirmDeleteGuest(dataset.guestId);
      return;
    case "mark-confirmed":
      await updateGuest(dataset.guestId, { rsvpStatus: "confirmed", updatedAt: serverTimestamp() });
      return;
    case "mark-pending":
      await updateGuest(dataset.guestId, { rsvpStatus: "pending", updatedAt: serverTimestamp() });
      return;
    case "mark-declined":
      await updateGuest(dataset.guestId, { rsvpStatus: "declined", updatedAt: serverTimestamp() });
      return;
    case "copy-guest-invite": {
      const guest = state.guests.find((item) => item.id === dataset.id || item.id === dataset.guestId);
      if (guest) {
        await copyText(guest.inviteLink || buildInviteLink(guest.guestToken));
      }
      return;
    }
    case "copy-guest-qr": {
      const guest = state.guests.find((item) => item.id === dataset.guestId);
      if (guest) {
        await copyText(guest.qrCodeValue || buildCheckinLink(guest.guestToken));
      }
      return;
    }
    case "open-reminder": {
      const guest = state.guests.find((item) => item.id === dataset.guestId);
      const url = buildWhatsAppReminderLink(guest);
      if (!url) {
        showToast("This guest does not have a valid phone number yet.", "error");
        return;
      }
      if (state.mode === "live") {
        await updateDoc(doc(state.services.db, "weddings", state.weddingId, "guests", guest.id), {
          reminderSentAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        guest.reminderSentAt = new Date().toLocaleString();
      }
      window.open(url, "_blank", "noopener");
      showToast("Reminder link opened.", "success");
      return;
    }
    case "toggle-checkin": {
      const guest = state.guests.find((item) => item.id === dataset.guestId);
      if (!guest) {
        return;
      }
      await updateGuest(guest.id, {
        checkedIn: !guest.checkedIn,
        checkedInAt: !guest.checkedIn ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      });
      return;
    }
    case "toggle-guest-menu":
      if (state.activeGuestMenu?.guestId === dataset.guestId) {
        closeGuestMenu();
        return;
      }
      closeGuestMenu({ restoreFocus: false });
      {
        const guest = state.guests.find((item) => item.id === dataset.guestId);
        const trigger = document.getElementById(`guest-menu-trigger-${dataset.guestId}`);
        if (guest && trigger) {
          renderGuestActionMenu(guest, trigger);
        }
      }
      return;
    case "set-seating-mode":
      state.seatingMode = dataset.mode;
      renderActiveView();
      return;
    case "planner-zoom-in":
      setPlannerZoom(state.plannerZoom + 0.1);
      return;
    case "planner-zoom-out":
      setPlannerZoom(state.plannerZoom - 0.1);
      return;
    case "planner-fit":
      setPlannerZoom(1);
      return;
    case "planner-auto-arrange":
      await handleAutoArrange();
      return;
    case "add-hall-object":
      addHallObject();
      return;
    case "select-table":
      state.selectedTableId = dataset.tableId;
      renderActiveView();
      return;
    case "edit-table":
      openTableModal(getSelectedTable());
      return;
    case "duplicate-table": {
      const table = state.tables.find((item) => item.id === dataset.id);
      if (table) {
        await duplicateTable(table);
      }
      return;
    }
    case "delete-table":
      await confirmDeleteTable(dataset.id);
      return;
    case "select-seat":
      state.selectedTableId = dataset.tableId;
      state.selectedSeatId = buildSeatKey(dataset.tableId, dataset.chairId);
      if (state.seatingMode === "layout") {
        state.seatingMode = "assignment";
      }
      renderActiveView();
      return;
    case "assign-seat":
      await assignGuestToChair(dataset.tableId, dataset.chairId, dataset.guestId);
      return;
    case "clear-seat": {
      const [tableId, chairId] = String(dataset.id || "").split("::");
      await assignGuestToChair(tableId, chairId, "");
      return;
    }
    default:
      return;
  }
}

function calculateDashboardStats(guests, tables) {
  const totalSeats = tables.reduce((sum, table) => sum + Number(table.seatCount || table.capacity || 0), 0);
  const seatedGuests = guests.filter((guest) => guest.tableId).length;
  const withoutSeat = guests.filter((guest) => guest.rsvpStatus === "confirmed" && !guest.tableId).length;
  const total = guests.length;
  const confirmed = guests.filter((guest) => guest.rsvpStatus === "confirmed").length;
  const pending = guests.filter((guest) => guest.rsvpStatus === "pending").length;
  const declined = guests.filter((guest) => guest.rsvpStatus === "declined").length;
  const checkedIn = guests.filter((guest) => guest.checkedIn).length;
  return {
    total,
    confirmed,
    pending,
    declined,
    checkedIn,
    notCheckedIn: guests.filter((guest) => !guest.checkedIn).length,
    totalSeats,
    seatedGuests,
    unassignedGuests: guests.filter((guest) => !guest.tableId).length,
    remainingSeats: Math.max(0, totalSeats - seatedGuests),
    withoutSeat,
    confirmedPct: percentage(confirmed, total),
    pendingPct: percentage(pending, total),
    declinedPct: percentage(declined, total),
    checkinPct: percentage(checkedIn, total),
    withoutSeatPct: percentage(withoutSeat, Math.max(confirmed, 1)),
  };
}

function calculateAttention(guests, tables) {
  const confirmedWithoutTables = guests.filter((guest) => guest.rsvpStatus === "confirmed" && !guest.tableId).length;
  const pendingGuests = guests.filter((guest) => guest.rsvpStatus === "pending").length;
  const incompleteInfo = guests.filter((guest) => !guest.phone || !guest.fullName).length;
  const overCapacity = tables.filter((table) => getTableGuests(table.id).length > Number(table.seatCount || table.capacity || 0)).length;
  const conflicts = guests.filter((guest) => guest.rsvpStatus === "declined" && guest.tableId).length;

  return [
    {
      title: `${confirmedWithoutTables} confirmed guest${confirmedWithoutTables === 1 ? "" : "s"} without tables`,
      description: "These guests accepted but still need a final placement.",
    },
    {
      title: `${pendingGuests} pending RSVP${pendingGuests === 1 ? "" : "s"}`,
      description: "Useful for reminder follow-up and late seating decisions.",
    },
    {
      title: `${overCapacity} table${overCapacity === 1 ? "" : "s"} over capacity`,
      description: "Check manual edits or seat conflicts that exceed the available chairs.",
    },
    {
      title: `${incompleteInfo} guest profile${incompleteInfo === 1 ? "" : "s"} incomplete`,
      description: "Phone or profile details are missing and may block reminders or coordination.",
    },
    {
      title: `${conflicts} declined guest${conflicts === 1 ? "" : "s"} still seated`,
      description: "Useful conflict warning before finalizing the floor plan.",
    },
  ];
}

function deriveRecentActivity(guests) {
  const items = [];
  guests.forEach((guest) => {
    if (guest.checkedInAt) {
      items.push({
        type: "checkin",
        sortKey: toTimeValue(guest.checkedInAt),
        title: `${guest.fullName || "Guest"} checked in`,
        subtitle: formatTimestamp(guest.checkedInAt),
      });
    }
    if (guest.updatedAt && guest.rsvpStatus) {
      items.push({
        type: "rsvp",
        sortKey: toTimeValue(guest.updatedAt),
        title: `${guest.fullName || "Guest"} RSVP is ${guest.rsvpStatus}`,
        subtitle: `Updated ${formatTimestamp(guest.updatedAt)}`,
      });
    }
    if (guest.createdAt) {
      items.push({
        type: "guest",
        sortKey: toTimeValue(guest.createdAt),
        title: `${guest.fullName || "Guest"} added to the event`,
        subtitle: formatTimestamp(guest.createdAt),
      });
    }
    if (guest.reminderSentAt) {
      items.push({
        type: "reminder",
        sortKey: toTimeValue(guest.reminderSentAt),
        title: `Reminder prepared for ${guest.fullName || "guest"}`,
        subtitle: formatTimestamp(guest.reminderSentAt),
      });
    }
  });
  return items
    .sort((a, b) => b.sortKey - a.sortKey)
    .slice(0, 6);
}

function calculateSideDistribution(guests) {
  const bride = guests.filter((guest) => guest.side === "bride").length;
  const groom = guests.filter((guest) => guest.side === "groom").length;
  const other = guests.filter((guest) => !["bride", "groom"].includes(guest.side)).length;
  const total = Math.max(guests.length, 1);
  return {
    bride,
    groom,
    other,
    bridePct: percentage(bride, total),
    groomPct: percentage(groom, total),
    otherPct: percentage(other, total),
  };
}

function getFilteredGuests() {
  const search = state.guestFilters.search.trim().toLowerCase();
  const sorted = [...state.guests].filter((guest) => {
    const matchesSearch =
      !search ||
      [guest.fullName, guest.fullNameAr, guest.phone].some((value) => String(value || "").toLowerCase().includes(search));
    if (!matchesSearch) {
      return false;
    }
    if (state.guestFilters.rsvp !== "all" && guest.rsvpStatus !== state.guestFilters.rsvp) {
      return false;
    }
    if (state.guestFilters.side !== "all" && guest.side !== state.guestFilters.side) {
      return false;
    }
    return true;
  });

  sorted.sort((a, b) => String(a.fullName || "").localeCompare(String(b.fullName || ""), undefined, { sensitivity: "base" }));

  return sorted;
}

function normalizeAdditionalGuests(value) {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue >= 0 ? numberValue : 0;
}

function parseAdditionalGuests(value) {
  const trimmed = String(value ?? "").trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function toggleGuestSelection(guestId, checked) {
  const next = new Set(state.selectedGuestIds);
  if (checked) {
    next.add(guestId);
  } else {
    next.delete(guestId);
  }
  state.selectedGuestIds = [...next];
}

function toggleAllVisibleGuests(checked) {
  const visibleGuestIds = getFilteredGuests().map((guest) => guest.id);
  const next = new Set(state.selectedGuestIds);
  visibleGuestIds.forEach((guestId) => {
    if (checked) {
      next.add(guestId);
    } else {
      next.delete(guestId);
    }
  });
  state.selectedGuestIds = [...next];
}

function allVisibleGuestsSelected(guests) {
  return Boolean(guests.length) && guests.every((guest) => state.selectedGuestIds.includes(guest.id));
}

async function updateBulkRsvp(status) {
  if (!can("canEditGuests")) {
    showToast("Your role does not allow guest editing.", "error");
    return;
  }

  const ids = [...state.selectedGuestIds];
  if (!ids.length) {
    return;
  }

  if (state.mode === "demo") {
    state.guests = state.guests.map((guest) =>
      ids.includes(guest.id) ? { ...guest, rsvpStatus: status, updatedAt: new Date().toLocaleString() } : guest
    );
    renderAll();
    showToast("Selected guests updated.", "success");
    return;
  }

  try {
    const batch = writeBatch(state.services.db);
    ids.forEach((guestId) => {
      batch.update(doc(state.services.db, "weddings", state.weddingId, "guests", guestId), {
        rsvpStatus: status,
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
    showToast("Selected guests updated.", "success");
  } catch (error) {
    console.error(error);
    showToast("Bulk update failed.", "error");
  }
}

async function openGuestModal(guest = null) {
  if (!can("canEditGuests")) {
    showToast("Your role does not allow guest editing.", "error");
    return;
  }

  state.selectedGuestId = guest?.id || "";
  state.dirtyGuestForm = false;
  elements.guestModalTitle.textContent = guest ? "Edit Guest" : "Add Guest";
  elements.guestDeleteButton.hidden = !guest;
  elements.guestForm.reset();
  elements.guestForm.fullName.value = guest?.fullName || "";
  elements.guestForm.phone.value = guest?.phone || "";
  elements.guestForm.side.value = guest?.side || "bride";
  elements.guestForm.additionalGuests.value = String(normalizeAdditionalGuests(guest?.additionalGuests));
  document.body.classList.add("is-modal-open");
  elements.guestModal.showModal();
  requestAnimationFrame(() => elements.guestForm.fullName.focus());
}

async function saveGuest(event) {
  event.preventDefault();
  if (!can("canEditGuests")) {
    showToast("Your role does not allow guest editing.", "error");
    return;
  }
  const guestId = state.selectedGuestId;
  const existingGuest = guestId ? state.guests.find((item) => item.id === guestId) : null;
  const token = existingGuest?.guestToken || generateGuestToken();
  const fullName = elements.guestForm.fullName.value.trim();
  if (!fullName) {
    elements.guestForm.fullName.setCustomValidity("Enter the guest's full name.");
    elements.guestForm.reportValidity();
    return;
  }
  elements.guestForm.fullName.setCustomValidity("");
  const additionalGuests = parseAdditionalGuests(elements.guestForm.additionalGuests.value);
  if (additionalGuests === null) {
    elements.guestForm.additionalGuests.setCustomValidity("Enter a whole number of 0 or more.");
    elements.guestForm.reportValidity();
    return;
  }
  elements.guestForm.additionalGuests.setCustomValidity("");

  const ownedPayload = {
    fullName,
    phone: elements.guestForm.phone.value.trim(),
    side: elements.guestForm.side.value,
    additionalGuests,
    updatedAt: serverTimestamp(),
  };
  const createPayload = {
    ...ownedPayload,
    fullNameAr: "",
    rsvpStatus: "pending",
    guestToken: token,
    inviteLink: buildInviteLink(token),
    tableId: "",
    tableName: "",
    seatNumber: "",
    qrCodeValue: buildCheckinLink(token),
    checkedIn: false,
    checkedInAt: null,
    notes: "",
    inviteSentAt: null,
    reminderSentAt: null,
  };

  if (state.mode === "demo") {
    const demoPayload = materializeDemoPayload(guestId ? ownedPayload : createPayload, existingGuest);
    if (guestId) {
      state.guests = state.guests.map((guest) => (guest.id === guestId ? { ...guest, ...demoPayload } : guest));
    } else {
      state.guests = [
        ...state.guests,
        {
          id: createId("guest"),
          ...demoPayload,
          createdAt: demoNow(),
        },
      ];
    }
    state.dirtyGuestForm = false;
    elements.guestModal.close();
    state.tables = hydrateTables(state.tables);
    renderAll();
    showToast("Guest saved successfully.", "success");
    return;
  }

  try {
    if (guestId) {
      await updateDoc(doc(state.services.db, "weddings", state.weddingId, "guests", guestId), ownedPayload);
    } else {
      await addDoc(collection(state.services.db, "weddings", state.weddingId, "guests"), {
        ...createPayload,
        createdAt: serverTimestamp(),
      });
    }
    state.dirtyGuestForm = false;
    elements.guestModal.close();
    await syncTablesAndGuests();
    showToast("Guest saved successfully.", "success");
  } catch (error) {
    console.error(error);
    showToast("We could not save this guest.", "error");
  }
}

async function confirmDeleteGuest(guestId) {
  const guest = state.guests.find((item) => item.id === guestId);
  if (!guest) {
    return;
  }
  const confirmed = window.confirm(`Delete ${guest.fullName}? This cannot be undone.`);
  if (!confirmed) {
    return;
  }
  await deleteGuest(guestId);
}

async function updateGuest(guestId, payload) {
  if (state.mode === "demo") {
    const existingGuest = state.guests.find((guest) => guest.id === guestId);
    const demoPayload = materializeDemoPayload(payload, existingGuest);
    state.guests = state.guests.map((guest) => (guest.id === guestId ? { ...guest, ...demoPayload } : guest));
    renderAll();
    showToast("Guest updated.", "success");
    return;
  }
  if (!can("canEditGuests") && !("checkedIn" in payload && can("canCheckIn"))) {
    showToast("Your role does not allow guest editing.", "error");
    return;
  }

  try {
    await updateDoc(doc(state.services.db, "weddings", state.weddingId, "guests", guestId), payload);
    await syncTablesAndGuests();
    showToast("Guest updated.", "success");
  } catch (error) {
    console.error(error);
    showToast("Guest update failed.", "error");
  }
}

async function deleteGuest(guestId) {
  if (!can("canEditGuests")) {
    showToast("Your role does not allow guest deletion.", "error");
    return;
  }

  if (state.mode === "demo") {
    state.guests = state.guests.filter((guest) => guest.id !== guestId);
    state.tables = hydrateTables(
      state.tables.map((table) => ({
        ...table,
        chairs: table.chairs.map((chair) => ({
          ...chair,
          guestId: chair.guestId === guestId ? "" : chair.guestId,
          status: chair.guestId === guestId ? "available" : chair.status,
        })),
      }))
    );
    renderAll();
    showToast("Guest deleted.", "success");
    return;
  }

  try {
    await deleteDoc(doc(state.services.db, "weddings", state.weddingId, "guests", guestId));
    await syncTablesAndGuests();
    showToast("Guest deleted.", "success");
  } catch (error) {
    console.error(error);
    showToast("Guest deletion failed.", "error");
  }
}

function openTableModal(table = null) {
  if (!can("canEditSeating")) {
    showToast("Your role does not allow seating edits.", "error");
    return;
  }

  state.selectedTableId = table?.id || "";
  state.dirtyTableForm = false;
  elements.tableModalTitle.textContent = table ? "Edit Table" : "Create Table";
  elements.tableForm.reset();
  elements.tableForm.name.value = table?.name || "";
  elements.tableForm.label.value = table?.label || "";
  elements.tableForm.capacity.value = table?.capacity || table?.seatCount || 8;
  elements.tableForm.shape.value = table?.shape || "round";
  elements.tableForm.seatCount.value = table?.seatCount || table?.capacity || 8;
  elements.tableForm.floorZone.value = table?.floorZone || "";
  elements.tableForm.tableColor.value = table?.tableColor || plannerPalette.tableColor;
  elements.tableForm.borderColor.value = table?.borderColor || plannerPalette.borderColor;
  elements.tableForm.chairColor.value = table?.chairColor || plannerPalette.chairColor;
  elements.tableForm.width.value = table?.width || defaultWidthForShape(table?.shape);
  elements.tableForm.height.value = table?.height || defaultHeightForShape(table?.shape);
  elements.tableForm.x.value = table?.x ?? 20;
  elements.tableForm.y.value = table?.y ?? 20;
  document.body.classList.add("is-modal-open");
  elements.tableModal.showModal();
}

async function saveTable(event) {
  event.preventDefault();
  if (!can("canEditSeating")) {
    showToast("Your role does not allow seating edits.", "error");
    return;
  }

  const payload = createPlannerTable({
    id: state.selectedTableId || createId("table"),
    name: elements.tableForm.name.value.trim(),
    label: elements.tableForm.label.value.trim(),
    capacity: Number(elements.tableForm.capacity.value || 0),
    seatCount: Number(elements.tableForm.seatCount.value || elements.tableForm.capacity.value || 0),
    shape: elements.tableForm.shape.value,
    floorZone: elements.tableForm.floorZone.value.trim(),
    tableColor: elements.tableForm.tableColor.value,
    borderColor: elements.tableForm.borderColor.value,
    chairColor: elements.tableForm.chairColor.value,
    width: Number(elements.tableForm.width.value || 180),
    height: Number(elements.tableForm.height.value || 180),
    x: Number(elements.tableForm.x.value || 0),
    y: Number(elements.tableForm.y.value || 0),
    chairs: state.tables.find((table) => table.id === state.selectedTableId)?.chairs || [],
  });

  if (state.mode === "demo") {
    if (state.selectedTableId) {
      state.tables = state.tables.map((table) => (table.id === state.selectedTableId ? payload : table));
    } else {
      state.tables = [...state.tables, payload];
    }
    state.tables = hydrateTables(state.tables);
    state.selectedTableId = payload.id;
    state.dirtyTableForm = false;
    elements.tableModal.close();
    renderAll();
    showToast("Table saved successfully.", "success");
    return;
  }

  try {
    if (state.selectedTableId) {
      await updateDoc(doc(state.services.db, "weddings", state.weddingId, "tables", state.selectedTableId), {
        ...payload,
        updatedAt: serverTimestamp(),
      });
    } else {
      await addDoc(collection(state.services.db, "weddings", state.weddingId, "tables"), {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    state.dirtyTableForm = false;
    elements.tableModal.close();
    showToast("Table saved successfully.", "success");
  } catch (error) {
    console.error(error);
    showToast("We could not save this table.", "error");
  }
}

async function duplicateTable(table) {
  if (!can("canEditSeating")) {
    showToast("Your role does not allow seating edits.", "error");
    return;
  }

  const duplicated = createPlannerTable({
    ...table,
    id: createId("table"),
    name: `${table.name} Copy`,
    label: `${table.label || table.name} Copy`,
    x: Number(table.x || 20) + 6,
    y: Number(table.y || 20) + 6,
    chairs: table.chairs.map((chair) => ({
      ...chair,
      id: createId("chair"),
      guestId: "",
      status: "available",
    })),
  });

  if (state.mode === "demo") {
    state.tables = [...state.tables, duplicated];
    renderAll();
    showToast("Table duplicated.", "success");
    return;
  }

  try {
    await addDoc(collection(state.services.db, "weddings", state.weddingId, "tables"), {
      ...duplicated,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    showToast("Table duplicated.", "success");
  } catch (error) {
    console.error(error);
    showToast("Table duplication failed.", "error");
  }
}

async function confirmDeleteTable(tableId) {
  const table = state.tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }
  const confirmed = window.confirm(`Delete ${table.name}? Assigned guests will become unassigned.`);
  if (!confirmed) {
    return;
  }
  await deleteTable(tableId);
}

async function deleteTable(tableId) {
  if (!can("canEditSeating")) {
    showToast("Your role does not allow seating edits.", "error");
    return;
  }

  if (state.mode === "demo") {
    state.guests = state.guests.map((guest) =>
      guest.tableId === tableId ? { ...guest, tableId: "", tableName: "", seatNumber: "" } : guest
    );
    state.tables = state.tables.filter((table) => table.id !== tableId);
    state.selectedTableId = state.tables[0]?.id || "";
    state.selectedSeatId = "";
    renderAll();
    showToast("Table deleted.", "success");
    return;
  }

  try {
    const batch = writeBatch(state.services.db);
    batch.delete(doc(state.services.db, "weddings", state.weddingId, "tables", tableId));
    state.guests
      .filter((guest) => guest.tableId === tableId)
      .forEach((guest) => {
        batch.update(doc(state.services.db, "weddings", state.weddingId, "guests", guest.id), {
          tableId: "",
          tableName: "",
          seatNumber: "",
          updatedAt: serverTimestamp(),
        });
      });
    await batch.commit();
    showToast("Table deleted.", "success");
  } catch (error) {
    console.error(error);
    showToast("Table deletion failed.", "error");
  }
}

async function handleAutoArrange() {
  if (!state.tables.length) {
    return;
  }
  const arranged = state.tables.map((table, index) => ({
    ...table,
    x: 20 + (index % 3) * 28,
    y: 24 + Math.floor(index / 3) * 28,
  }));

  if (state.mode === "demo") {
    state.tables = arranged;
    renderAll();
    showToast("Tables arranged into a ballroom grid.", "success");
    return;
  }

  setSaveState("saving");
  try {
    const batch = writeBatch(state.services.db);
    arranged.forEach((table) => {
      batch.update(doc(state.services.db, "weddings", state.weddingId, "tables", table.id), {
        x: table.x,
        y: table.y,
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
    setSaveState("saved");
    showToast("Tables arranged into a ballroom grid.", "success");
  } catch (error) {
    console.error(error);
    setSaveState("saved");
    showToast("Auto arrange failed.", "error");
  }
}

function setPlannerZoom(nextZoom) {
  state.plannerZoom = clamp(nextZoom, 0.7, 1.45);
  renderActiveView();
}

function addHallObject() {
  const types = [
    ["stage", "Stage"],
    ["entrance", "Entrance"],
    ["dance-floor", "Dance floor"],
    ["aisle", "Aisle"],
    ["buffet", "Buffet"],
    ["dj", "DJ"],
    ["photo-area", "Photo area"],
    ["divider", "Divider"],
    ["text-label", "Label"],
  ];
  const [type, label] = types[state.hallObjects.length % types.length];
  state.hallObjects = [
    ...state.hallObjects,
    {
      id: createId("object"),
      type,
      label,
      x: 16 + (state.hallObjects.length % 4) * 18,
      y: 18 + (state.hallObjects.length % 3) * 18,
    },
  ];
  renderActiveView();
  showToast("Local hall object added. Persistence can be layered in later.", "info");
}

function handlePlannerPointerDown(event) {
  if (state.seatingMode !== "layout") {
    return;
  }
  const tableNode = event.target.closest("[data-table-drag-id]");
  const seatNode = event.target.closest("[data-action='select-seat']");
  if (!tableNode || seatNode) {
    return;
  }

  const tableId = tableNode.dataset.tableDragId;
  const table = state.tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }

  state.selectedTableId = tableId;
  state.dragState = {
    tableId,
    startX: event.clientX,
    startY: event.clientY,
    originalX: Number(table.x || 0),
    originalY: Number(table.y || 0),
  };
  tableNode.setPointerCapture?.(event.pointerId);
}

function handlePlannerPointerMove(event) {
  if (!state.dragState) {
    return;
  }

  const canvas = document.getElementById("plannerCanvas");
  if (!canvas) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const dx = ((event.clientX - state.dragState.startX) / rect.width) * 100;
  const dy = ((event.clientY - state.dragState.startY) / rect.height) * 100;
  const nextX = clamp(state.dragState.originalX + dx, 8, 92);
  const nextY = clamp(state.dragState.originalY + dy, 12, 88);
  state.tables = state.tables.map((table) =>
    table.id === state.dragState.tableId ? { ...table, x: nextX, y: nextY } : table
  );
  renderActiveView();
}

async function handlePlannerPointerUp() {
  if (!state.dragState) {
    return;
  }

  const { tableId } = state.dragState;
  state.dragState = null;

  if (state.mode === "demo") {
    return;
  }

  const table = state.tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }

  setSaveState("saving");
  try {
    await updateDoc(doc(state.services.db, "weddings", state.weddingId, "tables", tableId), {
      x: table.x,
      y: table.y,
      updatedAt: serverTimestamp(),
    });
    setSaveState("saved");
  } catch (error) {
    console.error(error);
    setSaveState("saved");
    showToast("Table move could not be saved.", "error");
  }
}

async function assignGuestToChair(tableId, chairId, guestId) {
  if (!can("canEditSeating")) {
    showToast("Your role does not allow seating edits.", "error");
    return;
  }

  const table = state.tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }

  const targetChair = table.chairs.find((chair) => chair.id === chairId);
  if (!targetChair) {
    return;
  }

  const guest = guestId ? state.guests.find((item) => item.id === guestId) : null;
  if (guest?.rsvpStatus === "declined") {
    showToast("Declined guest assignment noted. Review before finalizing the floor plan.", "info");
  }
  if (guest?.rsvpStatus === "pending") {
    showToast("Pending RSVP guest seated. Consider confirming attendance.", "info");
  }

  const previousGuestId = targetChair.guestId || "";
  const sourceSeat = guestId ? findGuestSeat(guestId) : null;

  const nextTables = state.tables.map((item) => ({
    ...item,
    chairs: item.chairs.map((chair) => {
      if (item.id === tableId && chair.id === chairId) {
        return { ...chair, guestId, status: guestId ? "assigned" : "available" };
      }
      if (sourceSeat && item.id === sourceSeat.tableId && chair.id === sourceSeat.chairId) {
        return { ...chair, guestId: previousGuestId, status: previousGuestId ? "assigned" : "available" };
      }
      return chair;
    }),
  }));

  const nextGuests = state.guests.map((item) => {
    if (item.id === guestId) {
      return {
        ...item,
        tableId,
        tableName: table.name,
        seatNumber: String(targetChair.seatNumber),
      };
    }
    if (item.id === previousGuestId) {
      if (sourceSeat) {
        const sourceTable = state.tables.find((row) => row.id === sourceSeat.tableId);
        const sourceChair = sourceTable?.chairs.find((chair) => chair.id === sourceSeat.chairId);
        return {
          ...item,
          tableId: sourceSeat.tableId,
          tableName: sourceTable?.name || "",
          seatNumber: String(sourceChair?.seatNumber || ""),
        };
      }
      return { ...item, tableId: "", tableName: "", seatNumber: "" };
    }
    if (!guestId && item.id === previousGuestId) {
      return { ...item, tableId: "", tableName: "", seatNumber: "" };
    }
    return item;
  });

  state.tables = hydrateTables(nextTables);
  state.guests = nextGuests;
  renderAll();

  if (state.mode === "demo") {
    showToast(guestId ? "Guest assigned to seat." : "Seat cleared.", "success");
    return;
  }

  setSaveState("saving");
  try {
    const batch = writeBatch(state.services.db);
    nextTables.forEach((item) => {
      batch.update(doc(state.services.db, "weddings", state.weddingId, "tables", item.id), {
        chairs: item.chairs,
        guestIds: item.chairs.filter((chair) => chair.guestId).map((chair) => chair.guestId),
        updatedAt: serverTimestamp(),
      });
    });

    if (guestId) {
      batch.update(doc(state.services.db, "weddings", state.weddingId, "guests", guestId), {
        tableId,
        tableName: table.name,
        seatNumber: String(targetChair.seatNumber),
        updatedAt: serverTimestamp(),
      });
    }

    if (previousGuestId) {
      if (sourceSeat) {
        const sourceTable = nextTables.find((item) => item.id === sourceSeat.tableId);
        const sourceChair = sourceTable?.chairs.find((chair) => chair.id === sourceSeat.chairId);
        batch.update(doc(state.services.db, "weddings", state.weddingId, "guests", previousGuestId), {
          tableId: sourceSeat.tableId,
          tableName: sourceTable?.name || "",
          seatNumber: String(sourceChair?.seatNumber || ""),
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.update(doc(state.services.db, "weddings", state.weddingId, "guests", previousGuestId), {
          tableId: "",
          tableName: "",
          seatNumber: "",
          updatedAt: serverTimestamp(),
        });
      }
    }

    await batch.commit();
    setSaveState("saved");
    showToast(guestId ? "Guest assigned to seat." : "Seat cleared.", "success");
  } catch (error) {
    console.error(error);
    setSaveState("saved");
    showToast("Seat assignment failed.", "error");
  }
}

async function syncTablesAndGuests() {
  if (state.mode === "demo") {
    state.tables = hydrateTables(state.tables);
    renderAll();
    return;
  }

  if (!state.tables.length) {
    return;
  }

  const nextTables = hydrateTables(state.tables.map((table) => ({ ...table })));
  const batch = writeBatch(state.services.db);
  nextTables.forEach((table) => {
    batch.update(doc(state.services.db, "weddings", state.weddingId, "tables", table.id), {
      chairs: table.chairs,
      guestIds: state.guests.filter((guest) => guest.tableId === table.id).map((guest) => guest.id),
      updatedAt: serverTimestamp(),
    });
  });
  await batch.commit();
}

async function handleExport(type) {
  const filtered = (() => {
    switch (type) {
      case "confirmed":
        return state.guests.filter((guest) => guest.rsvpStatus === "confirmed");
      case "pending":
        return state.guests.filter((guest) => guest.rsvpStatus === "pending");
      case "declined":
        return state.guests.filter((guest) => guest.rsvpStatus === "declined");
      case "checkedIn":
        return state.guests.filter((guest) => guest.checkedIn);
      case "notCheckedIn":
        return state.guests.filter((guest) => !guest.checkedIn);
      case "tables":
        return [...state.guests].sort((a, b) => String(a.tableName || "").localeCompare(String(b.tableName || "")));
      case "bride":
        return state.guests.filter((guest) => guest.side === "bride");
      case "groom":
        return state.guests.filter((guest) => guest.side === "groom");
      case "selected":
        return state.guests.filter((guest) => state.selectedGuestIds.includes(guest.id));
      case "all":
      default:
        return state.guests;
    }
  })();

  const format = await exportGuests(
    filtered.map((guest) => ({
      ...guest,
      checkedInAt: formatTimestamp(guest.checkedInAt),
    })),
    `guests-${type || "all"}`,
    { includeSeating: type === "tables" }
  );
  showToast(`Guest export completed as ${format.toUpperCase()}.`, "success");
}

function hydrateTables(tables) {
  return tables.map((table) => {
    const next = createPlannerTable(table);
    next.chairs = next.chairs.map((chair) => {
      const matchingGuest = state.guests.find(
        (guest) => guest.tableId === next.id && String(guest.seatNumber || "") === String(chair.seatNumber)
      );
      return {
        ...chair,
        guestId: matchingGuest?.id || chair.guestId || "",
        status: matchingGuest ? "assigned" : chair.guestId ? "assigned" : chair.status || "available",
      };
    });
    return next;
  });
}

function createPlannerTable(table) {
  const seatCount = Number(table.seatCount || table.capacity || 8);
  const width = Number(table.width || defaultWidthForShape(table.shape));
  const height = Number(table.height || defaultHeightForShape(table.shape));
  const chairs = generateChairs(table.shape || "round", seatCount, width, height, table.chairs || []);

  return {
    id: table.id || createId("table"),
    name: table.name || "New Table",
    label: table.label || table.name || "Table",
    capacity: seatCount,
    seatCount,
    shape: table.shape || "round",
    floorZone: table.floorZone || "Grand Hall",
    x: Number(table.x ?? 20),
    y: Number(table.y ?? 20),
    width,
    height,
    rotation: Number(table.rotation || 0),
    tableColor: table.tableColor || plannerPalette.tableColor,
    borderColor: table.borderColor || plannerPalette.borderColor,
    chairColor: table.chairColor || plannerPalette.chairColor,
    chairs,
    guestIds: table.guestIds || [],
    locked: Boolean(table.locked),
  };
}

function generateChairs(shape, seatCount, width, height, previousChairs) {
  const existing = Array.isArray(previousChairs) ? previousChairs : [];
  const positions = buildChairPositions(shape, seatCount, width, height);
  return positions.map((position, index) => {
    const previous = existing[index] || existing.find((chair) => Number(chair.seatNumber) === index + 1) || {};
    return {
      id: previous.id || createId("chair"),
      seatNumber: index + 1,
      guestId: previous.guestId || "",
      status: previous.status || "available",
      x: position.x,
      y: position.y,
      notes: previous.notes || "",
      vip: Boolean(previous.vip),
    };
  });
}

function buildChairPositions(shape, seatCount) {
  if (shape === "round") {
    return Array.from({ length: seatCount }, (_, index) => {
      const angle = -Math.PI / 2 + (index / seatCount) * Math.PI * 2;
      return {
        x: 50 + Math.cos(angle) * 42,
        y: 50 + Math.sin(angle) * 42,
      };
    });
  }

  if (shape === "horseshoe" || shape === "u-shape" || shape === "open-u") {
    const spread = Math.max(seatCount, 6);
    return Array.from({ length: seatCount }, (_, index) => {
      const angle = Math.PI + (index / Math.max(1, spread - 1)) * Math.PI;
      return {
        x: 50 + Math.cos(angle) * 42,
        y: 58 + Math.sin(angle) * 34,
      };
    });
  }

  const sides = distributePerimeterSeats(seatCount);
  const points = [];
  const pushRange = (count, x1, y1, x2, y2) => {
    for (let i = 0; i < count; i += 1) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      points.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t });
    }
  };
  pushRange(sides.top, 24, 8, 76, 8);
  pushRange(sides.right, 92, 20, 92, 80);
  pushRange(sides.bottom, 76, 92, 24, 92);
  pushRange(sides.left, 8, 80, 8, 20);
  return points.slice(0, seatCount);
}

function distributePerimeterSeats(seatCount) {
  const base = Math.floor(seatCount / 4);
  let remainder = seatCount % 4;
  const result = { top: base, right: base, bottom: base, left: base };
  ["top", "right", "bottom", "left"].forEach((key) => {
    if (remainder > 0) {
      result[key] += 1;
      remainder -= 1;
    }
  });
  Object.keys(result).forEach((key) => {
    result[key] = Math.max(result[key], 1);
  });
  return result;
}

function getTableGuests(tableId) {
  return state.guests.filter((guest) => guest.tableId === tableId);
}

function getSelectedTable() {
  return state.tables.find((item) => item.id === state.selectedTableId) || state.tables[0] || null;
}

function findGuestSeat(guestId) {
  for (const table of state.tables) {
    for (const chair of table.chairs) {
      if (chair.guestId === guestId) {
        return { tableId: table.id, chairId: chair.id };
      }
    }
  }
  return null;
}

function getSelectedSeat() {
  if (!state.selectedSeatId) {
    return null;
  }
  const [tableId, chairId] = state.selectedSeatId.split("::");
  const table = state.tables.find((item) => item.id === tableId);
  const chair = table?.chairs.find((item) => item.id === chairId);
  const guest = chair?.guestId ? state.guests.find((item) => item.id === chair.guestId) : null;
  if (!table || !chair) {
    return null;
  }
  return { table, chair, guest };
}

function getAssignableGuests() {
  return state.guests
    .filter((guest) => !guest.tableId)
    .filter((guest) => {
      if (state.libraryFilters.rsvp === "pending" && guest.rsvpStatus !== "pending") {
        return false;
      }
      if (state.libraryFilters.side !== "all" && guest.side !== state.libraryFilters.side) {
        return false;
      }
      if (state.libraryFilters.vipOnly && !/vip/i.test(guest.notes || "")) {
        return false;
      }
      return true;
    })
    .sort((a, b) => guestPriorityScore(a) - guestPriorityScore(b));
}

function getSeatCandidates(currentGuestId) {
  return [...state.guests]
    .filter((guest) => {
      if (!state.guestAssignmentSearch) {
        return true;
      }
      return [guest.fullName, guest.fullNameAr, guest.phone, guest.side, guest.rsvpStatus]
        .some((value) => String(value || "").toLowerCase().includes(state.guestAssignmentSearch));
    })
    .sort((a, b) => {
      const priority = guestPriorityScore(a) - guestPriorityScore(b);
      if (priority !== 0) {
        return priority;
      }
      if (a.id === currentGuestId) {
        return -1;
      }
      if (b.id === currentGuestId) {
        return 1;
      }
      return String(a.fullName || "").localeCompare(String(b.fullName || ""));
    });
}

function guestPriorityScore(guest) {
  const statusPriority = { confirmed: 0, pending: 1, declined: 2 };
  const seatedPenalty = guest.tableId ? 4 : 0;
  const vipBoost = /vip/i.test(guest.notes || "") ? -1 : 0;
  return (statusPriority[guest.rsvpStatus] ?? 3) + seatedPenalty + vipBoost;
}

function chairStatusClass(chair, guest) {
  if (chair.vip) {
    return "vip";
  }
  if (guest?.rsvpStatus === "declined") {
    return "conflict";
  }
  if (guest?.rsvpStatus === "pending") {
    return "warning";
  }
  if (guest) {
    return "assigned";
  }
  return chair.status || "available";
}

function buildSeatKey(tableId, chairId) {
  return `${tableId}::${chairId}`;
}

function resolveChairColor(status, table) {
  switch (status) {
    case "assigned":
      return "#2E6D61";
    case "vip":
      return "#B89156";
    case "warning":
      return "#BE8741";
    case "conflict":
      return "#B25B54";
    default:
      return table.chairColor || plannerPalette.chairColor;
  }
}

function createHallObjects() {
  return [
    { id: "stage-default", type: "stage", label: "Stage", x: 50, y: 8 },
    { id: "entrance-default", type: "entrance", label: "Entrance", x: 50, y: 90 },
  ];
}

function redirectToLogin(message = "session-required") {
  state.unsubGuests?.();
  state.unsubTables?.();
  window.location.replace(buildLoginUrl(message));
}

async function resolveAccessibleWeddingId(user) {
  const rememberedWeddingId = localStorage.getItem(lastWeddingStorageKey);
  if (rememberedWeddingId && (await canViewWedding(user, rememberedWeddingId))) {
    return rememberedWeddingId;
  }

  const snapshot = await getDocs(query(collection(state.services.db, "weddings"), where("status", "==", "active")));
  for (const weddingDoc of snapshot.docs) {
    if (await canViewWedding(user, weddingDoc.id)) {
      rememberWeddingId(weddingDoc.id);
      return weddingDoc.id;
    }
  }
  return "";
}

async function canViewWedding(user, weddingId) {
  const permissionDoc = await getDoc(doc(state.services.db, "weddings", weddingId, "dashboardUsers", user.uid));
  return permissionDoc.exists() && permissionDoc.data().canViewDashboard;
}

function rememberWeddingId(weddingId) {
  localStorage.setItem(lastWeddingStorageKey, weddingId);
}

function buildLoginUrl(message) {
  const nextParams = new URLSearchParams();
  if (state.weddingId) {
    nextParams.set("wedding", state.weddingId);
  }
  if (state.mode === "demo") {
    nextParams.set("demo", "1");
  }
  if (message) {
    nextParams.set("message", message);
  }
  const query = nextParams.toString();
  return query ? `./dashboard-login.html?${query}` : "./dashboard-login.html";
}

function materializeDemoPayload(payload, existingGuest = null) {
  const next = { ...payload };
  if (next.updatedAt && typeof next.updatedAt === "object") {
    next.updatedAt = demoNow();
  }
  if (next.checkedInAt && typeof next.checkedInAt === "object") {
    next.checkedInAt = demoNow();
  }
  if (!next.inviteSentAt && existingGuest?.inviteSentAt) {
    next.inviteSentAt = existingGuest.inviteSentAt;
  }
  if (!next.reminderSentAt && existingGuest?.reminderSentAt) {
    next.reminderSentAt = existingGuest.reminderSentAt;
  }
  return next;
}

function defaultWidthForShape(shape) {
  switch (shape) {
    case "rectangle":
    case "conference":
    case "long-banquet":
      return 230;
    case "horseshoe":
    case "u-shape":
    case "open-u":
      return 220;
    case "square":
      return 170;
    default:
      return 180;
  }
}

function defaultHeightForShape(shape) {
  switch (shape) {
    case "rectangle":
    case "conference":
    case "long-banquet":
      return 140;
    case "horseshoe":
    case "u-shape":
    case "open-u":
      return 170;
    case "square":
      return 170;
    default:
      return 180;
  }
}

function prettifyShape(shape) {
  return String(shape || "round")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function can(permission) {
  return Boolean(state.permissions?.[permission]);
}

function setSaveState(value) {
  state.saveState = value;
  if (state.activeView === "seating") {
    renderActiveView();
  }
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
  showToast("Copied to clipboard.", "success");
}

function percentage(value, total) {
  return total ? Math.round((value / total) * 100) : 0;
}

function formatEventDate(value) {
  if (!value) {
    return "Date not set";
  }
  try {
    return new Date(value).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return String(value);
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

function toTimeValue(value) {
  if (!value) {
    return 0;
  }
  if (typeof value.toDate === "function") {
    return value.toDate().getTime();
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function getInitials(name) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildWhatsAppReminderLink(guest) {
  if (!guest) {
    return "";
  }
  const phone = cleanPhone(guest.phone);
  if (!phone) {
    return "";
  }
  const couple = `${state.wedding?.brideName || "Bride"} & ${state.wedding?.groomName || "Groom"}`;
  const message = `Hello ${guest.fullName || "Guest"}, this is a kind reminder to confirm your attendance for the wedding of ${couple}.\nPlease open your personal invitation here:\n${guest.inviteLink || buildInviteLink(guest.guestToken)}`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

function cleanPhone(phone) {
  return String(phone || "").replace(/[^\d]/g, "");
}

function buildInviteLink(guestToken) {
  return new URL(`index.html?wedding=${encodeURIComponent(state.weddingId)}&guest=${encodeURIComponent(guestToken)}`, window.location.href).toString();
}

function buildCheckinLink(guestToken) {
  return new URL(`checkin.html?wedding=${encodeURIComponent(state.weddingId)}&guest=${encodeURIComponent(guestToken)}`, window.location.href).toString();
}

function generateGuestToken() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function demoNow() {
  return new Date().toLocaleString();
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
