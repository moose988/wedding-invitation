import {
  collection,
  doc,
  getDoc,
  getDocs,
  initFirebase,
  isFirebaseConfigured,
  serverTimestamp,
  updateDoc,
} from "./firebase-config.js";
import { renderQrCode } from "./qr.js";

const demoWedding = {
  coupleName: "Layan & Mohammed",
  brideName: "Layan",
  groomName: "Mohammed",
  brideNameAr: "ليان",
  groomNameAr: "محمد",
  subtitleEn: "With love, we invite you to celebrate our special day.",
  subtitleAr: "بكل الحب ندعوكم لمشاركتنا فرحة العمر.",
  invitationMessageEn:
    "On an evening filled with love and grace, we would be honored by your presence as we begin a beautiful new chapter together.",
  invitationMessageAr:
    "في مساء يفيض حباً وطمأنينة، نتشرف بحضوركم لتشهدوا معنا بداية فصل جديد من العمر.",
  eventDateISO: "2026-12-20T20:00:00+04:00",
  timeEn: "8:00 PM",
  timeAr: "الساعة ٨:٠٠ مساءً",
  venueEn: "Pearl Ballroom, Dubai",
  venueAr: "قاعة اللؤلؤة، دبي",
  locationEn: "Dubai, United Arab Emirates",
  locationAr: "دبي، الإمارات العربية المتحدة",
  mapsUrl: "https://maps.app.goo.gl/8QDgAnwByyYeUt2i9",
  dressCodeEn: "Formal attire in champagne, mocha, emerald, and soft neutrals.",
  dressCodeAr: "الزي الرسمي بألوان الشامبانيا والموكا والزمردي والدرجات الهادئة.",
  closingEn: "Your presence makes our joy complete.",
  closingAr: "حضوركم يزيد فرحتنا.",
  ownerUserId: "",
  status: "active",
  media: {
    audio: "./music/wedding.mp3",
    heroImage: "./images/couple.jpg",
  },
  gallery: [
    "./images/gallery-1.jpg",
    "./images/gallery-2.jpg",
    "./images/gallery-3.jpg",
    "./images/gallery-4.jpg",
  ],
  palette: [
    { name: "Champagne Mist", mood: "Refined", color: "#dcc3a5" },
    { name: "Ivory Silk", mood: "Soft", color: "#f4ecdf" },
    { name: "Emerald Whisper", mood: "Royal", color: "#3f5f56" },
    { name: "Mocha Velvet", mood: "Warm", color: "#796253" },
    { name: "Golden Glow", mood: "Luminous", color: "#c7a060" },
  ],
};

const demoGuest = {
  fullName: "Our Cherished Guest",
  fullNameAr: "ضيفنا العزيز",
  phone: "",
  side: "both",
  rsvpStatus: "pending",
  seatNumber: "",
  tableId: "",
  tableName: "",
  inviteLink: window.location.href,
  qrCodeValue: "",
  checkedIn: false,
  notes: "",
};

const demoTables = [
  { id: "table-a", name: "Moonlight", label: "Table A", capacity: 8, x: 20, y: 24, shape: "round", floorZone: "Grand Hall" },
  { id: "table-b", name: "Rose Gold", label: "Table B", capacity: 8, x: 62, y: 18, shape: "round", floorZone: "Grand Hall" },
  { id: "table-c", name: "Emerald Garden", label: "Table C", capacity: 10, x: 26, y: 62, shape: "rectangle", floorZone: "Garden Wing" },
  { id: "table-d", name: "Pearl Lounge", label: "Table D", capacity: 10, x: 68, y: 60, shape: "rectangle", floorZone: "Garden Wing" },
];

const introLabels = ["Open Invitation", "افتح الدعوة"];
const rsvpStorageKey = "premium-invitation-demo-rsvp";
const introAnimationDuration = 1450;
const reducedMotionIntroDuration = 180;

const state = {
  mode: "demo",
  weddingId: "",
  guestToken: "",
  wedding: structuredClone(demoWedding),
  guest: null,
  tables: [...demoTables],
  assignedTable: null,
  firebaseReady: false,
  invitationOpening: false,
  labelIndex: 0,
  activeIntroLabelSlot: 0,
  countdownTimer: null,
  musicAvailable: true,
  isRsvpEditing: false,
  lastMobileScrollY: 0,
};

const icons = {
  date: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="15" rx="2.5"></rect><path d="M7 3.5v4M17 3.5v4M3.5 9.5h17"></path></svg>',
  time: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5v5l3 2"></path></svg>',
  venue: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 19.5h15M7 19.5V8.5l5-3 5 3v11M9.5 11.5h.01M14.5 11.5h.01M9.5 15.5h.01M14.5 15.5h.01"></path></svg>',
  location: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.3 6-11a6 6 0 1 0-12 0c0 5.7 6 11 6 11Z"></path><circle cx="12" cy="10" r="2.5"></circle></svg>',
  reply: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 6.5h15v11h-15z"></path><path d="m5 7 7 6 7-6"></path></svg>',
  calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="15" rx="2.5"></rect><path d="M8 3.5v4M16 3.5v4M4 10h16M8 14h3M13 14h3M8 17h3"></path></svg>',
};

const elements = {
  introScreen: document.getElementById("introScreen"),
  openInvitationButton: document.getElementById("openInvitation"),
  openInvitationLabelPrimary: document.getElementById("openInvitationLabelPrimary"),
  openInvitationLabelSecondary: document.getElementById("openInvitationLabelSecondary"),
  weddingAudio: document.getElementById("weddingAudio"),
  musicToggle: document.getElementById("musicToggle"),
  heroBackdrop: document.getElementById("heroBackdrop"),
  stickyActions: document.getElementById("stickyActions"),
  guestSpotlightSection: document.getElementById("guestSpotlightSection"),
  seatingSection: document.getElementById("seatingSection"),
  qrPassSection: document.getElementById("qrPassSection"),
  toastRail: document.getElementById("toastRail"),
};

document.body.classList.add("intro-active");

boot();

async function boot() {
  bindBaseEvents();
  setupIntroLabelSwap();
  setupRevealObserver();
  setupAudioState();
  setupStickyFooterAwareness();
  renderCountdownCards();

  const { weddingId, guestToken } = getUrlParams();
  state.weddingId = weddingId;
  state.guestToken = guestToken;

  if (elements.weddingAudio?.querySelector("source")) {
    elements.weddingAudio.querySelector("source").src = demoWedding.media.audio;
    elements.weddingAudio.load();
  }

  if (weddingId && guestToken && isFirebaseConfigured()) {
    try {
      await initFirebase();
      state.firebaseReady = true;
      state.mode = "firebase";
      await loadFirebaseInvitation(weddingId, guestToken);
    } catch (error) {
      console.error(error);
      state.mode = "demo";
      showToast("Firebase invitation mode is unavailable. The demo invitation is still ready.", "error");
    }
  }

  populateInvitation();
  setupCountdown();
}

function getUrlParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    weddingId: params.get("wedding")?.trim() || "",
    guestToken: params.get("guest")?.trim() || "",
  };
}

async function loadFirebaseInvitation(weddingId, guestToken) {
  const wedding = await loadWedding(weddingId);
  const guest = await loadGuestByToken(weddingId, guestToken);
  const tables = await loadTables(weddingId);

  if (!wedding) {
    throw new Error("Wedding not found.");
  }

  if (!guest) {
    throw new Error("Guest not found.");
  }

  state.wedding = normaliseWedding(wedding);
  state.guest = guest;
  state.tables = tables;
  state.assignedTable = tables.find((table) => table.id === guest.tableId) || null;
}

async function loadWedding(weddingId) {
  const snapshot = await getDoc(doc(initFirebase().db, "weddings", weddingId));
  if (!snapshot.exists()) {
    return null;
  }
  return { id: snapshot.id, ...snapshot.data() };
}

async function loadGuestByToken(weddingId, guestToken) {
  const snapshot = await getDoc(
    doc(initFirebase().db, "weddings", weddingId, "publicGuests", guestToken)
  );
  if (!snapshot.exists()) {
    return null;
  }
  return { id: snapshot.id, ...snapshot.data() };
}

async function loadTables(weddingId) {
  const snapshot = await getDocs(collection(initFirebase().db, "weddings", weddingId, "tables"));
  return snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
}

function normaliseWedding(wedding) {
  return {
    ...structuredClone(demoWedding),
    ...wedding,
    media: {
      ...demoWedding.media,
      ...(wedding.media || {}),
    },
    palette: Array.isArray(wedding.palette) && wedding.palette.length ? wedding.palette : demoWedding.palette,
  };
}

function populateInvitation() {
  const wedding = state.wedding;
  const englishNames = `${wedding.brideName} & ${wedding.groomName}`;
  const arabicNames = `${wedding.brideNameAr} و ${wedding.groomNameAr}`;

  document.title = `${englishNames} | Wedding Invitation Platform`;
  setText("heroArabicNames", arabicNames);
  setText("heroEnglishNames", englishNames);
  setText("heroSubtitleArabic", wedding.subtitleAr);
  setText("heroSubtitleEnglish", wedding.subtitleEn);
  setText("invitationMessageArabic", wedding.invitationMessageAr);
  setText("invitationMessageEnglish", wedding.invitationMessageEn);
  setText("closingArabic", wedding.closingAr);
  setText("closingEnglish", wedding.closingEn);
  if (elements.heroBackdrop) {
    elements.heroBackdrop.style.backgroundImage = `url("${wedding.media.heroImage}")`;
  }

  renderActions();
  renderDetails();
  renderGuestCard();
  renderRsvp();
  renderSeatSection();
  renderGuestQrPass();
}

function renderActions() {
  const wedding = state.wedding;
  const actionMarkup = `
    <button class="luxury-button luxury-button--primary" type="button" data-scroll-rsvp>
      ${icons.reply}<span>RSVP</span>
    </button>
    <a class="luxury-button luxury-button--secondary" href="${escapeAttribute(wedding.mapsUrl)}" target="_blank" rel="noopener noreferrer">
      ${icons.location}<span>View Location</span>
    </a>
    <button class="luxury-button luxury-button--ghost" type="button" data-calendar-download>
      ${icons.calendar}<span>Add to Calendar</span>
    </button>
  `;

  elements.stickyActions.innerHTML = actionMarkup;
}

function renderGuestCard() {
  if (state.mode !== "firebase" || !state.guest) {
    elements.guestSpotlightSection.hidden = true;
    return;
  }

  elements.guestSpotlightSection.hidden = false;
  setText("guestGreetingTitle", `Dear ${state.guest.fullName || "Guest"}`);
  setText("guestGreetingArabic", `يسعدنا حضوركم يا ${state.guest.fullNameAr || state.guest.fullName || "ضيفنا العزيز"}`);
  setText("guestGreetingEnglish", "Your personal invitation is ready below with RSVP, seating, and entrance access.");
}

function renderCountdownCards() {
  const grid = document.getElementById("countdownGrid");
  const units = [
    { key: "days", en: "Days", ar: "يوم" },
    { key: "hours", en: "Hours", ar: "ساعة" },
    { key: "minutes", en: "Minutes", ar: "دقيقة" },
    { key: "seconds", en: "Seconds", ar: "ثانية" },
  ];

  grid.innerHTML = units
    .map(
      (unit) => `
        <article class="countdown-card">
          <span class="countdown-card__value" data-unit="${unit.key}" data-value="00">00</span>
          <div class="countdown-card__label">
            <span>${unit.en}</span>
            <span class="rtl-copy" lang="ar" dir="rtl">${unit.ar}</span>
          </div>
        </article>
      `
    )
    .join("");
}

function setupCountdown() {
  updateCountdown();
  if (state.countdownTimer) {
    window.clearInterval(state.countdownTimer);
  }
  state.countdownTimer = window.setInterval(updateCountdown, 1000);
}

function updateCountdown() {
  const target = new Date(state.wedding.eventDateISO).getTime();
  const remaining = Math.max(0, target - Date.now());
  const parts = {
    days: Math.floor(remaining / (1000 * 60 * 60 * 24)),
    hours: Math.floor((remaining / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((remaining / (1000 * 60)) % 60),
    seconds: Math.floor((remaining / 1000) % 60),
  };

  Object.entries(parts).forEach(([key, value]) => {
    const node = document.querySelector(`[data-unit="${key}"]`);
    if (!node) {
      return;
    }
    const nextValue = String(value).padStart(2, "0");
    if (node.dataset.value !== nextValue) {
      node.dataset.value = nextValue;
      node.textContent = nextValue;
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        node.classList.remove("is-ticking");
        void node.offsetWidth;
        node.classList.add("is-ticking");
      }
    }
  });

  if (remaining === 0 && state.countdownTimer) {
    window.clearInterval(state.countdownTimer);
  }
}

function renderDetails() {
  const wedding = state.wedding;
  const detailCards = [
    {
      icon: icons.date,
      title: "Date & Time",
      en: `${formatDate(wedding.eventDateISO)} at ${wedding.timeEn}`,
      ar: `${formatArabicDate(wedding.eventDateISO)} - ${wedding.timeAr}`,
    },
    {
      icon: icons.location,
      title: "Location",
      en: wedding.locationEn,
      ar: wedding.locationAr,
      action: `<a class="detail-card__action" href="${escapeAttribute(wedding.mapsUrl)}" target="_blank" rel="noopener noreferrer">${icons.location}<span>View Location</span></a>`,
    },
  ];

  document.getElementById("detailsGrid").innerHTML = detailCards
    .map(
      (detail) => `
        <article class="detail-card">
          <div class="detail-card__icon">${detail.icon}</div>
          <h3 class="detail-card__title">${detail.title}</h3>
          <p class="detail-card__english">${detail.en}</p>
          <p class="detail-card__arabic rtl-copy" lang="ar" dir="rtl">${detail.ar}</p>
          ${detail.action || ""}
        </article>
      `
    )
    .join("");
}

function renderRsvp() {
  const mount = document.getElementById("rsvpMount");
  if (state.mode === "firebase" && state.guest) {
    renderFirebaseRsvp(mount);
    return;
  }
  renderDemoRsvp(mount);
}

function renderFirebaseRsvp(mount) {
  const statusCopy = {
    confirmed: "You have confirmed your attendance.",
    declined: "You have declined this invitation.",
    pending: "Please confirm your attendance.",
  };
  const guest = state.guest;
  mount.innerHTML = `
    <div class="firebase-rsvp-panel">
      <p class="firebase-rsvp-status">${statusCopy[guest.rsvpStatus] || statusCopy.pending}</p>
      <div class="firebase-rsvp-actions">
        <button class="luxury-button luxury-button--primary" type="button" data-rsvp-status="confirmed">Confirm Attendance</button>
        <button class="luxury-button luxury-button--secondary" type="button" data-rsvp-status="declined">Decline</button>
      </div>
    </div>
  `;
}

function renderDemoRsvp(mount) {
  const saved = readSavedRsvp();
  if (saved && !state.isRsvpEditing) {
    mount.innerHTML = `
      <div class="rsvp-summary" aria-live="polite">
        <p class="rsvp-summary__eyebrow">${escapeHtml(saved.status)}</p>
        <h3>Your reply has been saved</h3>
        <p>Thank you. Your response is stored on this device for the demo invitation.</p>
        ${saved.name ? `<p><strong>Name:</strong> ${escapeHtml(saved.name)}</p>` : ""}
        ${saved.guests ? `<p><strong>Guests:</strong> ${escapeHtml(saved.guests)}</p>` : ""}
        <button class="luxury-button luxury-button--secondary" type="button" data-edit-rsvp><span>Edit RSVP</span></button>
      </div>
    `;
    return;
  }

  mount.innerHTML = `
    <form class="rsvp-form" id="rsvpForm">
      <div class="rsvp-phases">
        <section class="rsvp-phase" data-rsvp-step="1">
          <p class="rsvp-phase__number">01</p>
          <h3>Are you attending?</h3>
          <div class="rsvp-choice" role="radiogroup" aria-label="Attendance">
            <label class="rsvp-answer">
              <input type="radio" name="status" value="Yes" ${saved?.status === "Yes" ? "checked" : ""} required />
              <span>Yes</span>
            </label>
            <label class="rsvp-answer">
              <input type="radio" name="status" value="No" ${saved?.status === "No" ? "checked" : ""} required />
              <span>No</span>
            </label>
          </div>
        </section>
        <section class="rsvp-phase" data-rsvp-step="2" ${saved?.status === "Yes" ? "" : "hidden"}>
          <p class="rsvp-phase__number">02</p>
          <h3>Your name</h3>
          <label class="rsvp-input-line">
            <span class="sr-only">Guest name</span>
            <input name="name" type="text" autocomplete="name" placeholder="Name" value="${escapeAttribute(saved?.name || "")}" required />
          </label>
          <button class="luxury-button luxury-button--secondary rsvp-next" type="button" data-rsvp-next="3"><span>Continue</span></button>
        </section>
        <section class="rsvp-phase" data-rsvp-step="3" ${saved?.name ? "" : "hidden"}>
          <p class="rsvp-phase__number">03</p>
          <h3>How many guests?</h3>
          <label class="rsvp-input-line rsvp-input-line--compact">
            <span class="sr-only">Number of guests</span>
            <input name="guests" type="number" min="0" max="10" inputmode="numeric" placeholder="1" value="${escapeAttribute(saved?.guests || "1")}" required />
          </label>
        </section>
      </div>
      <button class="luxury-button luxury-button--primary rsvp-form__submit" type="submit" ${saved?.name ? "" : "hidden"}>
        ${icons.reply}<span>Send RSVP</span>
      </button>
    </form>
  `;

  const form = document.getElementById("rsvpForm");
  form?.addEventListener("submit", handleDemoRsvpSubmit);
  setupRsvpPhases(form);
}

function renderSeatSection() {
  if (state.mode !== "firebase" || !state.guest) {
    elements.seatingSection.hidden = true;
    return;
  }

  elements.seatingSection.hidden = false;
  const assignedTable = state.assignedTable;
  const hasSeat = Boolean(assignedTable || state.guest.tableName || state.guest.seatNumber);

  document.getElementById("seatDetailsMount").innerHTML = hasSeat
    ? `
      <div class="seat-details-grid">
        <article class="seat-detail-card"><span>Table Name</span><strong>${escapeHtml(state.guest.tableName || assignedTable?.name || "Pending")}</strong></article>
        <article class="seat-detail-card"><span>Table Label</span><strong>${escapeHtml(assignedTable?.label || state.guest.tableId || "Pending")}</strong></article>
        <article class="seat-detail-card"><span>Seat Number</span><strong>${escapeHtml(state.guest.seatNumber || "Will be shared at the venue")}</strong></article>
        <article class="seat-detail-card"><span>Floor Zone</span><strong>${escapeHtml(assignedTable?.floorZone || "Main Hall")}</strong></article>
      </div>
    `
    : '<p class="seat-empty-copy">Your seating details will be shared soon.</p>';

  renderSeatingMap(state.tables, state.guest.tableId);
}

function renderSeatingMap(tables, assignedTableId) {
  const map = document.getElementById("seatingMap");
  if (!map) {
    return;
  }

  if (!tables.length) {
    map.innerHTML = '<p class="seat-empty-copy">A seating map will appear here once the venue layout is published.</p>';
    return;
  }

  map.innerHTML = tables
    .map((table) => {
      const isAssigned = table.id === assignedTableId;
      return `
        <article
          class="seat-map-table seat-map-table--${escapeAttribute(table.shape || "round")} ${isAssigned ? "is-assigned" : ""}"
          style="left:${Number(table.x || 0)}%;top:${Number(table.y || 0)}%;"
        >
          <strong>${escapeHtml(table.label || table.name)}</strong>
          <span>${escapeHtml(table.name || "Table")}</span>
          ${isAssigned ? '<small>You are here</small>' : ""}
        </article>
      `;
    })
    .join("");
}

async function renderGuestQrPass() {
  if (state.mode !== "firebase" || !state.guest || !state.weddingId || !state.guestToken) {
    elements.qrPassSection.hidden = true;
    return;
  }

  elements.qrPassSection.hidden = false;
  const checkinUrl = buildAbsoluteUrl(`checkin.html?wedding=${encodeURIComponent(state.weddingId)}&guest=${encodeURIComponent(state.guestToken)}`);
  const mount = document.getElementById("qrPassMount");
  mount.innerHTML = `
    <div class="qr-pass__content">
      <div class="qr-pass__code" id="guestQrCode"></div>
      <div class="qr-pass__copy">
        <p>Present this QR code at the entrance.</p>
        <a class="location-button" href="${escapeAttribute(checkinUrl)}" target="_blank" rel="noopener noreferrer">Open Check-In Link</a>
        <p class="qr-pass__fallback">${escapeHtml(checkinUrl)}</p>
      </div>
    </div>
  `;
  await renderQrCode(document.getElementById("guestQrCode"), checkinUrl, { size: 220 });
}

async function updateRsvp(status) {
  if (state.mode !== "firebase" || !state.guest?.guestId) {
    return;
  }

  try {
    await updateDoc(
      doc(initFirebase().db, "weddings", state.weddingId, "guests", state.guest.guestId),
      {
        rsvpStatus: status,
        updatedAt: serverTimestamp(),
      }
    );
    if (state.guestToken) {
      // Keep the token-keyed public mirror fresh so reloading this page shows the saved answer.
      await updateDoc(
        doc(initFirebase().db, "weddings", state.weddingId, "publicGuests", state.guestToken),
        {
          rsvpStatus: status,
          updatedAt: serverTimestamp(),
        }
      ).catch((error) => {
        console.warn("RSVP mirror update failed.", error);
      });
    }
    state.guest.rsvpStatus = status;
    renderFirebaseRsvp(document.getElementById("rsvpMount"));
    showToast("Your RSVP has been updated.", "success");
  } catch (error) {
    console.error(error);
    showToast("We could not update your RSVP just now.", "error");
  }
}

function bindBaseEvents() {
  elements.openInvitationButton?.addEventListener("click", handleOpenInvitation);
  elements.musicToggle?.addEventListener("click", handleMusicToggle);

  document.addEventListener("click", async (event) => {
    const calendarButton = event.target.closest("[data-calendar-download]");
    if (calendarButton) {
      downloadCalendarFile();
    }

    const rsvpTrigger = event.target.closest("[data-scroll-rsvp]");
    if (rsvpTrigger) {
      scrollToRsvp();
    }

    const editButton = event.target.closest("[data-edit-rsvp]");
    if (editButton) {
      state.isRsvpEditing = true;
      renderRsvp();
    }

    const rsvpButton = event.target.closest("[data-rsvp-status]");
    if (rsvpButton) {
      await updateRsvp(rsvpButton.dataset.rsvpStatus);
    }
  });
}

async function handleOpenInvitation() {
  if (state.invitationOpening) {
    return;
  }

  state.invitationOpening = true;
  elements.openInvitationButton.disabled = true;
  document.body.classList.add("intro-opening");
  await playWeddingMusicFromGesture();
  await waitForIntroAnimation();
  revealInvitation();
}

function revealInvitation() {
  document.body.classList.remove("intro-active");
  document.body.classList.add("invitation-open");
  elements.introScreen.classList.add("is-hidden");
  elements.musicToggle.hidden = false;
  elements.stickyActions.hidden = false;

  window.setTimeout(() => {
    document.body.classList.remove("intro-opening");
  }, 480);
}

async function playWeddingMusicFromGesture() {
  if (!state.musicAvailable || !elements.weddingAudio) {
    setMusicToggleState("unavailable", "Off", "Wedding music unavailable");
    return;
  }

  try {
    elements.weddingAudio.currentTime = 0;
    await elements.weddingAudio.play();
    setMusicToggleState("playing", "Stop", "Stop wedding music");
  } catch (error) {
    setMusicToggleState("paused", "Play", "Play wedding music");
  }
}

async function handleMusicToggle() {
  if (!state.musicAvailable || !elements.weddingAudio) {
    return;
  }

  if (elements.weddingAudio.paused) {
    try {
      await elements.weddingAudio.play();
      setMusicToggleState("playing", "Stop", "Stop wedding music");
    } catch (error) {
      setMusicToggleState("paused", "Play", "Play wedding music");
    }
    return;
  }

  elements.weddingAudio.pause();
  setMusicToggleState("paused", "Play", "Play wedding music");
}

function waitForIntroAnimation() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const duration = reduceMotion ? reducedMotionIntroDuration : introAnimationDuration;
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}

function setupIntroLabelSwap() {
  syncIntroLabel(elements.openInvitationLabelPrimary, 0);
  syncIntroLabel(elements.openInvitationLabelSecondary, 1);
  elements.openInvitationLabelSecondary.classList.remove("is-active");

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  window.setInterval(() => {
    state.labelIndex = (state.labelIndex + 1) % introLabels.length;
    const nextSlot = state.activeIntroLabelSlot === 0 ? 1 : 0;
    const nextNode = nextSlot === 0 ? elements.openInvitationLabelPrimary : elements.openInvitationLabelSecondary;
    const currentNode = nextSlot === 0 ? elements.openInvitationLabelSecondary : elements.openInvitationLabelPrimary;
    syncIntroLabel(nextNode, state.labelIndex);
    nextNode.classList.add("is-active");
    currentNode.classList.remove("is-active");
    state.activeIntroLabelSlot = nextSlot;
  }, 2600);
}

function syncIntroLabel(node, nextLabelIndex) {
  if (!node) {
    return;
  }
  const isArabic = nextLabelIndex === 1;
  node.textContent = introLabels[nextLabelIndex];
  node.lang = isArabic ? "ar" : "en";
  node.dir = isArabic ? "rtl" : "ltr";
}

function handleDemoRsvpSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const statusValue = form.elements.status.value;

  if (statusValue === "No") {
    localStorage.setItem(
      rsvpStorageKey,
      JSON.stringify({ status: "No", name: "", guests: "0", savedAt: new Date().toISOString() })
    );
    state.isRsvpEditing = false;
    renderRsvp();
    return;
  }

  const response = {
    status: statusValue,
    name: String(form.elements.name.value || "").trim(),
    guests: String(form.elements.guests.value || "").trim(),
    savedAt: new Date().toISOString(),
  };

  localStorage.setItem(rsvpStorageKey, JSON.stringify(response));
  state.isRsvpEditing = false;
  renderRsvp();
}

function setupRsvpPhases(form) {
  if (!form) {
    return;
  }

  const statusInputs = form.querySelectorAll('input[name="status"]');
  const nameInput = form.elements.name;
  const guestsInput = form.elements.guests;
  const nameStep = form.querySelector('[data-rsvp-step="2"]');
  const guestStep = form.querySelector('[data-rsvp-step="3"]');
  const submitButton = form.querySelector(".rsvp-form__submit");
  const nextButton = form.querySelector("[data-rsvp-next]");

  const revealStep = (step, focusTarget) => {
    const section = form.querySelector(`[data-rsvp-step="${step}"]`);
    if (!section || !section.hidden) {
      return;
    }
    section.hidden = false;
    window.requestAnimationFrame(() => {
      section.classList.add("is-visible");
      focusTarget?.focus();
    });
  };

  const hideStep = (section) => {
    if (!section) {
      return;
    }
    section.hidden = true;
    section.classList.remove("is-visible");
  };

  const advanceToGuestStep = () => {
    if (!nameInput.reportValidity()) {
      return;
    }
    revealStep("3", guestsInput);
    submitButton.hidden = false;
  };

  const updateFlow = (statusValue) => {
    if (statusValue === "Yes") {
      nameInput.required = true;
      guestsInput.required = true;
      revealStep("2", nameInput);
      return;
    }
    nameInput.required = false;
    guestsInput.required = false;
    nameInput.value = "";
    guestsInput.value = "0";
    hideStep(nameStep);
    hideStep(guestStep);
    submitButton.hidden = statusValue !== "No";
  };

  statusInputs.forEach((input) => input.addEventListener("change", () => updateFlow(input.value)));
  nextButton?.addEventListener("click", advanceToGuestStep);
  nameInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    advanceToGuestStep();
  });
}

function readSavedRsvp() {
  try {
    const saved = localStorage.getItem(rsvpStorageKey);
    return saved ? JSON.parse(saved) : null;
  } catch (error) {
    return null;
  }
}

function setupRevealObserver() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const revealItems = document.querySelectorAll(".reveal");
  if (reduceMotion) {
    revealItems.forEach((item) => item.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
  );

  revealItems.forEach((item) => observer.observe(item));
}

function setupAudioState() {
  elements.weddingAudio?.addEventListener("error", () => {
    state.musicAvailable = false;
    setMusicToggleState("unavailable", "Off", "Wedding music unavailable");
  });

  elements.weddingAudio?.addEventListener("pause", () => {
    if (state.musicAvailable && document.body.classList.contains("invitation-open")) {
      setMusicToggleState("paused", "Play", "Play wedding music");
    }
  });

  elements.weddingAudio?.addEventListener("play", () => {
    if (state.musicAvailable) {
      setMusicToggleState("playing", "Stop", "Stop wedding music");
    }
  });
}

function setupStickyFooterAwareness() {
  const closing = document.querySelector(".closing-card");
  if (!elements.stickyActions || !closing || !("IntersectionObserver" in window)) {
    return;
  }

  const observer = new IntersectionObserver(
    ([entry]) => {
      elements.stickyActions.classList.toggle("is-soft-hidden", entry.isIntersecting);
    },
    { threshold: 0.35 }
  );

  observer.observe(closing);
  setupMobileStickyFooterScroll();
}

function setupMobileStickyFooterScroll() {
  const mobileQuery = window.matchMedia("(max-width: 699px)");
  const updateMobileFooterState = () => {
    if (!elements.stickyActions) {
      return;
    }

    if (!mobileQuery.matches) {
      elements.stickyActions.classList.remove("is-scroll-hidden");
      state.lastMobileScrollY = window.scrollY;
      return;
    }

    const currentScrollY = window.scrollY;
    const scrollDelta = currentScrollY - state.lastMobileScrollY;
    if (currentScrollY < 24 || scrollDelta < -8) {
      elements.stickyActions.classList.remove("is-scroll-hidden");
    } else if (scrollDelta > 10) {
      elements.stickyActions.classList.add("is-scroll-hidden");
    }
    state.lastMobileScrollY = currentScrollY;
  };

  state.lastMobileScrollY = window.scrollY;
  window.addEventListener("scroll", updateMobileFooterState, { passive: true });
  mobileQuery.addEventListener("change", updateMobileFooterState);
}

function setMusicToggleState(stateName, label, ariaLabel) {
  elements.musicToggle.dataset.state = stateName;
  const labelNode = elements.musicToggle.querySelector(".music-toggle__label");
  if (labelNode) {
    labelNode.textContent = label;
  }
  elements.musicToggle.setAttribute("aria-label", ariaLabel);
}

function scrollToRsvp() {
  document.getElementById("rsvpSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function downloadCalendarFile() {
  const start = new Date(state.wedding.eventDateISO);
  const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
  const summary = `${state.wedding.brideName} & ${state.wedding.groomName} Wedding`;
  const description = `${state.wedding.invitationMessageEn}\n${state.wedding.venueEn}\n${state.wedding.mapsUrl}`;
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Wedding Invitation Platform//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${Date.now()}-wedding-invitation-platform`,
    `DTSTAMP:${toIcsDate(new Date())}`,
    `DTSTART:${toIcsDate(start)}`,
    `DTEND:${toIcsDate(end)}`,
    `SUMMARY:${escapeIcs(summary)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    `LOCATION:${escapeIcs(`${state.wedding.venueEn}, ${state.wedding.locationEn}`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "wedding-invitation.ics";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function showToast(message, tone = "info") {
  if (!elements.toastRail) {
    return;
  }
  const toast = document.createElement("div");
  toast.className = `toast toast--${tone}`;
  toast.textContent = message;
  elements.toastRail.appendChild(toast);
  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 260);
  }, 2600);
}

function buildAbsoluteUrl(path) {
  return new URL(path, window.location.href).toString();
}

function toIcsDate(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeIcs(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function formatDate(dateISO) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(dateISO));
}

function formatArabicDate(dateISO) {
  return new Intl.DateTimeFormat("ar-AE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(dateISO));
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) {
    node.textContent = value || "";
  }
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
