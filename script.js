const invitationData = {
  bride: {
    ar: "ليان",
    en: "Layan",
  },
  groom: {
    ar: "محمد",
    en: "Mohammed",
  },
  subtitle: {
    ar: "بكل الحب ندعوكم لمشاركتنا فرحة العمر",
    en: "With love, we invite you to celebrate our special day",
  },
  invitationMessage: {
    ar: "في مساء يفيض حباً وطمأنينة، نتشرف بحضوركم لتشهدوا معنا بداية فصل جديد من العمر.",
    en: "On an evening filled with love and grace, we would be honored by your presence as we begin a beautiful new chapter together.",
  },
  weddingDateISO: "2026-12-20T20:00:00+04:00",
  eventDurationHours: 4,
  time: {
    ar: "الساعة ٨:٠٠ مساءً",
    en: "8:00 PM",
  },
  venue: {
    ar: "قاعة اللؤلؤة، دبي",
    en: "Pearl Ballroom, Dubai",
  },
  location: {
    ar: "دبي، الإمارات العربية المتحدة",
    en: "Dubai, United Arab Emirates",
  },
  dressCode: {
    ar: "رسمي / ألوان هادئة",
    en: "Formal / Soft Neutral Colors",
  },
  closing: {
    ar: "حضوركم يزيد فرحتنا",
    en: "Your presence makes our joy complete",
  },
  actions: {
    rsvp: "RSVP",
    location: "View Location",
    calendar: "Add to Calendar",
  },
  rsvp: {
    nameLabel: "Guest name",
    guestCountLabel: "Number of guests",
    submitLabel: "Send RSVP",
    editLabel: "Edit RSVP",
    savedTitle: "Your reply has been saved",
    savedCopy: "Thank you. Your response is stored on this device for now.",
  },
  mapsUrl: "https://maps.app.goo.gl/8QDgAnwByyYeUt2i9",
  media: {
    audio: "./music/wedding.mp3",
    coupleImage: "./images/couple.jpg",
  },
};

const icons = {
  date: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5.5" width="17" height="15" rx="2.5"></rect>
      <path d="M7 3.5v4M17 3.5v4M3.5 9.5h17"></path>
    </svg>
  `,
  time: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5"></circle>
      <path d="M12 7.5v5l3 2"></path>
    </svg>
  `,
  venue: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.5 19.5h15M7 19.5V8.5l5-3 5 3v11M9.5 11.5h.01M14.5 11.5h.01M9.5 15.5h.01M14.5 15.5h.01"></path>
    </svg>
  `,
  location: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21s6-5.3 6-11a6 6 0 1 0-12 0c0 5.7 6 11 6 11Z"></path>
      <circle cx="12" cy="10" r="2.5"></circle>
    </svg>
  `,
  reply: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.5 6.5h15v11h-15z"></path>
      <path d="m5 7 7 6 7-6"></path>
    </svg>
  `,
  calendar: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5.5" width="16" height="15" rx="2.5"></rect>
      <path d="M8 3.5v4M16 3.5v4M4 10h16M8 14h3M13 14h3M8 17h3"></path>
    </svg>
  `,
};

const introLabels = ["Open Invitation", "افتح الدعوة"];
const rsvpStorageKey = "layan-mohammed-rsvp";

const introScreen = document.getElementById("introScreen");
const openInvitationButton = document.getElementById("openInvitation");
const openInvitationLabel = document.getElementById("openInvitationLabel");
const openInvitationLabelPrimary = document.getElementById("openInvitationLabelPrimary");
const openInvitationLabelSecondary = document.getElementById("openInvitationLabelSecondary");
const weddingAudio = document.getElementById("weddingAudio");
const musicToggle = document.getElementById("musicToggle");
const musicToggleLabel = musicToggle?.querySelector(".music-toggle__label");
const heroBackdrop = document.getElementById("heroBackdrop");
const stickyActions = document.getElementById("stickyActions");
const introAnimationDuration = 1450;
const reducedMotionIntroDuration = 180;

let labelIndex = 0;
let countdownTimer;
let musicAvailable = true;
let isRsvpEditing = false;
let invitationOpening = false;
let lastMobileScrollY = 0;
let activeIntroLabelSlot = 0;

document.body.classList.add("intro-active");

populateInvitation();
setupIntroLabelSwap();
setupRevealObserver();
setupCountdown();
setupAudioState();
setupStickyFooterAwareness();

openInvitationButton.addEventListener("click", handleOpenInvitation);

async function handleOpenInvitation() {
  if (invitationOpening) {
    return;
  }

  invitationOpening = true;
  openInvitationButton.disabled = true;
  document.body.classList.add("intro-opening");

  playWeddingMusicFromGesture();
  await waitForIntroAnimation();
  revealInvitation();
}

function revealInvitation() {
  document.body.classList.remove("intro-active");
  document.body.classList.add("invitation-open");
  introScreen.classList.add("is-hidden");
  musicToggle.hidden = false;
  stickyActions.hidden = false;

  window.setTimeout(() => {
    document.body.classList.remove("intro-opening");
  }, 480);
}

async function playWeddingMusicFromGesture() {
  if (musicAvailable) {
    try {
      weddingAudio.currentTime = 0;
      await weddingAudio.play();
      setMusicToggleState("playing", "Stop", "Stop wedding music");
    } catch (error) {
      setMusicToggleState("paused", "Play", "Play wedding music");
    }
  } else {
    setMusicToggleState("unavailable", "Off", "Wedding music unavailable");
  }
}

function waitForIntroAnimation() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const duration = reduceMotion ? reducedMotionIntroDuration : introAnimationDuration;
  return new Promise((resolve, reject) => {
    window.setTimeout(resolve, duration);
  });
}

musicToggle.addEventListener("click", async () => {
  if (!musicAvailable) {
    return;
  }

  if (weddingAudio.paused) {
    try {
      await weddingAudio.play();
      setMusicToggleState("playing", "Stop", "Stop wedding music");
    } catch (error) {
      setMusicToggleState("paused", "Play", "Play wedding music");
    }
    return;
  }

  weddingAudio.pause();
  setMusicToggleState("paused", "Play", "Play wedding music");
});

document.addEventListener("click", (event) => {
  const calendarButton = event.target.closest("[data-calendar-download]");
  if (calendarButton) {
    downloadCalendarFile();
  }

  const rsvpTrigger = event.target.closest("[data-scroll-rsvp]");
  if (rsvpTrigger) {
    scrollToRsvp();
  }

  const editButton = event.target.closest("[data-edit-rsvp]");
  if (editButton) {
    isRsvpEditing = true;
    renderRsvp();
  }
});

function populateInvitation() {
  const englishNames = `${invitationData.bride.en} & ${invitationData.groom.en}`;
  const arabicNames = `${invitationData.bride.ar} و ${invitationData.groom.ar}`;

  document.title = `${englishNames} | Wedding Invitation`;
  setText("heroArabicNames", arabicNames);
  setText("heroEnglishNames", englishNames);
  setText("heroSubtitleArabic", invitationData.subtitle.ar);
  setText("heroSubtitleEnglish", invitationData.subtitle.en);
  setText("invitationMessageArabic", invitationData.invitationMessage.ar);
  setText("invitationMessageEnglish", invitationData.invitationMessage.en);
  setText("closingArabic", invitationData.closing.ar);
  setText("closingEnglish", invitationData.closing.en);

  if (heroBackdrop) {
    heroBackdrop.style.backgroundImage = `url("${invitationData.media.coupleImage}")`;
  }

  renderActions();
  renderCountdownCards();
  renderDetails();
  renderRsvp();
}

function renderActions() {
  const actionMarkup = `
    <button class="luxury-button luxury-button--primary" type="button" data-scroll-rsvp>
      ${icons.reply}<span>${invitationData.actions.rsvp}</span>
    </button>
    <a class="luxury-button luxury-button--secondary" href="${invitationData.mapsUrl}" target="_blank" rel="noopener noreferrer">
      ${icons.location}<span>${invitationData.actions.location}</span>
    </a>
    <button class="luxury-button luxury-button--ghost" type="button" data-calendar-download>
      ${icons.calendar}<span>${invitationData.actions.calendar}</span>
    </button>
  `;

  if (stickyActions) {
    stickyActions.innerHTML = actionMarkup;
  }
}

function setupIntroLabelSwap() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  syncIntroLabel(openInvitationLabelPrimary, 0);
  syncIntroLabel(openInvitationLabelSecondary, 1);
  openInvitationLabelSecondary.classList.remove("is-active");

  if (reduceMotion) {
    return;
  }

  window.setInterval(() => {
    labelIndex = (labelIndex + 1) % introLabels.length;
    const nextSlot = activeIntroLabelSlot === 0 ? 1 : 0;
    const nextNode = nextSlot === 0 ? openInvitationLabelPrimary : openInvitationLabelSecondary;
    const currentNode = nextSlot === 0 ? openInvitationLabelSecondary : openInvitationLabelPrimary;

    syncIntroLabel(nextNode, labelIndex);
    nextNode.classList.add("is-active");
    currentNode.classList.remove("is-active");
    activeIntroLabelSlot = nextSlot;
  }, 2600);
}

function syncIntroLabel(node, nextLabelIndex) {
  if (!node) {
    return;
  }

  const isArabic = nextLabelIndex === 1;
  node.textContent = introLabels[nextLabelIndex];
  node.lang = isArabic ? "ar" : "en";
  node.dir = isArabic ? "rtl" : "ltr";
}

function renderCountdownCards() {
  const grid = document.getElementById("countdownGrid");
  const units = [
    { key: "days", en: "Days", ar: "يوم" },
    { key: "hours", en: "Hours", ar: "ساعة" },
    { key: "minutes", en: "Minutes", ar: "دقيقة" },
    { key: "seconds", en: "Seconds", ar: "ثانية" },
  ];

  grid.innerHTML = units
    .map(
      (unit) => `
        <article class="countdown-card">
          <span class="countdown-card__value" data-unit="${unit.key}" data-value="00">00</span>
          <div class="countdown-card__label">
            <span>${unit.en}</span>
            <span class="rtl-copy" lang="ar" dir="rtl">${unit.ar}</span>
          </div>
        </article>
      `
    )
    .join("");
}

function setupCountdown() {
  updateCountdown();
  countdownTimer = window.setInterval(updateCountdown, 1000);
}

function updateCountdown() {
  const target = new Date(invitationData.weddingDateISO).getTime();
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
    if (node.dataset.value === nextValue) {
      return;
    }

    node.dataset.value = nextValue;
    node.textContent = nextValue;

    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      node.classList.remove("is-ticking");
      void node.offsetWidth;
      node.classList.add("is-ticking");
    }
  });

  if (remaining === 0 && countdownTimer) {
    window.clearInterval(countdownTimer);
  }
}

function renderDetails() {
  const detailCards = [
    {
      icon: icons.date,
      title: "Date",
      en: formatDate(invitationData.weddingDateISO),
      ar: formatArabicDate(invitationData.weddingDateISO),
    },
    {
      icon: icons.location,
      title: "Location",
      en: invitationData.location.en,
      ar: invitationData.location.ar,
      action: `
        <a class="detail-card__action" href="${invitationData.mapsUrl}" target="_blank" rel="noopener noreferrer">
          ${icons.location}<span>${invitationData.actions.location}</span>
        </a>
      `,
    },
  ];

  const cardsMarkup = detailCards
    .map((detail) => {
      const copy = `
        <p class="detail-card__english">${detail.en}</p>
        <p class="detail-card__arabic rtl-copy" lang="ar" dir="rtl">${detail.ar}</p>
        ${detail.action ?? ""}
      `;

      return `
        <article class="detail-card">
          <div class="detail-card__icon">${detail.icon}</div>
          <h3 class="detail-card__title">${detail.title}</h3>
          ${copy}
        </article>
      `;
    })
    .join("");

  document.getElementById("detailsGrid").innerHTML = `
    ${cardsMarkup}
    <div class="details-calendar">
      <button class="detail-card__action" type="button" data-calendar-download>
        ${icons.calendar}<span>${invitationData.actions.calendar}</span>
      </button>
    </div>
  `;
}

function renderRsvp() {
  const mount = document.getElementById("rsvpMount");
  if (!mount) {
    return;
  }

  const saved = readSavedRsvp();
  if (saved && !isRsvpEditing) {
    mount.innerHTML = `
      <div class="rsvp-summary" aria-live="polite">
        <p class="rsvp-summary__eyebrow">${saved.status}</p>
        <h3>${invitationData.rsvp.savedTitle}</h3>
        <p>${invitationData.rsvp.savedCopy}</p>
        ${saved.name ? `<p class="rsvp-summary__detail"><strong>Name:</strong> ${escapeHtml(saved.name)}</p>` : ""}
        ${saved.guests ? `<p class="rsvp-summary__detail"><strong>Guests:</strong> ${escapeHtml(saved.guests)}</p>` : ""}
        <button class="luxury-button luxury-button--secondary" type="button" data-edit-rsvp>
          <span>${invitationData.rsvp.editLabel}</span>
        </button>
      </div>
    `;
    return;
  }

  mount.innerHTML = `
    <form class="rsvp-form" id="rsvpForm">
      <div class="rsvp-phases">
        <section class="rsvp-phase" data-rsvp-step="1">
          <p class="rsvp-phase__number">01</p>
          <h3>Are you attending?</h3>
          <div class="rsvp-choice" role="radiogroup" aria-label="Attendance">
            <label class="rsvp-answer">
              <input type="radio" name="status" value="Yes" ${saved?.status === "Yes" ? "checked" : ""} required />
              <span>Yes</span>
            </label>
            <label class="rsvp-answer">
              <input type="radio" name="status" value="No" ${saved?.status === "No" ? "checked" : ""} required />
              <span>No</span>
            </label>
          </div>
        </section>
        <section class="rsvp-phase" data-rsvp-step="2" ${saved?.status ? "" : "hidden"}>
          <p class="rsvp-phase__number">02</p>
          <h3>Your name</h3>
          <label class="rsvp-input-line">
            <span class="sr-only">${invitationData.rsvp.nameLabel}</span>
            <input name="name" type="text" autocomplete="name" placeholder="Name" value="${escapeAttribute(saved?.name || "")}" required />
          </label>
          <button class="luxury-button luxury-button--secondary rsvp-next" type="button" data-rsvp-next="3">
            <span>Continue</span>
          </button>
        </section>
        <section class="rsvp-phase" data-rsvp-step="3" ${saved?.name ? "" : "hidden"}>
          <p class="rsvp-phase__number">03</p>
          <h3>How many guests?</h3>
          <label class="rsvp-input-line rsvp-input-line--compact">
            <span class="sr-only">${invitationData.rsvp.guestCountLabel}</span>
            <input name="guests" type="number" min="0" max="10" inputmode="numeric" placeholder="1" value="${escapeAttribute(saved?.guests || "1")}" required />
          </label>
        </section>
      </div>
      <button class="luxury-button luxury-button--primary rsvp-form__submit" type="submit" ${saved?.name ? "" : "hidden"}>
        ${icons.reply}<span>${invitationData.rsvp.submitLabel}</span>
      </button>
      <p class="rsvp-form__status" id="rsvpStatus" aria-live="polite"></p>
    </form>
  `;

  const form = document.getElementById("rsvpForm");
  form.addEventListener("submit", handleRsvpSubmit);
  setupRsvpPhases(form);
}

function handleRsvpSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const finalStep = form.querySelector('[data-rsvp-step="3"]');
  const nameStep = form.querySelector('[data-rsvp-step="2"]');
  const submitButton = form.querySelector(".rsvp-form__submit");
  const statusValue = form.elements.status.value;

  if (statusValue === "No") {
    const response = {
      status: statusValue,
      name: "",
      guests: "0",
      savedAt: new Date().toISOString(),
    };

    localStorage.setItem(rsvpStorageKey, JSON.stringify(response));
    isRsvpEditing = false;
    renderRsvp();
    return;
  }

  if (nameStep && (nameStep.hidden || finalStep?.hidden || submitButton?.hidden)) {
    if (form.elements.name.reportValidity()) {
      nameStep.hidden = false;
      finalStep.hidden = false;
      submitButton.hidden = false;
      form.elements.guests.focus();
    }
    return;
  }

  const formData = new FormData(form);
  const response = {
    status: formData.get("status"),
    name: String(formData.get("name") || "").trim(),
    guests: String(formData.get("guests") || "").trim(),
    savedAt: new Date().toISOString(),
  };

  localStorage.setItem(rsvpStorageKey, JSON.stringify(response));
  isRsvpEditing = false;
  renderRsvp();
}

function setupRsvpPhases(form) {
  const statusInputs = form.querySelectorAll('input[name="status"]');
  const nameInput = form.elements.name;
  const guestsInput = form.elements.guests;
  const nameStep = form.querySelector('[data-rsvp-step="2"]');
  const guestStep = form.querySelector('[data-rsvp-step="3"]');
  const submitButton = form.querySelector(".rsvp-form__submit");

  const revealStep = (step, focusTarget) => {
    const section = form.querySelector(`[data-rsvp-step="${step}"]`);
    if (!section || !section.hidden) {
      return;
    }

    section.hidden = false;
    window.requestAnimationFrame(() => {
      section.classList.add("is-visible");
      focusTarget?.focus();
    });
  };

  const hideStep = (section) => {
    if (!section) {
      return;
    }

    section.hidden = true;
    section.classList.remove("is-visible");
  };

  const updateRsvpFlow = (statusValue) => {
    if (statusValue === "Yes") {
      nameInput.required = true;
      guestsInput.required = true;
      revealStep("2", nameInput);
      return;
    }

    nameInput.required = false;
    guestsInput.required = false;
    nameInput.value = "";
    guestsInput.value = "0";
    hideStep(nameStep);
    hideStep(guestStep);
    submitButton.hidden = statusValue !== "No";
  };

  statusInputs.forEach((input) => {
    input.addEventListener("change", () => updateRsvpFlow(input.value));
  });

  form.querySelector("[data-rsvp-next]")?.addEventListener("click", () => {
    if (!nameInput.reportValidity()) {
      return;
    }

    revealStep("3", guestsInput);
    submitButton.hidden = false;
  });

  const selectedStatus = Array.from(statusInputs).find((input) => input.checked)?.value;
  if (selectedStatus) {
    updateRsvpFlow(selectedStatus);
  } else {
    nameInput.required = false;
    guestsInput.required = false;
    submitButton.hidden = true;
  }
}

function readSavedRsvp() {
  try {
    const saved = localStorage.getItem(rsvpStorageKey);
    return saved ? JSON.parse(saved) : null;
  } catch (error) {
    return null;
  }
}

function setupRevealObserver() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const revealItems = document.querySelectorAll(".reveal");

  if (reduceMotion) {
    revealItems.forEach((item) => item.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
  );

  revealItems.forEach((item) => observer.observe(item));
}

function setupAudioState() {
  weddingAudio.addEventListener("error", () => {
    musicAvailable = false;
    setMusicToggleState("unavailable", "Off", "Wedding music unavailable");
  });

  weddingAudio.addEventListener("pause", () => {
    if (musicAvailable && document.body.classList.contains("invitation-open")) {
      setMusicToggleState("paused", "Play", "Play wedding music");
    }
  });

  weddingAudio.addEventListener("play", () => {
    if (musicAvailable) {
      setMusicToggleState("playing", "Stop", "Stop wedding music");
    }
  });
}

function setupStickyFooterAwareness() {
  const closing = document.querySelector(".closing-card");
  if (!stickyActions || !closing || !("IntersectionObserver" in window)) {
    return;
  }

  const observer = new IntersectionObserver(
    ([entry]) => {
      stickyActions.classList.toggle("is-soft-hidden", entry.isIntersecting);
    },
    { threshold: 0.35 }
  );

  observer.observe(closing);
  setupMobileStickyFooterScroll();
}

function setupMobileStickyFooterScroll() {
  const mobileQuery = window.matchMedia("(max-width: 699px)");

  const updateMobileFooterState = () => {
    if (!stickyActions) {
      return;
    }

    if (!mobileQuery.matches) {
      stickyActions.classList.remove("is-scroll-hidden");
      lastMobileScrollY = window.scrollY;
      return;
    }

    const currentScrollY = window.scrollY;
    const scrollDelta = currentScrollY - lastMobileScrollY;

    if (currentScrollY < 24 || scrollDelta < -8) {
      stickyActions.classList.remove("is-scroll-hidden");
    } else if (scrollDelta > 10) {
      stickyActions.classList.add("is-scroll-hidden");
    }

    lastMobileScrollY = currentScrollY;
  };

  lastMobileScrollY = window.scrollY;
  window.addEventListener("scroll", updateMobileFooterState, { passive: true });
  mobileQuery.addEventListener("change", updateMobileFooterState);
  updateMobileFooterState();
}

function setMusicToggleState(state, label, ariaLabel) {
  musicToggle.dataset.state = state;
  musicToggleLabel.textContent = label;
  musicToggle.setAttribute("aria-label", ariaLabel);
}

function scrollToRsvp() {
  document.getElementById("rsvpSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function downloadCalendarFile() {
  const start = new Date(invitationData.weddingDateISO);
  const end = new Date(start.getTime() + invitationData.eventDurationHours * 60 * 60 * 1000);
  const names = `${invitationData.bride.en} & ${invitationData.groom.en}`;
  const description = `${invitationData.invitationMessage.en}\\n${invitationData.venue.en}\\n${invitationData.mapsUrl}`;
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Layan Mohammed Wedding//Invitation//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${Date.now()}-layan-mohammed-wedding`,
    `DTSTAMP:${toIcsDate(new Date())}`,
    `DTSTART:${toIcsDate(start)}`,
    `DTEND:${toIcsDate(end)}`,
    `SUMMARY:${escapeIcs(`${names} Wedding`)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    `LOCATION:${escapeIcs(`${invitationData.venue.en}, ${invitationData.location.en}`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "layan-mohammed-wedding.ics";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function toIcsDate(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeIcs(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) {
    node.textContent = value;
  }
}

function formatDate(dateISO) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(dateISO));
}

function formatArabicDate(dateISO) {
  return new Intl.DateTimeFormat("ar-AE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(dateISO));
}
