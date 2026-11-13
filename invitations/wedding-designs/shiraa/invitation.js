const root = "./invitations/wedding-designs/shiraa/assets/";
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
window.scrollTo({ top: 0, left: 0, behavior: "instant" });
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
globalThis.invitationDesignConfig = {
  languageStorageKey: "shiraa-language",
  // The film settles on the couple at ~5.6s of 6s.
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
    heroKicker: { en: "Together with their families", ar: "بحضور الأهل والأحبّة" },
    openInvitation: { en: "Or tap to open", ar: "أو اضغطوا للفتح" },
    introCaption: { en: "Swipe up to lift the veil.", ar: "اسحبوا للأعلى لرفع الطرحة." },
    videoLabel: { en: "The couple turn to each other on the boardwalk as the sail lights up for the evening", ar: "العروسان على الممشى البحري والشراع يضيء للمساء" },
    detailsHeading: { en: "By the sea, as the sail lights up.", ar: "على شاطئ البحر، حين يضيء الشراع." },
    scheduleHeading: { en: "From the zaffa to the last song.", ar: "من الزفّة إلى آخر أغنية." },
    seatingHeading: { en: "Your place in the ballroom.", ar: "مكانكم في القاعة." },
    sampleSeating: { en: "A sample seating plan for your celebration.", ar: "نموذج لخطة الجلوس في احتفالكم." },
    introRetry: { en: "Still loading. Tap to retry.", ar: "ما زال التحميل جارياً. اضغطوا لإعادة المحاولة." },
    introBlocked: { en: "The film could not start. Tap to retry.", ar: "تعذّر بدء الفيلم. اضغطوا لإعادة المحاولة." },
    introError: { en: "The film is unavailable. Tap to retry.", ar: "الفيلم غير متاح. اضغطوا لإعادة المحاولة." },
    rsvpHeading: { en: "Will you be with us?", ar: "هل ستكونون معنا؟" },
    attendanceDeclined: { en: "We will miss you by the sea.", ar: "سنفتقدكم على البحر." },
    closing: { en: "Come as you are; the evening is waiting for you.", ar: "تعالوا كما أنتم، فالليلة بانتظاركم." },
    passHeading: { en: "Your pass for the night.", ar: "بطاقة دخولكم لهذه الليلة." },
    viewDetails: { en: "Join us", ar: "شاركونا" },
    skip: { en: "Skip", ar: "تخطي" },
  },
  // Fictional preview only. Live contexts replace these fields in the shared runtime.
  demoWedding: {
    coupleName: "Noura & Khalid", brideName: "Noura", groomName: "Khalid", brideNameAr: "نورة", groomNameAr: "خالد",
    subtitleEn: "With the blessing of our families, we invite you to celebrate our wedding by the sea.",
    subtitleAr: "بمباركة أهلنا، يسعدنا أن ندعوكم لمشاركتنا فرحة زفافنا على شاطئ البحر.",
    invitationMessageEn: "The sea at sunset, the sail lit gold, and the people we love most in one room.",
    invitationMessageAr: "البحر عند الغروب، والشراع يضيء ذهباً، وأحبّ الناس إلينا في مكانٍ واحد.",
    closingEn: "Come as you are; the evening is waiting for you.",
    closingAr: "تعالوا كما أنتم، فالليلة بانتظاركم.",
    venueEn: "The Sail Ballroom", venueAr: "قاعة الشراع", locationEn: "Jumeirah, Dubai", locationAr: "جميرا، دبي",
    eventDateISO: "2027-03-19T20:00:00+04:00", timeEn: "8:00 PM", timeAr: "٨:٠٠ مساءً",
    mapsUrl: "https://www.google.com/maps/search/?api=1&query=Jumeirah+Dubai", venueMapEmbedUrl: "https://www.google.com/maps?q=Jumeirah+Dubai&output=embed",
  },
};

await import("../../../script.js?v=20261113-pc-1");

// The shared runtime replaces the document with an accessible error for an
// incomplete link. Only enhance a successfully mounted invitation shell.
if (document.getElementById("introScreen") && document.getElementById("siteContent")) {
const body = document.body;
const intro = document.getElementById("introScreen");
const stage = document.getElementById("envelopeStage");
const veil = document.getElementById("shVeil");
const openButton = document.getElementById("openInvitation");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const compact = () => matchMedia("(max-width: 760px)").matches;
const saveData = navigator.connection?.saveData === true;

// Local review only: lets automated layout inspection start beyond the cover.
if (["127.0.0.1", "localhost"].includes(location.hostname) && new URLSearchParams(location.search).get("review") === "1") {
  document.getElementById("skipOpening").click();
}

/* ---------- Names: a small gold sail between them; a monogram on the veil ---------- */
const splitNames = (text) => {
  const parts = text.trim().split(/\s+(&|و)\s+/);
  return parts.length === 3 && parts[0] && parts[2] ? parts : null;
};
const ornamentNames = (node) => {
  if (!node || node.querySelector(".sh-name")) return;
  const parts = splitNames(node.textContent);
  if (!parts) return;
  const make = (className, value) => { const span = document.createElement("span"); span.className = className; if (value) span.textContent = value; return span; };
  const joint = make("sh-joint");
  joint.setAttribute("aria-hidden", "true");
  const label = make("sh-sr", ` ${parts[1] === "&" ? "and" : "و"} `);
  node.replaceChildren(make("sh-name", parts[0]), joint, label, make("sh-name", parts[2]));
};
const veilNames = document.getElementById("shVeilNames");
const monogram = document.getElementById("shMonogram");
const syncVeil = () => {
  const arabic = body.classList.contains("layla-arabic");
  const source = document.getElementById(arabic ? "heroArabicNames" : "heroEnglishNames");
  const names = [...(source?.querySelectorAll(".sh-name") || [])].map(node => node.textContent.trim());
  if (veilNames) veilNames.textContent = names.length === 2 ? `${names[0]} ${arabic ? "و" : "&"} ${names[1]}` : source?.textContent || "";
  if (monogram) monogram.textContent = names.length === 2 ? `${[...names[0]][0]}${[...names[1]][0]}` : "";
  monogram?.classList.toggle("is-arabic", arabic);
};
const nameNodes = ["heroEnglishNames", "heroArabicNames"].map(id => document.getElementById(id));
const namesObserver = new MutationObserver(() => { nameNodes.forEach(ornamentNames); syncVeil(); });
nameNodes.forEach(node => { if (node) { ornamentNames(node); namesObserver.observe(node, { childList: true, characterData: true, subtree: true }); } });
const languageObserver = new MutationObserver(syncVeil);
languageObserver.observe(body, { attributes: true, attributeFilter: ["class"] });
syncVeil();

/* ---------- Opening: lift the veil ----------
   --lift runs 0 → 1. The hem follows the finger; past a third of the way a
   release finishes the lift. The film starts inside pointerup so the browser
   keeps the user activation it needs for sound and playback. */
let lift = 0;
let startY = 0;
let startLift = 0;
let dragging = false;
let lifted = false;
let lastY = 0;
let lastT = 0;
let velocity = 0;
let warmed = false;
function warmFilm() {
  const video = document.getElementById("openingVideo");
  if (warmed || !video || saveData) return;
  warmed = true;
  video.preload = "auto";
  video.load();
}
// Each hem segment knows where it sits on the curve: k = (2t - 1)², 1 at the edges, 0 in the middle.
const hem = [...document.querySelectorAll(".sh-veil__hem i")];
hem.forEach((node, index) => { const t = (index + .5) / hem.length; node.style.setProperty("--k", ((2 * t - 1) ** 2).toFixed(3)); });
const setLift = (value) => {
  lift = Math.max(0, Math.min(1, value));
  stage.style.setProperty("--lift", lift.toFixed(4));
};
function liftAway() {
  if (lifted) return;
  lifted = true;
  stage.classList.remove("sh-dragging");
  stage.classList.add("sh-lifted");
  setLift(1);
  if (navigator.vibrate) navigator.vibrate([8, 30, 12]);
}
function onDown(event) {
  if (lifted || intro.classList.contains("is-opening") || event.target.closest("button")) return;
  dragging = true;
  startY = lastY = event.clientY;
  lastT = performance.now();
  velocity = 0;
  startLift = lift;
  warmFilm();
  stage.classList.add("sh-dragging");
  stage.setPointerCapture?.(event.pointerId);
}
function onMove(event) {
  if (!dragging) return;
  const now = performance.now();
  const travel = Math.max(220, stage.clientHeight * .62);
  setLift(startLift + (startY - event.clientY) / travel);
  velocity = (lastY - event.clientY) / Math.max(1, now - lastT);
  lastY = event.clientY;
  lastT = now;
  if (lift > .06) stage.classList.add("sh-moved");
}
function onUp() {
  if (!dragging) return;
  dragging = false;
  stage.classList.remove("sh-dragging");
  // A quick flick or a lift past a third opens; otherwise the veil falls back.
  if (lift > .34 || velocity > .55) { liftAway(); openButton.click(); return; }
  if (lift < .02 && Math.abs(startY - lastY) < 8) { veil.classList.remove("sh-nudge"); void veil.offsetWidth; veil.classList.add("sh-nudge"); }
  setLift(0);
  stage.classList.remove("sh-moved");
}
if (veil && stage) {
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("contextmenu", event => event.preventDefault());
  stage.addEventListener("keydown", event => { if (event.key === "ArrowUp" || event.key === "PageUp") { event.preventDefault(); openButton.click(); } });
}
// "Or tap to open" and skip lift the veil too, so it is never left hanging.
openButton?.addEventListener("click", () => { warmFilm(); liftAway(); }, true);
document.getElementById("skipOpening")?.addEventListener("click", liftAway, true);

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

/* ---------- Living film: the couple by the sea behind the hero ---------- */
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
livingFilm(document.getElementById("shHeroFilm"), document.getElementById("heroSection"), `${root}hero-portrait.webp`);

/* ---------- Collage: tiles drift at their own pace as the page scrolls ---------- */
const tiles = [...document.querySelectorAll(".sh-tile[class*=sh-tile--]")];
const speeds = { gown: -.06, heels: .05, roses: -.04, quote: .02, bisht: -.03, emerald: .08, oud: .04, cake: -.05, ghutra: .05 };
let drift = 0;
const collage = document.querySelector(".sh-collage");
const driftFrame = () => {
  drift = 0;
  if (!collage || reduced.matches) return;
  const box = collage.getBoundingClientRect();
  if (box.bottom < 0 || box.top > innerHeight) return;
  const centre = box.top + box.height / 2 - innerHeight / 2;
  tiles.forEach(tile => {
    const key = [...tile.classList].find(name => name.startsWith("sh-tile--"))?.slice(9);
    tile.style.setProperty("--drift", `${((speeds[key] || 0) * centre * (compact() ? .55 : 1)).toFixed(1)}px`);
  });
};
const onScroll = () => { if (!drift) drift = requestAnimationFrame(driftFrame); };
addEventListener("scroll", onScroll, { passive: true });

/* ---------- Entrances ---------- */
let observer;
const decor = new Map([...document.querySelectorAll(".sh-scroll")].map(node => [node.parentElement, node]));
function observeSections() {
  observer?.disconnect();
  document.querySelectorAll(".sh-arrival").forEach(node => node.classList.remove("sh-arrival"));
  const canAnimate = !reduced.matches && "IntersectionObserver" in window;
  body.classList.toggle("sh-motion", canAnimate);
  if (!canAnimate) return;
  observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting || !body.classList.contains("invitation-open")) return;
      // Clipped ornaments cannot be observed directly, so their section reports for them.
      const target = decor.get(entry.target) || entry.target;
      target.classList.add("sh-arrival");
      observer.unobserve(entry.target);
    });
  }, { threshold: .08, rootMargin: "0px 0px -6% 0px" });
  document.querySelectorAll(".section-frame,.sh-tile").forEach(node => observer.observe(node));
  decor.forEach((_, section) => observer.observe(section));
}
observeSections();
reduced.addEventListener("change", observeSections);
const scheduleMount = document.getElementById("scheduleMount");
const scheduleObserver = "IntersectionObserver" in window ? new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add("sh-schedule-arrival");
    scheduleObserver.unobserve(entry.target);
  });
}, { threshold: .3 }) : null;
const observeSchedule = () => scheduleMount?.querySelectorAll(".schedule-item:not(.sh-schedule-arrival)").forEach(item => scheduleObserver?.observe(item));
const scheduleChanges = new MutationObserver(observeSchedule);
if (scheduleMount) scheduleChanges.observe(scheduleMount, { childList: true });
observeSchedule();

// The floating action hides while its own target (hero or RSVP) is on screen.
const actionObserver = "IntersectionObserver" in window ? new IntersectionObserver(entries => {
  for (const entry of entries) body.classList.toggle(entry.target.id === "rsvpSection" ? "sh-rsvp-visible" : "sh-hero-visible", entry.isIntersecting);
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
  [scheduleChanges, opened, namesObserver, languageObserver].forEach(item => item.disconnect());
  removeEventListener("scroll", onScroll);
}, { once: true });
}
