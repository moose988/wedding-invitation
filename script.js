import {
  collection,
  doc,
  getDoc,
  getDocs,
  initFirebase,
  isFirebaseConfigured,
  onSnapshot,
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
const invitationParams = new URLSearchParams(window.location.search);
const explicitDemoMode = invitationParams.get("demo") === "1";

const state = {
  mode: explicitDemoMode ? "demo" : "unavailable",
  weddingId: "",
  guestToken: "",
  wedding: structuredClone(demoWedding),
  guest: null,
  tables: [...demoTables],
  hallObjects: createHallObjects(),
  assignedTable: null,
  seatPlanTransform: { scale: 1, x: 0, y: 0 },
  seatPlanGesture: null,
  seatPlanHasFitted: false,
  firebaseReady: false,
  invitationOpening: false,
  labelIndex: 0,
  activeIntroLabelSlot: 0,
  countdownTimer: null,
  musicAvailable: true,
  isRsvpEditing: false,
  lastMobileScrollY: 0,
  unsubWedding: null,
  unsubGuest: null,
  unsubTables: null,
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

  if (!explicitDemoMode && (!weddingId || !guestToken)) {
    renderInvitationAccessError("This invitation link is incomplete. Please use the personal link shared by the couple.");
    return;
  }

  if (weddingId && guestToken && isFirebaseConfigured()) {
    try {
      await initFirebase();
      state.firebaseReady = true;
      state.mode = "firebase";
      await loadFirebaseInvitation(weddingId, guestToken);
      startFirebaseInvitationListeners(weddingId, guestToken);
    } catch (error) {
      console.error(error);
      state.mode = "unavailable";
      renderInvitationAccessError("We could not open this invitation. Please check the link and try again.");
      return;
    }
  } else if (!explicitDemoMode) {
    renderInvitationAccessError("This invitation service is not configured. Please ask the couple for a new link.");
    return;
  }

  populateInvitation();
  setupCountdown();
}

function renderInvitationAccessError(message) {
  document.body.classList.remove("intro-active");
  document.body.innerHTML = `<main style="min-height:100vh;display:grid;place-items:center;padding:24px;background:#f6f1e8;color:#2f312d;font-family:Georgia,serif"><section style="max-width:520px;text-align:center;background:#fffdf8;border:1px solid #dccfb8;border-radius:20px;padding:32px"><h1>Invitation unavailable</h1><p>${escapeHtml(message)}</p></section></main>`;
}

function startFirebaseInvitationListeners(weddingId, guestToken) {
  state.unsubWedding?.(); state.unsubGuest?.(); state.unsubTables?.();
  const db = initFirebase().db;
  const refresh = async () => {
    try {
      await loadFirebaseInvitation(weddingId, guestToken);
      populateInvitation();
    } catch (error) {
      console.error(error);
      if (/guest not found|wedding not found/i.test(error.message || "")) {
        renderInvitationAccessError("This invitation is no longer available. Please ask the couple for a new link.");
      } else {
        showToast("Live seating update could not be loaded. Refresh to retry.", "error");
      }
    }
  };
  state.unsubWedding = onSnapshot(doc(db, "weddings", weddingId), (snapshot) => snapshot.exists() ? refresh() : renderInvitationAccessError("This wedding is no longer available."), () => showToast("Wedding data is unavailable.", "error"));
  state.unsubGuest = onSnapshot(doc(db, "weddings", weddingId, "publicGuests", guestToken), (snapshot) => snapshot.exists() ? refresh() : renderInvitationAccessError("This invitation is no longer available. Please ask the couple for a new link."), () => showToast("Invitation access is unavailable.", "error"));
  state.unsubTables = onSnapshot(collection(db, "weddings", weddingId, "tables"), refresh, () => showToast("Live seating update is unavailable.", "error"));
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
  state.hallObjects = hydrateHallObjects(state.wedding.hallObjects);
  state.tables = tables;
  const primaryAssignment = getInvitationSeatAssignments(guest)[0];
  state.assignedTable = tables.find((table) => table.id === (primaryAssignment?.tableId || guest.tableId)) || null;
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
  // The Firestore document ID is the table identity used by Seating.  Never
  // let an old embedded `id` field override it on the invitation page.
  return snapshot.docs.map((docSnapshot) => ({ ...docSnapshot.data(), id: docSnapshot.id }));
}

function normaliseWedding(wedding) {
  const normalised = {
    ...structuredClone(demoWedding),
    ...wedding,
    media: {
      ...demoWedding.media,
      ...(wedding.media || {}),
    },
    palette: Array.isArray(wedding.palette) && wedding.palette.length ? wedding.palette : demoWedding.palette,
  };

  // Some older records were created through a form that converted Arabic
  // characters to literal question marks. Keep the invitation readable while
  // those records are being migrated in Firestore.
  return repairCorruptedArabicText(normalised);
}

function repairCorruptedArabicText(wedding) {
  const isCorrupted = (value) => typeof value === "string" && value.includes("?");
  const laylaAndZaid = {
    brideNameAr: "\u0644\u064a\u0644\u0649",
    groomNameAr: "\u0632\u0627\u064a\u062f",
    subtitleAr: "\u0628\u0643\u0644 \u0627\u0644\u062d\u0628 \u0646\u062f\u0639\u0648\u0643\u0645 \u0644\u0645\u0634\u0627\u0631\u0643\u062a\u0646\u0627 \u0641\u0631\u062d\u0629 \u0627\u0644\u0639\u0645\u0631.",
    invitationMessageAr: "\u0641\u064a \u0645\u0633\u0627\u0621 \u064a\u0641\u064a\u0636 \u062d\u0628\u0627\u064b \u0648\u0637\u0645\u0623\u0646\u064a\u0646\u0629\u060c \u0646\u062a\u0634\u0631\u0641 \u0628\u062d\u0636\u0648\u0631\u0643\u0645 \u0644\u062a\u0634\u0647\u062f\u0648\u0627 \u0645\u0639\u0646\u0627 \u0628\u062f\u0627\u064a\u0629 \u0641\u0635\u0644 \u062c\u062f\u064a\u062f \u0645\u0646 \u0627\u0644\u0639\u0645\u0631.",
    timeAr: "\u0627\u0644\u0633\u0627\u0639\u0629 \u0668:\u0660\u0660 \u0645\u0633\u0627\u0621\u064b",
    venueAr: "\u0642\u0627\u0639\u0629 \u0627\u0644\u0644\u0624\u0644\u0624\u0629\u060c \u062f\u0628\u064a",
    locationAr: "\u062f\u0628\u064a\u060c \u0627\u0644\u0625\u0645\u0627\u0631\u0627\u062a \u0627\u0644\u0639\u0631\u0628\u064a\u0629 \u0627\u0644\u0645\u062a\u062d\u062f\u0629",
    dressCodeAr: "\u0627\u0644\u0632\u064a \u0627\u0644\u0631\u0633\u0645\u064a \u0628\u0623\u0644\u0648\u0627\u0646 \u0627\u0644\u0634\u0627\u0645\u0628\u0627\u0646\u064a\u0627 \u0648\u0627\u0644\u0645\u0648\u0643\u0627 \u0648\u0627\u0644\u0632\u0645\u0631\u062f\u064a \u0648\u0627\u0644\u062f\u0631\u062c\u0627\u062a \u0627\u0644\u0647\u0627\u062f\u0626\u0629.",
    closingAr: "\u062d\u0636\u0648\u0631\u0643\u0645 \u064a\u0632\u064a\u062f \u0641\u0631\u062d\u062a\u0646\u0627.",
  };

  if (`${wedding.brideName} & ${wedding.groomName}` !== "Layla & Zaid") {
    return wedding;
  }

  return Object.fromEntries(
    Object.entries(wedding).map(([key, value]) => [key, isCorrupted(value) ? (laylaAndZaid[key] || value) : value])
  );
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
  if (guest.rsvpStatus === "confirmed") {
    mount.innerHTML = `
      <div class="rsvp-summary rsvp-summary--confirmed" role="status" aria-live="polite">
        <span class="rsvp-confirmation-mark" aria-hidden="true">✓</span>
        <p class="rsvp-summary__eyebrow">RSVP Confirmed</p>
        <h3>Your attendance is confirmed</h3>
        <p>Thank you, ${escapeHtml(guest.fullName || "guest")}. We look forward to celebrating with you.</p>
      </div>
    `;
    return;
  }
  mount.innerHTML = `
    <form class="firebase-rsvp-panel rsvp-form" id="firebaseRsvpForm">
      <p class="firebase-rsvp-status">${statusCopy[guest.rsvpStatus] || statusCopy.pending}</p>
      <div class="rsvp-phases">
        <section class="rsvp-phase" data-rsvp-step="1">
          <p class="rsvp-phase__number">01</p>
          <h3>Are you attending?</h3>
          <div class="rsvp-choice" role="radiogroup" aria-label="Attendance">
            <label class="rsvp-answer">
              <input type="radio" name="status" value="confirmed" ${guest.rsvpStatus === "confirmed" ? "checked" : ""} required />
              <span>Yes</span>
            </label>
            <label class="rsvp-answer">
              <input type="radio" name="status" value="declined" ${guest.rsvpStatus === "declined" ? "checked" : ""} required />
              <span>No</span>
            </label>
          </div>
        </section>
      </div>
      <button class="luxury-button luxury-button--primary rsvp-form__submit" type="submit">
        ${icons.reply}<span>Send RSVP</span>
      </button>
    </form>
  `;
  const form = document.getElementById("firebaseRsvpForm");
  form?.addEventListener("submit", handleFirebaseRsvpSubmit);
  setupRsvpPhases(form);
}

function renderDemoRsvp(mount) {
  const saved = readSavedRsvp();
  if (saved && !state.isRsvpEditing) {
    mount.innerHTML = `
      <div class="rsvp-summary" aria-live="polite">
        <p class="rsvp-summary__eyebrow">${escapeHtml(saved.status)}</p>
        <h3>Your reply has been saved</h3>
        <p>Thank you. Your response is stored on this device for the demo invitation.</p>
        ${saved.additionalGuests ? `<p><strong>Additional guests:</strong> ${escapeHtml(saved.additionalGuests)}</p>` : ""}
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
      </div>
      <button class="luxury-button luxury-button--primary rsvp-form__submit" type="submit" ${saved?.status ? "" : "hidden"}>
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
  const assignments = getInvitationSeatAssignments(state.guest);
  const partyMembers = getInvitationPartyMembers(state.guest, assignments);

  document.getElementById("seatDetailsMount").innerHTML = `
      <div class="seat-details-grid">
        <article class="seat-detail-card"><span>Primary guest</span><strong>${escapeHtml(state.guest.fullName || "Guest")}</strong></article>
        <article class="seat-detail-card"><span>Party size</span><strong>${escapeHtml(String(getPartySize(state.guest)))}</strong></article>
      </div>
      <div class="guest-seat-list guest-seat-list--party" aria-label="Your party seating assignments">
        ${partyMembers.map(renderInvitationPartyMember).join("")}
      </div>
    `;

  renderSeatingMap(state.tables, assignments);
}

function getInvitationPartyMembers(guest, assignments) {
  const byKey = new Map(assignments.map((assignment) => [assignment.personKey, assignment]));
  return Array.from({ length: getPartySize(guest) }, (_, index) => {
    const personKey = personKeyForIndex(index);
    return {
      index,
      label: index === 0 ? (guest.fullName || "Primary guest") : `Companion ${index}`,
      assignment: byKey.get(personKey) || null,
    };
  });
}

function renderInvitationPartyMember(member) {
  const assignment = member.assignment;
  return `
    <article class="guest-seat-party-member ${assignment ? "is-assigned" : "is-unassigned"}">
      <strong>${escapeHtml(member.label)}</strong>
      <span>${assignment ? `${escapeHtml(assignment.tableName || "Table")} · Chair ${escapeHtml(String(assignment.seatNumber))}` : "Seat not assigned yet"}</span>
    </article>
  `;
}

function renderSeatingMap(tables, assignments = []) {
  const map = document.getElementById("seatingMap");
  if (!map) {
    return;
  }

  if (!tables.length) {
    map.innerHTML = '<p class="seat-empty-copy">A seating map will appear here once the venue layout is published.</p>';
    return;
  }

  state.seatPlanHasFitted = false;
  const assignedTableIds = new Set(assignments.map((assignment) => assignment.tableId));
  const assignedSeatKeys = new Set(assignments.map((assignment) => `${assignment.tableId}::${assignment.seatNumber}`));
  map.innerHTML = `
    <div class="seat-plan-toolbar" aria-label="Seating plan controls">
      <button type="button" data-seat-plan-control="my-seats" ${assignments.length ? "" : "disabled"}>My seats</button>
      <button type="button" data-seat-plan-control="zoom-out">-</button>
      <button type="button" data-seat-plan-control="fit">Fit</button>
      <button type="button" data-seat-plan-control="zoom-in">+</button>
    </div>
    <div class="seat-plan-viewport" id="seatPlanViewport">
      <div class="seat-plan-canvas" id="seatPlanCanvas" style="transform:translate(${state.seatPlanTransform.x}px, ${state.seatPlanTransform.y}px) scale(${state.seatPlanTransform.scale});">
        <div class="seat-plan-floor"></div>
        ${state.hallObjects.map(renderInvitationHallObject).join("")}
        ${tables
    .map((table) => {
      const isAssigned = assignedTableIds.has(table.id);
      const width = Number(table.width || defaultWidthForShape(table.shape));
      const height = Number(table.height || defaultHeightForShape(table.shape));
      return `
        <article
          class="seat-plan-table ${isAssigned ? "is-assigned" : ""}"
          style="left:${Number(table.x || 0)}%;top:${Number(table.y || 0)}%;width:${width}px;height:${height}px;"
        >
          ${(table.chairs || []).map((chair) => renderInvitationChair(table, chair, assignedSeatKeys)).join("")}
          <div class="seat-plan-table__surface seat-plan-table__surface--${escapeAttribute(table.shape || "round")}">
            <strong>${escapeHtml(table.label || table.name)}</strong>
            <span>${escapeHtml(table.name || "Table")}</span>
            ${isAssigned ? '<small>Your table</small>' : ""}
          </div>
        </article>
      `;
    })
    .join("")}
      </div>
    </div>
  `;
  bindSeatPlanInteractions();
  requestAnimationFrame(() => fitInvitationSeatingPlan(false));
}

function getPartySize(guest) {
  return 1 + normalizeAdditionalGuests(guest?.additionalGuests);
}

function personKeyForIndex(index) {
  return Number(index) === 0 ? "main" : `guest-${Number(index)}`;
}

function partyLabelForIndex(index) {
  return Number(index) === 0 ? "Main Guest" : `Guest ${Number(index)}`;
}

function partyIndexFromKey(personKey) {
  if (personKey === "main") {
    return 0;
  }
  const match = String(personKey || "").match(/^guest-(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function getInvitationSeatAssignments(guest) {
  const tableAssignments = getTableAuthoritativeSeatAssignments(guest);
  if (tableAssignments !== null) {
    return tableAssignments;
  }

  const structured = Array.isArray(guest?.seatingAssignments) ? guest.seatingAssignments : [];
  const source = structured.length
    ? structured
    : guest?.tableId && guest?.seatNumber
      ? [{ tableId: guest.tableId, tableName: guest.tableName, seatNumber: guest.seatNumber, personKey: "main", label: "Main Guest" }]
      : [];
  return source
    .map((assignment, index) => {
      const personKey = assignment.personKey || personKeyForIndex(Number.isInteger(Number(assignment.partyMemberIndex)) ? Number(assignment.partyMemberIndex) : index);
      const partyIndex = partyIndexFromKey(personKey);
      const table = state.tables.find((item) => item.id === assignment.tableId);
      const chair = table?.chairs?.find((item) => String(item.seatNumber) === String(assignment.seatNumber));
      if (!table || !chair) return null;
      return {
        tableId: assignment.tableId || "",
        tableName: assignment.tableName || table?.name || "",
        seatNumber: String(assignment.seatNumber || ""),
        personKey,
        label: assignment.label || partyLabelForIndex(partyIndex),
      };
    })
    .filter(Boolean)
    .sort((a, b) => partyIndexFromKey(a.personKey) - partyIndexFromKey(b.personKey));
}

function getTableAuthoritativeSeatAssignments(guest) {
  const guestId = String(guest?.guestId || "");
  if (!guestId || !state.tables.length) {
    return null;
  }

  // Older plans used only guest mirrors.  Once a plan stores chair state, the
  // tables become authoritative, including the case where this guest has no
  // chair at all (so a stale mirror cannot show an old assignment).
  const tablesStoreChairState = state.tables.some((table) =>
    (table.chairs || []).some((chair) =>
      Object.prototype.hasOwnProperty.call(chair, "assignment") || Object.prototype.hasOwnProperty.call(chair, "guestId")
    )
  );
  if (!tablesStoreChairState) {
    return null;
  }

  return state.tables
    .flatMap((table) =>
      (table.chairs || []).map((chair, index) => {
        const assignment = chair.assignment || {};
        const assignedGuestId = String(assignment.guestId || chair.guestId || "");
        if (assignedGuestId !== guestId) return null;
        const partyMemberIndex = Number.isInteger(Number(assignment.partyMemberIndex)) ? Number(assignment.partyMemberIndex) : index;
        return {
          tableId: table.id,
          tableName: table.name || assignment.tableName || "",
          seatNumber: String(assignment.seatNumber || chair.seatNumber || ""),
          personKey: assignment.personKey || personKeyForIndex(partyMemberIndex),
          label: assignment.label || partyLabelForIndex(partyMemberIndex),
        };
      })
    )
    .filter((assignment) => assignment?.tableId && assignment.seatNumber)
    .sort((a, b) => partyIndexFromKey(a.personKey) - partyIndexFromKey(b.personKey));
}

function renderInvitationChair(table, chair, assignedSeatKeys) {
  const key = `${table.id}::${chair.seatNumber}`;
  const isAssignedToInvite = assignedSeatKeys.has(key);
  const assignment = getInvitationSeatAssignments(state.guest).find((item) => item.tableId === table.id && String(item.seatNumber) === String(chair.seatNumber));
  return `
    <span
      class="seat-plan-chair ${isAssignedToInvite ? "is-yours" : ""} ${chair.assignment || chair.guestId ? "is-occupied" : ""}"
      style="left:${Number(chair.x || 0)}%;top:${Number(chair.y || 0)}%;"
      title="${escapeAttribute(isAssignedToInvite ? `${assignment?.label || "Your seat"} - seat ${chair.seatNumber}` : `Seat ${chair.seatNumber}`)}"
    >${escapeHtml(isAssignedToInvite ? assignment?.label?.replace("Main Guest", "Main").replace("Guest ", "G") || String(chair.seatNumber) : String(chair.seatNumber))}</span>
  `;
}

function renderInvitationHallObject(item) {
  return `
    <div class="seat-plan-object seat-plan-object--${escapeAttribute(item.type)}" style="left:${Number(item.x || 0)}%;top:${Number(item.y || 0)}%;">
      <span>${escapeHtml(item.label || item.type)}</span>
    </div>
  `;
}

function bindSeatPlanInteractions() {
  const viewport = document.getElementById("seatPlanViewport");
  const canvas = document.getElementById("seatPlanCanvas");
  const toolbar = document.querySelector(".seat-plan-toolbar");
  if (!viewport || !canvas) {
    return;
  }
  const applyTransform = () => {
    canvas.style.transform = `translate(${state.seatPlanTransform.x}px, ${state.seatPlanTransform.y}px) scale(${state.seatPlanTransform.scale})`;
  };
  const zoomBy = (delta) => {
    state.seatPlanTransform.scale = clamp(state.seatPlanTransform.scale + delta, 0.55, 2.5);
    applyTransform();
  };
  const activePointers = new Map();
  const pointerDistance = () => {
    const points = [...activePointers.values()];
    if (points.length < 2) {
      return 0;
    }
    return Math.hypot(points[0].clientX - points[1].clientX, points[0].clientY - points[1].clientY);
  };
  toolbar?.addEventListener("click", (event) => {
    const control = event.target.closest("[data-seat-plan-control]")?.dataset.seatPlanControl;
    if (control === "zoom-in") zoomBy(0.15);
    if (control === "zoom-out") zoomBy(-0.15);
    if (control === "fit") fitInvitationSeatingPlan();
    if (control === "my-seats") centerInvitationSeats();
  });
  viewport.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 0.08 : -0.08);
  }, { passive: false });
  viewport.addEventListener("pointerdown", (event) => {
    viewport.setPointerCapture?.(event.pointerId);
    activePointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    state.seatPlanGesture = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: state.seatPlanTransform.x, y: state.seatPlanTransform.y };
    if (activePointers.size === 2) {
      state.seatPlanGesture = {
        mode: "pinch",
        distance: pointerDistance(),
        scale: state.seatPlanTransform.scale,
      };
    }
  });
  viewport.addEventListener("pointermove", (event) => {
    if (activePointers.has(event.pointerId)) {
      activePointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    }
    const gesture = state.seatPlanGesture;
    if (!gesture) {
      return;
    }
    if (gesture.mode === "pinch") {
      const nextDistance = pointerDistance();
      if (gesture.distance && nextDistance) {
        state.seatPlanTransform.scale = clamp(gesture.scale * (nextDistance / gesture.distance), 0.55, 2.5);
        applyTransform();
      }
      return;
    }
    if (gesture.pointerId !== event.pointerId) {
      return;
    }
    state.seatPlanTransform.x = gesture.x + event.clientX - gesture.startX;
    state.seatPlanTransform.y = gesture.y + event.clientY - gesture.startY;
    applyTransform();
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => {
    viewport.addEventListener(eventName, (event) => {
      activePointers.delete(event.pointerId);
      state.seatPlanGesture = null;
    });
  });
}

function fitInvitationSeatingPlan(reset = true) {
  const viewport = document.getElementById("seatPlanViewport");
  if (!viewport || (!reset && state.seatPlanHasFitted)) return;
  const canvasWidth = 1100;
  const canvasHeight = 720;
  const padding = 18;
  const scale = clamp(Math.min((viewport.clientWidth - padding * 2) / canvasWidth, (viewport.clientHeight - padding * 2) / canvasHeight), 0.28, 1);
  state.seatPlanTransform = {
    scale,
    x: Math.round((viewport.clientWidth - canvasWidth * scale) / 2),
    y: Math.round((viewport.clientHeight - canvasHeight * scale) / 2),
  };
  state.seatPlanHasFitted = true;
  const canvas = document.getElementById("seatPlanCanvas");
  if (canvas) canvas.style.transform = `translate(${state.seatPlanTransform.x}px, ${state.seatPlanTransform.y}px) scale(${scale})`;
}

function centerInvitationSeats() {
  const viewport = document.getElementById("seatPlanViewport");
  const canvas = document.getElementById("seatPlanCanvas");
  const assignment = getInvitationSeatAssignments(state.guest)[0];
  const table = state.tables.find((item) => item.id === assignment?.tableId);
  if (!viewport || !canvas || !table) return;
  const scale = clamp(Math.max(state.seatPlanTransform.scale, 0.62), 0.45, 1.25);
  state.seatPlanTransform = {
    scale,
    x: Math.round(viewport.clientWidth / 2 - (Number(table.x || 50) / 100) * 1100 * scale),
    y: Math.round(viewport.clientHeight / 2 - (Number(table.y || 50) / 100) * 720 * scale),
  };
  canvas.style.transform = `translate(${state.seatPlanTransform.x}px, ${state.seatPlanTransform.y}px) scale(${scale})`;
}

function createHallObjects() {
  return [
    { id: "stage-default", type: "stage", label: "Stage", x: 50, y: 8 },
    { id: "entrance-default", type: "entrance", label: "Entrance", x: 50, y: 90 },
  ];
}

function hydrateHallObjects(savedObjects) {
  const savedById = new Map(Array.isArray(savedObjects) ? savedObjects.map((item) => [item.id, item]) : []);
  return createHallObjects().map((item) => ({
    ...item,
    ...(savedById.get(item.id) || {}),
  }));
}

function defaultWidthForShape(shape) {
  return ["rectangle", "conference", "long-banquet"].includes(shape) ? 230 : ["horseshoe", "u-shape", "open-u"].includes(shape) ? 220 : 180;
}

function defaultHeightForShape(shape) {
  return ["rectangle", "conference", "long-banquet"].includes(shape) ? 140 : ["horseshoe", "u-shape", "open-u"].includes(shape) ? 180 : 180;
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
      </div>
    </div>
  `;
  await renderQrCode(document.getElementById("guestQrCode"), checkinUrl, { size: 220 });
}

async function updateRsvp(status, additionalGuests = 0) {
  if (state.mode !== "firebase" || !state.guest?.guestId) {
    return;
  }

  try {
    const nextAdditionalGuests = status === "confirmed" ? normalizeAdditionalGuests(additionalGuests) : 0;
    await updateDoc(
      doc(initFirebase().db, "weddings", state.weddingId, "guests", state.guest.guestId),
      {
        rsvpStatus: status,
        additionalGuests: nextAdditionalGuests,
        updatedAt: serverTimestamp(),
      }
    );
    if (state.guestToken) {
      // Keep the token-keyed public mirror fresh so reloading this page shows the saved answer.
      await updateDoc(
        doc(initFirebase().db, "weddings", state.weddingId, "publicGuests", state.guestToken),
        {
          rsvpStatus: status,
          additionalGuests: nextAdditionalGuests,
          updatedAt: serverTimestamp(),
        }
      ).catch((error) => {
        console.warn("RSVP mirror update failed.", error);
      });
    }
    state.guest.rsvpStatus = status;
    state.guest.additionalGuests = nextAdditionalGuests;
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
      JSON.stringify({ status: "No", additionalGuests: "0", savedAt: new Date().toISOString() })
    );
    state.isRsvpEditing = false;
    renderRsvp();
    return;
  }

  const response = {
    status: statusValue,
    additionalGuests: "0",
    savedAt: new Date().toISOString(),
  };

  localStorage.setItem(rsvpStorageKey, JSON.stringify(response));
  state.isRsvpEditing = false;
  renderRsvp();
}

async function handleFirebaseRsvpSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const statusValue = form.elements.status.value;
  await updateRsvp(statusValue, 0);
}

function setupRsvpPhases(form) {
  if (!form) {
    return;
  }

  const statusInputs = form.querySelectorAll('input[name="status"]');
  const submitButton = form.querySelector(".rsvp-form__submit");

  const updateFlow = (statusValue) => {
    submitButton.hidden = !(statusValue === "Yes" || statusValue === "No" || statusValue === "confirmed" || statusValue === "declined");
  };

  statusInputs.forEach((input) => input.addEventListener("change", () => updateFlow(input.value)));
}

function readSavedRsvp() {
  try {
    const saved = localStorage.getItem(rsvpStorageKey);
    return saved ? JSON.parse(saved) : null;
  } catch (error) {
    return null;
  }
}

function normalizeAdditionalGuests(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.min(Math.max(parsed, 0), 10);
}

function clamp(value, min, max) {
  return Math.min(Math.max(Number(value) || 0, min), max);
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
