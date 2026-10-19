import {
  doc, getDoc, initGenderRevealSubmissionFirebase, initPublicFirebase, onSnapshot, runTransaction,
  serverTimestamp, signInAnonymously,
} from "./firebase-config.js";
import { createGenderRevealSubmissionService } from "./gender-reveal-submission.js";
import { GENDER_REVEAL_COUNTRIES, normalizeInternationalPhone } from "./gender-reveal-phone.js";
import { createIntroSequence } from "./intro-sequence.js";
import {
  genderRevealLocalValidation, genderRevealResultSummary, genderRevealSubmissionErrorKey,
  safeGenderRevealMediaUrl,
} from "./gender-reveal-experience.js";

const params = new URLSearchParams(location.search);
const weddingId = (params.get("wedding") || "").trim();
const languageStorageKey = `gender-reveal-language:${weddingId || "invitation"}`;
const copy = {
  en: {
    language: "Invitation language", loading: "Loading invitation…", loadError: "This invitation could not be loaded. Check the link or try again.",
    coverEyebrow: "A little celebration is on the way", coverQuestion: "Boy or Girl?", defaultMessage: "A little surprise is on the way…", openInvitation: "Open invitation",
    youAreInvited: "You are invited", kindlyReply: "Kindly reply", formTitle: "Share your RSVP and prediction", formIntro: "We would love to hear from you.",
    fullName: "Full name", phone: "International phone number", country: "Country calling code", attendance: "Will you attend?", attending: "Attending", notAttending: "Not attending",
    prediction: "What is your prediction?", boy: "Boy", girl: "Girl", message: "Message to the parents", optional: "Optional", messageHint: "Up to 1,000 characters.", submit: "Submit response", saving: "Saving your response…",
    saved: "Response saved", thankYou: "Thank you for sharing your prediction!", thankYouBody: "Your kind wishes mean so much.", resultsTitle: "The predictions so far", totalPredictions: (total) => `${total} ${total === 1 ? "prediction" : "predictions"}`,
    skip: "Skip", videoLoading: "Opening your invitation…", videoSlow: "The animation is taking a while, so here is your invitation.", videoFailed: "The animation is unavailable. Here is your invitation.", reducedMotion: "Your invitation is ready.",
    musicMute: "Mute music", musicUnmute: "Unmute music", musicBlocked: "Music could not start. Tap the sound button to try again.", musicPlaying: "Event music is playing.", musicUnavailable: "Event music is unavailable.",
    closed: "Responses are not open for this event.", validationSummary: "Please correct the highlighted fields.", nameRequired: "Enter your full name.", nameTooLong: "Your name must be 120 characters or fewer.", phoneInvalid: "Enter a valid international phone number.", attendanceRequired: "Choose whether you will attend.", predictionRequired: "Choose boy or girl.", messageTooLong: "Your message must be 1,000 characters or fewer.",
    closedError: "Responses are not open for this event. Your draft is still here.", permissionOrDuplicateError: "We could not accept this response. This number may have been used already, or access was denied. Your form is still here; no existing response was changed.", quotaError: "The response service is temporarily at capacity. Your form is still here; please try again later.", networkError: "A network problem prevented saving. Your form is still here; check your connection and try again.", saveError: "We could not save your response. Your form is still here; please try again.",
    resultsError: "Your response was saved, but the prediction totals could not be loaded right now.", boyBar: "Boy predictions", girlBar: "Girl predictions", madeWith: "Made with care by", fallbackStatic: "The opening animation was skipped. Your invitation is ready.",
  },
  ar: {
    language: "لغة الدعوة", loading: "جارٍ تحميل الدعوة…", loadError: "تعذّر تحميل هذه الدعوة. تحقق من الرابط أو حاول مرة أخرى.",
    coverEyebrow: "احتفال صغير يقترب", coverQuestion: "ولد أم بنت؟", defaultMessage: "مفاجأة جميلة بانتظارنا…", openInvitation: "افتح الدعوة",
    youAreInvited: "أنتم مدعوون", kindlyReply: "يرجى الرد", formTitle: "شاركنا ردك وتوقعك", formIntro: "يسعدنا أن نسمع منك.",
    fullName: "الاسم الكامل", phone: "رقم الهاتف الدولي", country: "رمز الاتصال الدولي", attendance: "هل ستحضر؟", attending: "سأحضر", notAttending: "لن أحضر",
    prediction: "ما توقعك؟", boy: "ولد", girl: "بنت", message: "رسالة إلى الوالدين", optional: "اختياري", messageHint: "حتى ١٬٠٠٠ حرف.", submit: "إرسال الرد", saving: "جارٍ حفظ ردك…",
    saved: "تم حفظ الرد", thankYou: "شكرًا لمشاركتنا توقعك!", thankYouBody: "تمنياتك الجميلة تعني لنا الكثير.", resultsTitle: "التوقعات حتى الآن", totalPredictions: (total) => `${new Intl.NumberFormat("ar").format(total)} ${total === 1 ? "توقع" : "توقعات"}`,
    skip: "تخطي", videoLoading: "جارٍ فتح الدعوة…", videoSlow: "استغرق عرض الحركة وقتًا أطول، وهذه دعوتك.", videoFailed: "الحركة غير متاحة، وهذه دعوتك.", reducedMotion: "دعوتك جاهزة.",
    musicMute: "كتم الموسيقى", musicUnmute: "تشغيل الصوت", musicBlocked: "تعذّر تشغيل الموسيقى. اضغط على زر الصوت للمحاولة مجددًا.", musicPlaying: "موسيقى الحفل تعمل.", musicUnavailable: "موسيقى الحفل غير متاحة.",
    closed: "الردود غير متاحة لهذه المناسبة.", validationSummary: "يرجى تصحيح الحقول المحددة.", nameRequired: "أدخل اسمك الكامل.", nameTooLong: "يجب ألا يتجاوز الاسم ١٢٠ حرفًا.", phoneInvalid: "أدخل رقم هاتف دوليًا صحيحًا.", attendanceRequired: "اختر ما إذا كنت ستحضر.", predictionRequired: "اختر ولد أو بنت.", messageTooLong: "يجب ألا تتجاوز الرسالة ١٬٠٠٠ حرف.",
    closedError: "الردود غير متاحة لهذه المناسبة. ما زالت بياناتك هنا.", permissionOrDuplicateError: "تعذّر قبول هذا الرد. ربما استُخدم هذا الرقم من قبل أو لا تتوفر صلاحية الإرسال. ما زالت بياناتك هنا ولم يتغير أي رد سابق.", quotaError: "خدمة الردود مشغولة مؤقتًا. ما زالت بياناتك هنا؛ حاول لاحقًا.", networkError: "منع خلل في الاتصال حفظ ردك. ما زالت بياناتك هنا؛ تحقق من الاتصال وحاول مجددًا.", saveError: "تعذّر حفظ ردك. ما زالت بياناتك هنا؛ حاول مجددًا.",
    resultsError: "تم حفظ ردك، لكن تعذّر تحميل إجمالي التوقعات الآن.", boyBar: "توقعات ولد", girlBar: "توقعات بنت", madeWith: "صُنعت بعناية بواسطة", fallbackStatic: "تم تخطي الحركة الافتتاحية. دعوتك جاهزة.",
  },
};

const $ = (id) => document.getElementById(id);
const elements = {
  app: $("genderRevealApp"), pageStatus: $("pageStatus"), cover: $("cover"), coverArtwork: $("coverArtwork"), coverMessage: $("coverMessage"), coverEventTitle: $("coverEventTitle"), open: $("openInvitation"),
  openingStage: $("openingStage"), openingVideo: $("openingVideo"), openingPoster: $("openingPoster"), openingStatus: $("openingStatus"), skip: $("skipOpening"), invitation: $("invitationContent"),
  eventTitle: $("eventTitle"), eventDate: $("eventDate"), eventMessage: $("eventMessage"), closedNotice: $("closedNotice"), formSection: $("responseFormSection"), form: $("responseForm"), formStatus: $("formStatus"), submit: $("submitResponse"),
  country: $("countryCallingCode"), fullName: $("fullName"), phone: $("phone"), message: $("message"), thankYou: $("thankYou"), results: $("results"), resultsStatus: $("resultsStatus"),
  music: $("eventMusic"), musicControls: $("musicControls"), musicToggle: $("musicToggle"), musicStatus: $("musicStatus"),
};
const eventErrorMessage = "This invitation could not be loaded. Check the link or try again.";
const controller = new AbortController();
const { signal } = controller;
let eventData = null;
let activeLanguage = readLanguage();
let submissionService = null;
let introSequence = null;
let responseSaved = false;
let openingFinished = false;
let musicUrl = "";
let openingUrl = "";
let artworkUrl = "";
let formStatusKey = "";
let formStatusIsError = false;
let pageStatusKey = "";
const fieldErrorKeys = {};
let openingMessageKey = "";
let pendingFallbackKey = "";
let musicStatusKey = "";
let resultsStatusKey = "";
let resultsTotal = 0;
let revealTimer = 0;
let isSubmitting = false;
let unsubscribeEvent = null;

function readLanguage() {
  try { return sessionStorage.getItem(languageStorageKey) === "ar" ? "ar" : "en"; }
  catch { return "en"; }
}

function saveLanguage(language) {
  try { sessionStorage.setItem(languageStorageKey, language); }
  catch { /* Session storage can be disabled; language still works in memory. */ }
}

function localizedEventTitle() {
  return activeLanguage === "ar"
    ? (eventData?.eventTitleAr || "حفل الكشف عن جنس المولود")
    : (eventData?.eventTitle || "Gender Reveal Party");
}

function localizedEventMessage() {
  if (!eventData) return copy[activeLanguage].defaultMessage;
  return activeLanguage === "ar"
    ? (eventData.genderRevealMessageAr || eventData.subtitleAr || copy.ar.defaultMessage)
    : (eventData.genderRevealMessageEn || eventData.subtitleEn || copy.en.defaultMessage);
}

function localizedDate(event) {
  const date = new Date(event.eventDateISO);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(activeLanguage === "ar" ? "ar-AE" : "en-AE", {
      dateStyle: "full", timeStyle: "short", timeZone: event.eventTimeZone || "Asia/Dubai",
    }).format(date);
  } catch {
    return "";
  }
}

function localizeCountries() {
  const selected = elements.country.value || "971";
  let displayNames;
  try { displayNames = new Intl.DisplayNames([activeLanguage === "ar" ? "ar" : "en"], { type: "region" }); }
  catch { displayNames = null; }
  const fragment = document.createDocumentFragment();
  for (const [region, englishName, callingCode] of GENDER_REVEAL_COUNTRIES) {
    const option = document.createElement("option");
    const countryName = activeLanguage === "ar" ? (displayNames?.of(region) || englishName) : englishName;
    option.value = callingCode;
    option.textContent = `${countryName} (+${callingCode})`;
    option.dataset.region = region;
    option.selected = region === "AE" && !elements.country.dataset.touched;
    fragment.append(option);
  }
  elements.country.replaceChildren(fragment);
  const sameCode = [...elements.country.options].find((option) => option.value === selected);
  if (sameCode) sameCode.selected = true;
}

function renderLanguage() {
  const strings = copy[activeLanguage];
  const arabic = activeLanguage === "ar";
  document.documentElement.lang = activeLanguage;
  document.documentElement.dir = arabic ? "rtl" : "ltr";
  document.body.classList.toggle("is-arabic", arabic);
  document.querySelectorAll("[data-copy]").forEach((node) => {
    const value = strings[node.dataset.copy];
    if (typeof value === "string") node.textContent = value;
  });
  document.querySelectorAll("[data-language]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.language === activeLanguage));
  });
  document.querySelector(".gr-language")?.setAttribute("aria-label", strings.language);
  document.title = localizedEventTitle();
  if (eventData) {
    elements.coverEventTitle.textContent = localizedEventTitle();
    elements.coverMessage.textContent = localizedEventMessage();
    elements.eventTitle.textContent = localizedEventTitle();
    elements.eventDate.textContent = localizedDate(eventData);
    elements.eventMessage.textContent = localizedEventMessage();
    if (eventData.eventStatus !== "active") elements.closedNotice.textContent = strings.closed;
  }
  localizeCountries();
  for (const [fieldName, errorKey] of Object.entries(fieldErrorKeys)) {
    if (errorKey) $(`${fieldName}Error`).textContent = strings[errorKey] || "";
  }
  if (pageStatusKey) elements.pageStatus.textContent = strings[pageStatusKey] || "";
  if (formStatusKey) setFormStatus(formStatusKey, formStatusIsError);
  if (openingMessageKey) elements.openingStatus.textContent = strings[openingMessageKey] || "";
  if (pendingFallbackKey && !elements.mediaNotice.hidden) $("mediaNotice").textContent = strings[pendingFallbackKey] || "";
  if (musicStatusKey) elements.musicStatus.textContent = strings[musicStatusKey] || "";
  if (resultsStatusKey) elements.resultsStatus.textContent = strings[resultsStatusKey] || "";
  if (isSubmitting) elements.submit.querySelector("[data-copy]").textContent = strings.saving;
  if (responseSaved && resultsTotal >= 0) {
    const resultTotal = $("resultTotal");
    if (resultTotal) resultTotal.textContent = typeof strings.totalPredictions === "function" ? strings.totalPredictions(resultsTotal) : "";
  }
  $("boyBar")?.setAttribute("aria-label", strings.boyBar);
  $("girlBar")?.setAttribute("aria-label", strings.girlBar);
  elements.musicToggle.setAttribute("aria-label", elements.music.muted ? strings.musicUnmute : strings.musicMute);
  elements.app.setAttribute("aria-busy", String(!eventData));
}

function setPageStatus(key = "", isError = false) {
  pageStatusKey = key;
  elements.pageStatus.textContent = key ? copy[activeLanguage][key] : "";
  elements.pageStatus.classList.toggle("is-error", isError);
  elements.pageStatus.hidden = !key;
}

function setOpeningStatus(key) {
  openingMessageKey = key;
  elements.openingStatus.textContent = key ? copy[activeLanguage][key] : "";
}

function setFormStatus(key, isError = false) {
  formStatusKey = key;
  formStatusIsError = isError;
  elements.formStatus.textContent = key ? copy[activeLanguage][key] : "";
  elements.formStatus.classList.toggle("is-error", isError);
}

function setFieldError(fieldName, key) {
  fieldErrorKeys[fieldName] = key || "";
  const errorNode = $(`${fieldName}Error`);
  const field = fieldName === "attendance" || fieldName === "prediction"
    ? elements.form.querySelector(`[name="${fieldName}"]`)
    : $(fieldName);
  if (errorNode) errorNode.textContent = key ? copy[activeLanguage][key] : "";
  field?.setAttribute("aria-invalid", String(Boolean(key)));
  if (!key) field?.removeAttribute("aria-invalid");
}

function safeAssetPath(field) {
  return safeGenderRevealMediaUrl(eventData?.[field] || "");
}

async function loadEvent() {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(weddingId)) throw new Error(eventErrorMessage);
  const { db } = initPublicFirebase();
  await new Promise((resolve, reject) => {
    let initialSnapshot = true;
    unsubscribeEvent = onSnapshot(doc(db, "weddings", weddingId, "publicEvent", "details"), (snapshot) => {
      const isInitialSnapshot = initialSnapshot;
      initialSnapshot = false;
      if (!snapshot.exists() || snapshot.data().eventCategory !== "gender_reveal") {
        if (isInitialSnapshot) reject(new Error(eventErrorMessage));
        else {
          eventData = null;
          elements.open.disabled = true;
          setPageStatus("loadError", true);
          elements.app.setAttribute("aria-busy", "false");
        }
        return;
      }
      eventData = snapshot.data();
      artworkUrl = safeAssetPath("genderRevealArtworkUrl") || new URL("./images/gender-reveal-cover.png", location.href).href;
      openingUrl = safeAssetPath("genderRevealOpeningVideoUrl");
      musicUrl = safeAssetPath("genderRevealMusicUrl");
      elements.coverArtwork.src = artworkUrl;
      elements.openingPoster.src = artworkUrl;
      elements.open.disabled = openingFinished;
      elements.formSection.hidden = responseSaved || eventData.eventStatus !== "active";
      elements.closedNotice.hidden = eventData.eventStatus === "active";
      elements.musicToggle.hidden = !musicUrl;
      elements.musicControls.hidden = !musicUrl;
      renderLanguage();
      setPageStatus("");
      elements.app.setAttribute("aria-busy", "false");
      if (isInitialSnapshot) resolve();
    }, (error) => {
      if (initialSnapshot) reject(error);
      else setPageStatus("loadError", true);
    });
  });
}

function shouldUseStaticOpening() {
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const slowConnection = connection?.saveData || ["slow-2g", "2g"].includes(connection?.effectiveType);
  return reducedMotion || slowConnection;
}

function startMusicFromGesture() {
  if (!musicUrl) return;
  elements.music.src = musicUrl;
  elements.music.load();
  elements.musicControls.hidden = false;
  elements.musicToggle.hidden = false;
  elements.music.muted = false;
  try {
    const play = elements.music.play();
    if (play && typeof play.then === "function") {
      void play.then(() => {
        elements.musicToggle.setAttribute("aria-pressed", "false");
        elements.musicToggle.setAttribute("aria-label", copy[activeLanguage].musicMute);
        musicStatusKey = "musicPlaying";
        elements.musicStatus.textContent = copy[activeLanguage].musicPlaying;
      }).catch(() => {
        musicStatusKey = "musicBlocked";
        elements.musicStatus.textContent = copy[activeLanguage].musicBlocked;
      });
    }
  } catch {
    musicStatusKey = "musicBlocked";
    elements.musicStatus.textContent = copy[activeLanguage].musicBlocked;
  }
}

function stopAndReleaseVideo() {
  elements.openingVideo.pause();
  elements.openingVideo.removeAttribute("src");
  elements.openingVideo.load();
}

function finishOpening(why = "") {
  if (openingFinished) return;
  openingFinished = true;
  introSequence?.dispose();
  introSequence = null;
  elements.invitation.hidden = false;
  elements.invitation.inert = false;
  if (why) elements.openingStage.classList.add("is-leaving");
  elements.openingStage.classList.add("is-leaving");
  elements.cover.classList.add("is-leaving");
  if (why) {
    openingMessageKey = why;
    $("mediaNotice").hidden = false;
    $("mediaNotice").textContent = copy[activeLanguage][why] || "";
  }
  requestAnimationFrame(() => elements.invitation.classList.add("is-visible"));
  const delay = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 520;
  window.clearTimeout(revealTimer);
  revealTimer = window.setTimeout(() => {
    elements.cover.hidden = true;
    elements.openingStage.hidden = true;
    elements.openingStage.classList.remove("is-leaving");
    stopAndReleaseVideo();
  }, delay);
}

function handleOpenInvitation() {
  if (!eventData || openingFinished || elements.open.disabled) return;
  elements.open.disabled = true;
  startMusicFromGesture();
  if (!openingUrl || shouldUseStaticOpening()) {
    finishOpening(!openingUrl ? "fallbackStatic" : "reducedMotion");
    return;
  }
  elements.openingStage.hidden = false;
  elements.openingVideo.poster = artworkUrl;
  elements.openingVideo.src = openingUrl;
  elements.openingVideo.load();
  introSequence = createIntroSequence({
    video: elements.openingVideo,
    startupTimeout: 2400,
    bufferTimeout: 1800,
    onState(phase) {
      if (["loading", "buffering"].includes(phase)) setOpeningStatus("videoLoading");
      else if (phase === "retry") {
        setOpeningStatus("videoSlow");
      pendingFallbackKey = "videoSlow";
      introSequence?.skip();
      } else if (phase === "error" || phase === "blocked") {
        setOpeningStatus("videoFailed");
        pendingFallbackKey = "videoFailed";
        introSequence?.skip();
      }
    },
    onFrame() { setOpeningStatus(""); },
    onComplete() { finishOpening(pendingFallbackKey); },
  });
  introSequence.start();
  try {
    const playback = elements.openingVideo.play();
    if (playback && typeof playback.catch === "function") playback.catch(() => introSequence?.playbackRejected());
  } catch {
    introSequence.playbackRejected();
  }
}

function toggleMusic() {
  if (!musicUrl) return;
  if (elements.music.paused) {
    elements.music.muted = false;
    try {
      void elements.music.play().then(() => {
        elements.musicToggle.setAttribute("aria-pressed", "false");
        musicStatusKey = "musicPlaying";
        elements.musicStatus.textContent = copy[activeLanguage].musicPlaying;
        renderLanguage();
      }).catch(() => {
        musicStatusKey = "musicBlocked";
        elements.musicStatus.textContent = copy[activeLanguage].musicBlocked;
      });
    } catch {
      musicStatusKey = "musicBlocked";
      elements.musicStatus.textContent = copy[activeLanguage].musicBlocked;
    }
    return;
  }
  elements.music.muted = !elements.music.muted;
  elements.musicToggle.setAttribute("aria-pressed", String(elements.music.muted));
  elements.musicToggle.setAttribute("aria-label", copy[activeLanguage][elements.music.muted ? "musicUnmute" : "musicMute"]);
  elements.musicStatus.textContent = elements.music.muted ? copy[activeLanguage].musicUnmute : copy[activeLanguage].musicPlaying;
  musicStatusKey = elements.music.muted ? "musicUnmute" : "musicPlaying";
}

function validateForm() {
  const values = Object.fromEntries(new FormData(elements.form).entries());
  const errors = genderRevealLocalValidation(values, normalizeInternationalPhone);
  for (const key of ["fullName", "phone", "attendance", "prediction", "message"]) setFieldError(key, errors[key] || "");
  if (Object.keys(errors).length) {
    setFormStatus("validationSummary", true);
    const first = Object.keys(errors)[0];
    (first === "attendance" || first === "prediction" ? elements.form.querySelector(`[name="${first}"]`) : $(first))?.focus();
    return null;
  }
  setFormStatus("");
  return values;
}

async function getSubmissionService() {
  if (submissionService) return submissionService;
  const firebase = initGenderRevealSubmissionFirebase();
  submissionService = createGenderRevealSubmissionService({
    api: { doc, runTransaction, serverTimestamp },
    db: firebase.db,
    weddingId,
    ensureAnonymousUser: async () => {
      if (!firebase.auth.currentUser) await signInAnonymously(firebase.auth);
    },
  });
  return submissionService;
}

async function showSubmittedResults() {
  responseSaved = true;
  elements.thankYou.hidden = false;
  elements.results.hidden = true;
  elements.resultsStatus.hidden = true;
  resultsStatusKey = "";
  try {
    const { db } = initPublicFirebase();
    const aggregate = await getDoc(doc(db, "weddings", weddingId, "genderRevealResults", "aggregate"));
    if (!aggregate.exists()) throw new Error("Aggregate results were not found.");
    const summary = genderRevealResultSummary(aggregate.data());
    resultsTotal = summary.totalCount;
    $("boyResult").textContent = String(summary.boyCount);
    $("girlResult").textContent = String(summary.girlCount);
    $("boyPercent").textContent = `${summary.boyPercent}%`;
    $("girlPercent").textContent = `${summary.girlPercent}%`;
    $("boyFill").style.width = `${summary.boyPercent}%`;
    $("girlFill").style.width = `${summary.girlPercent}%`;
    $("boyBar").setAttribute("aria-valuenow", String(summary.boyPercent));
    $("girlBar").setAttribute("aria-valuenow", String(summary.girlPercent));
    $("resultTotal").textContent = copy[activeLanguage].totalPredictions(summary.totalCount);
    elements.results.hidden = false;
    elements.results.querySelectorAll(".gr-results__row, .gr-results__bar, .gr-results__total").forEach((node) => { node.hidden = false; });
  } catch {
    elements.results.querySelectorAll(".gr-results__row, .gr-results__bar, .gr-results__total").forEach((node) => { node.hidden = true; });
    elements.resultsStatus.hidden = false;
    elements.resultsStatus.classList.add("is-error");
    resultsStatusKey = "resultsError";
    elements.resultsStatus.textContent = copy[activeLanguage].resultsError;
  }
  renderLanguage();
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!eventData || eventData.eventStatus !== "active" || elements.submit.disabled) return;
  const values = validateForm();
  if (!values) return;
  elements.submit.disabled = true;
  isSubmitting = true;
  elements.submit.querySelector("[data-copy]").textContent = copy[activeLanguage].saving;
  setFormStatus("");
  try {
    await (await getSubmissionService())(values);
    elements.formSection.hidden = true;
    await showSubmittedResults();
  } catch (error) {
    const messageKey = genderRevealSubmissionErrorKey(error);
    setFormStatus(messageKey, true);
  } finally {
    isSubmitting = false;
    elements.submit.disabled = false;
    elements.submit.querySelector("[data-copy]").textContent = copy[activeLanguage].submit;
  }
}

function clearFieldError(event) {
  const name = event.target?.name;
  if (["fullName", "phone", "attendance", "prediction", "message"].includes(name)) setFieldError(name, "");
  if (formStatusKey) setFormStatus("");
}

function cleanup() {
  controller.abort();
  unsubscribeEvent?.();
  unsubscribeEvent = null;
  window.clearTimeout(revealTimer);
  introSequence?.dispose();
  introSequence = null;
  elements.openingVideo.pause();
  elements.music.pause();
  elements.openingVideo.removeAttribute("src");
  elements.music.removeAttribute("src");
  elements.openingVideo.load();
  elements.music.load();
}

document.querySelectorAll("[data-language]").forEach((button) => button.addEventListener("click", () => {
  activeLanguage = button.dataset.language === "ar" ? "ar" : "en";
  saveLanguage(activeLanguage);
  renderLanguage();
}, { signal }));
elements.country.addEventListener("change", () => { elements.country.dataset.touched = "true"; }, { signal });
elements.form.addEventListener("input", clearFieldError, { signal });
elements.form.addEventListener("change", clearFieldError, { signal });
elements.form.addEventListener("submit", handleSubmit, { signal });
elements.open.addEventListener("click", handleOpenInvitation, { signal });
elements.skip.addEventListener("click", () => introSequence?.skip(), { signal });
elements.musicToggle.addEventListener("click", toggleMusic, { signal });
window.addEventListener("pagehide", cleanup, { once: true, signal });

renderLanguage();
loadEvent().catch(() => {
  elements.open.disabled = true;
  setPageStatus("loadError", true);
  elements.app.setAttribute("aria-busy", "false");
});
