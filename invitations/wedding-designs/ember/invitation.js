const root = "./invitations/wedding-designs/ember/assets/";
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
window.scrollTo({ top: 0, left: 0, behavior: "instant" });
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
globalThis.invitationDesignConfig = {
  languageStorageKey: "ember-language",
  // The candles are all lit and the glow has settled a little before the film ends.
  finishAt: 6.6,
  chairArtwork: `${root}chair.svg`,
  rtl: true,
  keylessMapPreview: true,
  detailLines: true,
  requireReady: true,
  prefillSavedRsvp: true,
  sampleSeatingPreview: true,
  detailsScrollTarget: "detailsSection",
  skipOpening: reducedMotion,
  scrollBehavior: () => reducedMotion() || document.body.classList.contains("keyboard-navigation") ? "instant" : "smooth",
  copy: {
    heroKicker: { en: "You're invited to celebrate", ar: "يسعدنا أن تحتفلوا معنا" },
    openInvitation: { en: "Or tap to open", ar: "أو اضغطوا للفتح" },
    introCaption: { en: "Strike the match to light the candles.", ar: "أشعلوا عود الثقاب لإضاءة الشموع." },
    videoLabel: { en: "The candles on the cake light one by one", ar: "شموع الكعكة تضيء واحدة تلو الأخرى" },
    detailsHeading: { en: "One more year, one long evening.", ar: "عامٌ جديد، وأمسية طويلة." },
    scheduleHeading: { en: "From the first toast to the last song.", ar: "من النخب الأول إلى آخر أغنية." },
    scheduleLabel: { en: "The evening", ar: "الأمسية" },
    seatingHeading: { en: "Your seat at the table.", ar: "مكانكم على الطاولة." },
    sampleSeating: { en: "A sample seating plan for the party.", ar: "نموذج لخطة الجلوس في الحفل." },
    introRetry: { en: "Still loading. Tap to retry.", ar: "ما زال التحميل جارياً. اضغطوا لإعادة المحاولة." },
    introBlocked: { en: "The film could not start. Tap to retry.", ar: "تعذّر بدء الفيلم. اضغطوا لإعادة المحاولة." },
    introError: { en: "The film is unavailable. Tap to retry.", ar: "الفيلم غير متاح. اضغطوا لإعادة المحاولة." },
    rsvpHeading: { en: "Will you raise a glass with us?", ar: "هل سترفعون الكأس معنا؟" },
    messageLabel: { en: "A birthday wish (optional)", ar: "أمنية عيد ميلاد (اختياري)" },
    attendanceDeclined: { en: "We'll save you a slice anyway.", ar: "سنحتفظ لكم بقطعة من الكعكة على أي حال." },
    attendanceDeclinedThanks: { en: "We're sorry you'll miss the party. Thank you for your wishes.", ar: "يؤسفنا أنكم لن تحضروا الحفل. شكراً لتمنياتكم." },
    closing: { en: "Come hungry, stay late.", ar: "تعالوا بشهية، وابقوا حتى آخر الليل." },
    passHeading: { en: "Your pass for the night.", ar: "بطاقة دخولكم لهذه الليلة." },
    viewDetails: { en: "Join us", ar: "شاركونا" },
    skip: { en: "Skip", ar: "تخطي" },
  },
  // Fictional preview only. Live contexts replace these fields in the shared runtime.
  demoWedding: {
    eventCategory: "celebration",
    eventTitle: "Layla's 30th Birthday",
    coupleName: "", brideName: "", groomName: "", brideNameAr: "", groomNameAr: "",
    subtitleEn: "Thirty candles, one long table, and everyone she loves.",
    subtitleAr: "ثلاثون شمعة، وطاولة طويلة، وكل من تحبّ.",
    invitationMessageEn: "Dinner, a cake worth the wait, and dancing until the candles burn low.",
    invitationMessageAr: "عشاء، وكعكة تستحق الانتظار، ورقص حتى تخفت الشموع.",
    closingEn: "Come hungry, stay late.",
    closingAr: "تعالوا بشهية، وابقوا حتى آخر الليل.",
    venueEn: "The Velvet Room", venueAr: "قاعة المخمل", locationEn: "DIFC, Dubai", locationAr: "مركز دبي المالي العالمي، دبي",
    eventDateISO: "2027-04-17T20:00:00+04:00", timeEn: "8:00 PM", timeAr: "٨:٠٠ مساءً",
    dressCodeEn: "Evening wear in deep tones and gold.", dressCodeAr: "ملابس سهرة بألوان داكنة وذهبية.",
    mapsUrl: "https://www.google.com/maps/search/?api=1&query=DIFC+Dubai", venueMapEmbedUrl: "https://www.google.com/maps?q=DIFC+Dubai&output=embed",
    schedule: [
      { time: "8:00 PM", timeAr: "٨:٠٠ مساءً", titleEn: "Welcome drinks", titleAr: "مشروبات الترحيب", descriptionEn: "Find your people, find a glass.", descriptionAr: "التقوا بالأحبة واختاروا مشروبكم." },
      { time: "9:00 PM", timeAr: "٩:٠٠ مساءً", titleEn: "Dinner at the long table", titleAr: "العشاء على الطاولة الطويلة", descriptionEn: "Four courses, many toasts.", descriptionAr: "أربعة أطباق، وأنخاب كثيرة." },
      { time: "10:30 PM", timeAr: "١٠:٣٠ مساءً", titleEn: "Candles & cake", titleAr: "الشموع والكعكة", descriptionEn: "Make a wish with her.", descriptionAr: "تمنّوا معها أمنية." },
      { time: "11:00 PM", timeAr: "١١:٠٠ مساءً", titleEn: "Dancing", titleAr: "الرقص", descriptionEn: "Until the last song.", descriptionAr: "حتى آخر أغنية." },
    ],
  },
};

await import("../../../script.js?v=20261113-pc-1");

// The shared runtime replaces the document with an accessible error for an
// incomplete link. Only enhance a successfully mounted invitation shell.
if (document.getElementById("introScreen") && document.getElementById("siteContent")) {
const body = document.body;
const intro = document.getElementById("introScreen");
const stage = document.getElementById("envelopeStage");
const box = document.getElementById("emBox");
const match = document.getElementById("emMatch");
const sparks = document.getElementById("emSparks");
const openButton = document.getElementById("openInvitation");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const saveData = navigator.connection?.saveData === true;

// Local review only: lets automated layout inspection start beyond the cover.
if (["127.0.0.1", "localhost"].includes(location.hostname) && new URLSearchParams(location.search).get("review") === "1") {
  document.getElementById("skipOpening").click();
}

/* ---------- Title: on the cover, and in Arabic when no Arabic title exists ---------- */
const english = document.getElementById("heroEnglishNames");
const arabic = document.getElementById("heroArabicNames");
const coverTitle = document.getElementById("emCoverTitle");
let syncing = false;
const syncTitle = () => {
  if (syncing) return;
  syncing = true;
  const title = english?.textContent.trim() || "";
  if (arabic && !arabic.textContent.trim() && title) arabic.textContent = title;
  const isArabic = body.classList.contains("layla-arabic");
  if (coverTitle) coverTitle.textContent = (isArabic ? arabic?.textContent.trim() : "") || title;
  updateAge(title);
  syncing = false;
};
const titleObserver = new MutationObserver(syncTitle);
[english, arabic].forEach(node => node && titleObserver.observe(node, { childList: true, characterData: true, subtree: true }));
const languageObserver = new MutationObserver(syncTitle);
languageObserver.observe(body, { attributes: true, attributeFilter: ["class"] });

/* ---------- The age: rolls up like an odometer once the invitation opens ---------- */
const age = document.getElementById("emAge");
const ageDigits = document.getElementById("emAgeDigits");
const ageText = document.getElementById("emAgeText");
let ageValue = 0;
let ageRolled = false;
function updateAge(title) {
  const found = /(?:^|\D)(\d{1,3})(?:st|nd|rd|th)?(?!\d)/i.exec(title);
  const value = found ? Number(found[1]) : 0;
  if (value === ageValue) return;
  ageValue = value > 0 && value < 130 ? value : 0;
  age.hidden = !ageValue;
  if (!ageValue) return;
  ageText.textContent = `Turning ${ageValue}`;
  const digits = String(ageValue).split("");
  ageDigits.replaceChildren(...digits.map((digit, index) => {
    const column = document.createElement("span");
    column.className = "em-age__column";
    const reel = document.createElement("span");
    reel.className = "em-age__reel";
    // The last digit spins through a couple of full turns; higher digits climb once.
    const turns = index === digits.length - 1 ? 2 : 0;
    const stops = turns * 10 + Number(digit);
    for (let n = 0; n <= stops; n += 1) {
      const cell = document.createElement("span");
      cell.textContent = String(n % 10);
      reel.append(cell);
    }
    reel.style.setProperty("--stops", String(stops));
    reel.style.setProperty("--delay", `${index * 160}ms`);
    column.append(reel);
    return column;
  }));
  ageRolled = false;
  if (body.classList.contains("invitation-open")) rollAge();
}
function rollAge() {
  if (ageRolled || !ageValue) return;
  ageRolled = true;
  requestAnimationFrame(() => requestAnimationFrame(() => age.classList.add("is-rolled")));
}
syncTitle();

/* ---------- Opening: strike the match ----------
   --x runs 0 → 1 as the match slides across the striker. Past three quarters
   it catches. The film starts inside pointerup so the browser keeps the user
   activation it needs for the music. */
let x = 0;
let startX = 0;
let startValue = 0;
let dragging = false;
let lit = false;
let lastX = 0;
let lastT = 0;
let warmed = false;
let litTimer = 0;
function warmFilm() {
  const video = document.getElementById("openingVideo");
  if (warmed || !video || saveData) return;
  warmed = true;
  video.preload = "auto";
  video.load();
}
const setX = (value) => {
  x = Math.max(0, Math.min(1, value));
  stage.style.setProperty("--x", x.toFixed(4));
};
function spark(speed) {
  if (reduced.matches || sparks.childElementCount > 26) return;
  const count = Math.min(4, 1 + Math.floor(speed * 3));
  for (let i = 0; i < count; i += 1) {
    const dot = document.createElement("i");
    dot.style.setProperty("--sx", `${(-20 - Math.random() * 50).toFixed(0)}px`);
    dot.style.setProperty("--sy", `${(-14 - Math.random() * 46).toFixed(0)}px`);
    dot.style.setProperty("--ss", `${(.6 + Math.random() * .9).toFixed(2)}`);
    sparks.append(dot);
    dot.addEventListener("animationend", () => dot.remove(), { once: true });
  }
}
function ignite() {
  if (lit) return;
  lit = true;
  stage.classList.add("em-lit");
  setX(1);
  if (navigator.vibrate) navigator.vibrate([10, 40, 18]);
  for (let i = 0; i < 6; i += 1) spark(1);
  // If the finger stays down, open anyway once the flame has caught.
  litTimer = setTimeout(() => { if (dragging) { dragging = false; openButton.click(); } }, 900);
}
function onDown(event) {
  if (lit || intro.classList.contains("is-opening") || event.target.closest("button")) return;
  dragging = true;
  startX = lastX = event.clientX;
  lastT = performance.now();
  startValue = x;
  warmFilm();
  stage.classList.add("em-dragging");
  stage.setPointerCapture?.(event.pointerId);
}
function onMove(event) {
  if (!dragging) return;
  const now = performance.now();
  const travel = Math.max(160, box.clientWidth * .74);
  const direction = document.documentElement.dir === "rtl" ? -1 : 1;
  setX(startValue + direction * (event.clientX - startX) / travel);
  const speed = Math.abs(event.clientX - lastX) / Math.max(1, now - lastT);
  lastX = event.clientX;
  lastT = now;
  if (x > .06) stage.classList.add("em-moved");
  if (speed > .35 && x > .08) spark(speed);
  if (x >= .78 && !lit) ignite();
}
function onUp() {
  if (!dragging) return;
  dragging = false;
  stage.classList.remove("em-dragging");
  if (lit) { clearTimeout(litTimer); openButton.click(); return; }
  if (x < .02) { box.classList.remove("em-nudge"); void box.offsetWidth; box.classList.add("em-nudge"); }
  setX(0);
  stage.classList.remove("em-moved");
}
if (box && stage) {
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("contextmenu", event => event.preventDefault());
  stage.addEventListener("keydown", event => { if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); ignite(); openButton.click(); } });
}
// "Or tap to open" and skip light the match too, so it is never left unlit.
openButton?.addEventListener("click", () => { warmFilm(); if (!lit) { lit = true; stage.classList.add("em-lit"); setX(1); } }, true);
document.getElementById("skipOpening")?.addEventListener("click", () => { lit = true; stage.classList.add("em-lit"); }, true);

/* ---------- Settle focus after the cover leaves; roll the age ---------- */
let focused = false;
const settleCover = () => {
  if (!body.classList.contains("invitation-open")) return;
  rollAge();
  if (focused) return;
  focused = true;
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  intro.inert = true;
  intro.setAttribute("aria-hidden", "true");
  const hero = document.getElementById("heroSection");
  hero.setAttribute("tabindex", "-1");
  hero.focus({ preventScroll: true });
};
const opened = new MutationObserver(settleCover);
opened.observe(body, { attributes: true, attributeFilter: ["class"] });
settleCover();

/* ---------- Stickers drift a little against the scroll ---------- */
const stickers = [...document.querySelectorAll(".em-sticker")];
let driftFrame = 0;
const drift = () => {
  driftFrame = 0;
  if (reduced.matches) return;
  for (const sticker of stickers) {
    const rect = sticker.getBoundingClientRect();
    if (rect.bottom < -100 || rect.top > innerHeight + 100) continue;
    sticker.style.setProperty("--drift", `${((rect.top + rect.height / 2 - innerHeight / 2) * -.06).toFixed(1)}px`);
  }
};
const onScroll = () => { if (!driftFrame) driftFrame = requestAnimationFrame(drift); };
addEventListener("scroll", onScroll, { passive: true });

/* ---------- Entrances ---------- */
let observer;
function observeSections() {
  observer?.disconnect();
  const canAnimate = !reduced.matches && "IntersectionObserver" in window;
  body.classList.toggle("em-motion", canAnimate);
  if (!canAnimate) return;
  observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting || !body.classList.contains("invitation-open")) return;
      entry.target.classList.add("em-arrival");
      observer.unobserve(entry.target);
    });
  }, { threshold: .08, rootMargin: "0px 0px -6% 0px" });
  document.querySelectorAll(".section-frame").forEach(node => observer.observe(node));
}
observeSections();
reduced.addEventListener("change", observeSections);
const scheduleMount = document.getElementById("scheduleMount");
const scheduleObserver = "IntersectionObserver" in window ? new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add("em-schedule-arrival");
    scheduleObserver.unobserve(entry.target);
  });
}, { threshold: .3 }) : null;
const observeSchedule = () => scheduleMount?.querySelectorAll(".schedule-item:not(.em-schedule-arrival)").forEach(item => scheduleObserver?.observe(item));
const scheduleChanges = new MutationObserver(observeSchedule);
if (scheduleMount) scheduleChanges.observe(scheduleMount, { childList: true });
observeSchedule();

// The floating action hides while its own target (hero or RSVP) is on screen.
const actionObserver = "IntersectionObserver" in window ? new IntersectionObserver(entries => {
  for (const entry of entries) body.classList.toggle(entry.target.id === "rsvpSection" ? "em-rsvp-visible" : "em-hero-visible", entry.isIntersecting);
}, { threshold: .05 }) : null;
actionObserver?.observe(document.getElementById("heroSection"));
actionObserver?.observe(document.getElementById("rsvpSection"));

document.querySelector(".skip-link").addEventListener("click", event => {
  event.preventDefault();
  document.getElementById("skipOpening").click();
});
document.addEventListener("keydown", () => body.classList.add("keyboard-navigation"));
document.addEventListener("pointerdown", () => body.classList.remove("keyboard-navigation"));
window.addEventListener("pagehide", () => {
  [observer, scheduleObserver, actionObserver].forEach(item => item?.disconnect());
  [scheduleChanges, opened, titleObserver, languageObserver].forEach(item => item.disconnect());
  removeEventListener("scroll", onScroll);
  clearTimeout(litTimer);
}, { once: true });
}
