const root = "./invitations/wedding-designs/moonlit-conservatory/assets/";
globalThis.invitationDesignConfig = {
  languageStorageKey: "moonlit-conservatory-language",
  finishAt: 4.8,
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

// A short, once-only entrance for each content group; all content is visible
// without this enhancement. No scroll handlers or continuous rendering loops.
let observer;
function observeSections() {
  observer?.disconnect();
  document.querySelectorAll(".moon-arrival").forEach(node => node.classList.remove("moon-arrival"));
  if (reduced.matches || !("IntersectionObserver" in window)) return;
  observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting || !body.classList.contains("invitation-open")) return;
      entry.target.classList.add("moon-arrival");
      observer.unobserve(entry.target);
    });
  }, { threshold: .12 });
  document.querySelectorAll(".section-frame").forEach(node => observer.observe(node));
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
window.addEventListener("pagehide", () => { observer?.disconnect(); opened.disconnect(); actionObserver?.disconnect(); }, { once: true });
}
