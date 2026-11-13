const root = "./invitations/wedding-designs/mandoos/assets/";
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
window.scrollTo({ top: 0, left: 0, behavior: "instant" });
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
globalThis.invitationDesignConfig = {
  languageStorageKey: "mandoos-language",
  // The film settles on the open chest at ~5.6s of 6s.
  finishAt: 5.6,
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
    heroKicker: { en: "Together with their families", ar: "بمباركة الأهل" },
    openInvitation: { en: "Or tap to open", ar: "أو اضغطوا للفتح" },
    introCaption: { en: "Trace the string of pearls to open the mandoos.", ar: "مرّروا إصبعكم حول عقد اللؤلؤ لفتح المندوس." },
    videoLabel: { en: "The mandoos opens onto pearls, gold and emerald velvet", ar: "المندوس ينفتح على اللؤلؤ والذهب والمخمل الأخضر" },
    detailsHeading: { en: "A night as rare as a dana pearl.", ar: "ليلةٌ نادرة كالدانة." },
    scheduleHeading: { en: "The evening, pearl by pearl.", ar: "الأمسية، لؤلؤةً لؤلؤة." },
    seatingHeading: { en: "Your place, set with care.", ar: "مكانكم، مُعدٌّ بعناية." },
    sampleSeating: { en: "A sample seating plan for your celebration.", ar: "نموذج لخطة الجلوس في احتفالكم." },
    introRetry: { en: "Still loading. Tap to retry.", ar: "ما زال التحميل جارياً. اضغطوا لإعادة المحاولة." },
    introBlocked: { en: "The film could not start. Tap to retry.", ar: "تعذّر بدء الفيلم. اضغطوا لإعادة المحاولة." },
    introError: { en: "The film is unavailable. Tap to retry.", ar: "الفيلم غير متاح. اضغطوا لإعادة المحاولة." },
    rsvpHeading: { en: "Will you honour us?", ar: "هل تشرّفوننا بحضوركم؟" },
    attendanceDeclined: { en: "You'll be dearly missed.", ar: "سنفتقدكم كثيراً." },
    closing: { en: "Your presence is the dana of our evening.", ar: "حضوركم دانةُ ليلتنا." },
    passHeading: { en: "Your key to the evening.", ar: "مفتاحكم إلى الأمسية." },
    viewDetails: { en: "Open the details", ar: "افتحوا التفاصيل" },
    skip: { en: "Skip", ar: "تخطي" },
  },
  // Fictional preview only. Live contexts replace these fields in the shared runtime.
  demoWedding: {
    coupleName: "Mariam & Hamdan", brideName: "Mariam", groomName: "Hamdan", brideNameAr: "مريم", groomNameAr: "حمدان",
    subtitleEn: "With the blessing of our families, we invite you to share the joy of our wedding night.",
    subtitleAr: "بمباركة أهلنا، نتشرف بدعوتكم لمشاركتنا فرحة ليلة زفافنا.",
    invitationMessageEn: "An evening of oud, bakhoor and the people dearest to us. It is not complete without you.",
    invitationMessageAr: "أمسية من العود والبخور وأعزّ الناس على قلوبنا، ولا تكتمل إلا بحضوركم.",
    closingEn: "Your presence is the dana of our evening.",
    closingAr: "حضوركم دانةُ ليلتنا.",
    venueEn: "Qasr Al Dana", venueAr: "قصر الدانة", locationEn: "Abu Dhabi, United Arab Emirates", locationAr: "أبوظبي، الإمارات العربية المتحدة",
    eventDateISO: "2027-02-12T20:00:00+04:00", timeEn: "8:00 PM", timeAr: "٨:٠٠ مساءً",
    mapsUrl: "https://www.google.com/maps/search/?api=1&query=Abu+Dhabi", venueMapEmbedUrl: "https://www.google.com/maps?q=Abu+Dhabi&output=embed",
  },
};

await import("../../../script.js?v=20261113-pc-1");

// The shared runtime replaces the document with an accessible error for an
// incomplete link. Only enhance a successfully mounted invitation shell.
if (document.getElementById("introScreen") && document.getElementById("siteContent")) {
const body = document.body;
const intro = document.getElementById("introScreen");
const stage = document.getElementById("envelopeStage");
const openButton = document.getElementById("openInvitation");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const compact = () => matchMedia("(max-width: 760px)").matches;
const saveData = navigator.connection?.saveData === true;

// Local review only: lets automated layout inspection start beyond the cover.
if (["127.0.0.1", "localhost"].includes(location.hostname) && new URLSearchParams(location.search).get("review") === "1") {
  document.getElementById("skipOpening").click();
}

/* ---------- Names: a pearl on a gold thread between them ---------- */
const splitNames = (text) => {
  const parts = text.trim().split(/\s+(&|و)\s+/);
  return parts.length === 3 && parts[0] && parts[2] ? parts : null;
};
const ornamentNames = (node) => {
  if (!node || node.querySelector(".md-name")) return;
  const parts = splitNames(node.textContent);
  if (!parts) return;
  const make = (className, value) => { const span = document.createElement("span"); span.className = className; if (value) span.textContent = value; return span; };
  const bead = make("md-bead");
  bead.setAttribute("aria-hidden", "true");
  const label = make("md-sr", ` ${parts[1] === "&" ? "and" : "و"} `);
  node.replaceChildren(make("md-name", parts[0]), bead, label, make("md-name", parts[2]));
};
const nameNodes = ["heroEnglishNames", "heroArabicNames"].map(id => document.getElementById(id));
const namesObserver = new MutationObserver(() => nameNodes.forEach(ornamentNames));
nameNodes.forEach(node => { if (node) { ornamentNames(node); namesObserver.observe(node, { childList: true, characterData: true, subtree: true }); } });

/* ---------- Opening: trace the string of pearls around the lock ---------- */
const PEARLS = 12;
const lock = document.getElementById("mdLock");
const pearlRing = document.getElementById("mdLockPearls");
const progressArc = document.getElementById("mdLockProgress");
const pearls = [];
for (let i = 0; i < PEARLS; i += 1) {
  const pearl = document.createElement("i");
  pearl.style.setProperty("--a", `${(360 / PEARLS) * i}deg`);
  pearlRing?.append(pearl);
  pearls.push(pearl);
}
let turned = 0; // signed radians travelled around the lock
let lastAngle = null;
let unlocked = false;
let pendingOpen = false;
let tracing = false;
let lit = 0;

// The film starts buffering on the first touch, so it is ready by the time the key turns.
let warmed = false;
function warmFilm() {
  const video = document.getElementById("openingVideo");
  if (warmed || !video || saveData) return;
  warmed = true;
  video.preload = "auto";
  video.load();
}

const centre = () => {
  const box = lock.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2, r: box.width / 2 };
};
function paint() {
  const progress = Math.min(1, Math.abs(turned) / (Math.PI * 2));
  const clockwise = turned >= 0;
  lock.classList.toggle("is-anticlockwise", !clockwise);
  progressArc?.style.setProperty("stroke-dashoffset", String(1 - progress));
  const count = progress <= 0 ? 0 : Math.min(PEARLS, Math.floor(progress * PEARLS) + 1);
  pearls.forEach((pearl, index) => {
    const step = clockwise ? index : (PEARLS - index) % PEARLS;
    pearl.classList.toggle("is-lit", step < count);
  });
  if (count > lit && navigator.vibrate) navigator.vibrate(count === PEARLS ? [10, 30, 14] : 6);
  lit = count;
  stage.style.setProperty("--md-progress", progress.toFixed(3));
  if (progress >= 1) unlock();
}
function unlock() {
  if (unlocked) return;
  unlocked = true;
  pendingOpen = true;
  stage.classList.add("md-unlocked");
}
function angleOf(event) {
  const c = centre();
  const dx = event.clientX - c.x;
  const dy = event.clientY - c.y;
  // Too close to the keyhole the angle jumps about; ignore it there.
  if (Math.hypot(dx, dy) < c.r * .22) return null;
  return Math.atan2(dy, dx);
}
function onDown(event) {
  if (unlocked || intro.classList.contains("is-opening") || event.target.closest("button")) return;
  tracing = true;
  warmFilm();
  stage.classList.add("md-tracing");
  stage.setPointerCapture?.(event.pointerId);
  lastAngle = angleOf(event);
}
function onMove(event) {
  if (!tracing || unlocked) return;
  const angle = angleOf(event);
  if (angle === null) return;
  if (lastAngle !== null) {
    let delta = angle - lastAngle;
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    turned += delta;
    paint();
  }
  lastAngle = angle;
}
function onUp() {
  if (!tracing) return;
  tracing = false;
  lastAngle = null;
  stage.classList.remove("md-tracing");
  // Most of the way round is enough: finish the string for the guest.
  if (!unlocked && Math.abs(turned) >= Math.PI * 2 * .8) {
    turned = Math.sign(turned || 1) * Math.PI * 2;
    paint();
  }
  // Opening inside the release keeps the browser's user activation, so the
  // film and the music may start with their permissions intact.
  if (pendingOpen) { pendingOpen = false; openButton.click(); }
}
if (lock && stage) {
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  paint();
}
// "Or tap to open" turns the key too, so the pearls are never left half-lit.
openButton?.addEventListener("click", () => {
  if (!unlocked) { turned = Math.PI * 2; paint(); pendingOpen = false; }
}, true);

/* ---------- Settle focus after the cover leaves ---------- */
let focused = false;
const settleCover = () => {
  if (!body.classList.contains("invitation-open") || focused) return;
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

/* ---------- Living films: the open chest behind the hero, smoke beside the reply ---------- */
const filmObservers = [];
function livingFilm(video, section, portraitPoster) {
  if (!video || !section || !("IntersectionObserver" in window)) return;
  const sources = [...video.querySelectorAll("source[data-src]")];
  if (portraitPoster && compact()) video.poster = portraitPoster;
  const canPlay = () => !reduced.matches && !saveData && !document.hidden && body.classList.contains("invitation-open");
  let visible = false;
  const sync = () => {
    if (visible && canPlay()) {
      if (sources.length && !sources[0].src) { sources.forEach(item => { item.src = item.dataset.src; }); video.load(); }
      video.play()?.catch(() => {});
    } else if (!video.paused) {
      video.pause();
    }
  };
  const watcher = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); sync(); });
  watcher.observe(section);
  filmObservers.push(watcher);
  reduced.addEventListener("change", sync);
  document.addEventListener("visibilitychange", sync);
  const classes = new MutationObserver(sync);
  classes.observe(body, { attributes: true, attributeFilter: ["class"] });
  filmObservers.push(classes);
}
livingFilm(document.getElementById("mdHeroFilm"), document.getElementById("heroSection"), `${root}inside-portrait.webp`);
livingFilm(document.getElementById("mdSmokeFilm"), document.getElementById("rsvpSection"));

/* ---------- Entrances ---------- */
let observer;
const decor = new Map([...document.querySelectorAll(".md-henna-rule, .md-talli--edge")].map(node => [node.parentElement, node]));
function observeSections() {
  observer?.disconnect();
  document.querySelectorAll(".md-arrival").forEach(node => node.classList.remove("md-arrival"));
  const canAnimate = !reduced.matches && "IntersectionObserver" in window;
  body.classList.toggle("md-motion", canAnimate);
  if (!canAnimate) return;
  observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting || !body.classList.contains("invitation-open")) return;
      // Clipped ornaments cannot be observed directly (their visible area is
      // zero until they are drawn), so their section reports for them.
      const target = decor.get(entry.target) || entry.target;
      target.classList.add("md-arrival");
      observer.unobserve(entry.target);
    });
  }, { threshold: .1, rootMargin: "0px 0px -6% 0px" });
  document.querySelectorAll(".section-frame").forEach(node => observer.observe(node));
  decor.forEach((_, section) => observer.observe(section));
}
observeSections();
reduced.addEventListener("change", observeSections);
const scheduleMount = document.getElementById("scheduleMount");
const scheduleObserver = "IntersectionObserver" in window ? new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add("md-schedule-arrival");
    scheduleObserver.unobserve(entry.target);
  });
}, { threshold: .3 }) : null;
const observeSchedule = () => scheduleMount?.querySelectorAll(".schedule-item:not(.md-schedule-arrival)").forEach(item => scheduleObserver?.observe(item));
const scheduleChanges = new MutationObserver(observeSchedule);
if (scheduleMount) scheduleChanges.observe(scheduleMount, { childList: true });
observeSchedule();

// The floating action hides while its own target (hero or RSVP) is on screen.
const actionObserver = "IntersectionObserver" in window ? new IntersectionObserver(entries => {
  for (const entry of entries) body.classList.toggle(entry.target.id === "rsvpSection" ? "md-rsvp-visible" : "md-hero-visible", entry.isIntersecting);
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
  [...filmObservers, observer, scheduleObserver, actionObserver].forEach(item => item?.disconnect());
  [scheduleChanges, opened, namesObserver].forEach(item => item.disconnect());
}, { once: true });
}
