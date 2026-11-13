const root = "./invitations/wedding-designs/pomegranate-courtyard/assets/";
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
window.scrollTo({ top: 0, left: 0, behavior: "instant" });
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
globalThis.invitationDesignConfig = {
  languageStorageKey: "pomegranate-courtyard-language",
  // The film settles on the courtyard at ~5.6s of 6s.
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
    introCaption: { en: "Scratch the foil to reveal your invitation.", ar: "امسحوا الطبقة لتظهر دعوتكم." },
    videoLabel: { en: "The invitation opens into a candlelit courtyard", ar: "الدعوة تنفتح على فناء مضاء بالشموع" },
    detailsHeading: { en: "An evening in the courtyard.", ar: "أمسية في الفناء." },
    scheduleHeading: { en: "The evening, hour by hour.", ar: "الأمسية، ساعة بساعة." },
    seatingHeading: { en: "A seat, kept for you.", ar: "مقعدٌ محجوز لكم." },
    sampleSeating: { en: "A sample seating plan for your celebration.", ar: "نموذج لخطة الجلوس في احتفالكم." },
    introRetry: { en: "Still loading. Tap to retry.", ar: "ما زال التحميل جارياً. اضغطوا لإعادة المحاولة." },
    introBlocked: { en: "The film could not start. Tap to retry.", ar: "تعذّر بدء الفيلم. اضغطوا لإعادة المحاولة." },
    introError: { en: "The film is unavailable. Tap to retry.", ar: "الفيلم غير متاح. اضغطوا لإعادة المحاولة." },
    rsvpHeading: { en: "Will you join us?", ar: "هل ستشاركوننا؟" },
    attendanceDeclined: { en: "You'll be missed at the table.", ar: "سنفتقدكم على المائدة." },
    closing: { en: "Your presence completes our table.", ar: "بحضوركم تكتمل مائدتنا." },
    passHeading: { en: "Your key to the courtyard.", ar: "مفتاحكم إلى الفناء." },
    viewDetails: { en: "Step inside", ar: "تفضلوا بالدخول" },
    skip: { en: "Skip", ar: "تخطي" },
  },
  // Fictional preview only. Live contexts replace these fields in the shared runtime.
  demoWedding: {
    coupleName: "Nour & Karim", brideName: "Nour", groomName: "Karim", brideNameAr: "نور", groomNameAr: "كريم",
    subtitleEn: "Together with our families, we invite you to an evening under the pomegranate trees.",
    subtitleAr: "بمشاركة أهلنا، ندعوكم إلى أمسية تحت أشجار الرمان.",
    invitationMessageEn: "Long tables, candlelight, and the people we love most. Come as you are; stay until the last song.",
    invitationMessageAr: "موائد طويلة وضوء شموع وأحبّ الناس إلينا. تعالوا كما أنتم، وابقوا حتى آخر أغنية.",
    closingEn: "Your presence completes our table.",
    closingAr: "بحضوركم تكتمل مائدتنا.",
    venueEn: "Dar Al Rumman", venueAr: "دار الرمّان", locationEn: "Dubai, United Arab Emirates", locationAr: "دبي، الإمارات العربية المتحدة",
    eventDateISO: "2027-04-17T19:30:00+04:00", timeEn: "7:30 PM", timeAr: "٧:٣٠ مساءً",
    mapsUrl: "https://www.google.com/maps/search/?api=1&query=Dubai", venueMapEmbedUrl: "https://www.google.com/maps?q=Dubai&output=embed",
  },
};

await import("../../../script.js?v=20261113-pc-1");

// The shared runtime replaces the document with an accessible error for an
// incomplete link. Only enhance a successfully mounted invitation shell.
if (document.getElementById("introScreen") && document.getElementById("siteContent")) {
const body = document.body;
const intro = document.getElementById("introScreen");
const openButton = document.getElementById("openInvitation");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const compact = () => matchMedia("(max-width: 760px)").matches;

// Local review only: lets automated layout inspection start beyond the cover.
if (["127.0.0.1", "localhost"].includes(location.hostname) && new URLSearchParams(location.search).get("review") === "1") {
  document.getElementById("skipOpening").click();
}

/* ---------- Names: stacked, with a ruled ampersand ---------- */
const splitNames = (text) => {
  const parts = text.trim().split(/\s+(&|و)\s+/);
  return parts.length === 3 && parts[0] && parts[2] ? parts : null;
};
const ornamentNames = (node) => {
  if (!node || node.querySelector(".pc-name")) return;
  const parts = splitNames(node.textContent);
  if (!parts) return;
  const make = (className, value) => { const span = document.createElement("span"); span.className = className; span.textContent = value; return span; };
  const amp = make("pc-amp", parts[1]);
  amp.setAttribute("aria-hidden", "true");
  const label = make("pc-sr", ` ${parts[1] === "&" ? "and" : "و"} `);
  label.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)";
  node.replaceChildren(make("pc-name", parts[0]), amp, label, make("pc-name", parts[2]));
};
// The card in the opening photograph carries the same names, in the guest's language.
const cardNames = document.getElementById("pcCardNames");
const syncCardNames = () => {
  const arabic = body.classList.contains("layla-arabic");
  const source = document.getElementById(arabic ? "heroArabicNames" : "heroEnglishNames");
  const text = source?.querySelector(".pc-name") ? [...source.querySelectorAll(".pc-name")].map(n => n.textContent).join(arabic ? " و " : " & ") : source?.textContent || "";
  const parts = splitNames(text);
  if (!cardNames) return;
  if (parts) {
    const em = document.createElement("em");
    em.textContent = parts[1] === "&" ? "& " + parts[2] : "و " + parts[2];
    cardNames.replaceChildren(document.createTextNode(parts[0]), em);
  } else {
    cardNames.textContent = text;
  }
};
const nameNodes = ["heroEnglishNames", "heroArabicNames"].map(id => document.getElementById(id));
const namesObserver = new MutationObserver(() => { nameNodes.forEach(ornamentNames); syncCardNames(); });
nameNodes.forEach(node => { if (node) { ornamentNames(node); namesObserver.observe(node, { childList: true, characterData: true, subtree: true }); } });
const languageObserver = new MutationObserver(syncCardNames);
languageObserver.observe(body, { attributes: true, attributeFilter: ["class"] });
syncCardNames();

/* ---------- Opening: scratch the copper foil ---------- */
const stage = document.getElementById("envelopeStage");
const canvas = document.getElementById("pcFoil");
const context = canvas?.getContext?.("2d");
const REVEAL_AT = 0.42;
let revealed = false;
let pendingOpen = false;

function paintFoil() {
  if (!context) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.globalCompositeOperation = "source-over";
  // Burnished copper: a broad diagonal gradient with soft hot spots.
  const base = context.createLinearGradient(0, 0, width, height);
  base.addColorStop(0, "#7c3f25");
  base.addColorStop(.22, "#c7865b");
  base.addColorStop(.42, "#f1caa6");
  base.addColorStop(.55, "#cf9067");
  base.addColorStop(.78, "#9a5634");
  base.addColorStop(1, "#d79b72");
  context.fillStyle = base;
  context.fillRect(0, 0, width, height);
  const glow = context.createRadialGradient(width * .3, height * .28, 0, width * .3, height * .28, Math.max(width, height) * .7);
  glow.addColorStop(0, "rgba(255,236,214,.38)");
  glow.addColorStop(1, "rgba(255,236,214,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);
  // Brushed grain.
  context.lineWidth = 1;
  for (let y = 0; y < height; y += 2) {
    context.strokeStyle = `rgba(${Math.random() < .5 ? "255,240,225" : "70,25,10"},${(Math.random() * .07).toFixed(3)})`;
    context.beginPath();
    context.moveTo(0, y + Math.random());
    context.lineTo(width, y + Math.random() * 2);
    context.stroke();
  }
  // Embossed zellige: a lattice of eight-pointed stars, light edge over dark.
  const star = (cx, cy, r) => {
    context.beginPath();
    for (let i = 0; i < 16; i += 1) {
      const angle = (Math.PI / 8) * i - Math.PI / 2;
      const radius = i % 2 === 0 ? r : r * .62;
      context.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    }
    context.closePath();
  };
  const step = Math.max(64, Math.min(width, height) / 5.2);
  for (let row = -1; row * step < height + step; row += 1) {
    for (let column = -1; column * step < width + step; column += 1) {
      const cx = column * step + (row % 2 ? step / 2 : 0);
      const cy = row * step * .86;
      star(cx + .8, cy + .8, step * .3);
      context.strokeStyle = "rgba(70,25,10,.16)";
      context.stroke();
      star(cx, cy, step * .3);
      context.strokeStyle = "rgba(255,240,225,.22)";
      context.stroke();
    }
  }
  // A quiet border, like the edge of a foiled card.
  context.strokeStyle = "rgba(58,14,25,.35)";
  context.lineWidth = 1;
  context.strokeRect(14.5, 14.5 + (window.visualViewport ? 0 : 0), width - 29, height - 29);
  context.strokeStyle = "rgba(255,240,225,.35)";
  context.strokeRect(19.5, 19.5, width - 39, height - 39);
  // Fine noise so the metal never looks like a flat gradient.
  const grain = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < grain.data.length; i += 4) {
    const n = (Math.random() - .5) * 16;
    grain.data[i] += n; grain.data[i + 1] += n; grain.data[i + 2] += n;
  }
  context.putImageData(grain, 0, 0);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  resetCoverage(width, height);
}

// Coverage is tracked on a coarse grid of the visible screen, which is cheap
// and avoids reading pixels back from the canvas on every stroke.
let grid = null;
let gridColumns = 0;
let gridRows = 0;
let cleared = 0;
const CELL = 18;
function resetCoverage(width, height) {
  gridColumns = Math.ceil(width / CELL);
  gridRows = Math.ceil(height / CELL);
  grid = new Uint8Array(gridColumns * gridRows);
  cleared = 0;
}
function markCoverage(x, y, radius) {
  const reach = Math.ceil(radius / CELL);
  const cx = Math.floor(x / CELL);
  const cy = Math.floor(y / CELL);
  for (let gy = cy - reach; gy <= cy + reach; gy += 1) {
    for (let gx = cx - reach; gx <= cx + reach; gx += 1) {
      if (gx < 0 || gy < 0 || gx >= gridColumns || gy >= gridRows) continue;
      const dx = (gx + .5) * CELL - x;
      const dy = (gy + .5) * CELL - y;
      if (dx * dx + dy * dy > radius * radius) continue;
      const index = gy * gridColumns + gx;
      if (!grid[index]) { grid[index] = 1; cleared += 1; }
    }
  }
}

const brush = () => Math.max(30, Math.min(stage.clientWidth, stage.clientHeight) * .085);
function scratch(from, to) {
  const radius = brush();
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(distance / (radius * .35)));
  context.globalCompositeOperation = "destination-out";
  for (let i = 1; i <= steps; i += 1) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    const soft = context.createRadialGradient(x, y, radius * .45, x, y, radius);
    soft.addColorStop(0, "rgba(0,0,0,1)");
    soft.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = soft;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    markCoverage(x, y, radius * .8);
  }
  context.globalCompositeOperation = "source-over";
}

// Copper flakes curl away from the fingertip.
let lastFlake = 0;
function shed(point) {
  const now = performance.now();
  if (now - lastFlake < 45 || reduced.matches) return;
  lastFlake = now;
  const flake = document.createElement("span");
  flake.className = "pc-flake";
  flake.style.cssText = `left:${point.x}px;top:${point.y}px;--s:${(3 + Math.random() * 4).toFixed(1)}px;--dx:${(Math.random() * 60 - 30).toFixed(0)}px;--dy:${(40 + Math.random() * 70).toFixed(0)}px;--r:${(Math.random() * 540 - 270).toFixed(0)}deg`;
  stage.append(flake);
  flake.addEventListener("animationend", () => flake.remove(), { once: true });
}

// The film starts buffering on the first touch, so it is ready by the reveal.
// The runtime attaches its own listeners only when the film is opened.
let warmed = false;
function warmFilm() {
  const video = document.getElementById("openingVideo");
  if (warmed || !video || saveData) return;
  warmed = true;
  video.preload = "auto";
  video.load();
}

let pointer = null;
let ticks = 0;
const local = (event) => { const box = canvas.getBoundingClientRect(); return { x: event.clientX - box.left, y: event.clientY - box.top }; };
function onDown(event) {
  if (revealed || intro.classList.contains("is-opening")) return;
  pointer = local(event);
  canvas.setPointerCapture?.(event.pointerId);
  warmFilm();
  stage.classList.add("pc-scratching");
  scratch(pointer, pointer);
}
function onMove(event) {
  if (!pointer || revealed) return;
  const point = local(event);
  scratch(pointer, point);
  shed(point);
  if (navigator.vibrate && (ticks += 1) % 9 === 0) navigator.vibrate(4);
  pointer = point;
  if (cleared / grid.length >= REVEAL_AT) reveal();
}
function onUp() {
  pointer = null;
  // Starting the film inside the release keeps the browser's user activation,
  // so the opening film and the music may begin with sound permissions intact.
  if (pendingOpen) { pendingOpen = false; openButton.click(); }
}
function reveal() {
  if (revealed) return;
  revealed = true;
  pendingOpen = true;
  stage.classList.add("pc-revealing");
  if (navigator.vibrate) navigator.vibrate([8, 40, 12]);
}

if (context) {
  paintFoil();
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  // A plain tap on the foil scratches; it must not open the invitation.
  canvas.addEventListener("click", event => event.stopPropagation());
  let resizeTimer = 0;
  const repaint = () => { if (!revealed && !pointer) paintFoil(); };
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(repaint, 150); });
  // Fonts change nothing on the canvas, but the stage can change size once
  // the mobile browser chrome settles.
  window.visualViewport?.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(repaint, 150); });
} else if (canvas) {
  canvas.remove();
}
// Tapping "Or tap to open" also lifts the foil so the film is not hidden.
openButton?.addEventListener("click", () => { if (!revealed) { revealed = true; stage.classList.add("pc-revealing"); } }, true);

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

/* ---------- Living courtyard behind the hero ---------- */
const film = document.getElementById("pcHeroFilm");
const saveData = navigator.connection?.saveData === true;
let filmObserver = null;
if (film && "IntersectionObserver" in window) {
  const sources = [...film.querySelectorAll("source[data-src]")];
  if (compact()) film.poster = `${root}courtyard-portrait.webp`;
  const canPlay = () => !reduced.matches && !saveData && !document.hidden && body.classList.contains("invitation-open");
  let visible = false;
  const sync = () => {
    if (visible && canPlay()) {
      if (sources.length && !sources[0].src) { sources.forEach(item => { item.src = item.dataset.src; }); film.load(); }
      film.play()?.catch(() => {});
    } else if (!film.paused) {
      film.pause();
    }
  };
  filmObserver = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); sync(); });
  filmObserver.observe(document.getElementById("heroSection"));
  reduced.addEventListener("change", sync);
  document.addEventListener("visibilitychange", sync);
  new MutationObserver(sync).observe(body, { attributes: true, attributeFilter: ["class"] });
}

/* ---------- Entrances ---------- */
let observer;
function observeSections() {
  observer?.disconnect();
  document.querySelectorAll(".pc-arrival").forEach(node => node.classList.remove("pc-arrival"));
  const canAnimate = !reduced.matches && "IntersectionObserver" in window;
  body.classList.toggle("pc-motion", canAnimate);
  if (!canAnimate) return;
  observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting || !body.classList.contains("invitation-open")) return;
      entry.target.classList.add("pc-arrival");
      observer.unobserve(entry.target);
    });
  }, { threshold: .1, rootMargin: "0px 0px -6% 0px" });
  document.querySelectorAll(".section-frame").forEach(node => observer.observe(node));
}
observeSections();
reduced.addEventListener("change", observeSections);
const scheduleMount = document.getElementById("scheduleMount");
const scheduleObserver = "IntersectionObserver" in window ? new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add("pc-schedule-arrival");
    scheduleObserver.unobserve(entry.target);
  });
}, { threshold: .2 }) : null;
const observeSchedule = () => scheduleMount?.querySelectorAll(".schedule-item:not(.pc-schedule-arrival)").forEach(item => scheduleObserver?.observe(item));
const scheduleChanges = new MutationObserver(observeSchedule);
if (scheduleMount) scheduleChanges.observe(scheduleMount, { childList: true });
observeSchedule();

// The floating action hides while its own target (hero or RSVP) is on screen.
const actionObserver = "IntersectionObserver" in window ? new IntersectionObserver(entries => {
  for (const entry of entries) body.classList.toggle(entry.target.id === "rsvpSection" ? "pc-rsvp-visible" : "pc-hero-visible", entry.isIntersecting);
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
  [filmObserver, observer, scheduleObserver, actionObserver].forEach(item => item?.disconnect());
  [scheduleChanges, opened, namesObserver, languageObserver].forEach(item => item.disconnect());
}, { once: true });
}
