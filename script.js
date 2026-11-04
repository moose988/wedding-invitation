import { invitationRefreshIsCurrent, invitationRsvpStorageKey, invitationRsvpView } from "./invitations/shared/rsvp-state.js";
import { buildSatelliteMapEmbedUrl } from "./invitations/shared/map-embed.js";
import { buildInvitationCalendar } from "./invitations/shared/calendar.js";
import { renderQrCode } from "./qr.js?v=20261017-qr-module-fix";
import { createIntroSequence } from "./intro-sequence.js?v=20261028-finish-at-1";
import {
  buildChairPositions,
  buildSeatAssignmentKeys,
  defaultTableHeight,
  defaultTableWidth,
  getContrastingTextColor,
  getSeatPlanFrameBounds,
  getSeatPlanFocusBounds,
  normalizeTableShape,
  resolveTableName,
} from "./seating-utils.js?v=20261018-invitation-seat-map";
import { getEventDisplayTitle, isCelebrationEvent } from "./event-utils.js";
import { formatPartySeatLabel, getPartySeatSelection, resolvePartySeatTarget, retainPartySeatSelection } from "./invitations/wedding-designs/layla-zaid/party-seat-selector.js?v=20261027-seat-label-1";
import { renderLaylaScheduleIcon, resolveLaylaScheduleIcon } from "./invitations/wedding-designs/layla-zaid/schedule-icons.js?v=20261027-timeline-icons-2";

const demoWedding = {
  coupleName: "Layla & Zaid",
  brideName: "Layla",
  groomName: "Zaid",
  brideNameAr: "ليلى",
  groomNameAr: "زايد",
  subtitleEn: "With love, we invite you to celebrate our wedding evening.",
  subtitleAr: "بكل الحب ندعوكم لمشاركتنا فرحة العمر.",
  invitationMessageEn:
    "On an evening filled with love and grace, we would be honored by your presence as we begin a beautiful new chapter together.",
  invitationMessageAr:
    "في مساء يفيض حباً وطمأنينة، نتشرف بحضوركم لتشهدوا معنا بداية فصل جديد من العمر.",
  eventDateISO: "2026-12-20T20:00:00+04:00",
  schedule: [
    { time: "7:30 PM", timeAr: "٧:٣٠ مساءً", titleEn: "Welcome & arrival", titleAr: "استقبال الضيوف", descriptionEn: "A warm welcome as everyone gathers.", descriptionAr: "نرحب بكم مع بداية الأمسية." },
    { time: "8:00 PM", timeAr: "٨:٠٠ مساءً", titleEn: "A celebration of love", titleAr: "احتفال بالحب", descriptionEn: "Join us for the wedding celebration.", descriptionAr: "نحتفل معاً بهذه المناسبة السعيدة." },
    { time: "9:00 PM", timeAr: "٩:٠٠ مساءً", titleEn: "Dinner & dancing", titleAr: "العشاء والرقص", descriptionEn: "An evening of good food and joyful company.", descriptionAr: "أمسية من الطعام الطيب والفرح." },
  ],
  timeEn: "8:00 PM",
  timeAr: "الساعة ٨:٠٠ مساءً",
  venueEn: "Sofitel Dubai The Palm",
  venueAr: "سوفيتيل دبي النخلة",
  locationEn: "Palm Jumeirah, Dubai, United Arab Emirates",
  locationAr: "نخلة جميرا، دبي، الإمارات العربية المتحدة",
  venueMapEmbedUrl: "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3884.645870813754!2d55.12983347537994!3d25.139942477747873!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3e5f154a3af8b24f%3A0x6607557459d2717c!2sSofitel%20Dubai%20The%20Palm!5e1!3m2!1sen!2sae!4v1791536214433!5m2!1sen!2sae",
  mapsUrl: "https://www.google.com/maps/dir/?api=1&destination=25.139942477747873%2C55.12983347537994",
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
  phone: "",
  side: "groom",
  rsvpStatus: "pending",
  seatNumber: "",
  tableId: "",
  tableName: "",
  inviteLink: window.location.href,
  qrCodeValue: "",
  checkedIn: false,
  notes: "",
};
const sampleRsvpGuestName = "Avery Morgan";

const demoTables = [
  { id: "table-a", name: "Moonlight", capacity: 8, x: 20, y: 24, shape: "round", floorZone: "Grand Hall" },
  { id: "table-b", name: "Rose Gold", capacity: 8, x: 62, y: 18, shape: "round", floorZone: "Grand Hall" },
  { id: "table-c", name: "Emerald Garden", capacity: 10, x: 26, y: 62, shape: "rectangle", floorZone: "Garden Wing" },
  { id: "table-d", name: "Pearl Lounge", capacity: 10, x: 68, y: 60, shape: "rectangle", floorZone: "Garden Wing" },
];

const invitationParams = new URLSearchParams(window.location.search);
const initialInvitationCredential = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
const explicitDemoMode = invitationParams.get("demo") === "1";
const explicitSampleMode = invitationParams.get("sample") === "1" && invitationParams.get("wedding") === "luxury-wedding-demo";
const rsvpStorageKey = explicitSampleMode ? "" : invitationRsvpStorageKey(invitationParams.get("wedding"), initialInvitationCredential.get("guest"));
let invitationDataApiPromise = null;
const laylaLanguageStorageKey = "layla-zaid-invitation-language";
const laylaCopy = {
  heroKicker: { en: "Our Wedding Day", ar: "يوم زفافنا" },
  playMusic: { en: "Play event music", ar: "تشغيل موسيقى الحفل" },
  stopMusic: { en: "Pause event music", ar: "إيقاف موسيقى الحفل" },
  musicUnavailable: { en: "Event music unavailable", ar: "موسيقى الحفل غير متاحة" },
  introCaption: { en: "A love story awaits — tap to open", ar: "تنتظركم حكاية حب — اضغطوا لفتح الدعوة" },
  invitationPreparing: { en: "Preparing your invitation…", ar: "جارٍ تجهيز دعوتكم…" },
  openInvitation: { en: "Open your wedding invitation", ar: "افتحوا دعوة زفافكم" },
  retryOpening: { en: "Tap to retry opening", ar: "اضغطوا لإعادة محاولة الفتح" },
  introLoading: { en: "Opening your invitation…", ar: "جارٍ فتح دعوتكم…" },
  introRetry: { en: "Still loading. Tap the envelope to retry or skip.", ar: "ما زال التحميل جارياً. اضغطوا على الظرف لإعادة المحاولة أو تخطّي الحركة." },
  introBlocked: { en: "The animation could not start. Tap the envelope to retry or skip.", ar: "تعذّر بدء الحركة. اضغطوا على الظرف لإعادة المحاولة أو تخطّي الحركة." },
  introError: { en: "The animation is unavailable. Tap the envelope to retry or skip.", ar: "الحركة غير متاحة. اضغطوا على الظرف لإعادة المحاولة أو تخطّي الحركة." },
  skip: { en: "Skip", ar: "تخطي" },
  viewDetails: { en: "View details", ar: "عرض التفاصيل" },
  scrollDetails: { en: "Scroll to event details", ar: "انتقلوا إلى تفاصيل الحفل" },
  videoLabel: { en: "The wedding invitation envelope opening", ar: "فتح مظروف دعوة الزفاف" },
  mapTitle: { en: "Satellite map preview for", ar: "معاينة القمر الصناعي لـ" },
  countdownLabel: { en: "Until we celebrate", ar: "حتى نحتفل معاً" },
  countdownHeading: { en: "The day is drawing near", ar: "اقترب موعد لقائنا" },
  invitationLabel: { en: "Invitation", ar: "الدعوة" },
  invitationHeading: { en: "An Evening of Love and Grace", ar: "أمسية من الحب والرقي" },
  venue: { en: "Venue", ar: "القاعة" },
  hall: { en: "Hall", ar: "الصالة" },
  detailsLabel: { en: "Details", ar: "التفاصيل" },
  detailsHeading: { en: "A place to gather", ar: "مكان يجمعنا" },
  detailOptions: { en: "Event details", ar: "تفاصيل المناسبة" },
  loadMapPreview: { en: "Load map preview", ar: "تحميل معاينة الخريطة" },
  mapPreviewLoading: { en: "Loading the map preview…", ar: "جارٍ تحميل معاينة الخريطة…" },
  mapPreviewError: { en: "Map preview could not load. Use the directions link instead.", ar: "تعذر تحميل معاينة الخريطة. استخدموا رابط الاتجاهات." },
  retryConnection: { en: "Retry connection", ar: "إعادة المحاولة" },
  scheduleLabel: { en: "The Wedding Evening", ar: "أمسية الزفاف" },
  scheduleHeading: { en: "A celebration of love", ar: "احتفال بالحب" },
  seatingHeading: { en: "A place reserved for you", ar: "مقاعدنا بانتظاركم" },
  seatLabel: { en: "Your Seats", ar: "مقاعدك" },
  rsvpLabel: { en: "RSVP", ar: "تأكيد الحضور" },
  rsvpHeading: { en: "Will you join us?", ar: "هل ستشاركوننا فرحتنا؟" },
  passLabel: { en: "Entrance Pass", ar: "بطاقة الدخول" },
  passHeading: { en: "Your QR Access", ar: "رمز الدخول الخاص بك" },
  dateTime: { en: "Date & Time", ar: "التاريخ والوقت" },
  location: { en: "Location", ar: "الموقع" },
  viewLocation: { en: "View Location", ar: "عرض الموقع" },
  openInMaps: { en: "Open in Maps", ar: "افتح في الخرائط" },
  mapUnavailable: { en: "Map preview is unavailable. Use directions for the venue location.", ar: "معاينة الخريطة غير متاحة. استخدم الاتجاهات للوصول إلى موقع القاعة." },
  sampleInvitation: { en: "Sample invitation", ar: "نموذج دعوة" },
  sampleNotice: { en: "You’re viewing a sample invitation. Guest names, seating assignments, RSVP, and entrance passes are not included.", ar: "أنتم تشاهدون نموذجاً للدعوة. لا تظهر أسماء الضيوف أو المقاعد المخصصة أو تأكيد الحضور أو بطاقات الدخول." },
  sampleRsvpNote: { en: "Sample invitation — try the RSVP experience. No real response will be sent.", ar: "نموذج دعوة — جرّبوا تجربة تأكيد الحضور. لن يتم إرسال أي رد حقيقي." },
  exploreDetails: { en: "Explore event details", ar: "استكشفوا تفاصيل الحفل" },
  rsvp: { en: "RSVP", ar: "تأكيد الحضور" },
  calendar: { en: "Add to Calendar", ar: "أضف إلى التقويم" },
  attending: { en: "Will you be joining us?", ar: "هل ستشاركوننا؟" },
  yes: { en: "Yes, I'll be there.", ar: "نعم، سأكون معكم." }, no: { en: "Can't make it.", ar: "أعتذر عن الحضور." },
  messageLabel: { en: "A little note for the couple (optional)", ar: "رسالة صغيرة للعروسين (اختياري)" },
  messagePlaceholder: { en: "Write a note…", ar: "اكتبوا رسالتكم…" },
  sendRsvp: { en: "Send RSVP", ar: "إرسال التأكيد" },
  rsvpConfirmed: { en: "RSVP Confirmed", ar: "تم تأكيد الحضور" },
  attendanceConfirmed: { en: "Thank you, {name}!", ar: "شكرًا لك، {name}!" },
  attendanceConfirmedThanks: {
    en: "We can’t wait to celebrate with you.",
    ar: "نتطلع للاحتفال معك.",
  },
  attendanceDeclined: { en: "We'll miss you, {name}.", ar: "سنفتقدك، {name}." },
  changeResponse: { en: "Change response", ar: "تغيير الرد" },
  responseSaving: { en: "Saving your response…", ar: "جارٍ حفظ ردك…" },
  responseSaved: { en: "Your response has been saved.", ar: "تم حفظ ردك." },
  responseSaveError: { en: "We could not save your response. Please try again.", ar: "تعذر حفظ ردك. يرجى المحاولة مرة أخرى." },
  retryResponse: { en: "Retry", ar: "إعادة المحاولة" },
  pendingResponse: { en: "Your response is pending. Please choose an option.", ar: "لم يتم تسجيل ردك بعد. يرجى اختيار أحد الخيارات." },
  attendanceDeclinedThanks: { en: "We're sorry you'll miss the celebration — you'll be in our hearts on the day.", ar: "يؤسفنا أنك لن تشاركنا الاحتفال، وستكون في قلوبنا يوم الفرح." },
  declinedLabel: { en: "Response saved", ar: "تم حفظ الرد" },
  qrInstructions: { en: "Present this QR code at the entrance.", ar: "يرجى إبراز رمز QR عند المدخل." },
  madeBy: { en: "Made by", ar: "تصميم" },
  deadline: { en: "Kindly reply by", ar: "يرجى الرد قبل" },
  dear: { en: "Dear", ar: "عزيزنا" },
  companion: { en: "Companion", ar: "المرافق" },
  guestFallback: { en: "Guest", ar: "ضيف" },
  partySeatSelectorLabel: { en: "Choose a party member to find their seat", ar: "اختر فرداً من مجموعتك للعثور على مقعده" },
  seatNotAssigned: { en: "Seat not assigned yet", ar: "لم يتم تخصيص مقعد بعد" },
  seatNotAssignedSelected: { en: "This guest does not have an assigned seat yet.", ar: "لم يتم تخصيص مقعد لهذا الضيف بعد." },
  selectedSeatStatus: { en: "Map focused on {name}’s assigned chair.", ar: "تم تحديد مقعد {name} على المخطط." },
  tableChair: { en: "Table {table} · Chair {chair}", ar: "الطاولة {table} · المقعد {chair}" },
  fit: { en: "Fit", ar: "ملاءمة" },
  seatsPending: { en: "Your seats have not been assigned yet.", ar: "لم يتم تخصيص مقاعد لكم بعد." },
  yourTable: { en: "Your table", ar: "طاولتك" }, seatingEmpty: { en: "A seating map will appear here once the venue layout is published.", ar: "ستظهر خريطة المقاعد هنا عند نشر مخطط القاعة." },
};

const state = {
  mode: explicitSampleMode ? "sample" : (explicitDemoMode ? "demo" : "unavailable"),
  sampleMode: explicitSampleMode,
  weddingId: "",
  guestToken: "",
  guestId: "",
  wedding: structuredClone(demoWedding),
  guest: null,
  tables: [...demoTables],
  hallObjects: hydrateHallObjects(),
  assignedTable: null,
  seatPlanTransform: { scale: 1, x: 0, y: 0 },
  seatPlanGesture: null,
  seatPlanHasFitted: false,
  seatPlanViewMode: "fit",
  seatPlanFocusedAssignments: [],
  seatPlanSelectedTarget: null,
  seatingSelectedPersonKey: "",
  activeDetailTab: "date",
  detailItems: [],
  firebaseReady: false,
  laylaLanguage: document.body?.classList.contains("layla-zaid-invitation") && localStorage.getItem(laylaLanguageStorageKey) === "ar" ? "ar" : "en",
  invitationOpening: false,
  introCompletion: null,
  introSequence: null,
  introFinished: false,
  invitationReady: false,
  invitationLoadRetryable: false,
  introPageHideHandler: null,
  rsvpMessage: "",
  revealObserver: null,
  motionObserver: null,
  invitationRefreshVersion: 0,
  isRsvpSaving: false,
  rsvpSaveError: "",
  rsvpSelection: "",
  sampleRsvpResponse: null,
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

let laylaMapPreviewObserver = null;

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
  introStatus: document.getElementById("introStatus"),
  introRetryLabel: document.getElementById("introRetryLabel"),
  openInvitationButton: document.getElementById("openInvitation"),
  openingVideo: document.getElementById("openingVideo"),
  skipOpeningButton: document.getElementById("skipOpening"),
  weddingAudio: document.getElementById("weddingAudio"),
  musicToggle: document.getElementById("musicToggle"),
  heroBackdrop: document.getElementById("heroBackdrop"),
  stickyActions: document.getElementById("stickyActions"),
  guestSpotlightSection: document.getElementById("guestSpotlightSection"),
  rsvpMount: document.getElementById("rsvpMount"),
  seatingSection: document.getElementById("seatingSection"),
  qrPassSection: document.getElementById("qrPassSection"),
  toastRail: document.getElementById("toastRail"),
};

document.body.classList.add("intro-active");

boot();

function setupIntroSequence() {
  if (!elements.introScreen || state.introSequence) return;
  state.introSequence = createIntroSequence({
    video: elements.openingVideo,
    startupTimeout: isLaylaInvitation() ? 10000 : undefined,
    bufferTimeout: isLaylaInvitation() ? 10000 : undefined,
    // The Layla envelope video's motion settles at ~3s of its 4.5s; the rest is a still frame.
    finishAt: isLaylaInvitation() ? 3 : null,
    onState: updateIntroPresentation,
    onFrame: () => {
      elements.introScreen?.classList.add("is-playing");
    },
    onComplete: () => completeIntroSequence(),
  });
  state.introCompletion = () => state.introSequence?.skip();
  state.introPageHideHandler = () => disposeIntroSequence();
  window.addEventListener("pagehide", state.introPageHideHandler, { once: true });
}

function completeIntroSequence() {
  state.introFinished = true;
  if (state.invitationReady) {
    revealInvitation();
    return;
  }
  state.invitationOpening = true;
  if (elements.introStatus) {
    elements.introStatus.hidden = false;
    elements.introStatus.textContent = laylaText("invitationPreparing");
  }
  if (elements.skipOpeningButton) elements.skipOpeningButton.hidden = true;
}

function markInvitationReady() {
  document.documentElement.style.visibility = "";
  state.invitationReady = true;
  if (state.introFinished) revealInvitation();
}

function getInvitationDataApi() {
  if (!invitationDataApiPromise) {
    invitationDataApiPromise = import("./invitations/shared/invitation-data.js?v=20261027-layla-lazy-public-firebase");
  }
  return invitationDataApiPromise;
}

function withTimeout(promise, milliseconds, message) {
  let timeoutId;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeoutId = window.setTimeout(() => reject(Object.assign(new Error(message), { transient: true, code: "deadline-exceeded" })), milliseconds);
    }),
  ]).finally(() => window.clearTimeout(timeoutId));
}

function getInvitationParams(location = window.location) {
  const params = new URLSearchParams(location.search);
  const credential = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
  const guestId = credential.get("recipient")?.trim() || "";
  return {
    weddingId: params.get("wedding")?.trim() || "",
    guestToken: credential.get("guest")?.trim() || "",
    guestId: /^[A-Za-z0-9_-]{1,128}$/.test(guestId) ? guestId : "",
  };
}

function invitationSeatingEnabled(wedding) {
  return wedding?.seatingEnabled !== false;
}

function updateIntroPresentation(phase) {
  const retryable = ["retry", "blocked", "error"].includes(phase);
  const opening = ["loading", "buffering", "retry", "playing", "fallback"].includes(phase);
  elements.introScreen?.classList.toggle("is-opening", opening);
  elements.introScreen?.classList.toggle("is-retryable", retryable);
  if (["blocked", "error"].includes(phase)) {
    state.invitationOpening = false;
    elements.introScreen?.classList.remove("is-playing");
  } else if (opening) {
    state.invitationOpening = true;
  }

  const statusKey = {
    loading: "introLoading",
    retry: "introRetry",
    blocked: "introBlocked",
    error: "introError",
  }[phase];
  if (elements.introStatus) {
    elements.introStatus.hidden = !statusKey;
    elements.introStatus.textContent = statusKey ? laylaText(statusKey) : "";
  }
  if (elements.introRetryLabel) {
    elements.introRetryLabel.textContent = retryable ? laylaText("retryOpening") : "";
  }
  elements.openInvitationButton?.setAttribute("aria-label", laylaText(retryable ? "retryOpening" : "openInvitation"));
}

function disposeIntroSequence() {
  state.introSequence?.dispose();
  state.introSequence = null;
  state.introCompletion = null;
  if (state.introPageHideHandler) {
    window.removeEventListener("pagehide", state.introPageHideHandler);
    state.introPageHideHandler = null;
  }
}

async function boot() {
  bindBaseEvents();
  if (isLaylaInvitation()) setupLaylaNoticeClearance();
  setupIntroSequence();
  void warmEnvelopeAssets();
  setupRevealObserver();
  setupAudioState();
  setupStickyFooterAwareness();
  renderCountdownCards();

  const { weddingId, guestToken, guestId } = getUrlParams();
  state.weddingId = weddingId;
  state.guestToken = guestToken;
  state.guestId = guestId;

  if (elements.weddingAudio?.querySelector("source")) {
    elements.weddingAudio.querySelector("source").src = demoWedding.media.audio;
    elements.weddingAudio.load();
  }

  if (state.sampleMode) {
    if (weddingId !== "luxury-wedding-demo") {
      renderInvitationAccessError("This sample invitation is unavailable.");
      return;
    }
    // Sample mode always uses the built-in fictional fixture and never reads a
    // live event, guest record, seating map, or RSVP token.
    state.mode = "sample";
    state.wedding = normaliseWedding({ ...demoWedding, id: weddingId });
    state.hallObjects = hydrateHallObjects(state.wedding.hallObjects);
    populateInvitation();
    setupCountdown();
    markInvitationReady();
    return;
  }

  if (!explicitDemoMode && (!weddingId || !guestToken)) {
    renderInvitationAccessError("This invitation link is incomplete. Please use the personal link shared by the couple.");
    return;
  }

  if (weddingId && guestToken) {
    try {
      const invitationApi = await withTimeout(getInvitationDataApi(), 12000, "The invitation service is taking longer than expected. Please try again.");
      if (invitationApi.isFirebaseConfigured()) {
        state.mode = "firebase";
        const redirected = await loadFirebaseInvitation(weddingId, guestToken, invitationApi);
        if (redirected) return;
        state.unsubGuest = invitationApi.subscribeToInvitation(
          { weddingId, guestToken, guestId },
          (context) => applyInvitationContext(context),
          (error) => {
            console.error("Invitation refresh failed.", error);
            if (error.transient) { showInvitationConnectionError(error.message); return; }
            renderInvitationAccessError("This invitation is no longer available. Please ask the couple for a new link.");
          },
          { schedule: Boolean(document.getElementById("scheduleMount")) },
        );
        window.addEventListener("pagehide", () => state.unsubGuest?.(), { once: true });
        markInvitationReady();
      } else if (!explicitDemoMode) {
        renderInvitationAccessError("This invitation service is not configured. Please ask the couple for a new link.");
        return;
      }
    } catch (error) {
      console.error(error);
      state.mode = "unavailable";
      state.invitationLoadRetryable = Boolean(error.transient || error.name === "TypeError");
      renderInvitationAccessError(error.transient ? error.message : "We could not open this invitation. Please check the link and try again.");
      return;
    }
  } else if (!explicitDemoMode) {
    renderInvitationAccessError("This invitation service is not configured. Please ask the couple for a new link.");
    return;
  }

  populateInvitation();
  setupCountdown();
  markInvitationReady();
}

function renderInvitationAccessError(message) {
  document.documentElement.style.visibility = "";
  disposeIntroSequence();
  document.body.classList.remove("intro-active");
  const isArabic = isLaylaInvitation() && state.laylaLanguage === "ar";
  const unavailable = isArabic ? "الدعوة غير متاحة" : "Invitation unavailable";
  const privateInvite = isArabic ? "دعوة شخصية" : "Private invitation";
  const localizedMessage = isArabic
    ? (/incomplete/i.test(message) ? "رابط الدعوة غير مكتمل. يرجى استخدام الرابط الشخصي الذي شاركه العروسان." : /configured/i.test(message) ? "خدمة الدعوة غير مهيأة. يرجى التواصل مع العروسين." : "هذه الدعوة غير متاحة. يرجى طلب رابط جديد من العروسين.")
    : message;
  document.body.innerHTML = `<main class="invitation-error"><section class="invitation-error__card"><p class="section-kicker">${privateInvite}</p><h1>${unavailable}</h1><p>${escapeHtml(localizedMessage)}</p>${state.invitationLoadRetryable ? `<button class="luxury-button luxury-button--secondary" type="button" data-retry-invitation>${escapeHtml(laylaText("retryConnection"))}</button>` : ""}</section></main>`;
  document.querySelector("[data-retry-invitation]")?.addEventListener("click", () => location.reload());
}

function showInvitationConnectionError(message) {
  let notice = document.getElementById("invitationConnectionError");
  if (!notice) { notice = document.createElement("aside"); notice.id = "invitationConnectionError"; notice.setAttribute("role", "status"); document.body.prepend(notice); }
  notice.textContent = message + " ";
  const retry = document.createElement("button"); retry.textContent = "Retry updates";
  retry.addEventListener("click", () => location.reload(), { once: true }); notice.append(retry);
}

window.addEventListener("pageshow", (event) => { if (event.persisted) location.reload(); });

function warmEnvelopeAssets() {
  const images = [...document.querySelectorAll(".envelope-intro__poster, .venue-illustration")];
  return Promise.allSettled(images.map((image) => image.decode ? Promise.race([image.decode().catch(() => undefined), new Promise((resolve) => window.setTimeout(resolve, 900))]) : Promise.resolve()));
}

function getUrlParams() {
  const params = getInvitationParams();
  return { ...params, guestToken: explicitSampleMode ? "" : params.guestToken };
}

async function loadFirebaseInvitation(weddingId, guestToken, invitationApi, requestVersion = ++state.invitationRefreshVersion) {
  const context = await withTimeout(
    invitationApi.loadInvitationContext({ weddingId, guestToken, guestId: state.guestId }),
    12000,
    "Guest details are taking longer than expected. Please try again.",
  );
  if (!invitationRefreshIsCurrent(requestVersion, state.invitationRefreshVersion)) return;
  if (context.wedding.invitationTemplate === "layla-zaid" && !isLaylaInvitation()) {
    const target = new URL("./invitations/wedding-designs/layla-zaid/index.html", window.location.href);
    target.search = window.location.search;
    target.hash = window.location.hash;
    window.location.replace(target.href);
    return true;
  }
  applyInvitationContext(context);
  return false;
}

function applyInvitationContext(context) {
  state.wedding = normaliseWedding(context.wedding);
  const publishedLanguage = context.wedding.invitationLanguage === "ar" ? "ar" : "en";
  if (state.publishedInvitationLanguage !== publishedLanguage) {
    state.laylaLanguage = publishedLanguage;
    state.publishedInvitationLanguage = publishedLanguage;
  }
  document.documentElement.lang = state.laylaLanguage;
  state.guest = context.guest;
  state.hallObjects = hydrateHallObjects(state.wedding.hallObjects, state.mode === "firebase");
  state.tables = Array.isArray(state.wedding.tables) ? state.wedding.tables : [];
  const primaryAssignment = getInvitationSeatAssignments(state.guest)[0];
  state.assignedTable = state.tables.find((table) => table.id === primaryAssignment?.tableId) || null;
  if (state.mode === "firebase") {
    populateInvitation();
    setupCountdown();
  }
}

function normaliseWedding(wedding) {
  const normalised = {
    ...structuredClone(demoWedding),
    ...wedding,
    eventTitle: wedding.eventTitle || "",
    coupleName: wedding.coupleName || "",
    brideName: wedding.brideName || "",
    groomName: wedding.groomName || "",
    brideNameAr: wedding.brideNameAr || "",
    groomNameAr: wedding.groomNameAr || "",
    subtitleEn: wedding.subtitleEn || "",
    subtitleAr: wedding.subtitleAr || "",
    invitationMessageEn: wedding.invitationMessageEn || "",
    invitationMessageAr: wedding.invitationMessageAr || "",
    eventDateISO: wedding.eventDateISO || "",
    timeEn: wedding.timeEn || "",
    timeAr: wedding.timeAr || "",
    venueEn: wedding.venueEn || wedding.venueName || "",
    venueAr: wedding.venueAr || wedding.venueNameAr || "",
    hallEn: wedding.hallEn || wedding.hall || wedding.hallName || "",
    hallAr: wedding.hallAr || wedding.hall || "",
    location: wedding.location || "",
    locationEn: wedding.locationEn || wedding.location || "",
    locationAr: wedding.locationAr || "",
    mapsUrl: wedding.mapsUrl || "",
    venueMapEmbedUrl: wedding.venueMapEmbedUrl || "",
    closingEn: wedding.closingEn || "",
    closingAr: wedding.closingAr || "",
    media: {
      ...demoWedding.media,
      ...(wedding.media || {}),
    },
    palette: Array.isArray(wedding.palette) && wedding.palette.length ? wedding.palette : demoWedding.palette,
    schedule: Array.isArray(wedding.schedule) ? wedding.schedule : [],
  };

  // Some older records were created through a form that converted Arabic
  // characters to literal question marks. Keep the invitation readable while
  // those records are being migrated in Firestore.
  return repairCorruptedArabicText(normalised);
}

function repairCorruptedArabicText(wedding) {
  const isCorrupted = (value) => typeof value === "string" && /\?{2,}/.test(value);
  const sampleDefaults = wedding.id === "luxury-wedding-demo" ? {
    brideNameAr: demoWedding.brideNameAr,
    groomNameAr: demoWedding.groomNameAr,
    subtitleAr: demoWedding.subtitleAr,
    invitationMessageAr: demoWedding.invitationMessageAr,
    closingAr: demoWedding.closingAr,
  } : {};
  const fallbacks = {
    brideNameAr: wedding.brideName,
    groomNameAr: wedding.groomName,
    eventTitleAr: wedding.eventTitle || wedding.coupleName,
    coupleNameAr: wedding.coupleName || wedding.eventTitle,
    subtitleAr: wedding.subtitleEn,
    invitationMessageAr: wedding.invitationMessageEn,
    timeAr: wedding.timeEn,
    venueAr: wedding.venueEn || wedding.venueName,
    venueNameAr: wedding.venueEn || wedding.venueName,
    hallAr: wedding.hallEn || wedding.hall || wedding.hallName,
    locationAr: wedding.locationEn || wedding.location,
    dressCodeAr: wedding.dressCodeEn,
    closingAr: wedding.closingEn,
  };
  const repaired = { ...wedding };

  for (const [key, fallback] of Object.entries(fallbacks)) {
    if (isCorrupted(repaired[key])) repaired[key] = sampleDefaults[key] || fallback || "";
  }

  if (Array.isArray(repaired.schedule)) {
    repaired.schedule = repaired.schedule.map((item, index) => {
      if (!item || typeof item !== "object") return item;
      const sampleItem = wedding.id === "luxury-wedding-demo" ? demoWedding.schedule[index] : null;
      return {
        ...item,
        timeAr: isCorrupted(item.timeAr) ? (sampleItem?.timeAr || item.time || "") : item.timeAr,
        titleAr: isCorrupted(item.titleAr) ? (sampleItem?.titleAr || item.titleEn || "") : item.titleAr,
        descriptionAr: isCorrupted(item.descriptionAr) ? (sampleItem?.descriptionAr || item.descriptionEn || "") : item.descriptionAr,
      };
    });
  }

  return repaired;
}

function populateInvitation() {
  const activeElement = document.activeElement;
  const activeName = elements.rsvpMount?.contains(activeElement) ? activeElement?.getAttribute("name") : "";
  const selection = activeName && typeof activeElement.selectionStart === "number"
    ? [activeElement.selectionStart, activeElement.selectionEnd]
    : null;
  const wedding = state.wedding;
  const sampleBanner = document.getElementById("samplePreviewBanner");
  if (sampleBanner) sampleBanner.hidden = !state.sampleMode;
  const englishNames = isCelebrationEvent(wedding)
    ? getEventDisplayTitle(wedding)
    : `${wedding.brideName} & ${wedding.groomName}`;
  const arabicNames = isCelebrationEvent(wedding) ? "" : [wedding.brideNameAr || wedding.brideName, wedding.groomNameAr || wedding.groomName].filter(Boolean).join(" و ");

  document.title = `${wedding.eventTitle || englishNames} | Wedding Invitation`;
  setText("heroArabicNames", arabicNames);
  setText("heroEnglishNames", englishNames);
  setText("heroSubtitleArabic", wedding.subtitleAr);
  setText("heroSubtitleEnglish", wedding.subtitleEn);
  setText("invitationMessageArabic", wedding.invitationMessageAr);
  setText("invitationMessageEnglish", wedding.invitationMessageEn);
  setText("closingArabic", wedding.closingAr);
  setText("closingEnglish", wedding.closingEn);
  const dateText = state.laylaLanguage === "ar" ? formatArabicDate(wedding.eventDateISO) : formatDate(wedding.eventDateISO);
  const heroDetails = [dateText, laylaValue(wedding.timeEn || eventTimeFromDate(wedding), wedding.timeAr || eventTimeFromDate(wedding, "ar")), laylaValue(wedding.venueEn || wedding.venueName, wedding.venueAr || wedding.venueNameAr)].filter(Boolean);
  const eventLine = document.getElementById("heroEventLine");
  if (isLaylaInvitation() && eventLine) {
    eventLine.replaceChildren(...heroDetails.map((text) => {
      const line = document.createElement("span");
      line.textContent = text;
      return line;
    }));
  } else {
    setText("heroEventLine", heroDetails.join(" · "));
  }
  if (elements.weddingAudio?.querySelector("source") && wedding.media.audio) {
    const source = elements.weddingAudio.querySelector("source");
    const nextSource = new URL(wedding.media.audio, document.baseURI).toString();
    if (source.src !== nextSource) {
      source.src = nextSource;
      elements.weddingAudio.load();
    }
  }

  renderActions();
  renderDetails();
  renderSchedule();
  renderGuestCard();
  renderRsvp();
  renderSeatSection();
  renderGuestQrPass();
  applyLaylaLanguage();
  setupRevealObserver();
  if (activeName) {
    const replacement = elements.rsvpMount.querySelector(`[name="${activeName}"]`);
    replacement?.focus({ preventScroll: true });
    if (replacement && selection && typeof replacement.setSelectionRange === "function") {
      replacement.setSelectionRange(selection[0], selection[1]);
    }
  }
}

function isLaylaInvitation() { return document.body.classList.contains("layla-zaid-invitation"); }
function laylaText(key) { return laylaCopy[key]?.[state.laylaLanguage] || laylaCopy[key]?.en || key; }
function laylaValue(en, ar) { return state.laylaLanguage === "ar" ? (ar || en || "") : (en || ""); }
function applyLaylaLanguage() {
  if (!isLaylaInvitation()) return;
  const arabic = state.laylaLanguage === "ar";
  document.documentElement.lang = arabic ? "ar" : "en";
  // Keep the document's geometry left-to-right so centered cards and fixed
  // controls never mirror when only the invitation copy switches to Arabic.
  document.documentElement.dir = "ltr";
  document.body.classList.toggle("layla-arabic", arabic);
  document.querySelectorAll("[data-layla-text]").forEach((node) => { node.textContent = laylaText(node.dataset.laylaText); });
  const wedding = state.wedding || {};
  for (const [key, selector] of [["scheduleLabel", "#scheduleSection [data-layla-text='scheduleLabel']"], ["scheduleHeading", "#scheduleSection [data-layla-text='scheduleHeading']"]]) {
    const node = document.querySelector(selector);
    const configured = wedding[`${key}${arabic ? "Ar" : "En"}`] || wedding[key];
    if (node && typeof configured === "string" && configured.trim()) node.textContent = configured.trim();
  }
  document.querySelectorAll("[data-layla-language]").forEach((node) => { node.hidden = node.dataset.laylaLanguage !== state.laylaLanguage; });
  document.querySelectorAll("#laylaLanguageToggle [data-language]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.language === state.laylaLanguage));
  });
  elements.openInvitationButton?.setAttribute("aria-label", laylaText("openInvitation"));
  elements.skipOpeningButton?.setAttribute("aria-label", laylaText("skip"));
  document.querySelector(".hero-down")?.setAttribute("aria-label", laylaText("scrollDetails"));
  elements.openingVideo?.setAttribute("aria-label", laylaText("videoLabel"));
  if (elements.musicToggle) elements.musicToggle.setAttribute("aria-label", laylaText(elements.weddingAudio?.paused === false ? "stopMusic" : "playMusic"));
  if (state.introSequence && !["idle", "complete", "disposed"].includes(state.introSequence.phase)) {
    updateIntroPresentation(state.introSequence.phase);
  }
}

function setLaylaLanguage(language) {
  if (!isLaylaInvitation() || !["en", "ar"].includes(language) || language === state.laylaLanguage) return;
  const scrollY = window.scrollY;
  state.laylaLanguage = language;
  localStorage.setItem(laylaLanguageStorageKey, language);
  populateInvitation();
  renderCountdownCards();
  applyLaylaLanguage();
  requestAnimationFrame(() => window.scrollTo(0, scrollY));
}

function renderActions() {
  const wedding = state.wedding;
  if (state.sampleMode) {
    elements.stickyActions.innerHTML = `<button class="luxury-button luxury-button--primary" type="button" data-scroll-details>${icons.calendar}<span>${laylaText("exploreDetails")}</span></button>`;
    return;
  }
  const actionMarkup = `<button class="luxury-button luxury-button--primary" type="button" data-scroll-rsvp>${icons.reply}<span>${isLaylaInvitation() ? laylaText("rsvp") : "RSVP"}</span></button>`;

  elements.stickyActions.innerHTML = actionMarkup;
}

function renderGuestCard() {
  if (state.mode !== "firebase" || !state.guest) {
    elements.guestSpotlightSection.hidden = true;
    return;
  }

  if (document.body.classList.contains("layla-zaid-invitation")) {
    elements.guestSpotlightSection.hidden = true;
    return;
  }

  elements.guestSpotlightSection.hidden = false;
  setText("guestGreetingTitle", `Dear ${state.guest.fullName || "Guest"}`);
  setText("guestGreetingArabic", "يسعدنا حضوركم");
  setText(
    "guestGreetingEnglish",
    document.body.classList.contains("layla-zaid-invitation")
      ? ""
      : `Your personal invitation is ready below with RSVP${invitationSeatingEnabled(state.wedding) ? ", seating," : ""} and entrance access.`
  );
}

function renderCountdownCards() {
  const grid = document.getElementById("countdownGrid");
  const units = [
    { key: "days", en: "Days", ar: "يوم" }, { key: "hours", en: "Hours", ar: "ساعة" }, { key: "minutes", en: "Minutes", ar: "دقيقة" }, { key: "seconds", en: "Seconds", ar: "ثانية" },
  ];

  grid.innerHTML = units
    .map(
      (unit) => `
        <article class="countdown-card">
          <span class="countdown-card__value" data-unit="${unit.key}" data-value="00">00</span>
          <div class="countdown-card__label">
            <span>${isLaylaInvitation() ? laylaValue(unit.en, unit.ar) : unit.en}</span>
            ${isLaylaInvitation() ? "" : `<span class="rtl-copy" lang="ar" dir="rtl">${unit.ar}</span>`}
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
      title: isLaylaInvitation() ? laylaText("dateTime") : "Date & Time",
      en: laylaValue(`${formatDate(wedding.eventDateISO)}${wedding.timeEn || eventTimeFromDate(wedding) ? ` · ${wedding.timeEn || eventTimeFromDate(wedding)}` : ""}`, `${formatArabicDate(wedding.eventDateISO)}${wedding.timeAr || eventTimeFromDate(wedding, "ar") ? ` · ${wedding.timeAr || eventTimeFromDate(wedding, "ar")}` : ""}`),
    },
    {
      icon: icons.venue,
      title: isLaylaInvitation() ? laylaText("venue") : "Venue",
      en: laylaValue(wedding.venueEn || wedding.venueName, wedding.venueAr || wedding.venueNameAr),
    },
    {
      icon: icons.location,
      title: isLaylaInvitation() ? laylaText("location") : "Location",
      en: laylaValue(wedding.locationEn || wedding.location, wedding.locationAr || wedding.location),
    },
  ];
  const hall = laylaValue(wedding.hallEn || wedding.hall || wedding.hallName, wedding.hallAr || wedding.hall);
  if (hall && isLaylaInvitation()) {
    const venueDetail = detailCards.find((detail) => detail.title === laylaText("venue"));
    if (venueDetail) venueDetail.en = [venueDetail.en, `${laylaText("hall")}: ${hall}`].filter(Boolean).join(" · ");
  } else if (hall) {
    detailCards.push({ icon: icons.venue, title: "Hall", en: hall });
  }

  const mount = document.getElementById("detailsGrid");
  if (isLaylaInvitation()) {
    state.detailItems = detailCards.slice(0, 3).map((detail, index) => ({ ...detail, key: ["date", "venue", "location"][index] }));
    if (!state.detailItems.some((detail) => detail.key === state.activeDetailTab)) state.activeDetailTab = "date";
    mount.innerHTML = `
      <div class="detail-tabs" role="tablist" aria-label="${escapeAttribute(laylaText("detailOptions"))}" ${state.laylaLanguage === "ar" ? 'dir="rtl"' : 'dir="ltr"'}>
        ${state.detailItems.map((detail) => `<button class="detail-tab" id="detailTab-${detail.key}" type="button" role="tab" data-detail-tab="${detail.key}" aria-controls="detailCardPanel" aria-selected="false" tabindex="-1">${escapeHtml(detail.title)}</button>`).join("")}
      </div>
      <article class="detail-card" id="detailCardPanel" role="tabpanel" tabindex="0" aria-labelledby="detailTab-date">
        <div class="detail-card__icon" aria-hidden="true"></div>
        <h3 class="detail-card__title"></h3>
        <p class="detail-card__english"></p>
      </article>
    `;
    renderActiveLaylaDetail();
  } else {
    mount.innerHTML = detailCards.map((detail) => `
      <article class="detail-card">
        <div class="detail-card__icon">${detail.icon}</div>
        <h3 class="detail-card__title">${escapeHtml(detail.title)}</h3>
        <p class="detail-card__english">${escapeHtml(detail.en)}</p>
      </article>
    `).join("");
  }
  renderLocationMap();
}

function renderActiveLaylaDetail() {
  const detail = state.detailItems.find((item) => item.key === state.activeDetailTab) || state.detailItems[0];
  const panel = document.getElementById("detailCardPanel");
  if (!detail || !panel) return;
  state.activeDetailTab = detail.key;
  panel.setAttribute("aria-labelledby", `detailTab-${detail.key}`);
  panel.querySelector(".detail-card__icon").innerHTML = detail.icon;
  panel.querySelector(".detail-card__title").textContent = detail.title;
  const value = panel.querySelector(".detail-card__english");
  value.textContent = detail.en;
  value.classList.toggle("rtl-copy", state.laylaLanguage === "ar");
  value.lang = state.laylaLanguage;
  value.dir = state.laylaLanguage === "ar" ? "rtl" : "ltr";
  document.querySelectorAll("[data-detail-tab]").forEach((button) => {
    const selected = button.dataset.detailTab === detail.key;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && typeof panel.animate === "function") {
    panel.animate([{ opacity: 0.72, transform: "translateY(4px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 180, easing: "ease-out" });
  }
}

function selectLaylaDetailTab(key, focus = false) {
  if (!state.detailItems.some((item) => item.key === key)) return;
  state.activeDetailTab = key;
  renderActiveLaylaDetail();
  if (focus) document.getElementById(`detailTab-${key}`)?.focus();
}

function renderSchedule() {
  const section = document.getElementById("scheduleSection");
  const mount = document.getElementById("scheduleMount");
  if (!section || !mount) return;
  const items = Array.isArray(state.wedding?.schedule) ? state.wedding.schedule.filter((item) => item && (item.titleEn || item.titleAr)) : [];
  section.hidden = !items.length;
  const isLayla = isLaylaInvitation();
  mount.innerHTML = items.map((item, index) => {
    const arabic = isLaylaInvitation() && state.laylaLanguage === "ar";
    const titleArabic = String(item.titleAr || "").trim() || getArabicScheduleFallback(item.titleEn);
    const descriptionArabic = String(item.descriptionAr || "").trim() || getArabicScheduleFallback(item.descriptionEn);
    const title = arabic ? (titleArabic || item.titleEn || "") : (item.titleEn || item.titleAr || "");
    const description = arabic ? (descriptionArabic || item.descriptionEn || "") : (item.descriptionEn || item.descriptionAr || "");
    const time = arabic
      ? formatArabicScheduleTime(String(item.timeAr || "").trim() || item.timeEn || item.time)
      : (item.timeEn || item.time || item.timeAr || "");
    const timeLang = /\p{Script=Arabic}/u.test(time) ? ' lang="ar"' : ' lang="en"';
    const titleLang = arabic ? (titleArabic ? ' lang="ar" dir="rtl"' : ' lang="en" dir="ltr"') : "";
    const descriptionLang = arabic ? (descriptionArabic ? ' lang="ar" dir="rtl"' : ' lang="en" dir="ltr"') : "";
    const iconType = isLayla ? resolveLaylaScheduleIcon(item) : "";
    const eventIcon = isLayla ? renderLaylaScheduleIcon(iconType) : '<span class="schedule-item__marker" aria-hidden="true"></span>';
    const iconClass = isLayla ? ` schedule-item--${iconType}` : "";
    return `<li class="schedule-item${arabic ? " schedule-item--arabic" : ""}${iconClass}" style="--item-index:${index}" ${arabic ? 'lang="ar" dir="rtl"' : ""}><time class="schedule-item__time" dir="auto"${timeLang}><bdi dir="auto">${escapeHtml(time)}</bdi></time>${eventIcon}<div class="schedule-item__copy"><h3${titleLang}>${escapeHtml(title)}</h3>${description ? `<p${descriptionLang}>${escapeHtml(description)}</p>` : ""}</div></li>`;
  }).join("");
  const calendarAction = document.querySelector("[data-calendar-download]");
  const calendarTarget = document.getElementById(items.length ? "scheduleActions" : "venueActions");
  if (calendarAction && calendarTarget) calendarTarget.append(calendarAction);
  if (isLayla && items.length) updateLaylaScheduleConnector(mount);
}

function updateLaylaScheduleConnector(mount) {
  const measure = () => {
    const items = [...mount.querySelectorAll(".schedule-item")];
    if (!items.length) return;
    const iconCenter = (item) => {
      const icon = item.querySelector(".schedule-item__icon");
      return item.offsetTop + (icon ? icon.offsetTop + icon.getBoundingClientRect().height / 2 : item.offsetHeight / 2);
    };
    const firstCenter = iconCenter(items[0]);
    const lastItem = items.at(-1);
    const lastCenter = iconCenter(lastItem);
    mount.style.setProperty("--schedule-line-start", `${firstCenter}px`);
    mount.style.setProperty("--schedule-line-end", `${Math.max(0, mount.scrollHeight - lastCenter)}px`);
  };
  if ("ResizeObserver" in window && !mount._laylaScheduleResizeObserver) {
    mount._laylaScheduleResizeObserver = new ResizeObserver(measure);
    mount._laylaScheduleResizeObserver.observe(mount);
  }
  requestAnimationFrame(measure);
  document.fonts?.ready.then(() => { if (mount.isConnected) measure(); });
}

const arabicScheduleFallbacks = new Map([
  ["guest arrival", "استقبال الضيوف"],
  ["welcome reception", "حفل استقبال الضيوف"],
  ["welcome and arrival", "استقبال الضيوف"],
  ["a celebration of love", "احتفال بالحب"],
  ["wedding ceremony", "مراسم عقد القران"],
  ["dinner", "العشاء"],
  ["dinner and dancing", "العشاء والرقص"],
  ["celebration and dancing", "الاحتفال والرقص"],
  ["a warm welcome as everyone gathers", "نرحب بكم مع بداية الأمسية."],
  ["join us for the wedding celebration", "انضموا إلينا للاحتفال بالزفاف."],
  ["an evening of good food and joyful company", "أمسية من الطعام الطيب والرفقة الجميلة."],
]);

function getArabicScheduleFallback(value) {
  const key = String(value || "").trim().toLocaleLowerCase("en")
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return arabicScheduleFallbacks.get(key) || "";
}

function formatArabicScheduleTime(value) {
  return String(value || "")
    .replace(/\b(a\.?m\.?|p\.?m\.?)(?=\s|$)/gi, (match) => /^a/i.test(match) ? "صباحًا" : "مساءً")
    .replace(/[0-9]/g, (digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]);
}

function renderLocationMap() {
  const mount = document.getElementById("venueMapPreviewMount");
  if (!mount) return;
  laylaMapPreviewObserver?.disconnect();
  laylaMapPreviewObserver = null;
  const wedding = state.wedding || {};
  const venue = String(laylaValue(wedding.venueEn || wedding.venueName, wedding.venueAr || wedding.venueNameAr) || "").trim();
  const address = String(laylaValue(wedding.locationEn, wedding.locationAr) || "").trim();
  const directions = safeMapsLink(wedding.mapsUrl) || (venue ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([venue, address].filter(Boolean).join(", "))}` : "");
  const iframeUrl = buildSatelliteMapEmbedUrl(wedding, window.GOOGLE_MAPS_EMBED_API_KEY);
  const label = isLaylaInvitation() ? laylaText("openInMaps") : "Open in Maps";
  const unavailable = isLaylaInvitation() ? laylaText("mapUnavailable") : "Satellite preview is unavailable. Open directions for this venue.";
  const mapTitle = isLaylaInvitation() ? `${laylaText("mapTitle")} ${venue}` : `Satellite map preview for ${venue}`;
  const mapsLink = document.getElementById("openMapsLink");
  if (mapsLink) { mapsLink.href = directions || "#"; mapsLink.hidden = !directions; }
  const mapActionMarkup = mapsLink
    ? (directions ? "" : `<p class="venue-map-card__fallback">${escapeHtml(unavailable)}</p>`)
    : (directions ? `<a class="detail-card__action" href="${escapeAttribute(directions)}" target="_blank" rel="noopener noreferrer">${icons.location}<span>${label}</span></a>` : `<p class="venue-map-card__fallback">${escapeHtml(unavailable)}</p>`);
  const mapPreviewMarkup = iframeUrl && isLaylaInvitation()
    ? `<div class="venue-map-preview venue-map-preview--pending" data-map-preview data-map-url="${escapeAttribute(iframeUrl)}" aria-busy="true"><p role="status">${escapeHtml(laylaText("mapPreviewLoading"))}</p><button class="map-preview-button" type="button" data-load-map-preview hidden>${escapeHtml(laylaText("loadMapPreview"))}</button></div>`
    : iframeUrl
      ? `<div class="venue-map-preview"><iframe src="${escapeAttribute(iframeUrl)}" title="${escapeAttribute(mapTitle)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" tabindex="-1" aria-hidden="true"></iframe></div>`
    : `<div class="venue-map-preview venue-map-preview--fallback" role="img" aria-label="${escapeAttribute(unavailable)}"><p>${escapeHtml(unavailable)}</p></div>`;
  const mapFrameMarkup = isLaylaInvitation()
    ? `<div class="venue-map-frame"><span class="venue-map-corner venue-map-corner--top-left" aria-hidden="true"></span><span class="venue-map-corner venue-map-corner--bottom-right" aria-hidden="true"></span>${mapPreviewMarkup}</div>`
    : mapPreviewMarkup;
  mount.innerHTML = `
    <div class="venue-map-card" aria-label="${escapeAttribute(venue || "Venue map")}">
      ${venue ? `<p class="venue-map-card__venue">${escapeHtml(venue)}</p>` : ""}
      ${mapFrameMarkup}
      ${mapActionMarkup}
    </div>
  `;
  if (isLaylaInvitation() && mapsLink && directions) mount.querySelector(".venue-map-card")?.append(mapsLink);

  const preview = mount.querySelector("[data-map-preview]");
  const retryButton = preview?.querySelector("[data-load-map-preview]");
  if (preview && retryButton) {
    const startPreview = () => {
      if (preview.isConnected) loadLaylaMapPreview(retryButton);
    };
    if ("IntersectionObserver" in window) {
      laylaMapPreviewObserver = new IntersectionObserver((entries, observer) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        laylaMapPreviewObserver = null;
        startPreview();
      }, { rootMargin: "240px 0px" });
      laylaMapPreviewObserver.observe(preview);
    } else {
      startPreview();
    }
  }
}

function loadLaylaMapPreview(button) {
  const preview = button?.closest("[data-map-preview]");
  const iframeUrl = preview?.dataset.mapUrl;
  if (!preview || !iframeUrl || preview.querySelector("iframe")) return;
  const iframe = document.createElement("iframe");
  iframe.title = `${laylaText("mapTitle")} ${laylaValue(state.wedding?.venueEn, state.wedding?.venueAr)}`;
  iframe.loading = "lazy";
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  iframe.tabIndex = -1;
  iframe.setAttribute("aria-hidden", "true");
  let settled = false;
  const status = preview.querySelector("p");
  const timeout = window.setTimeout(() => {
    if (settled) return;
    settled = true;
    iframe.remove();
    preview.classList.add("venue-map-preview--fallback");
    preview.setAttribute("aria-busy", "false");
    if (status) status.textContent = laylaText("mapPreviewError");
    button.hidden = false;
  }, 10000);
  iframe.addEventListener("load", () => {
    settled = true;
    window.clearTimeout(timeout);
    preview.classList.remove("venue-map-preview--pending");
    preview.setAttribute("aria-busy", "false");
    button.hidden = true;
    if (status) status.textContent = "";
  }, { once: true });
  iframe.addEventListener("error", () => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timeout);
    iframe.remove();
    preview.classList.add("venue-map-preview--fallback");
    preview.setAttribute("aria-busy", "false");
    if (status) status.textContent = laylaText("mapPreviewError");
    button.hidden = false;
  }, { once: true });
  button.hidden = true;
  preview.classList.remove("venue-map-preview--fallback");
  preview.classList.add("venue-map-preview--pending");
  preview.setAttribute("aria-busy", "true");
  if (status) status.textContent = laylaText("mapPreviewLoading");
  preview.append(iframe);
  iframe.src = iframeUrl;
}

function safeMapsLink(value) {
  try {
    const url = new URL(String(value || ""));
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

// The shared demo invitation always starts without a response and never saves one,
// so anyone opening it can try the RSVP and see the result.
function usesSampleRsvp() {
  return state.sampleMode || state.weddingId === "luxury-wedding-demo";
}

function renderRsvp() {
  const mount = document.getElementById("rsvpMount");
  if (usesSampleRsvp()) {
    renderDemoRsvp(mount, { sample: true });
    return;
  }
  if (state.mode === "firebase" && state.guest) {
    renderFirebaseRsvp(mount);
    return;
  }
  renderDemoRsvp(mount);
}

function renderFirebaseRsvp(mount) {
  const guest = state.guest;
  const view = invitationRsvpView(guest);
  const isLayla = isLaylaInvitation();
  const copy = (key, fallback) => isLayla ? laylaText(key) : fallback;
  const languageAttributes = isLayla && state.laylaLanguage === "ar" ? 'lang="ar" dir="rtl"' : "";
  if (view.showSummary && !state.isRsvpEditing) {
    const confirmationLabel = view.status === "confirmed" ? copy("rsvpConfirmed", "Response saved") : copy("declinedLabel", "Response saved");
    const confirmationHeading = view.status === "confirmed"
      ? (isLayla ? laylaText("attendanceConfirmed").replace("{name}", escapeHtml(guest.fullName || laylaText("guestFallback"))) : copy("attendanceConfirmed", "Your attendance is confirmed"))
      : copy("attendanceDeclined", "Your response is recorded as not attending.");
    const confirmationMessage = view.status === "confirmed"
      ? (isLayla ? laylaText("attendanceConfirmedThanks").replace("{name}", escapeHtml(guest.fullName || laylaText("dear"))) : `Thank you, ${escapeHtml(guest.fullName || "guest")}. We look forward to celebrating with you.`)
      : copy("attendanceDeclinedThanks", "Thank you for letting us know.");
    mount.innerHTML = `
      <div class="rsvp-summary rsvp-summary--${view.status}" role="status" aria-live="polite">
        <span class="rsvp-confirmation-mark" aria-hidden="true">${view.status === "confirmed" ? "✓" : "♡"}</span>
        <p class="rsvp-summary__eyebrow" ${languageAttributes}>${confirmationLabel}</p>
        <h3 ${languageAttributes}>${confirmationHeading}</h3>
        <p ${languageAttributes}>${confirmationMessage}</p>
        <button class="luxury-button luxury-button--secondary" type="button" data-change-rsvp><span>${copy("changeResponse", "Change response")}</span></button>
      </div>
    `;
    return;
  }
  const pendingCopy = copy("pendingResponse", "Your response is pending. Please choose an option.");
  const savingCopy = copy("responseSaving", "Saving your response…");
  const errorCopy = state.rsvpSaveError || "";
  const greeting = isLayla ? "" : `<p class="firebase-rsvp-greeting">${copy("dear", "Dear")} ${escapeHtml(guest.fullName || "Guest")}</p>`;
  const statusCopy = state.isRsvpSaving ? savingCopy : (errorCopy || (isLayla ? "" : pendingCopy));
  mount.innerHTML = `
    <form class="firebase-rsvp-panel rsvp-form" id="firebaseRsvpForm">
      ${greeting}
      ${statusCopy ? `<p class="firebase-rsvp-status" data-tone="${errorCopy ? "error" : "status"}" role="${errorCopy ? "alert" : "status"}" aria-live="polite">${statusCopy}</p>` : ""}
      <div class="rsvp-phases">
        <section class="rsvp-phase" data-rsvp-step="1">
          ${isLaylaInvitation() ? "" : '<p class="rsvp-phase__number">01</p><h3>Are you attending?</h3>'}
          <div class="rsvp-choice" role="radiogroup" aria-label="${isLaylaInvitation() ? laylaText("attending") : "Attendance"}">
            <label class="rsvp-answer">
              <input type="radio" name="status" value="confirmed" ${state.rsvpSelection === "confirmed" ? "checked" : ""} required ${state.isRsvpSaving ? "disabled" : ""} />
              <span>${isLaylaInvitation() ? laylaText("yes") : "Yes"}</span>
            </label>
            <label class="rsvp-answer">
              <input type="radio" name="status" value="declined" ${state.rsvpSelection === "declined" ? "checked" : ""} required ${state.isRsvpSaving ? "disabled" : ""} />
              <span>${isLaylaInvitation() ? laylaText("no") : "No"}</span>
            </label>
          </div>
        </section>
      </div>
      <label class="rsvp-form__message"><span>${copy("messageLabel", "Optional message")}</span><textarea name="message" maxlength="1000" placeholder="${escapeAttribute(copy("messagePlaceholder", "Write a note…"))}" ${languageAttributes} ${state.isRsvpSaving ? "disabled" : ""}>${escapeHtml(state.rsvpMessage)}</textarea></label>
      ${state.wedding.rsvpDeadlineISO ? `<p class="rsvp-deadline">${copy("deadline", "Kindly reply by")} ${escapeHtml(state.laylaLanguage === "ar" ? formatArabicDate(state.wedding.rsvpDeadlineISO) : formatDate(state.wedding.rsvpDeadlineISO))}</p>` : ""}
      <button class="luxury-button luxury-button--primary rsvp-form__submit" type="submit" ${state.isRsvpSaving ? "disabled" : ""}>
        ${icons.reply}<span>${state.rsvpSaveError ? copy("retryResponse", "Retry") : copy("sendRsvp", "Send RSVP")}</span>
      </button>
    </form>
  `;
  const form = document.getElementById("firebaseRsvpForm");
  form?.addEventListener("submit", handleFirebaseRsvpSubmit);
  form?.addEventListener("change", (event) => {
    if (event.target.matches('input[name="status"]')) state.rsvpSelection = event.target.value;
  });
  form?.querySelector('[name="message"]')?.addEventListener("input", (event) => { state.rsvpMessage = event.target.value.slice(0, 1000); });
  if (form && state.isRsvpSaving) form.querySelector(".rsvp-form__submit span").textContent = savingCopy;
  setupRsvpPhases(form);
}

function renderDemoRsvp(mount, { sample = false } = {}) {
  const saved = sample ? state.sampleRsvpResponse : readSavedRsvp();
  if (saved && ["confirmed", "declined"].includes(saved.status) && !state.isRsvpEditing) {
    const confirmed = saved.status === "confirmed";
    const name = sample ? (state.guest?.fullName || sampleRsvpGuestName) : demoGuest.fullName;
    const languageAttributes = isLaylaInvitation() && state.laylaLanguage === "ar" ? 'lang="ar" dir="rtl"' : "";
    const confirmationHeading = confirmed
      ? laylaText("attendanceConfirmed").replace("{name}", name)
      : laylaText("attendanceDeclined").replace("{name}", name);
    mount.innerHTML = `
      <div class="rsvp-summary rsvp-summary--${confirmed ? "confirmed" : "declined"}" aria-live="polite" ${sample ? languageAttributes : ""}>
        <span class="rsvp-confirmation-mark" aria-hidden="true">${confirmed ? "✓" : "♡"}</span>
        <p class="rsvp-summary__eyebrow">${escapeHtml(confirmed ? laylaText("rsvpConfirmed") : laylaText("declinedLabel"))}</p>
        <h3>${escapeHtml(confirmationHeading)}</h3>
        <p>${escapeHtml(confirmed ? laylaText("attendanceConfirmedThanks").replace("{name}", name) : laylaText("attendanceDeclinedThanks"))}</p>
        ${saved.message ? `<p class="rsvp-summary__message">${escapeHtml(saved.message)}</p>` : ""}
        ${sample ? `<p class="sample-rsvp-note" role="note">${escapeHtml(laylaText("sampleRsvpNote"))}</p>` : ""}
        <button class="luxury-button luxury-button--secondary" type="button" data-${sample ? "change" : "edit"}-rsvp><span>${escapeHtml(laylaText("changeResponse"))}</span></button>
      </div>
    `;
    return;
  }

  const guestName = sample ? (state.guest?.fullName || sampleRsvpGuestName) : demoGuest.fullName;
  const languageAttributes = isLaylaInvitation() && state.laylaLanguage === "ar" ? 'lang="ar" dir="rtl"' : "";
  const demoStatusCopy = state.rsvpSaveError || (isLaylaInvitation() ? "" : laylaText("pendingResponse"));
  mount.innerHTML = `
    <form class="rsvp-form" id="${sample ? "sampleRsvpForm" : "rsvpForm"}" ${sample ? languageAttributes : ""}>
      ${sample ? `<p class="sample-rsvp-note" role="note">${escapeHtml(laylaText("sampleRsvpNote"))}</p>` : ""}
      ${isLaylaInvitation() ? "" : `<p class="rsvp-demo-greeting">${escapeHtml(laylaText("dear"))} ${escapeHtml(guestName)}</p>`}
      ${demoStatusCopy ? `<p class="firebase-rsvp-status" role="status" aria-live="polite">${escapeHtml(demoStatusCopy)}</p>` : ""}
      <div class="rsvp-phases">
        <section class="rsvp-phase" data-rsvp-step="1">
          ${isLaylaInvitation() ? "" : `<p class="rsvp-phase__number">01</p><h3>Are you attending?</h3>`}
          <div class="rsvp-choice" role="radiogroup" aria-label="${escapeAttribute(laylaText("attending"))}">
            <label class="rsvp-answer">
              <input type="radio" name="status" value="confirmed" ${state.rsvpSelection === "confirmed" ? "checked" : ""} required />
              <span>${isLaylaInvitation() ? laylaText("yes") : "Yes"}</span>
            </label>
            <label class="rsvp-answer">
              <input type="radio" name="status" value="declined" ${state.rsvpSelection === "declined" ? "checked" : ""} required />
              <span>${isLaylaInvitation() ? laylaText("no") : "No"}</span>
            </label>
          </div>
        </section>
      </div>
      <label class="rsvp-form__message"><span>${escapeHtml(laylaText("messageLabel"))}</span><textarea name="message" maxlength="1000" placeholder="${escapeAttribute(laylaText("messagePlaceholder"))}">${escapeHtml(state.rsvpMessage || saved?.message || "")}</textarea></label>
      ${state.wedding.rsvpDeadlineISO ? `<p class="rsvp-deadline">${escapeHtml(laylaText("deadline"))} ${escapeHtml(state.laylaLanguage === "ar" ? formatArabicDate(state.wedding.rsvpDeadlineISO) : formatDate(state.wedding.rsvpDeadlineISO))}</p>` : ""}
      <button class="luxury-button luxury-button--primary rsvp-form__submit" type="submit" hidden>
        ${icons.reply}<span>${escapeHtml(laylaText(state.rsvpSaveError ? "retryResponse" : "sendRsvp"))}</span>
      </button>
    </form>
  `;

  const form = document.getElementById(sample ? "sampleRsvpForm" : "rsvpForm");
  form?.addEventListener("submit", sample ? handleSampleRsvpSubmit : handleDemoRsvpSubmit);
  form?.querySelector('[name="message"]')?.addEventListener("input", (event) => { state.rsvpMessage = event.target.value.slice(0, 1000); });
  setupRsvpPhases(form);
}

function renderSeatSection() {
  if (state.sampleMode || state.mode !== "firebase" || !state.guest || !invitationSeatingEnabled(state.wedding)) {
    elements.seatingSection.hidden = true;
    return;
  }

  elements.seatingSection.hidden = false;
  const assignments = getInvitationSeatAssignments(state.guest);

  if (document.body.classList.contains("layla-zaid-invitation")) {
    const partyMembers = getInvitationPartyMembers(state.guest, assignments);
    state.seatingSelectedPersonKey = retainPartySeatSelection(state.seatingSelectedPersonKey, partyMembers);
    const selection = getPartySeatSelection(state.seatingSelectedPersonKey, partyMembers, state.tables);
    const selectedTarget = selection.target ? { ...selection.target, personKey: selection.member.personKey } : null;
    state.seatPlanSelectedTarget = selectedTarget;
    state.seatPlanFocusedAssignments = selection.member?.assignment && selectedTarget ? [selection.member.assignment] : [];
    if (state.seatingSelectedPersonKey && !selectedTarget) state.seatPlanViewMode = "manual";
    document.getElementById("seatDetailsMount").innerHTML = `
      <div class="layla-seat-greeting">
        <h3 ${state.laylaLanguage === "ar" ? 'lang="ar" dir="rtl" class="rtl-copy"' : ""}>${laylaValue(`${laylaText("dear")} ${escapeHtml(state.guest.fullName || laylaText("guestFallback"))}`, `${laylaText("dear")} ${escapeHtml(state.guest.fullName || laylaText("guestFallback"))}`)}</h3>
      </div>
      <div class="layla-party-seat-selector${partyMembers.length <= 3 ? " is-compact" : ""}" id="laylaPartySeatSelector" role="group" aria-label="${escapeAttribute(laylaText("partySeatSelectorLabel"))}">
        ${partyMembers.map((member) => renderLaylaPartyChairMember(member, state.seatingSelectedPersonKey)).join("")}
      </div>
      <p class="layla-party-seat-status" id="laylaPartySeatStatus" role="status" aria-live="polite"${state.seatingSelectedPersonKey ? "" : " hidden"}>${escapeHtml(getPartySeatStatus(selection.member, selectedTarget))}</p>
    `;
    bindLaylaPartySeatSelector();
    setInvitationMapVisibility(!selection.member || Boolean(selectedTarget));
    renderSeatingMap(state.tables, assignments, selectedTarget);
    return;
  }

  const partyMembers = getInvitationPartyMembers(state.guest, assignments);
  state.seatingSelectedPersonKey = retainPartySeatSelection(state.seatingSelectedPersonKey, partyMembers);
  const selection = getPartySeatSelection(state.seatingSelectedPersonKey, partyMembers, state.tables);

  document.getElementById("seatDetailsMount").innerHTML = `
      <div class="seat-details-grid">
        <article class="seat-detail-card"><span>Primary guest</span><strong>${escapeHtml(state.guest.fullName || "Guest")}</strong></article>
        <article class="seat-detail-card"><span>Party size</span><strong>${escapeHtml(String(getPartySize(state.guest)))}</strong></article>
      </div>
      <div class="guest-seat-list guest-seat-list--party" aria-label="Your party seating assignments">
        ${partyMembers.map((member) => renderInvitationPartyMember(member, state.seatingSelectedPersonKey)).join("")}
      </div>
      <p class="guest-seat-selection-status" id="guestSeatSelectionStatus" role="status" aria-live="polite"${selection.member && !selection.target ? "" : " hidden"}>${escapeHtml(selection.member?.label || "This guest")} has not been assigned a seat yet.</p>
    `;

  setInvitationMapVisibility(!selection.member || Boolean(selection.target));
  renderSeatingMap(state.tables, assignments, selection.target);
  bindInvitationPartySummary();
}

function getInvitationPartyMembers(guest, assignments) {
  const byKey = new Map(assignments.map((assignment) => [assignment.personKey, assignment]));
  return Array.from({ length: getPartySize(guest) }, (_, index) => {
    const personKey = personKeyForIndex(index);
    return {
      index,
      personKey,
      label: index === 0
        ? (guest.fullName || (isLaylaInvitation() ? laylaText("guestFallback") : "Primary guest"))
        : `${isLaylaInvitation() ? laylaText("companion") : "Companion"} ${index}`,
      assignment: byKey.get(personKey) || null,
    };
  });
}

function getPartySeatStatus(member, target) {
  if (!member) return "";
  if (!target) return laylaText("seatNotAssignedSelected");
  return laylaText("selectedSeatStatus").replace("{name}", member.label);
}

function renderLaylaPartyChairMember(member, selectedPersonKey) {
  const assignment = member.assignment;
  const target = assignment ? resolvePartySeatTarget(assignment, state.tables) : null;
  const selected = member.personKey === selectedPersonKey;
  const isUnassigned = !target;
  const tableName = assignment?.tableName || laylaText("yourTable");
  const assignmentLabel = target
    ? formatPartySeatLabel(tableName, target.seatNumber, state.laylaLanguage)
    : laylaText("seatNotAssigned");
  const accessibleLabel = `${member.index + 1}. ${member.label}. ${assignmentLabel}${target ? ". Select to focus this chair on the seating map." : ". Select for seat status; no chair is assigned yet."}`;
  const targetAttributes = target
    ? `data-assignment-table-id="${escapeAttribute(target.tableId)}" data-assignment-chair-id="${escapeAttribute(target.chairId)}" data-assignment-seat-number="${escapeAttribute(target.seatNumber)}"`
    : "";
  return `
    <button class="layla-party-chair ${selected ? "is-selected" : ""} ${isUnassigned ? "is-unassigned" : "is-assigned"}" type="button" data-party-person-key="${escapeAttribute(member.personKey)}" ${targetAttributes} aria-pressed="${selected}" aria-label="${escapeAttribute(accessibleLabel)}">
      <span class="layla-party-chair__art" aria-hidden="true">
        <img src="./invitations/wedding-designs/layla-zaid/assets/layla-zaid-louis-chair.webp?v=20261026-chair-selector-1" alt="" loading="lazy" decoding="async" />
        <span class="layla-party-chair__number">${member.index + 1}</span>
      </span>
      <strong class="layla-party-chair__name">${escapeHtml(member.label)}</strong>
      <span class="layla-party-chair__assignment">${escapeHtml(assignmentLabel)}</span>
    </button>
  `;
}

function bindLaylaPartySeatSelector() {
  document.querySelectorAll("[data-party-person-key]").forEach((button) => {
    button.addEventListener("click", () => selectLaylaPartyMember(button.dataset.partyPersonKey));
  });
}

function selectLaylaPartyMember(personKey) {
  const assignments = getInvitationSeatAssignments(state.guest);
  const partyMembers = getInvitationPartyMembers(state.guest, assignments);
  const selection = getPartySeatSelection(personKey, partyMembers, state.tables);
  if (!selection.member) return;

  state.seatingSelectedPersonKey = selection.member.personKey;
  const target = selection.target ? { ...selection.target, personKey: selection.member.personKey } : null;
  state.seatPlanSelectedTarget = target;
  document.querySelectorAll("[data-party-person-key]").forEach((button) => {
    const selected = button.dataset.partyPersonKey === state.seatingSelectedPersonKey;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });

  const status = document.getElementById("laylaPartySeatStatus");
  if (status) {
    status.hidden = false;
    status.textContent = getPartySeatStatus(selection.member, target);
  }
  state.seatPlanFocusedAssignments = target ? [selection.member.assignment] : [];
  setInvitationMapVisibility(Boolean(target));
  if (target) {
    focusInvitationChair(target);
  } else {
    if (state.seatPlanViewMode === "person") state.seatPlanViewMode = "manual";
    document.querySelectorAll("#seatingMap .seat-plan-chair.is-selected").forEach((chair) => chair.classList.remove("is-selected"));
    const map = document.getElementById("seatingMap");
    if (map) {
      delete map.dataset.selectedPersonKey;
      delete map.dataset.selectedTableId;
      delete map.dataset.selectedChairId;
    }
  }
}

function setInvitationMapVisibility(visible) {
  const map = document.getElementById("seatingMap");
  const container = map?.closest(".seating-content-outline") || map?.closest(".seating-map-shell");
  if (container) container.hidden = !visible;
}

function renderInvitationPartyMember(member, selectedPersonKey) {
  const target = member.assignment ? resolvePartySeatTarget(member.assignment, state.tables) : null;
  const selected = member.personKey === selectedPersonKey;
  return `
    <button class="guest-seat-party-member ${target ? "is-assigned" : "is-unassigned"} ${selected ? "is-selected" : ""}" type="button" data-party-member-index="${member.index}" aria-pressed="${selected}" aria-label="${escapeAttribute(target ? `${member.label}, ${member.assignment.tableName || "Table"}, chair ${target.seatNumber}. Focus on map.` : `${member.label}, seat not assigned yet.`)}">
      <strong>${escapeHtml(member.label)}</strong>
      <span>${target ? `${escapeHtml(member.assignment.tableName || "Table")} · Chair ${escapeHtml(target.seatNumber)}` : "Seat not assigned yet"}</span>
    </button>
  `;
}

function bindInvitationPartySummary() {
  document.querySelectorAll("[data-party-member-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.partyMemberIndex);
      const members = getInvitationPartyMembers(state.guest, getInvitationSeatAssignments(state.guest));
      const member = members[index];
      if (!member) return;
      const selection = getPartySeatSelection(member.personKey, members, state.tables);
      state.seatingSelectedPersonKey = member.personKey;
      state.seatPlanSelectedTarget = selection.target ? { ...selection.target, personKey: member.personKey } : null;
      document.querySelectorAll("[data-party-member-index]").forEach((item) => {
        const selected = Number(item.dataset.partyMemberIndex) === index;
        item.classList.toggle("is-selected", selected);
        item.setAttribute("aria-pressed", String(selected));
      });
      const status = document.getElementById("guestSeatSelectionStatus");
      if (status) { status.hidden = Boolean(selection.target); status.textContent = `${member.label} has not been assigned a seat yet.`; }
      setInvitationMapVisibility(Boolean(selection.target));
      if (selection.target) focusInvitationChair({ ...selection.target, personKey: member.personKey });
      else { state.seatPlanViewMode = "manual"; state.seatPlanFocusedAssignments = []; }
    });
  });
}

function renderSeatingMap(tables, assignments = [], selectedTarget = null) {
  const map = document.getElementById("seatingMap");
  if (!map) {
    return;
  }

  if (!tables.length) {
    map.innerHTML = `<p class="seat-empty-copy">${isLaylaInvitation() ? laylaText("seatingEmpty") : "A seating map will appear here once the venue layout is published."}</p>`;
    return;
  }

  document.getElementById("seatPlanViewport")?._seatPlanResizeObserver?.disconnect();
  const assignedTableIds = new Set(assignments.map((assignment) => assignment.tableId));
  const assignedSeatKeys = buildSeatAssignmentKeys(assignments);
  map.innerHTML = `
    <div class="seat-plan-toolbar" aria-label="Seating plan controls">
      ${isLaylaInvitation() ? "" : `<button type="button" data-seat-plan-control="my-seats" ${assignments.length ? "" : "disabled"}>My seats</button>`}
      <button type="button" data-seat-plan-control="zoom-out">-</button>
      <button type="button" data-seat-plan-control="fit">${isLaylaInvitation() ? laylaText("fit") : "Fit"}</button>
      <button type="button" data-seat-plan-control="zoom-in">+</button>
    </div>
    <div class="seat-plan-viewport" id="seatPlanViewport">
      <div class="seat-plan-canvas" id="seatPlanCanvas" style="transform:translate(${state.seatPlanTransform.x}px, ${state.seatPlanTransform.y}px) scale(${state.seatPlanTransform.scale});">
        <div class="seat-plan-floor"></div>
        ${state.hallObjects.map(renderInvitationHallObject).join("")}
        ${tables
    .map((table) => {
      const isAssigned = assignedTableIds.has(table.id);
      const shape = normalizeTableShape(table.shape);
      const width = Number(table.width || defaultTableWidth(shape));
      const height = Number(table.height || defaultTableHeight(shape));
      const positions = buildChairPositions(shape, table.chairs?.length || table.seatCount || table.capacity || 0, width, height);
      const positionBySeat = new Map(positions.map((position, index) => [String(index + 1), position]));
      return `
        <article
          class="seat-plan-table seat-plan-table--${shape} ${isAssigned ? "is-assigned" : ""}"
          style="left:${Number(table.x || 0)}%;top:${Number(table.y || 0)}%;width:${width}px;height:${height}px;transform:translate(-50%, -50%) rotate(${Number(table.rotation || 0)}deg);--table-fill:${escapeAttribute(table.tableColor || "#f3ebdc")};--table-border:${escapeAttribute(table.borderColor || "#bc9b61")};--chair-color:${escapeAttribute(table.chairColor || "#24554a")};--chair-ink:${getContrastingTextColor(table.chairColor || "#24554a")};"
        >
          ${(table.chairs || []).map((chair, index) => renderInvitationChair(table, chair, assignedSeatKeys, positionBySeat.get(String(chair.seatNumber)) || positions[index], selectedTarget)).join("")}
          <div class="seat-plan-table__surface seat-plan-table__surface--${shape}">
            <div class="seat-plan-table__label">
              <strong>${escapeHtml(resolveTableName(table))}</strong>
              ${isAssigned ? `<small>${isLaylaInvitation() ? laylaText("yourTable") : "Your table"}</small>` : ""}
            </div>
          </div>
        </article>
      `;
    })
    .join("")}
      </div>
    </div>
    ${isLaylaInvitation() ? (assignments.length ? "" : `<p class="seat-plan-caption" role="status">${laylaText("seatsPending")}</p>`) : `<p class="seat-plan-caption" role="status">${assignments.length ? `<span class="seat-plan-caption__swatch" aria-hidden="true"></span>Your party’s seats are marked in gold; other chairs are shown for context.` : "Your seats have not been assigned yet."}</p>`}
  `;
  if (selectedTarget) {
    map.dataset.selectedPersonKey = selectedTarget.personKey || "";
    map.dataset.selectedTableId = selectedTarget.tableId;
    map.dataset.selectedChairId = selectedTarget.chairId;
  } else {
    delete map.dataset.selectedPersonKey;
    delete map.dataset.selectedTableId;
    delete map.dataset.selectedChairId;
  }
  bindSeatPlanInteractions();
  const fitWhenReady = () => requestAnimationFrame(() => {
    if (!map.isConnected) return;
    // A guest may start interacting while fonts load. Respect that new view.
    if (state.seatPlanViewMode === "person") focusInvitationChair(state.seatPlanSelectedTarget);
    else fitInvitationSeatingPlan(false);
  });
  if (isLaylaInvitation() && document.fonts) document.fonts.ready.then(fitWhenReady);
  else requestAnimationFrame(() => selectedTarget ? focusInvitationChair(selectedTarget) : fitInvitationSeatingPlan(false));
}

function setupLaylaNoticeClearance() {
  const measure = () => {
    const height = [...document.body.children].filter((node) => node.matches('aside[role="status"]') && getComputedStyle(node).position === "sticky")
      .reduce((max, node) => Math.max(max, node.getBoundingClientRect().height), 0);
    document.body.style.setProperty("--layla-notice-height", `${Math.ceil(height)}px`);
  };
  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
  const observeNotices = () => {
    resize?.disconnect();
    document.querySelectorAll('body > aside[role="status"]').forEach((node) => resize?.observe(node));
    measure();
  };
  new MutationObserver(observeNotices).observe(document.body, { childList: true });
  window.addEventListener("resize", measure, { passive: true });
  observeNotices();
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
      const table = state.tables.find((item) => String(item.id) === String(assignment.tableId));
      const target = resolvePartySeatTarget(assignment, state.tables);
      if (!table || !target) return null;
      return {
        ...target,
        tableName: resolveTableName(table),
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
        const target = resolvePartySeatTarget({ tableId: table.id, chairId: chair.id }, [table]);
        if (!target) return null;
        return {
          ...target,
          tableName: resolveTableName(table),
          personKey: assignment.personKey || personKeyForIndex(partyMemberIndex),
          label: assignment.label || partyLabelForIndex(partyMemberIndex),
        };
      })
    )
    .filter((assignment) => assignment?.tableId && assignment.seatNumber)
    .sort((a, b) => partyIndexFromKey(a.personKey) - partyIndexFromKey(b.personKey));
}

function renderInvitationChair(table, chair, assignedSeatKeys, position = chair, selectedTarget = null) {
  const key = `${table.id}::${chair.seatNumber}`;
  const isAssignedToInvite = assignedSeatKeys.has(key);
  const isSelectedForPerson = String(selectedTarget?.tableId || "") === String(table.id) && String(selectedTarget?.chairId || "") === String(chair.id);
  const hasSavedPosition = chair.x !== undefined && chair.x !== null && chair.y !== undefined && chair.y !== null && Number.isFinite(Number(chair.x)) && Number.isFinite(Number(chair.y));
  const chairPosition = hasSavedPosition ? chair : position;
  return `
    <span
      class="seat-plan-chair ${isAssignedToInvite ? "is-yours is-occupied" : "is-empty"} ${isSelectedForPerson ? "is-selected" : ""}"
      data-seat-table-id="${escapeAttribute(table.id)}"
      data-seat-chair-id="${escapeAttribute(chair.id)}"
      style="left:${Number(chairPosition?.x ?? 0)}%;top:${Number(chairPosition?.y ?? 0)}%;--chair-rotation:${Number(chairPosition?.rotation || 0)}deg;--chair-color:${escapeAttribute(table.chairColor || "#24554a")};--chair-ink:${getContrastingTextColor(table.chairColor || "#24554a")};"
      title="${escapeAttribute(`${isAssignedToInvite ? "Your party seat" : "Seat"} ${chair.seatNumber}`)}"
      aria-label="${escapeAttribute(`${isAssignedToInvite ? "Your party seat" : "Seat"} ${chair.seatNumber}`)}"
    ><span>${escapeHtml(String(chair.seatNumber))}</span>${isAssignedToInvite ? '<span class="seat-plan-chair__marker" aria-hidden="true">✓</span>' : ""}</span>
  `;
}

function renderInvitationHallObject(item) {
  const isDanceFloor = item.type === "dance-floor";
  const width = isDanceFloor ? clamp(Number(item.width) || 280, 120, 700) : 0;
  const height = isDanceFloor ? clamp(Number(item.height) || width, 120, 700) : 0;
  const rotation = isDanceFloor ? clamp(Number(item.rotation) || 0, 0, 360) : 0;
  const danceFloorStyle = isDanceFloor
    ? `width:${width}px;height:${height}px;--dance-floor-fill:${escapeAttribute(item.fillColor || "#2F6F64")};--dance-floor-border:${escapeAttribute(item.borderColor || "#D7B56D")};--dance-floor-rotation:${rotation}deg;`
    : "";
  return `
    <div class="seat-plan-object seat-plan-object--${escapeAttribute(item.type)}" style="left:${Number(item.x ?? 0)}%;top:${Number(item.y ?? 0)}%;${danceFloorStyle}">
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
  let transformFrame = 0;
  const applyTransform = () => {
    if (transformFrame) return;
    transformFrame = requestAnimationFrame(() => {
      canvas.style.transform = `translate3d(${state.seatPlanTransform.x}px, ${state.seatPlanTransform.y}px, 0) scale(${state.seatPlanTransform.scale})`;
      transformFrame = 0;
    });
  };
  const zoomBy = (delta) => {
    state.seatPlanViewMode = "manual";
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
  const startGestureForActivePointers = () => {
    const points = [...activePointers.entries()];
    if (points.length >= 2) {
      state.seatPlanGesture = { mode: "pinch", distance: pointerDistance(), scale: state.seatPlanTransform.scale };
      return;
    }
    if (points.length === 1) {
      const [pointerId, point] = points[0];
      state.seatPlanGesture = {
        pointerId,
        startX: point.clientX,
        startY: point.clientY,
        x: state.seatPlanTransform.x,
        y: state.seatPlanTransform.y,
      };
      return;
    }
    state.seatPlanGesture = null;
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
    event.preventDefault();
    viewport.setPointerCapture?.(event.pointerId);
    activePointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    startGestureForActivePointers();
  });
  viewport.addEventListener("pointermove", (event) => {
    if (activePointers.has(event.pointerId)) {
      event.preventDefault();
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
    state.seatPlanViewMode = "manual";
    state.seatPlanTransform.x = gesture.x + event.clientX - gesture.startX;
    state.seatPlanTransform.y = gesture.y + event.clientY - gesture.startY;
    applyTransform();
  });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((eventName) => {
    viewport.addEventListener(eventName, (event) => {
      activePointers.delete(event.pointerId);
      startGestureForActivePointers();
    });
  });
  if (typeof ResizeObserver === "function") {
    let lastWidth = viewport.clientWidth;
    let lastHeight = viewport.clientHeight;
    const observer = new ResizeObserver(() => {
      const nextWidth = viewport.clientWidth;
      const nextHeight = viewport.clientHeight;
      if (!nextWidth || !nextHeight || (nextWidth === lastWidth && nextHeight === lastHeight)) return;
      lastWidth = nextWidth;
      lastHeight = nextHeight;
      requestAnimationFrame(() => {
        if (!viewport.isConnected) return;
        if (state.seatPlanViewMode === "person") {
          focusInvitationChair(state.seatPlanSelectedTarget);
        } else if (state.seatPlanViewMode === "seats") {
          centerInvitationSeats(state.seatPlanFocusedAssignments);
        } else if (state.seatPlanViewMode === "fit") {
          fitInvitationSeatingPlan(true);
        } else {
          const scale = state.seatPlanTransform.scale;
          const centerX = (viewport.clientWidth / 2 - state.seatPlanTransform.x) / scale;
          const centerY = (viewport.clientHeight / 2 - state.seatPlanTransform.y) / scale;
          state.seatPlanTransform.x = Math.round(viewport.clientWidth / 2 - centerX * scale);
          state.seatPlanTransform.y = Math.round(viewport.clientHeight / 2 - centerY * scale);
          canvas.style.transform = `translate3d(${state.seatPlanTransform.x}px, ${state.seatPlanTransform.y}px, 0) scale(${scale})`;
        }
      });
    });
    observer.observe(viewport);
    viewport._seatPlanResizeObserver = observer;
  }
}

function focusInvitationChair(target) {
  const resolvedTarget = resolvePartySeatTarget(target, state.tables);
  const viewport = document.getElementById("seatPlanViewport");
  const canvas = document.getElementById("seatPlanCanvas");
  const map = document.getElementById("seatingMap");
  if (!resolvedTarget || !viewport || !canvas || !map || !viewport.clientWidth || !viewport.clientHeight) return false;

  const bounds = getSeatPlanFocusBounds(
    state.tables,
    [{ tableId: resolvedTarget.tableId, seatNumber: resolvedTarget.seatNumber }],
    1100,
    900,
    38,
    24,
  );
  if (!bounds) return false;
  const boundsWidth = Math.max(1, bounds.maxX - bounds.minX);
  const boundsHeight = Math.max(1, bounds.maxY - bounds.minY);
  const scale = clamp(Math.min((viewport.clientWidth - 48) / boundsWidth, (viewport.clientHeight - 48) / boundsHeight), 0.05, 1.1);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  state.seatPlanViewMode = "person";
  state.seatPlanSelectedTarget = { ...resolvedTarget, personKey: target.personKey || "" };
  state.seatPlanFocusedAssignments = [{ ...resolvedTarget }];
  state.seatPlanTransform = {
    scale,
    x: Math.round(viewport.clientWidth / 2 - centerX * scale),
    y: Math.round(viewport.clientHeight / 2 - centerY * scale),
  };
  state.seatPlanHasFitted = true;
  canvas.style.transform = `translate3d(${state.seatPlanTransform.x}px, ${state.seatPlanTransform.y}px, 0) scale(${scale})`;
  map.dataset.selectedPersonKey = target.personKey || "";
  map.dataset.selectedTableId = resolvedTarget.tableId;
  map.dataset.selectedChairId = resolvedTarget.chairId;
  map.querySelectorAll(".seat-plan-chair").forEach((seat) => {
    const selected = seat.dataset.seatTableId === resolvedTarget.tableId && seat.dataset.seatChairId === resolvedTarget.chairId;
    seat.classList.toggle("is-selected", selected);
  });
  return true;
}

function fitInvitationSeatingPlan(reset = true) {
  const viewport = document.getElementById("seatPlanViewport");
  if (!viewport || viewport.closest("[hidden]") || (!reset && state.seatPlanHasFitted)) return;
  const canvasWidth = 1100;
  const canvasHeight = 900;
  if (reset) {
    state.seatPlanViewMode = "fit";
    state.seatPlanFocusedAssignments = [];
  }
  if (!viewport.clientWidth || !viewport.clientHeight) {
    requestAnimationFrame(() => fitInvitationSeatingPlan(reset));
    return;
  }
  const padding = 18;
  const bounds = getInvitationPlanBounds(canvasWidth, canvasHeight);
  const scale = clamp(
    Math.min((viewport.clientWidth - padding * 2) / bounds.width, (viewport.clientHeight - padding * 2) / bounds.height),
    0.05,
    1.1,
  );
  state.seatPlanTransform = {
    scale,
    x: Math.round(viewport.clientWidth / 2 - ((bounds.minX + bounds.maxX) / 2) * scale),
    y: Math.round(viewport.clientHeight / 2 - ((bounds.minY + bounds.maxY) / 2) * scale),
  };
  state.seatPlanHasFitted = true;
  const canvas = document.getElementById("seatPlanCanvas");
  if (canvas) canvas.style.transform = `translate3d(${state.seatPlanTransform.x}px, ${state.seatPlanTransform.y}px, 0) scale(${scale})`;
}

function getInvitationPlanBounds(canvasWidth, canvasHeight) {
  const boxes = [];
  const addBox = (centerX, centerY, width, height) => {
    boxes.push({ minX: centerX - width / 2, maxX: centerX + width / 2, minY: centerY - height / 2, maxY: centerY + height / 2 });
  };
  state.tables.forEach((table) => {
    const width = Number(table.width || defaultTableWidth(table.shape));
    const height = Number(table.height || defaultTableHeight(table.shape));
    const radians = (Number(table.rotation || 0) * Math.PI) / 180;
    const halfWidth = (Math.abs(Math.cos(radians)) * width + Math.abs(Math.sin(radians)) * height) / 2;
    const halfHeight = (Math.abs(Math.sin(radians)) * width + Math.abs(Math.cos(radians)) * height) / 2;
    const centerX = (Number(table.x ?? 50) / 100) * canvasWidth;
    const centerY = (Number(table.y ?? 50) / 100) * canvasHeight;
    addBox(centerX, centerY, halfWidth * 2 + 112, halfHeight * 2 + 112);
  });
  const allChairAssignments = state.tables.flatMap((table) =>
    (table.chairs || []).map((chair) => ({ tableId: table.id, seatNumber: chair.seatNumber })),
  );
  const chairBounds = getSeatPlanFrameBounds(state.tables, allChairAssignments, canvasWidth, canvasHeight, 22);
  if (chairBounds) boxes.push(chairBounds);
  state.hallObjects.forEach((item) => {
    const isDanceFloor = item.type === "dance-floor";
    const width = isDanceFloor ? clamp(Number(item.width) || 280, 120, 700) : 160;
    const height = isDanceFloor ? clamp(Number(item.height) || 280, 120, 700) : 54;
    const radians = isDanceFloor ? (Number(item.rotation || 0) * Math.PI) / 180 : 0;
    const halfWidth = (Math.abs(Math.cos(radians)) * width + Math.abs(Math.sin(radians)) * height) / 2;
    const halfHeight = (Math.abs(Math.sin(radians)) * width + Math.abs(Math.cos(radians)) * height) / 2;
    addBox(
      (Number(item.x ?? 50) / 100) * canvasWidth,
      (Number(item.y ?? 50) / 100) * canvasHeight,
      halfWidth * 2 + 24,
      halfHeight * 2 + 24,
    );
  });
  if (!boxes.length) return { minX: 0, maxX: canvasWidth, minY: 0, maxY: canvasHeight, width: canvasWidth, height: canvasHeight };
  const minX = Math.min(...boxes.map((box) => box.minX)) - 48;
  const maxX = Math.max(...boxes.map((box) => box.maxX)) + 48;
  const minY = Math.min(...boxes.map((box) => box.minY)) - 48;
  const maxY = Math.max(...boxes.map((box) => box.maxY)) + 48;
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

function centerInvitationSeats(assignments = getInvitationSeatAssignments(state.guest)) {
  const viewport = document.getElementById("seatPlanViewport");
  const canvas = document.getElementById("seatPlanCanvas");
  if (!viewport || !canvas || !assignments.length) return;
  state.seatPlanViewMode = "seats";
  state.seatPlanFocusedAssignments = assignments.map((assignment) => ({ ...assignment }));
  const focus = () => {
    const currentViewport = document.getElementById("seatPlanViewport");
    const currentCanvas = document.getElementById("seatPlanCanvas");
    if (!currentViewport || !currentCanvas) return;
    if (!currentViewport.clientWidth || !currentViewport.clientHeight) {
      requestAnimationFrame(focus);
      return;
    }
    const bounds = getSeatPlanFocusBounds(state.tables, assignments, 1100, 900);
    if (!bounds) return;
    const boundsWidth = Math.max(1, bounds.maxX - bounds.minX);
    const boundsHeight = Math.max(1, bounds.maxY - bounds.minY);
    const scale = clamp(Math.min((currentViewport.clientWidth - 52) / boundsWidth, (currentViewport.clientHeight - 72) / boundsHeight), 0.28, 1.25);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    state.seatPlanTransform = {
      scale,
      x: Math.round(currentViewport.clientWidth / 2 - centerX * scale),
      y: Math.round(currentViewport.clientHeight / 2 - centerY * scale),
    };
    state.seatPlanHasFitted = true;
    currentCanvas.style.transform = `translate3d(${state.seatPlanTransform.x}px, ${state.seatPlanTransform.y}px, 0) scale(${scale})`;
  };
  requestAnimationFrame(focus);
}

function createHallObjects() {
  return [
    { id: "stage-default", type: "stage", label: "Stage", x: 50, y: 8 },
    { id: "entrance-default", type: "entrance", label: "Entrance", x: 50, y: 90 },
    { id: "dance-floor-default", type: "dance-floor", label: "Dance Floor", x: 50, y: 48, width: 260, height: 260, shape: "round", fillColor: "#2F6F64", borderColor: "#D7B56D" },
  ];
}

function hydrateHallObjects(savedObjects, live = false) {
  const saved = Array.isArray(savedObjects) ? savedObjects : [];
  const savedById = new Map(saved.map((item) => [item.id, item]));
  const defaults = live ? createHallObjects().filter((item) => item.type !== "dance-floor") : createHallObjects();
  const defaultIds = new Set(defaults.map((item) => item.id));
  const mergedDefaults = defaults.map((item) => ({
    ...item,
    ...(savedById.get(item.id) || {}),
  }));
  const savedExtras = saved.filter((item) => item?.id && !defaultIds.has(item.id));
  const hasSavedDanceFloor = saved.some((item) => item?.type === "dance-floor");
  return hasSavedDanceFloor
    ? [...mergedDefaults.filter((item) => item.type !== "dance-floor"), ...savedExtras]
    : [...mergedDefaults, ...savedExtras];
}

function defaultWidthForShape(shape) {
  return defaultTableWidth(shape);
}

function defaultHeightForShape(shape) {
  return defaultTableHeight(shape);
}

async function renderGuestQrPass() {
  if (
    state.sampleMode || state.mode !== "firebase" ||
    !state.guest ||
    !state.weddingId ||
    !state.guestToken ||
    state.wedding?.showInvitationQr === false
  ) {
    elements.qrPassSection.hidden = true;
    const mount = document.getElementById("qrPassMount");
    if (mount) mount.innerHTML = "";
    return;
  }

  elements.qrPassSection.hidden = false;
  const checkinUrl = buildAbsoluteUrl(`checkin.html?wedding=${encodeURIComponent(state.weddingId)}#guest=${encodeURIComponent(state.guestToken)}`);
  const mount = document.getElementById("qrPassMount");
  mount.innerHTML = `
    <div class="qr-pass__content">
      <div class="qr-pass__code" id="guestQrCode"></div>
      <div class="qr-pass__copy">
        <p>${isLaylaInvitation() ? laylaText("qrInstructions") : "Present this QR code at the entrance."}</p>
      </div>
    </div>
  `;
  await renderQrCode(document.getElementById("guestQrCode"), checkinUrl, { size: 220 });
}

async function updateRsvp(status, additionalGuests) {
  if (state.sampleMode || state.mode !== "firebase" || state.isRsvpSaving || !state.guest || !["confirmed", "declined"].includes(status)) return;
  state.isRsvpSaving = true;
  state.rsvpSaveError = "";
  const liveForm = document.getElementById("firebaseRsvpForm");
  liveForm?.querySelectorAll("button, input, textarea").forEach((control) => { control.disabled = true; });
  const statusNode = liveForm?.querySelector(".firebase-rsvp-status");
  if (statusNode) statusNode.textContent = isLaylaInvitation() ? laylaText("responseSaving") : "Saving your response…";
  if (isLaylaInvitation() && liveForm) {
    liveForm.setAttribute("aria-busy", "true");
    const label = liveForm.querySelector(".rsvp-form__submit span");
    if (label) label.textContent = laylaText("responseSaving");
  }

  try {
    const message = state.rsvpMessage.trim();
    if (message.length > 1000) throw new Error("Message must be 1000 characters or fewer.");
    const invitationApi = await getInvitationDataApi();
    await invitationApi.saveInvitationRsvp({
      weddingId: state.weddingId,
      guestToken: state.guestToken,
      guestId: state.guestId,
      guest: state.guest,
    }, status, additionalGuests, message || undefined);
    state.guest.rsvpStatus = status;
    if (additionalGuests !== undefined && additionalGuests !== null) state.guest.additionalGuests = Number(additionalGuests);
    state.isRsvpSaving = false;
    state.isRsvpEditing = false;
    state.rsvpSelection = "";
    state.rsvpMessage = "";
    renderFirebaseRsvp(document.getElementById("rsvpMount"));
    if (!isLaylaInvitation()) showToast("Your response has been saved.", "success");
  } catch (error) {
    console.error("Invitation RSVP save failed.", error.code || "unavailable");
    state.isRsvpSaving = false;
    state.rsvpSaveError = error.transient || error.code === "permission-denied" ? error.message : isLaylaInvitation() ? laylaText("responseSaveError") : "We could not save your response. Please try again.";
    state.rsvpSelection = status;
    renderFirebaseRsvp(document.getElementById("rsvpMount"));
    if (!isLaylaInvitation()) showToast(state.rsvpSaveError, "error");
  }
}

function bindBaseEvents() {
  elements.openInvitationButton?.addEventListener("click", handleOpenInvitation);
  elements.introScreen?.addEventListener("click", (event) => {
    if (!isLaylaInvitation()) return;
    if (event.target.closest("#openInvitation, #skipOpening")) return;
    handleOpenInvitation();
  });
  elements.skipOpeningButton?.addEventListener("click", () => revealInvitation());
  elements.musicToggle?.addEventListener("click", handleMusicToggle);

  document.addEventListener("click", async (event) => {
    if (event.target.closest("#laylaLanguageToggle")) {
      const language = event.target.closest("[data-language]")?.dataset.language;
      if (language === "en" || language === "ar") setLaylaLanguage(language);
      return;
    }
    const detailTab = event.target.closest("[data-detail-tab]");
    if (detailTab) {
      selectLaylaDetailTab(detailTab.dataset.detailTab);
      return;
    }
    const mapPreviewButton = event.target.closest("[data-load-map-preview]");
    if (mapPreviewButton) {
      loadLaylaMapPreview(mapPreviewButton);
      return;
    }
    const calendarButton = event.target.closest("[data-calendar-download]");
    if (calendarButton) {
      downloadCalendarFile();
    }

    if (event.target.closest("[data-scroll-details]")) {
      const detailsTarget = isLaylaInvitation()
        ? document.querySelector("#countdownSection .section-frame")
        : document.getElementById("detailsSection");
      detailsTarget?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    const rsvpTrigger = event.target.closest("[data-scroll-rsvp]");
    if (rsvpTrigger) {
      if (state.sampleMode) return;
      scrollToRsvp();
    }

    if (event.target.closest("[data-edit-rsvp], [data-change-rsvp]")) {
      if (event.target.closest("[data-change-rsvp]")) {
        state.rsvpSelection = usesSampleRsvp() ? (state.sampleRsvpResponse?.status || "") : "";
        if (usesSampleRsvp()) state.rsvpMessage = state.sampleRsvpResponse?.message || "";
      }
      state.isRsvpEditing = true;
      renderRsvp();
    }

    const rsvpButton = event.target.closest("[data-rsvp-status]");
    if (rsvpButton) {
      await updateRsvp(rsvpButton.dataset.rsvpStatus);
    }
  });

  document.addEventListener("keydown", (event) => {
    const current = event.target.closest("[data-detail-tab]");
    if (!current) return;
    const tabs = [...document.querySelectorAll("[data-detail-tab]")];
    if (!tabs.length) return;
    const index = tabs.indexOf(current);
    const rtl = state.laylaLanguage === "ar";
    const forward = rtl ? "ArrowLeft" : "ArrowRight";
    const backward = rtl ? "ArrowRight" : "ArrowLeft";
    let nextIndex = index;
    if (event.key === forward) nextIndex = (index + 1) % tabs.length;
    else if (event.key === backward) nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    selectLaylaDetailTab(tabs[nextIndex].dataset.detailTab, true);
  });
}

function configureInlineEnvelopePlayback(video) {
  video.defaultMuted = true;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
}

function handleOpenInvitation() {
  if (document.body.classList.contains("invitation-open")) return;

  const video = elements.openingVideo;
  if (state.introSequence?.active) {
    if (!state.introSequence.retry() || !video) return;
    configureInlineEnvelopePlayback(video);
    try {
      const playback = video.play();
      if (playback && typeof playback.catch === "function") {
        playback.catch(() => state.introSequence?.playbackRejected());
      }
    } catch (error) {
      state.introSequence.playbackRejected();
    }
    return;
  }

  if (state.invitationOpening) return;
  state.invitationOpening = true;
  if (elements.skipOpeningButton) elements.skipOpeningButton.hidden = false;

  if (!video || !state.introSequence) {
    // Some invitation templates do not include an opening video. The guest's
    // tap should still open the invitation instead of leaving the error
    // overlay above the RSVP controls.
    revealInvitation();
    void playWeddingMusicFromGesture();
    return;
  }

  configureInlineEnvelopePlayback(video);
  waitForIntroAnimation();
  try {
    // Keep play() in the tap handler and before any awaited work so mobile
    // browsers retain the user's activation for this media request.
    const playback = video.play();
    if (playback && typeof playback.catch === "function") {
      playback.catch(() => state.introSequence?.playbackRejected());
    }
  } catch (error) {
    state.introSequence.playbackRejected();
  }
  // Audio is a separate best-effort request and never gates the envelope.
  void playWeddingMusicFromGesture();
}

function revealInvitation() {
  if (document.body.classList.contains("invitation-open")) return;
  document.body.classList.add("invitation-open");
  const finishIntro = state.introCompletion;
  state.introCompletion = null;
  finishIntro?.();
  disposeIntroSequence();
  state.invitationOpening = false;
  elements.openingVideo?.pause();
  document.body.classList.remove("intro-active");
  elements.introScreen?.classList.add("is-hidden");
  const siteContent = document.getElementById("siteContent");
  if (siteContent) siteContent.inert = false;
  if (elements.skipOpeningButton) elements.skipOpeningButton.hidden = true;
  if (isLaylaInvitation()) setupLaylaDetailsBackdrop();
  elements.musicToggle.hidden = false;
  elements.stickyActions.hidden = false;
  setupRevealObserver();
}

async function playWeddingMusicFromGesture() {
  if (!state.musicAvailable || !elements.weddingAudio) {
    setMusicToggleState("unavailable", "♫", isLaylaInvitation() ? laylaText("musicUnavailable") : "Event music unavailable");
    return;
  }

  try {
    elements.weddingAudio.currentTime = 0;
    await elements.weddingAudio.play();
    setMusicToggleState("playing", "♫", isLaylaInvitation() ? laylaText("stopMusic") : "Stop event music");
  } catch (error) {
    setMusicToggleState("paused", "♫", isLaylaInvitation() ? laylaText("playMusic") : "Play event music");
  }
}

async function handleMusicToggle() {
  if (!state.musicAvailable || !elements.weddingAudio) {
    return;
  }

  if (elements.weddingAudio.paused) {
    try {
      await elements.weddingAudio.play();
      setMusicToggleState("playing", "♫", isLaylaInvitation() ? laylaText("stopMusic") : "Stop event music");
    } catch (error) {
      setMusicToggleState("paused", "♫", isLaylaInvitation() ? laylaText("playMusic") : "Play event music");
    }
    return;
  }

  elements.weddingAudio.pause();
  setMusicToggleState("paused", "♫", isLaylaInvitation() ? laylaText("playMusic") : "Play event music");
}

function waitForIntroAnimation() {
  if (!state.introSequence?.start()) return false;
  state.introCompletion = () => state.introSequence?.skip();
  return true;
}

function handleDemoRsvpSubmit(event) {
  event.preventDefault();
  if (state.sampleMode) return;
  const form = event.currentTarget;
  const statusValue = form.elements.status.value;
  if (!["confirmed", "declined"].includes(statusValue)) return;
  const message = String(form.elements.message?.value || "").trim();
  if (message.length > 1000) return;
  const response = {
    status: statusValue,
    additionalGuests: readSavedRsvp()?.additionalGuests,
    message,
    savedAt: new Date().toISOString(),
  };

  localStorage.setItem(rsvpStorageKey, JSON.stringify(response));
  state.rsvpSelection = "";
  state.rsvpSaveError = "";
  state.rsvpMessage = "";
  state.isRsvpEditing = false;
  renderRsvp();
  showToast(laylaText("responseSaved"), "success");
}

function handleSampleRsvpSubmit(event) {
  event.preventDefault();
  if (!usesSampleRsvp()) return;
  const form = event.currentTarget;
  const status = String(form.elements.status.value || "");
  if (!["confirmed", "declined"].includes(status)) return;
  const message = String(form.elements.message?.value || "").trim().slice(0, 1000);
  state.sampleRsvpResponse = { status, message };
  state.rsvpSelection = status;
  state.rsvpMessage = message;
  state.rsvpSaveError = "";
  state.isRsvpEditing = false;
  renderRsvp();
}

async function handleFirebaseRsvpSubmit(event) {
  event.preventDefault();
  if (state.sampleMode) return;
  const form = event.currentTarget;
  const statusValue = form.elements.status.value;
  if (!["confirmed", "declined"].includes(statusValue)) return;
  state.rsvpMessage = String(form.elements.message?.value || "").slice(0, 1000);
  await updateRsvp(statusValue);
}

function setupRsvpPhases(form) {
  if (!form) {
    return;
  }

  const statusInputs = form.querySelectorAll('input[name="status"]');
  const submitButton = form.querySelector(".rsvp-form__submit");

  const updateFlow = (statusValue) => {
    submitButton.hidden = !(statusValue === "confirmed" || statusValue === "declined");
  };

  statusInputs.forEach((input) => input.addEventListener("change", () => updateFlow(input.value)));
}

function readSavedRsvp() {
  try {
    const saved = localStorage.getItem(rsvpStorageKey);
    if (!saved) return null;
    const value = JSON.parse(saved);
    if (value?.status === "Yes" || value?.status === "No") {
      value.status = value.status === "Yes" ? "confirmed" : "declined";
      localStorage.setItem(rsvpStorageKey, JSON.stringify(value));
    }
    return ["confirmed", "declined"].includes(value?.status) ? value : null;
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

function setupLaylaDetailsBackdrop() {
  document.body.classList.add("layla-details-visible");
}

function setupRevealObserver() {
  if (!document.body.classList.contains("invitation-open")) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.querySelectorAll(".reveal").forEach((item) => item.classList.add("is-visible"));
    return;
  }
  if (!state.revealObserver && "IntersectionObserver" in window) {
    state.revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          state.revealObserver.unobserve(entry.target);
          entry.target.removeAttribute("data-reveal-observed");
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
  }
  const items = [...document.querySelectorAll(".reveal:not(.is-visible)")].filter((item) => !item.hidden && !item.closest("[hidden]"));
  items.forEach((item, index) => {
    item.style.setProperty("--reveal-delay", `${Math.min(index, 4) * 75}ms`);
    if (state.revealObserver) state.revealObserver.observe(item);
    else item.classList.add("is-visible");
  });
  if (!state.motionObserver && "IntersectionObserver" in window) {
    state.motionObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { entry.target.style.animationPlayState = entry.isIntersecting ? "running" : "paused"; });
    }, { threshold: 0 });
  }
  if (state.motionObserver) {
    [...document.querySelectorAll(".petal:not([data-motion-observed]), .hero-blossom:not([data-motion-observed]), .section-kicker:not([data-motion-observed]), .invitation-flower:not([data-motion-observed])")].filter((item) => !item.hidden && !item.closest("[hidden]")).forEach((item) => {
      item.dataset.motionObserved = "true";
      item.style.animationPlayState = "paused";
      state.motionObserver.observe(item);
    });
  }
}

function setupAudioState() {
  document.addEventListener("visibilitychange", () => {
    document.body.classList.toggle("page-hidden", document.hidden);
  });
  elements.weddingAudio?.addEventListener("error", () => {
    state.musicAvailable = false;
    setMusicToggleState("unavailable", "Off", isLaylaInvitation() ? laylaText("musicUnavailable") : "Event music unavailable");
  });

  elements.weddingAudio?.addEventListener("pause", () => {
    if (state.musicAvailable && document.body.classList.contains("invitation-open")) {
      setMusicToggleState("paused", "♫", isLaylaInvitation() ? laylaText("playMusic") : "Play event music");
    }
  });

  elements.weddingAudio?.addEventListener("playing", () => {
    if (state.musicAvailable) {
      setMusicToggleState("playing", "♫", isLaylaInvitation() ? laylaText("stopMusic") : "Stop event music");
    }
  });

  elements.weddingAudio?.addEventListener("ended", () => {
    if (state.musicAvailable) {
      setMusicToggleState("paused", "♫", isLaylaInvitation() ? laylaText("playMusic") : "Play event music");
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
  elements.musicToggle.setAttribute("aria-pressed", String(stateName === "playing"));
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
  const ics = buildInvitationCalendar(state.wedding, state.weddingId || "layla-zaid-demo");

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "event-invitation.ics";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser's download pipeline a moment to consume the object URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
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
  // Designs may be nested below the hosting root. document.baseURI honors
  // their declared base path while the root invitation continues unchanged.
  return new URL(path, document.baseURI).toString();
}

function eventTimeFromDate(wedding, locale = "en") {
  const date = new Date(wedding.eventDateISO);
  if (!wedding.eventDateISO || Number.isNaN(date.getTime())) return "";
  try { return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", ...(wedding.eventTimeZone ? { timeZone: wedding.eventTimeZone } : {}) }).format(date); } catch { return ""; }
}

function formatDate(dateISO) {
  return new Intl.DateTimeFormat("en-GB", {
    ...(state.wedding.eventTimeZone ? { timeZone: state.wedding.eventTimeZone } : {}),
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(dateISO));
}

function formatArabicDate(dateISO) {
  return new Intl.DateTimeFormat("ar-AE", {
    ...(state.wedding.eventTimeZone ? { timeZone: state.wedding.eventTimeZone } : {}),
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
