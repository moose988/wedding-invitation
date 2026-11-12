const root = "./invitations/wedding-designs/moonlit-conservatory/assets/";
globalThis.invitationDesignConfig = {
  languageStorageKey: "moonlit-conservatory-language",
  finishAt: 5.8,
  chairArtwork: `${root}chair.svg`,
  rtl: true,
  requireReady: true,
  prefillSavedRsvp: true,
  skipOpening: () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  scrollBehavior: () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.body.classList.contains("keyboard-navigation") ? "instant" : "smooth",
  copy: {
    heroKicker: { en: "Together, under the stars", ar: "معاً، تحت النجوم" },
    openInvitation: { en: "Enter the celebration", ar: "ادخلوا إلى الاحتفال" },
    introCaption: { en: "A little moonlight. A lifetime of love.", ar: "قليل من ضوء القمر، وعمر من الحب." },
    videoLabel: { en: "A journey into the moonlit conservatory", ar: "رحلة إلى الحديقة في ضوء القمر" },
    countdownHeading: { en: "Every moment, a little closer.", ar: "كل لحظة، نقترب أكثر." },
    detailsHeading: { en: "Meet us in the moonlight.", ar: "نلتقي في ضوء القمر." },
    scheduleHeading: { en: "The evening unfolds.", ar: "فصول أمسيتنا." },
    seatingHeading: { en: "Your place in our story.", ar: "مكانكم في حكايتنا." },
    rsvpHeading: { en: "The night needs you.", ar: "بحضوركم تكتمل ليلتنا." },
    attendanceDeclined: { en: "You'll be missed.", ar: "سنفتقد حضوركم." },
    closing: { en: "With you, under the stars.", ar: "بكم تضيء ليلتنا." },
    passHeading: { en: "Your evening starts here.", ar: "أمسيتكم تبدأ هنا." },
    viewDetails: { en: "Explore the evening", ar: "اكتشفوا الأمسية" },
  },
  // Fictional preview only. Live contexts replace these fields in the shared runtime.
  demoWedding: {
    coupleName: "Nour & Adam", brideName: "Nour", groomName: "Adam", brideNameAr: "نور", groomNameAr: "آدم",
    subtitleEn: "Together with our families, we invite you to celebrate our wedding.",
    subtitleAr: "بمشاركة أهلنا، ندعوكم للاحتفال بزفافنا.",
    invitationMessageEn: "An evening of warm embraces, familiar faces, and a beautiful beginning. We would love you to be part of it.",
    invitationMessageAr: "أمسية من اللقاءات الدافئة والوجوه المحببة وبداية جميلة. يسعدنا أن تكونوا جزءاً منها.",
    closingEn: "With you, under the stars.",
    closingAr: "بكم تضيء ليلتنا.",
    venueEn: "The Glasshouse", venueAr: "البيت الزجاجي", locationEn: "Dubai, United Arab Emirates", locationAr: "دبي، الإمارات العربية المتحدة",
    eventDateISO: "2027-02-20T19:00:00+04:00", timeEn: "7:00 PM", timeAr: "٧:٠٠ مساءً",
    mapsUrl: "https://www.google.com/maps/search/?api=1&query=Dubai", venueMapEmbedUrl: "https://www.google.com/maps?q=Dubai&output=embed",
  },
};

await import("../../../script.js?v=20261019-arabic-schedule-1");

// The shared runtime replaces the document with an accessible error for an
// incomplete link. Only enhance a successfully mounted invitation shell.
if (document.getElementById("introScreen") && document.getElementById("siteContent")) {
// Local review only: lets automated layout inspection start beyond the cover.
if (["127.0.0.1", "localhost"].includes(location.hostname) && new URLSearchParams(location.search).get("review") === "1") {
  document.getElementById("skipOpening").click();
}

const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const body = document.body;
const intro = document.getElementById("introScreen");
let focused = false;
const settleCover = () => {
  if (!body.classList.contains("invitation-open") || focused) return;
  focused = true;
  // The dismissed cover must leave both the tab order and accessibility tree.
  intro.inert = true;
  intro.setAttribute("aria-hidden", "true");
  document.getElementById("heroSection").setAttribute("tabindex", "-1");
  document.getElementById("heroSection").focus({ preventScroll: true });
};
const opened = new MutationObserver(settleCover);
opened.observe(body, { attributes: true, attributeFilter: ["class"] });
settleCover();

// Decorative night sky: stars, fireflies, falling jasmine petals and a rare
// shooting star. Pure CSS animation of transform/opacity, behind the content.
const sky = document.createElement("div");
sky.className = "moon-sky";
sky.setAttribute("aria-hidden", "true");
const random = (min, max) => min + Math.random() * (max - min);
const fx = document.createElement("div");
fx.className = "moon-sky__fx";
const compact = matchMedia("(max-width: 760px)").matches;
for (let index = 0; index < (compact ? 10 : 16); index += 1) {
  const fly = document.createElement("span");
  fly.className = "moon-firefly";
  fly.style.cssText = `--x:${random(2, 96)}%;--y:${random(20, 96)}%;--s:${random(3, 6).toFixed(1)}px;--d:${random(10, 20).toFixed(1)}s;--delay:${random(-20, 0).toFixed(1)}s;--dx:${random(-60, 60).toFixed(0)}px;--dy:${random(-80, -20).toFixed(0)}px`;
  fx.append(fly);
}
for (let index = 0; index < (compact ? 7 : 12); index += 1) {
  const petal = document.createElement("span");
  petal.className = "moon-petal";
  petal.style.cssText = `--x:${random(0, 100)}%;--s:${random(8, 15).toFixed(1)}px;--d:${random(16, 28).toFixed(1)}s;--delay:${random(-28, 0).toFixed(1)}s;--sway:${random(-90, 90).toFixed(0)}px`;
  fx.append(petal);
}
const shooting = document.createElement("span");
shooting.className = "moon-shooting";
fx.append(shooting);
const stars = document.createElement("div");
stars.className = "moon-sky__stars";
sky.append(stars, fx);
body.prepend(sky);
// Hidden tabs do not need to animate the sky.
document.addEventListener("visibilitychange", () => { sky.style.visibility = document.hidden ? "hidden" : ""; });

// Stack the couple's names with a calligraphic ampersand. The shared runtime
// rewrites these nodes on every refresh or language change, so re-apply then.
const ornamentNames = (node) => {
  if (!node || node.querySelector(".moon-name")) return;
  const text = node.textContent.trim();
  const parts = text.split(/\s+(&|و)\s+/);
  if (parts.length !== 3 || !parts[0] || !parts[2]) return;
  const make = (className, value) => { const span = document.createElement("span"); span.className = className; span.textContent = value; return span; };
  const amp = make("moon-amp", parts[1]);
  amp.setAttribute("aria-hidden", "true");
  const label = make("moon-sr", ` ${parts[1] === "&" ? "and" : "و"} `);
  label.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)";
  node.replaceChildren(make("moon-name", parts[0]), amp, label, make("moon-name", parts[2]));
};
const nameNodes = ["heroEnglishNames", "heroArabicNames"].map(id => document.getElementById(id));
const namesObserver = new MutationObserver(() => nameNodes.forEach(ornamentNames));
nameNodes.forEach(node => { if (node) { ornamentNames(node); namesObserver.observe(node, { childList: true, characterData: true, subtree: true }); } });

// A once-only entrance for each content group. Content is only hidden before
// its entrance when the browser can actually run it (moon-motion).
let observer;
function observeSections() {
  observer?.disconnect();
  document.querySelectorAll(".moon-arrival").forEach(node => node.classList.remove("moon-arrival"));
  const canAnimate = !reduced.matches && "IntersectionObserver" in window;
  body.classList.toggle("moon-motion", canAnimate);
  if (!canAnimate) return;
  observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting || !body.classList.contains("invitation-open")) return;
      entry.target.classList.add("moon-arrival");
      observer.unobserve(entry.target);
    });
  }, { threshold: .12, rootMargin: "0px 0px -6% 0px" });
  document.querySelectorAll(".section-frame, .qd-footer").forEach(node => observer.observe(node));
}
observeSections();
reduced.addEventListener("change", observeSections);
const actionObserver = "IntersectionObserver" in window ? new IntersectionObserver(entries => {
  for (const entry of entries) {
    body.classList.toggle(entry.target.id === "rsvpSection" ? "moon-rsvp-visible" : "hero-actions-visible", entry.isIntersecting);
  }
}, { threshold:.05 }) : null;
actionObserver?.observe(document.getElementById("heroSection"));
actionObserver?.observe(document.getElementById("rsvpSection"));
document.querySelector(".skip-link").addEventListener("click", event => {
  event.preventDefault();
  document.getElementById("skipOpening").click();
});
// Stop scroll animation for keyboard navigation; focus reaches its target at once.
document.addEventListener("keydown", () => body.classList.add("keyboard-navigation"));
document.addEventListener("pointerdown", () => body.classList.remove("keyboard-navigation"));
// Details background film. It loads only when the section is close, plays
// only while visible, and stays a still poster for reduced motion or Save-Data.
const detailsVideo = document.getElementById("detailsBackdropVideo");
const saveData = navigator.connection?.saveData === true;
let detailsObserver = null;
if (detailsVideo && "IntersectionObserver" in window) {
  const source = detailsVideo.querySelector("source[data-src]");
  const canPlay = () => !reduced.matches && !saveData && !document.hidden && body.classList.contains("invitation-open");
  let visible = false;
  const sync = () => {
    if (visible && canPlay()) {
      if (source && !source.src) { source.src = source.dataset.src; detailsVideo.load(); }
      detailsVideo.play()?.catch(() => {});
    } else if (!detailsVideo.paused) {
      detailsVideo.pause();
    }
  };
  detailsObserver = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); sync(); }, { rootMargin: "200px 0px" });
  detailsObserver.observe(document.getElementById("detailsSection"));
  reduced.addEventListener("change", sync);
  document.addEventListener("visibilitychange", sync);
  new MutationObserver(sync).observe(body, { attributes: true, attributeFilter: ["class"] });
}
window.addEventListener("pagehide", () => { detailsObserver?.disconnect(); observer?.disconnect(); opened.disconnect(); actionObserver?.disconnect(); namesObserver.disconnect(); }, { once: true });
}
