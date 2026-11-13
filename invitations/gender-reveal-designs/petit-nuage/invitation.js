// Petit Nuage: gender reveal invitation.
// Same guest flow and data as the classic gender reveal page (one RSVP and
// prediction per browser session, then the live boy/girl totals), with its own
// opening: hold the pearl balloon until it pops, and the film starts on the
// cover's own frame. Firebase is only loaded for real events; ?sample=1 runs a
// self-contained demo for previews.
import {
  genderRevealLocalValidation, genderRevealResultSummary, genderRevealSubmissionErrorKey, safeGenderRevealMediaUrl,
} from "../../../gender-reveal-experience.js";
import { createIntroSequence } from "../../../intro-sequence.js?v=20261028-finish-at-1";

const ASSETS = new URL("./assets/", import.meta.url);
const asset = (name) => new URL(name, ASSETS).href;
const OPENING_FILM = asset("opening.mp4");
const OPENING_FILM_FINISH_AT = 6.4;
const HOLD_MS = 1100;

const params = new URLSearchParams(location.search);
const sampleMode = params.get("sample") === "1";
const weddingId = (params.get("wedding") || "").trim();
const languageStorageKey = `gender-reveal-language:${weddingId || "petit-nuage"}`;
const reducedMotionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
const reducedMotion = () => Boolean(reducedMotionQuery?.matches);

const SAMPLE_EVENT = Object.freeze({
  eventCategory: "gender_reveal", eventStatus: "active",
  eventTitle: "Sara & Omar's Gender Reveal", eventTitleAr: "حفل الكشف عن جنس مولود سارة وعمر",
  genderRevealMessageEn: "A little cloud is drifting our way. Come and find out with us, pink or blue.",
  genderRevealMessageAr: "غيمة صغيرة في طريقها إلينا. تعالوا لنكتشف معًا: وردي أم أزرق؟",
  eventDateISO: "2027-02-12T17:00:00+04:00", eventTimeZone: "Asia/Dubai",
  venueEn: "The Cloud Terrace", location: "Jumeirah Beach Road, Dubai", mapsUrl: "https://maps.google.com/?q=Jumeirah+Beach+Road+Dubai",
  genderRevealMusicUrl: "/music/gender-reveal-party.mp3",
});
const SAMPLE_TOTALS = { boyCount: 18, girlCount: 21 };

const copy = {
  en: {
    language: "Invitation language", loading: "Loading invitation…", loadError: "This invitation could not be loaded. Check the link or try again.", sample: "Sample invitation",
    coverEyebrow: "A little celebration is on the way", boy: "Boy", girl: "Girl", or: "or", team: "Team", defaultMessage: "A little surprise is on the way…",
    openInvitation: "Open invitation", popHint: "Press & hold the balloon until it pops", popHolding: "Keep holding…", tapOpen: "or tap here to open",
    youAreInvited: "You are invited", when: "When", where: "Where", directions: "Get directions", days: "Days", hours: "Hours", minutes: "Min", seconds: "Sec", celebrating: "It's party time!",
    thingsEyebrow: "Getting ready for you", thingsTitle: "All the little things",
    capBottle: "Warm milk at 3 a.m.", capBooties: "Tiny first steps", capBunny: "A first best friend", capRattle: "Shake, giggle, repeat", capPram: "Slow strolls by the sea", capMobile: "Lullabies and stars", capHorse: "Big adventures ahead", capPacifier: "Sweet dreams",
    quote: "Every little thing about you is already loved.",
    kindlyReply: "Kindly reply", formTitle: "Team Blue or Team Pink?", formIntro: "Tell us if you can come, and cast your guess. One reply per browser, please.",
    fullName: "Full name", attendance: "Will you attend?", attending: "Attending", notAttending: "Not attending",
    prediction: "What is your prediction?", message: "Message to the parents", optional: "Optional", messageHint: "Up to 1,000 characters.", submit: "Send my guess", saving: "Sending…",
    saved: "Response saved", thankYou: "Thank you for your guess!", thankYouBody: "Your kind wishes mean so much to the parents.", resultsTitle: "The guesses so far",
    totalPredictions: (total) => `${total} ${total === 1 ? "guess" : "guesses"} so far`,
    skip: "Skip", retryOpening: "Retry video", videoLoading: "Opening your invitation…", videoSlow: "The video is taking longer to start. You can retry or skip.", videoFailed: "The video could not be played. You can retry or skip.", videoBlocked: "Your browser blocked video playback. Tap retry or skip.", reducedMotion: "Your invitation is ready.", fallbackStatic: "The opening film was skipped. Your invitation is ready.",
    musicPlay: "Play event music", musicPause: "Pause event music", musicBlocked: "Music could not start. Tap the music button to try again.", musicPlaying: "Event music is playing.", musicUnavailable: "Event music is unavailable.",
    closed: "Responses are not open for this event.", validationSummary: "Please check the highlighted fields.", nameRequired: "Enter your full name.", nameTooLong: "Your name must be 120 characters or fewer.", attendanceRequired: "Choose whether you will attend.", predictionRequired: "Pick Team Boy or Team Girl.", messageTooLong: "Your message must be 1,000 characters or fewer.",
    closedError: "Responses are not open for this event. Your draft is still here.", permissionError: "Access was denied while saving your response. Your form is still here; please try again or contact the organizer.", duplicateError: "This browser has already sent a response. Your earlier response has not been changed.", quotaError: "The response service is busy right now. Your form is still here; please try again later.", networkError: "A network problem stopped your response from saving. Your form is still here; check your connection and try again.", saveError: "We could not save your response. Your form is still here; please try again.",
    resultsError: "Your response was saved, but the totals could not be loaded right now.", boyBar: "Boy predictions", girlBar: "Girl predictions",
    closing: "Whoever you are, little one, you are already so loved.", madeBy: "Made by",
  },
  ar: {
    language: "لغة الدعوة", loading: "جارٍ تحميل الدعوة…", loadError: "تعذّر تحميل هذه الدعوة. تحقق من الرابط أو حاول مرة أخرى.", sample: "دعوة تجريبية",
    coverEyebrow: "احتفال صغير يقترب", boy: "ولد", girl: "بنت", or: "أم", team: "فريق", defaultMessage: "مفاجأة جميلة بانتظارنا…",
    openInvitation: "افتح الدعوة", popHint: "اضغط مطولًا على البالون حتى ينفجر", popHolding: "استمر بالضغط…", tapOpen: "أو اضغط هنا لفتح الدعوة",
    youAreInvited: "أنتم مدعوون", when: "الموعد", where: "المكان", directions: "الاتجاهات", days: "يوم", hours: "ساعة", minutes: "دقيقة", seconds: "ثانية", celebrating: "حان وقت الاحتفال!",
    thingsEyebrow: "نستعد لاستقبالك", thingsTitle: "كل الأشياء الصغيرة",
    capBottle: "حليب دافئ في منتصف الليل", capBooties: "أولى الخطوات الصغيرة", capBunny: "أول صديق", capRattle: "هزّة وضحكة", capPram: "نزهات هادئة على البحر", capMobile: "تهويدات ونجوم", capHorse: "مغامرات كبيرة تنتظرك", capPacifier: "أحلام سعيدة",
    quote: "كل شيء صغير فيك محبوب منذ الآن.",
    kindlyReply: "يرجى الرد", formTitle: "الفريق الأزرق أم الوردي؟", formIntro: "أخبرنا إن كنت ستحضر وشاركنا توقعك. ردّ واحد من كل متصفح.",
    fullName: "الاسم الكامل", attendance: "هل ستحضر؟", attending: "سأحضر", notAttending: "لن أحضر",
    prediction: "ما توقعك؟", message: "رسالة إلى الوالدين", optional: "اختياري", messageHint: "حتى ١٬٠٠٠ حرف.", submit: "أرسل توقعي", saving: "جارٍ الإرسال…",
    saved: "تم حفظ الرد", thankYou: "شكرًا لمشاركتنا توقعك!", thankYouBody: "تمنياتك الجميلة تعني الكثير للوالدين.", resultsTitle: "التوقعات حتى الآن",
    totalPredictions: (total) => `${new Intl.NumberFormat("ar").format(total)} ${total === 1 ? "توقع" : "توقعات"} حتى الآن`,
    skip: "تخطي", retryOpening: "إعادة تشغيل الفيديو", videoLoading: "جارٍ فتح الدعوة…", videoSlow: "استغرق تشغيل الفيديو وقتًا أطول. يمكنك إعادة المحاولة أو التخطي.", videoFailed: "تعذّر تشغيل الفيديو. يمكنك إعادة المحاولة أو التخطي.", videoBlocked: "منع المتصفح تشغيل الفيديو. اضغط لإعادة المحاولة أو التخطي.", reducedMotion: "دعوتك جاهزة.", fallbackStatic: "تم تخطي الفيلم الافتتاحي. دعوتك جاهزة.",
    musicPlay: "تشغيل موسيقى الحفل", musicPause: "إيقاف موسيقى الحفل مؤقتًا", musicBlocked: "تعذّر تشغيل الموسيقى. اضغط زر الموسيقى للمحاولة مجددًا.", musicPlaying: "موسيقى الحفل تعمل.", musicUnavailable: "موسيقى الحفل غير متاحة.",
    closed: "الردود غير متاحة لهذه المناسبة.", validationSummary: "يرجى مراجعة الحقول المحددة.", nameRequired: "أدخل اسمك الكامل.", nameTooLong: "يجب ألا يتجاوز الاسم ١٢٠ حرفًا.", attendanceRequired: "اختر ما إذا كنت ستحضر.", predictionRequired: "اختر فريق الولد أو البنت.", messageTooLong: "يجب ألا تتجاوز الرسالة ١٬٠٠٠ حرف.",
    closedError: "الردود غير متاحة لهذه المناسبة. ما زالت بياناتك هنا.", permissionError: "لا تتوفر صلاحية حفظ الرد. ما زالت بياناتك هنا؛ حاول مجددًا أو تواصل مع المنظم.", duplicateError: "أرسل هذا المتصفح ردًا من قبل. لم يتغير ردك السابق.", quotaError: "خدمة الردود مشغولة الآن. ما زالت بياناتك هنا؛ حاول لاحقًا.", networkError: "منع خلل في الاتصال حفظ ردك. ما زالت بياناتك هنا؛ تحقق من الاتصال وحاول مجددًا.", saveError: "تعذّر حفظ ردك. ما زالت بياناتك هنا؛ حاول مجددًا.",
    resultsError: "تم حفظ ردك، لكن تعذّر تحميل الإجمالي الآن.", boyBar: "توقعات ولد", girlBar: "توقعات بنت",
    closing: "أيًّا كنت يا صغيرنا، فأنت محبوب منذ الآن.", madeBy: "صُنعت بواسطة",
  },
};

const $ = (id) => document.getElementById(id);
const el = {
  app: $("genderRevealApp"), pageStatus: $("pageStatus"), cover: $("cover"), stage: $("stage"), coverArtwork: $("coverArtwork"), coverMessage: $("coverMessage"), coverEventTitle: $("coverEventTitle"),
  open: $("openInvitation"), tapOpen: $("tapOpen"), popHint: $("popHint"), openingVideo: $("openingVideo"), openingTools: $("openingTools"), openingStatus: $("openingStatus"), retry: $("retryOpening"), skip: $("skipOpening"),
  confetti: $("confetti"), invitation: $("invitationContent"), sampleBanner: $("sampleBanner"),
  eventTitle: $("eventTitle"), eventMessage: $("eventMessage"), eventDay: $("eventDay"), eventDate: $("eventDate"), eventTime: $("eventTime"), countdown: $("countdown"),
  whereCard: $("whereCard"), eventVenue: $("eventVenue"), eventPlace: $("eventPlace"), mapsLink: $("mapsLink"),
  closedNotice: $("closedNotice"), mediaNotice: $("mediaNotice"), formSection: $("responseFormSection"), form: $("responseForm"), formStatus: $("formStatus"), submit: $("submitResponse"),
  thankYou: $("thankYou"), results: $("results"), resultsStatus: $("resultsStatus"),
  music: $("eventMusic"), musicToggle: $("musicToggle"), musicStatus: $("musicStatus"),
};

const controller = new AbortController();
const { signal } = controller;
const state = {
  event: null, language: readLanguage(), musicUrl: "", openingFinished: false, opening: false, intro: null, responseSaved: false, submitting: false,
  pageStatusKey: "", formStatusKey: "", formStatusIsError: false, openingKey: "", pendingFallbackKey: "", mediaNoticeKey: "", musicStatusKey: "", resultsStatusKey: "", resultsTotal: 0,
  fieldErrors: {}, unsubscribe: null, firebase: null, submit: null, revealTimer: 0, countdownTimer: 0, audioPrimed: false,
};

function readLanguage() {
  try { return sessionStorage.getItem(languageStorageKey) === "ar" ? "ar" : "en"; } catch { return "en"; }
}
function saveLanguage(language) {
  try { sessionStorage.setItem(languageStorageKey, language); } catch { /* Storage can be disabled; the language still works in memory. */ }
}
const t = (key) => copy[state.language][key];

/* ---------- Text ---------- */

function eventTitle() {
  return state.language === "ar" ? (state.event?.eventTitleAr || "حفل الكشف عن جنس المولود") : (state.event?.eventTitle || "Gender Reveal Party");
}
function eventMessage() {
  if (!state.event) return t("defaultMessage");
  return state.language === "ar"
    ? (state.event.genderRevealMessageAr || state.event.subtitleAr || copy.ar.defaultMessage)
    : (state.event.genderRevealMessageEn || state.event.subtitleEn || copy.en.defaultMessage);
}
function dateParts() {
  const date = new Date(state.event?.eventDateISO || "");
  if (Number.isNaN(date.getTime())) return null;
  const locale = state.language === "ar" ? "ar-AE" : "en-GB";
  const timeZone = state.event.eventTimeZone || "Asia/Dubai";
  try {
    return {
      day: new Intl.DateTimeFormat(locale, { weekday: "long", timeZone }).format(date),
      date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone }).format(date),
      time: new Intl.DateTimeFormat(state.language === "ar" ? "ar-AE" : "en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(date),
    };
  } catch { return null; }
}

function render() {
  const strings = copy[state.language];
  const arabic = state.language === "ar";
  document.documentElement.lang = state.language;
  document.documentElement.dir = arabic ? "rtl" : "ltr";
  document.body.classList.toggle("is-arabic", arabic);
  document.querySelectorAll("[data-copy]").forEach((node) => {
    const value = strings[node.dataset.copy];
    if (typeof value === "string") node.textContent = value;
  });
  document.querySelectorAll("[data-language]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.language === state.language)));
  document.querySelector(".pn-language")?.setAttribute("aria-label", strings.language);
  document.title = eventTitle();
  if (state.event) {
    el.coverEventTitle.textContent = eventTitle();
    el.coverMessage.textContent = eventMessage();
    el.eventTitle.textContent = eventTitle();
    el.eventMessage.textContent = eventMessage();
    const parts = dateParts();
    el.eventDay.textContent = parts?.day || "";
    el.eventDate.textContent = parts?.date || "";
    el.eventTime.textContent = parts?.time || "";
    const venue = (state.event.venueEn || "").trim();
    const place = (state.event.location || state.event.locationEn || "").trim();
    el.whereCard.hidden = !venue && !place;
    el.eventVenue.textContent = venue || place;
    el.eventPlace.textContent = venue ? place : "";
    el.eventPlace.hidden = !venue || !place;
    const maps = safeHttps(state.event.mapsUrl);
    el.mapsLink.hidden = !maps;
    if (maps) el.mapsLink.href = maps;
  }
  for (const [field, key] of Object.entries(state.fieldErrors)) {
    const node = $(`${field}Error`);
    if (node) node.textContent = key ? strings[key] || "" : "";
  }
  if (state.pageStatusKey) el.pageStatus.textContent = strings[state.pageStatusKey] || "";
  if (state.formStatusKey) el.formStatus.textContent = strings[state.formStatusKey] || "";
  if (state.openingKey) el.openingStatus.textContent = strings[state.openingKey] || "";
  if (state.mediaNoticeKey) el.mediaNotice.textContent = strings[state.mediaNoticeKey] || "";
  if (state.musicStatusKey) el.musicStatus.textContent = strings[state.musicStatusKey] || "";
  if (state.resultsStatusKey) el.resultsStatus.textContent = strings[state.resultsStatusKey] || "";
  if (state.submitting) el.submit.querySelector("[data-copy]").textContent = strings.saving;
  if (state.responseSaved) $("resultTotal").textContent = strings.totalPredictions(state.resultsTotal);
  $("boyBar").setAttribute("aria-label", strings.boyBar);
  $("girlBar").setAttribute("aria-label", strings.girlBar);
  updateMusicButton();
  tickCountdown();
  el.app.setAttribute("aria-busy", String(!state.event));
}

function safeHttps(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

function setPageStatus(key = "", isError = false) {
  state.pageStatusKey = key;
  el.pageStatus.textContent = key ? t(key) : "";
  el.pageStatus.classList.toggle("is-error", isError);
  el.pageStatus.hidden = !key;
}
function setOpeningStatus(key) {
  state.openingKey = key;
  el.openingStatus.textContent = key ? t(key) : "";
}
function setFormStatus(key, isError = false) {
  state.formStatusKey = key;
  state.formStatusIsError = isError;
  el.formStatus.textContent = key ? t(key) : "";
  el.formStatus.classList.toggle("is-error", isError);
}
function setFieldError(field, key) {
  state.fieldErrors[field] = key || "";
  const node = $(`${field}Error`);
  const input = field === "attendance" || field === "prediction" ? el.form.querySelector(`[name="${field}"]`) : $(field);
  if (node) node.textContent = key ? t(key) : "";
  if (key) input?.setAttribute("aria-invalid", "true");
  else input?.removeAttribute("aria-invalid");
  input?.closest("fieldset, .pn-field")?.classList.toggle("has-error", Boolean(key));
}

/* ---------- Countdown ---------- */

function tickCountdown() {
  const target = new Date(state.event?.eventDateISO || "").getTime();
  if (!Number.isFinite(target)) { el.countdown.hidden = true; return; }
  el.countdown.hidden = false;
  const left = Math.max(0, target - Date.now());
  const values = { days: Math.floor(left / 864e5), hours: Math.floor(left / 36e5) % 24, minutes: Math.floor(left / 6e4) % 60, seconds: Math.floor(left / 1e3) % 60 };
  const format = new Intl.NumberFormat(state.language === "ar" ? "ar" : "en", { minimumIntegerDigits: 2 });
  el.countdown.querySelectorAll("[data-unit]").forEach((node) => {
    const text = format.format(values[node.dataset.unit]);
    if (node.textContent !== text) { node.textContent = text; node.classList.remove("is-ticking"); void node.offsetWidth; node.classList.add("is-ticking"); }
  });
  el.countdown.classList.toggle("is-done", left === 0);
}
function startCountdown() {
  window.clearInterval(state.countdownTimer);
  tickCountdown();
  state.countdownTimer = window.setInterval(tickCountdown, 1000);
}

/* ---------- Event data ---------- */

function applyEvent(data) {
  state.event = data;
  state.musicUrl = sampleMode ? new URL("../../../music/gender-reveal-party.mp3", import.meta.url).href : safeGenderRevealMediaUrl(data.genderRevealMusicUrl || "");
  el.open.disabled = state.openingFinished;
  el.tapOpen.disabled = state.openingFinished;
  el.formSection.hidden = state.responseSaved || data.eventStatus !== "active";
  el.closedNotice.hidden = data.eventStatus === "active";
  el.musicToggle.hidden = !state.musicUrl || !state.opening && !state.openingFinished;
  setPageStatus("");
  render();
}

async function loadFirebase() {
  if (!state.firebase) state.firebase = await import("../../../firebase-config.js");
  return state.firebase;
}

async function loadEvent() {
  if (sampleMode) {
    el.sampleBanner.hidden = false;
    applyEvent({ ...SAMPLE_EVENT });
    return;
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(weddingId)) throw new Error("Invalid invitation link.");
  const { doc, initPublicFirebase, onSnapshot } = await loadFirebase();
  const { db } = initPublicFirebase();
  await new Promise((resolve, reject) => {
    let first = true;
    state.unsubscribe = onSnapshot(doc(db, "weddings", weddingId, "publicEvent", "details"), (snapshot) => {
      const wasFirst = first;
      first = false;
      if (!snapshot.exists() || snapshot.data().eventCategory !== "gender_reveal") {
        if (wasFirst) reject(new Error("Not a gender reveal invitation."));
        else { state.event = null; el.open.disabled = true; el.tapOpen.disabled = true; setPageStatus("loadError", true); el.app.setAttribute("aria-busy", "false"); }
        return;
      }
      applyEvent(snapshot.data());
      if (wasFirst) resolve();
    }, (error) => { if (first) reject(error); else setPageStatus("loadError", true); });
  });
}

/* ---------- Music ---------- */

function updateMusicButton() {
  const playing = !el.music.paused && !el.music.ended;
  el.musicToggle.setAttribute("aria-label", t(playing ? "musicPause" : "musicPlay"));
  el.musicToggle.setAttribute("aria-pressed", String(playing));
  el.musicToggle.dataset.state = playing ? "playing" : "paused";
}
function setMusicStatus(key) {
  state.musicStatusKey = key;
  el.musicStatus.textContent = key ? t(key) : "";
}
function ensureMusicSource() {
  if (!state.musicUrl) return false;
  if (el.music.src !== state.musicUrl) { el.music.src = state.musicUrl; el.music.load(); }
  return true;
}
// Called inside the pointerdown gesture: iOS only lets audio start from a
// gesture, and the pop itself happens later on a timer. A silent play/pause
// unlocks the element so the pop can start the song.
function primeMusic() {
  if (state.audioPrimed || !ensureMusicSource()) return;
  state.audioPrimed = true;
  el.music.muted = true;
  const attempt = el.music.play();
  if (attempt?.then) attempt.then(() => { if (!state.opening && !state.openingFinished) el.music.pause(); el.music.muted = false; }).catch(() => { el.music.muted = false; state.audioPrimed = false; });
  else el.music.muted = false;
}
function playMusic() {
  if (!ensureMusicSource()) return;
  el.musicToggle.hidden = false;
  el.music.muted = false;
  try {
    const attempt = el.music.play();
    attempt?.then?.(() => { updateMusicButton(); setMusicStatus("musicPlaying"); }).catch(() => { updateMusicButton(); setMusicStatus("musicBlocked"); });
  } catch { updateMusicButton(); setMusicStatus("musicBlocked"); }
}
function toggleMusic() {
  if (!state.musicUrl) return;
  if (!el.music.paused && !el.music.ended) { el.music.pause(); updateMusicButton(); setMusicStatus(""); return; }
  playMusic();
}

/* ---------- Confetti ---------- */

const confetti = (() => {
  const canvas = el.confetti;
  const context = canvas.getContext("2d");
  const colours = ["#9cc3e2", "#bcd6ec", "#6f9fc8", "#f3b8c6", "#f7d2db", "#e38ea4", "#fff6ea", "#d9b77c"];
  let pieces = [];
  let frame = 0;
  let last = 0;
  function size() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(innerWidth * ratio);
    canvas.height = Math.round(innerHeight * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  function step(now) {
    const dt = Math.min(48, now - (last || now)) / 16.7;
    last = now;
    context.clearRect(0, 0, innerWidth, innerHeight);
    pieces = pieces.filter((p) => p.y < innerHeight + 40 && p.life > 0);
    for (const p of pieces) {
      p.vx *= Math.pow(.985, dt); p.vy = p.vy * Math.pow(.985, dt) + .09 * dt;
      p.x += (p.vx + Math.sin((p.y + p.seed) / 28) * .5) * dt; p.y += p.vy * dt;
      p.spin += p.vs * dt; p.life -= dt;
      context.save();
      context.globalAlpha = Math.min(1, p.life / 40);
      context.translate(p.x, p.y);
      context.rotate(p.spin);
      context.fillStyle = p.colour;
      if (p.shape === 0) context.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.spin * 1.7)) + 1);
      else if (p.shape === 1) { context.beginPath(); context.arc(0, 0, p.w / 2.4, 0, Math.PI * 2); context.fill(); }
      else { context.beginPath(); context.moveTo(0, -p.w / 2); context.lineTo(p.w / 2, p.w / 2); context.lineTo(-p.w / 2, p.w / 2); context.closePath(); context.fill(); }
      context.restore();
    }
    frame = pieces.length ? requestAnimationFrame(step) : 0;
    if (!frame) { context.clearRect(0, 0, innerWidth, innerHeight); canvas.classList.remove("is-live"); }
  }
  return {
    burst(x, y, count = 170) {
      if (reducedMotion()) return;
      size();
      canvas.classList.add("is-live");
      for (let i = 0; i < count; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 4 + Math.random() * 11;
        pieces.push({
          x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 4, spin: Math.random() * 6, vs: (Math.random() - .5) * .3,
          w: 6 + Math.random() * 7, h: 9 + Math.random() * 8, shape: i % 7 === 0 ? 2 : i % 3 === 0 ? 1 : 0,
          colour: colours[i % colours.length], seed: Math.random() * 400, life: 150 + Math.random() * 90,
        });
      }
      if (!frame) { last = 0; frame = requestAnimationFrame(step); }
    },
    stop() { cancelAnimationFrame(frame); frame = 0; pieces = []; context.clearRect(0, 0, canvas.width, canvas.height); },
  };
})();

/* ---------- Opening: hold the balloon ---------- */

const hold = { active: false, start: 0, charge: 0, frame: 0, pointerId: null };

function setCharge(value) {
  hold.charge = Math.max(0, Math.min(1, value));
  el.cover.style.setProperty("--charge", hold.charge.toFixed(3));
}

function holdLoop(now) {
  if (hold.active) {
    setCharge((now - hold.start) / HOLD_MS);
    if (hold.charge >= 1) { hold.active = false; pop(); return; }
  } else {
    setCharge(hold.charge - .045);
    if (hold.charge <= 0) { hold.frame = 0; el.cover.classList.remove("is-holding"); return; }
  }
  hold.frame = requestAnimationFrame(holdLoop);
}

function beginHold(event) {
  if (!state.event || state.opening || state.openingFinished || el.open.disabled) return;
  if (event?.pointerId !== undefined) {
    hold.pointerId = event.pointerId;
    try { el.open.setPointerCapture(event.pointerId); } catch { /* Capture is a nicety. */ }
  }
  primeMusic();
  hold.active = true;
  hold.start = performance.now() - hold.charge * HOLD_MS;
  el.cover.classList.add("is-holding");
  el.popHint.querySelector("[data-copy]").textContent = t("popHolding");
  navigator.vibrate?.(8);
  if (!hold.frame) hold.frame = requestAnimationFrame(holdLoop);
}

function endHold() {
  if (!hold.active) return;
  hold.active = false;
  hold.pointerId = null;
  el.popHint.querySelector("[data-copy]").textContent = t("popHint");
  if (!hold.frame) hold.frame = requestAnimationFrame(holdLoop);
}

function balloonCentre() {
  const box = el.open.getBoundingClientRect();
  return [box.left + box.width / 2, box.top + box.height / 2];
}

function pop() {
  if (state.opening || state.openingFinished || !state.event) return;
  state.opening = true;
  cancelAnimationFrame(hold.frame);
  hold.frame = 0;
  el.open.disabled = true;
  el.tapOpen.disabled = true;
  navigator.vibrate?.([18, 40, 28]);
  const [x, y] = balloonCentre();
  el.cover.style.setProperty("--pop-x", `${x}px`);
  el.cover.style.setProperty("--pop-y", `${y}px`);
  el.cover.classList.remove("is-holding");
  el.cover.classList.add("is-popped");
  playMusic();
  if (reducedMotion() || slowConnection()) { confetti.burst(x, y); finishOpening(reducedMotion() ? "reducedMotion" : "fallbackStatic"); return; }
  // The film's own balloon bursts about 0.6 s in; the paper confetti joins it then.
  el.cover.classList.add("is-film-pop");
  window.setTimeout(() => confetti.burst(x, y, 130), 620);
  startFilm();
}

function slowConnection() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  return Boolean(connection?.saveData || ["slow-2g", "2g"].includes(connection?.effectiveType));
}

function startFilm() {
  const video = el.openingVideo;
  document.body.classList.add("pn-film-active");
  el.openingTools.hidden = false;
  el.retry.hidden = true;
  video.defaultMuted = true;
  video.muted = true;
  video.playsInline = true;
  video.src = OPENING_FILM;
  video.load();
  state.intro = createIntroSequence({
    video, startupTimeout: 9000, bufferTimeout: 14000, finishAt: OPENING_FILM_FINISH_AT,
    onState(phase) {
      if (phase === "loading" || phase === "buffering") { el.retry.hidden = true; setOpeningStatus("videoLoading"); }
      else if (phase === "playing") { state.pendingFallbackKey = ""; el.retry.hidden = true; setOpeningStatus(""); }
      else if (phase === "retry") { setOpeningStatus("videoSlow"); state.pendingFallbackKey = "videoSlow"; el.retry.hidden = false; }
      else if (phase === "blocked" || phase === "error") { setOpeningStatus(phase === "blocked" ? "videoBlocked" : "videoFailed"); state.pendingFallbackKey = "fallbackStatic"; el.retry.hidden = false; }
    },
    onFrame() { state.pendingFallbackKey = ""; el.retry.hidden = true; setOpeningStatus(""); el.cover.classList.add("is-filming"); },
    onComplete(reason) { finishOpening(["ended", "motion-complete", "skip"].includes(reason) ? "" : "fallbackStatic"); },
  });
  state.intro.start();
  playFilm();
}

function playFilm() {
  try {
    const attempt = el.openingVideo.play();
    attempt?.catch?.(() => state.intro?.playbackRejected());
  } catch { state.intro?.playbackRejected(); }
}

function retryFilm() {
  if (state.openingFinished || !state.intro) return;
  if (!state.intro.retry()) return;
  el.openingVideo.muted = true;
  try { el.openingVideo.currentTime = 0; } catch { /* Metadata may still be loading. */ }
  el.retry.hidden = true;
  setOpeningStatus("videoLoading");
  playFilm();
}

function finishOpening(noticeKey = "") {
  if (state.openingFinished) return;
  state.openingFinished = true;
  state.opening = false;
  state.intro?.dispose();
  state.intro = null;
  el.invitation.hidden = false;
  el.invitation.inert = false;
  el.retry.hidden = true;
  el.openingTools.hidden = true;
  if (state.musicUrl) el.musicToggle.hidden = false;
  if (noticeKey) { state.mediaNoticeKey = noticeKey; el.mediaNotice.hidden = false; el.mediaNotice.textContent = t(noticeKey); }
  window.scrollTo(0, 0);
  requestAnimationFrame(() => {
    document.body.classList.add("pn-revealed");
    el.cover.classList.add("is-leaving");
    el.invitation.classList.add("is-visible");
  });
  window.clearTimeout(state.revealTimer);
  state.revealTimer = window.setTimeout(() => {
    el.cover.hidden = true;
    document.body.classList.remove("pn-cover-active", "pn-film-active");
    el.openingVideo.pause();
    el.openingVideo.removeAttribute("src");
    el.openingVideo.load();
    $("eventTitle")?.focus?.({ preventScroll: true });
  }, reducedMotion() ? 0 : 1300);
  startCountdown();
  setupScenery();
}

/* ---------- Details motion ---------- */

function setupScenery() {
  const revealables = document.querySelectorAll(".pn-ticket, .pn-heading, .pn-tile, .pn-form > *, .pn-teams, .pn-closing > *");
  revealables.forEach((node, index) => { node.classList.add("pn-rise"); node.style.setProperty("--rise-delay", `${(index % 4) * 70}ms`); });
  if (!("IntersectionObserver" in window) || reducedMotion()) { revealables.forEach((node) => node.classList.add("is-in")); return; }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add("is-in"); observer.unobserve(entry.target); }
  }, { rootMargin: "0px 0px -8% 0px", threshold: .12 });
  revealables.forEach((node) => observer.observe(node));
  signal.addEventListener("abort", () => observer.disconnect());

  const tiles = [...document.querySelectorAll("[data-drift]")];
  let ticking = false;
  const drift = () => {
    ticking = false;
    const middle = innerHeight / 2;
    for (const tile of tiles) {
      const box = tile.getBoundingClientRect();
      if (box.bottom < -200 || box.top > innerHeight + 200) continue;
      const offset = (box.top + box.height / 2 - middle) * Number(tile.dataset.drift);
      tile.style.setProperty("--drift", `${offset.toFixed(1)}px`);
    }
  };
  window.addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(drift); } }, { passive: true, signal });
  drift();
}

/* ---------- RSVP and prediction ---------- */

function validateForm() {
  const values = Object.fromEntries(new FormData(el.form).entries());
  const errors = genderRevealLocalValidation(values);
  for (const key of ["prediction", "fullName", "attendance", "message"]) setFieldError(key, errors[key] || "");
  if (Object.keys(errors).length) {
    setFormStatus("validationSummary", true);
    const first = ["prediction", "fullName", "attendance", "message"].find((key) => errors[key]);
    (first === "attendance" || first === "prediction" ? el.form.querySelector(`[name="${first}"]`) : $(first))?.focus();
    return null;
  }
  setFormStatus("");
  return values;
}

async function submitter() {
  if (state.submit) return state.submit;
  if (sampleMode) {
    state.submit = async (values) => {
      await new Promise((resolve) => setTimeout(resolve, 650));
      if (values.prediction === "boy") SAMPLE_TOTALS.boyCount += 1; else SAMPLE_TOTALS.girlCount += 1;
      return { ok: true };
    };
    return state.submit;
  }
  const api = await loadFirebase();
  const { createGenderRevealSubmissionService } = await import("../../../gender-reveal-submission.js");
  const firebase = api.initGenderRevealSubmissionFirebase();
  state.submit = createGenderRevealSubmissionService({
    api: { doc: api.doc, getDocFromServer: api.getDocFromServer, increment: api.increment, runTransaction: api.runTransaction, serverTimestamp: api.serverTimestamp },
    db: firebase.db,
    weddingId,
    ensureAnonymousUser: async () => {
      await firebase.persistenceReady;
      if (!firebase.auth.currentUser) await api.signInAnonymously(firebase.auth);
      return firebase.auth.currentUser?.uid || "";
    },
  });
  return state.submit;
}

async function readTotals() {
  if (sampleMode) return { ...SAMPLE_TOTALS };
  const { doc, getDoc, initPublicFirebase } = await loadFirebase();
  const { db } = initPublicFirebase();
  const aggregate = await getDoc(doc(db, "weddings", weddingId, "genderRevealResults", "aggregate"));
  if (!aggregate.exists()) throw new Error("Totals not found.");
  return aggregate.data();
}

function countUp(node, to, suffix = "") {
  if (reducedMotion()) { node.textContent = `${to}${suffix}`; return; }
  const start = performance.now();
  const run = (now) => {
    const progress = Math.min(1, (now - start) / 1400);
    node.textContent = `${Math.round(to * (1 - Math.pow(1 - progress, 3)))}${suffix}`;
    if (progress < 1) requestAnimationFrame(run);
  };
  requestAnimationFrame(run);
}

async function showResults(prediction) {
  state.responseSaved = true;
  el.thankYou.hidden = false;
  el.thankYou.dataset.team = prediction || "";
  el.results.hidden = true;
  el.resultsStatus.hidden = true;
  state.resultsStatusKey = "";
  el.thankYou.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  el.thankYou.focus({ preventScroll: true });
  const box = el.thankYou.getBoundingClientRect();
  confetti.burst(innerWidth / 2, Math.max(80, Math.min(innerHeight * .4, box.top + 60)), 120);
  try {
    const summary = genderRevealResultSummary(await readTotals());
    state.resultsTotal = summary.totalCount;
    $("boyResult").textContent = String(summary.boyCount);
    $("girlResult").textContent = String(summary.girlCount);
    $("boyBar").setAttribute("aria-valuenow", String(summary.boyPercent));
    $("girlBar").setAttribute("aria-valuenow", String(summary.girlPercent));
    $("resultTotal").textContent = t("totalPredictions")(summary.totalCount);
    el.results.hidden = false;
    el.results.classList.remove("is-filled");
    $("boyFill").style.setProperty("--level", `${summary.boyPercent}%`);
    $("girlFill").style.setProperty("--level", `${summary.girlPercent}%`);
    el.results.dataset.leader = summary.boyCount === summary.girlCount ? "tie" : summary.boyCount > summary.girlCount ? "boy" : "girl";
    requestAnimationFrame(() => requestAnimationFrame(() => el.results.classList.add("is-filled")));
    countUp($("boyPercent"), summary.boyPercent, "%");
    countUp($("girlPercent"), summary.girlPercent, "%");
  } catch {
    el.resultsStatus.hidden = false;
    state.resultsStatusKey = "resultsError";
    el.resultsStatus.textContent = t("resultsError");
  }
  render();
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!state.event || state.event.eventStatus !== "active" || el.submit.disabled) return;
  const values = validateForm();
  if (!values) return;
  el.submit.disabled = true;
  state.submitting = true;
  el.submit.querySelector("[data-copy]").textContent = t("saving");
  setFormStatus("");
  try {
    await (await submitter())(values);
    el.formSection.hidden = true;
    await showResults(values.prediction);
  } catch (error) {
    setFormStatus(genderRevealSubmissionErrorKey(error), true);
  } finally {
    state.submitting = false;
    el.submit.disabled = false;
    el.submit.querySelector("[data-copy]").textContent = t("submit");
  }
}

function clearFieldError(event) {
  const name = event.target?.name;
  if (["fullName", "attendance", "prediction", "message"].includes(name)) setFieldError(name, "");
  if (state.formStatusKey) setFormStatus("");
  if (name === "prediction") el.form.dataset.team = event.target.value;
}

/* ---------- Wiring ---------- */

function cleanup() {
  controller.abort();
  state.unsubscribe?.();
  window.clearTimeout(state.revealTimer);
  window.clearInterval(state.countdownTimer);
  cancelAnimationFrame(hold.frame);
  state.intro?.dispose();
  confetti.stop();
  el.openingVideo.pause();
  el.music.pause();
}

document.querySelectorAll("[data-language]").forEach((button) => button.addEventListener("click", () => {
  state.language = button.dataset.language === "ar" ? "ar" : "en";
  saveLanguage(state.language);
  render();
}, { signal }));

el.open.addEventListener("pointerdown", (event) => { if (event.button === 0 || event.pointerType !== "mouse") { event.preventDefault(); beginHold(event); } }, { signal });
for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) el.open.addEventListener(type, endHold, { signal });
el.open.addEventListener("contextmenu", (event) => event.preventDefault(), { signal });
el.open.addEventListener("keydown", (event) => { if ((event.key === " " || event.key === "Enter") && !event.repeat) { event.preventDefault(); beginHold(event); } }, { signal });
el.open.addEventListener("keyup", (event) => { if (event.key === " " || event.key === "Enter") endHold(); }, { signal });
// Screen readers activate with a synthetic click (detail 0); open straight away.
el.open.addEventListener("click", (event) => { if (event.detail === 0 && !hold.active) { primeMusic(); pop(); } }, { signal });
el.tapOpen.addEventListener("click", () => { primeMusic(); pop(); }, { signal });
el.skip.addEventListener("click", () => (state.intro ? state.intro.skip() : finishOpening()), { signal });
el.retry.addEventListener("click", retryFilm, { signal });
el.musicToggle.addEventListener("click", toggleMusic, { signal });
el.music.addEventListener("play", () => { updateMusicButton(); if (!el.music.muted) setMusicStatus("musicPlaying"); }, { signal });
el.music.addEventListener("pause", updateMusicButton, { signal });
el.music.addEventListener("error", () => { if (!el.music.getAttribute("src")) return; updateMusicButton(); setMusicStatus("musicUnavailable"); }, { signal });
el.form.addEventListener("input", clearFieldError, { signal });
el.form.addEventListener("change", clearFieldError, { signal });
el.form.addEventListener("submit", handleSubmit, { signal });
window.addEventListener("pagehide", cleanup, { once: true });

render();
loadEvent().catch(() => {
  el.open.disabled = true;
  el.tapOpen.disabled = true;
  setPageStatus("loadError", true);
  el.app.setAttribute("aria-busy", "false");
});
