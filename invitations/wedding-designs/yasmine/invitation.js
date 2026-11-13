const root = "./invitations/wedding-designs/yasmine/assets/";
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
window.scrollTo({ top: 0, left: 0, behavior: "instant" });
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
globalThis.invitationDesignConfig = {
  languageStorageKey: "yasmine-language",
  // The film settles on the terrace at ~5.6s of 6s.
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
    heroKicker: { en: "Together with their families", ar: "بفرحة الأهل" },
    openInvitation: { en: "Or tap to open", ar: "أو اضغطوا للفتح" },
    introCaption: { en: "Press and hold to stitch your invitation.", ar: "اضغطوا مطوّلاً لتطريز دعوتكم." },
    videoLabel: { en: "Jasmine lifts from the card and rises to a terrace under an olive tree", ar: "الياسمين يرتفع عن البطاقة إلى شرفة تحت شجرة زيتون" },
    detailsHeading: { en: "Under the olive tree, as the sun goes down.", ar: "تحت شجرة الزيتون، عند المغيب." },
    scheduleHeading: { en: "From the zaffe to the last dabke.", ar: "من الزفّة إلى آخر دبكة." },
    seatingHeading: { en: "A place at our table.", ar: "مكانكم على مائدتنا." },
    sampleSeating: { en: "A sample seating plan for your celebration.", ar: "نموذج لخطة الجلوس في احتفالكم." },
    introRetry: { en: "Still loading. Tap to retry.", ar: "ما زال التحميل جارياً. اضغطوا لإعادة المحاولة." },
    introBlocked: { en: "The film could not start. Tap to retry.", ar: "تعذّر بدء الفيلم. اضغطوا لإعادة المحاولة." },
    introError: { en: "The film is unavailable. Tap to retry.", ar: "الفيلم غير متاح. اضغطوا لإعادة المحاولة." },
    rsvpHeading: { en: "Will you dance with us?", ar: "هل ترقصون معنا؟" },
    attendanceDeclined: { en: "The dabke line will miss you.", ar: "سيفتقدكم صفّ الدبكة." },
    closing: { en: "Come with your hearts; the jasmine is already in bloom.", ar: "تعالوا بقلوبكم، فالياسمين قد أزهر." },
    passHeading: { en: "Wave this at the door.", ar: "لوّحوا بها عند الباب." },
    viewDetails: { en: "Come closer", ar: "اقتربوا" },
    skip: { en: "Skip", ar: "تخطي" },
  },
  // Fictional preview only. Live contexts replace these fields in the shared runtime.
  demoWedding: {
    coupleName: "Lina & Fadi", brideName: "Lina", groomName: "Fadi", brideNameAr: "لينا", groomNameAr: "فادي",
    subtitleEn: "With full hearts and our families beside us, we invite you to dance with us on our wedding night.",
    subtitleAr: "بقلوبٍ فرحة ومعنا أهلنا، ندعوكم لتشاركونا الفرح والدبكة في ليلة عرسنا.",
    invitationMessageEn: "A long table under the olive tree, the smell of jasmine, and everyone we love in one dabke line.",
    invitationMessageAr: "مائدة طويلة تحت شجرة الزيتون، ورائحة الياسمين، وكلّ من نحبّ في صفّ دبكة واحد.",
    closingEn: "Come with your hearts; the jasmine is already in bloom.",
    closingAr: "تعالوا بقلوبكم، فالياسمين قد أزهر.",
    venueEn: "Dar Al Zaytoun", venueAr: "دار الزيتون", locationEn: "Dubai, United Arab Emirates", locationAr: "دبي، الإمارات العربية المتحدة",
    eventDateISO: "2027-06-05T19:00:00+04:00", timeEn: "7:00 PM", timeAr: "٧:٠٠ مساءً",
    mapsUrl: "https://www.google.com/maps/search/?api=1&query=Dubai", venueMapEmbedUrl: "https://www.google.com/maps?q=Dubai&output=embed",
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

/* ---------- Tatreez: one cross-stitch star, drawn from a grid ---------- */
const R = 9;
const inStar = (x, y) => (Math.abs(x) <= 6 && Math.abs(y) <= 6) || Math.abs(x) + Math.abs(y) <= 9;
const cells = [];
for (let y = -R; y <= R; y += 1) {
  for (let x = -R; x <= R; x += 1) {
    if (!inStar(x, y)) continue;
    const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !inStar(x + dx, y + dy));
    const d = Math.abs(x) + Math.abs(y);
    const inner = d === 4 || d <= 1 || (d === 7 && (x === 0 || y === 0 || Math.abs(x) === Math.abs(y)));
    if (edge || inner) cells.push({ x, y, order: Math.hypot(x, y) * 10 + ((Math.atan2(y, x) + Math.PI) / (Math.PI * 2)) });
  }
}
cells.sort((a, b) => a.order - b.order);
const SVG = "http://www.w3.org/2000/svg";
const sprite = document.getElementById("ysSprite");
if (sprite && !document.getElementById("ys-star")) {
  const symbol = document.createElementNS(SVG, "symbol");
  symbol.id = "ys-star";
  symbol.setAttribute("viewBox", "-10 -10 20 20");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", cells.map(({ x, y }) => `M${x - .42} ${y - .42}l.84 .84M${x + .42} ${y - .42}l-.84 .84`).join(""));
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", ".34");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("fill", "none");
  symbol.append(path);
  sprite.append(symbol);
}

/* ---------- Names: a small stitched star between them ---------- */
const splitNames = (text) => {
  const parts = text.trim().split(/\s+(&|و)\s+/);
  return parts.length === 3 && parts[0] && parts[2] ? parts : null;
};
const ornamentNames = (node) => {
  if (!node || node.querySelector(".ys-name")) return;
  const parts = splitNames(node.textContent);
  if (!parts) return;
  const make = (className, value) => { const span = document.createElement("span"); span.className = className; if (value) span.textContent = value; return span; };
  const joint = make("ys-joint");
  joint.setAttribute("aria-hidden", "true");
  joint.innerHTML = '<svg><use href="#ys-star"/></svg>';
  const label = make("ys-sr", ` ${parts[1] === "&" ? "and" : "و"} `);
  node.replaceChildren(make("ys-name", parts[0]), joint, label, make("ys-name", parts[2]));
};
const cardNames = document.getElementById("ysCardNames");
const syncCardNames = () => {
  const arabic = body.classList.contains("layla-arabic");
  const source = document.getElementById(arabic ? "heroArabicNames" : "heroEnglishNames");
  const names = source?.querySelectorAll(".ys-name");
  if (cardNames) cardNames.textContent = names?.length === 2 ? `${names[0].textContent} ${arabic ? "و" : "&"} ${names[1].textContent}` : source?.textContent || "";
};
const nameNodes = ["heroEnglishNames", "heroArabicNames"].map(id => document.getElementById(id));
const namesObserver = new MutationObserver(() => { nameNodes.forEach(ornamentNames); syncCardNames(); });
nameNodes.forEach(node => { if (node) { ornamentNames(node); namesObserver.observe(node, { childList: true, characterData: true, subtree: true }); } });
const languageObserver = new MutationObserver(syncCardNames);
languageObserver.observe(body, { attributes: true, attributeFilter: ["class"] });
syncCardNames();

/* ---------- Opening: press and hold to stitch the star ---------- */
const HOLD_MS = 2600;
const motif = document.getElementById("ysMotif");
const stitches = cells.map(({ x, y }) => {
  const stitch = document.createElementNS(SVG, "path");
  const cx = 105 + x * 10;
  const cy = 105 + y * 10;
  stitch.setAttribute("d", `M${cx - 3.6} ${cy - 3.6}l7.2 7.2M${cx + 3.6} ${cy - 3.6}l-7.2 7.2`);
  motif?.append(stitch);
  return stitch;
});
let progress = 0;
let holding = false;
let done = false;
let pendingOpen = false;
let shown = 0;
let lastFrame = 0;
let lingerTimer = 0;

let warmed = false;
function warmFilm() {
  const video = document.getElementById("openingVideo");
  if (warmed || !video || saveData) return;
  warmed = true;
  video.preload = "auto";
  video.load();
}
function draw() {
  const count = Math.round(progress * stitches.length);
  for (let i = shown; i < count; i += 1) stitches[i].classList.add("is-sewn");
  if (count > shown && navigator.vibrate && Math.floor(count / 12) > Math.floor(shown / 12)) navigator.vibrate(5);
  shown = Math.max(shown, count);
  stage.style.setProperty("--ys-progress", progress.toFixed(3));
}
function bloom() {
  if (reduced.matches) return;
  const hoop = document.getElementById("ysHoop");
  for (let i = 0; i < 16; i += 1) {
    const petal = document.createElement("i");
    petal.className = "ys-burst";
    const angle = (Math.PI * 2 * i) / 16 + Math.random() * .3;
    const reach = 90 + Math.random() * 110;
    petal.style.cssText = `--dx:${(Math.cos(angle) * reach).toFixed(0)}px;--dy:${(Math.sin(angle) * reach).toFixed(0)}px;--r:${(Math.random() * 360).toFixed(0)}deg;animation-delay:${(Math.random() * .15).toFixed(2)}s`;
    hoop?.append(petal);
    petal.addEventListener("animationend", () => petal.remove(), { once: true });
  }
}
function finish() {
  if (done) return;
  done = true;
  pendingOpen = true;
  stage.classList.add("ys-sewn");
  bloom();
  if (navigator.vibrate) navigator.vibrate([10, 40, 16]);
  // If the guest keeps holding, open anyway after a breath.
  lingerTimer = setTimeout(() => { if (pendingOpen) { pendingOpen = false; openButton.click(); } }, 900);
}
function tick(now) {
  if (!holding || done) return;
  const delta = Math.min(64, now - (lastFrame || now));
  lastFrame = now;
  progress = Math.min(1, progress + delta / HOLD_MS);
  draw();
  if (progress >= 1) { finish(); return; }
  requestAnimationFrame(tick);
}
function onDown(event) {
  if (done || intro.classList.contains("is-opening") || event.target.closest("button")) return;
  holding = true;
  lastFrame = 0;
  warmFilm();
  stage.classList.add("ys-holding");
  stage.setPointerCapture?.(event.pointerId);
  requestAnimationFrame(tick);
}
function onUp() {
  if (!holding) return;
  holding = false;
  stage.classList.remove("ys-holding");
  // Opening inside the release keeps the browser's user activation for the film and music.
  if (pendingOpen) { pendingOpen = false; clearTimeout(lingerTimer); openButton.click(); }
}
if (motif && stage) {
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("contextmenu", event => event.preventDefault());
}
// "Or tap to open" finishes the embroidery too, so the star is never left half-sewn.
openButton?.addEventListener("click", () => {
  if (!done) { progress = 1; draw(); done = true; pendingOpen = false; stage.classList.add("ys-sewn"); }
  clearTimeout(lingerTimer);
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

/* ---------- Living film: the terrace behind the hero ---------- */
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
livingFilm(document.getElementById("ysHeroFilm"), document.getElementById("heroSection"), `${root}terrace-portrait.webp`);

/* ---------- Entrances ---------- */
let observer;
const decor = new Map([...document.querySelectorAll(".ys-band--edge")].map(node => [node.parentElement, node]));
function observeSections() {
  observer?.disconnect();
  document.querySelectorAll(".ys-arrival").forEach(node => node.classList.remove("ys-arrival"));
  const canAnimate = !reduced.matches && "IntersectionObserver" in window;
  body.classList.toggle("ys-motion", canAnimate);
  if (!canAnimate) return;
  observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting || !body.classList.contains("invitation-open")) return;
      // Clipped ornaments cannot be observed directly (their visible area is
      // zero until they are drawn), so their section reports for them.
      const target = decor.get(entry.target) || entry.target;
      target.classList.add("ys-arrival");
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
    entry.target.classList.add("ys-schedule-arrival");
    scheduleObserver.unobserve(entry.target);
  });
}, { threshold: .3 }) : null;
const observeSchedule = () => scheduleMount?.querySelectorAll(".schedule-item:not(.ys-schedule-arrival)").forEach(item => scheduleObserver?.observe(item));
const scheduleChanges = new MutationObserver(observeSchedule);
if (scheduleMount) scheduleChanges.observe(scheduleMount, { childList: true });
observeSchedule();

// The floating action hides while its own target (hero or RSVP) is on screen.
const actionObserver = "IntersectionObserver" in window ? new IntersectionObserver(entries => {
  for (const entry of entries) body.classList.toggle(entry.target.id === "rsvpSection" ? "ys-rsvp-visible" : "ys-hero-visible", entry.isIntersecting);
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
}, { once: true });
}
