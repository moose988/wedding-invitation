import {
  getDoc, initGenderRevealSubmissionFirebase, initPublicFirebase, signInAnonymously,
  doc, runTransaction, serverTimestamp,
} from "./firebase-config.js";
import { createGenderRevealSubmissionService } from "./gender-reveal-submission.js";
import { GENDER_REVEAL_COUNTRIES } from "./gender-reveal-phone.js";

const params = new URLSearchParams(location.search);
const weddingId = (params.get("wedding") || "").trim();
const pageStatus = document.getElementById("pageStatus");
const eventPanel = document.getElementById("eventPanel");
const formSection = document.getElementById("responseFormSection");
const form = document.getElementById("responseForm");
const formStatus = document.getElementById("formStatus");
const language = document.getElementById("eventLanguage");
let eventData = null;
let submitResponse = null;

for (const [region, name, callingCode] of GENDER_REVEAL_COUNTRIES) {
  const option = document.createElement("option");
  option.value = callingCode;
  option.textContent = `${name} (+${callingCode})`;
  option.dataset.region = region;
  option.selected = region === "AE";
  document.getElementById("countryCallingCode").append(option);
}

function localizedDate(event, languageCode) {
  const date = new Date(event.eventDateISO);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(languageCode === "ar" ? "ar" : "en", {
    dateStyle: "full", timeStyle: "short", timeZone: event.eventTimeZone || "Asia/Dubai",
  }).format(date);
}

function safeMediaUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function safeMapUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function renderLanguage(languageCode) {
  const arabic = languageCode === "ar";
  document.documentElement.lang = languageCode;
  eventPanel.dir = arabic ? "rtl" : "ltr";
  document.querySelectorAll("[data-en][data-ar]").forEach((element) => {
    element.textContent = arabic ? element.dataset.ar : element.dataset.en;
  });
  document.getElementById("eventTitle").textContent = arabic
    ? (eventData.eventTitleAr || eventData.eventTitle)
    : eventData.eventTitle;
  document.getElementById("eventDate").textContent = localizedDate(eventData, languageCode);
  const venue = document.getElementById("eventVenue");
  const venueName = document.getElementById("eventVenueName");
  venueName.textContent = [eventData.venueEn, eventData.location].filter(Boolean).join(" · ");
  const mapLink = document.getElementById("eventMapLink");
  mapLink.href = safeMapUrl(eventData.mapsUrl || "") || "#";
  mapLink.hidden = !safeMapUrl(eventData.mapsUrl || "");
  venue.hidden = !venueName.textContent && mapLink.hidden;
  document.getElementById("eventMessage").textContent = arabic
    ? (eventData.genderRevealMessageAr || eventData.subtitleAr || "")
    : (eventData.genderRevealMessageEn || eventData.subtitleEn || "");
}

function renderResults(aggregate = {}) {
  const boys = Number.isSafeInteger(aggregate.boyCount) ? aggregate.boyCount : 0;
  const girls = Number.isSafeInteger(aggregate.girlCount) ? aggregate.girlCount : 0;
  const total = boys + girls;
  document.getElementById("boyResult").textContent = String(boys);
  document.getElementById("girlResult").textContent = String(girls);
  document.getElementById("boyPercent").textContent = `${total ? Math.round((boys / total) * 100) : 0}%`;
  document.getElementById("girlPercent").textContent = `${total ? Math.round((girls / total) * 100) : 0}%`;
  document.getElementById("results").hidden = false;
}

async function loadEvent() {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(weddingId)) throw new Error("This invitation link is missing its event id.");
  const { db } = initPublicFirebase();
  const eventSnapshot = await getDoc(doc(db, "weddings", weddingId, "publicEvent", "details"));
  if (!eventSnapshot.exists()) throw new Error("This invitation is unavailable.");
  eventData = eventSnapshot.data();
  if (eventData.eventCategory !== "gender_reveal") throw new Error("This link is not a Gender Reveal Party invitation.");
  const lang = eventData.invitationLanguage === "ar" ? "ar" : "en";
  language.value = lang;
  renderLanguage(lang);
  for (const [id, field, type] of [
    ["eventArtwork", "genderRevealArtworkUrl", "image"],
    ["eventOpeningVideo", "genderRevealOpeningVideoUrl", "video"],
    ["eventMusic", "genderRevealMusicUrl", "audio"],
  ]) {
    const element = document.getElementById(id);
    const url = safeMediaUrl(eventData[field] || "");
    if (url) { element.src = url; element.hidden = false; }
  }
  eventPanel.hidden = false;
  pageStatus.hidden = true;
  if (eventData.eventStatus === "active") formSection.hidden = false;
  else document.getElementById("eventMessage").textContent ||= "Responses are not open for this event.";
}

language.addEventListener("change", () => renderLanguage(language.value));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const submit = form.querySelector("button[type='submit']");
  const values = Object.fromEntries(new FormData(form).entries());
  submit.disabled = true;
  formStatus.textContent = "Saving your response…";
  try {
    if (!submitResponse) {
      const firebase = initGenderRevealSubmissionFirebase();
      const api = { doc, runTransaction, serverTimestamp };
      submitResponse = createGenderRevealSubmissionService({
        api, db: firebase.db, weddingId,
        ensureAnonymousUser: async () => {
          if (!firebase.auth.currentUser) await signInAnonymously(firebase.auth);
        },
      });
    }
    await submitResponse(values);
    form.reset();
    formSection.hidden = true;
    pageStatus.hidden = false;
    pageStatus.textContent = language.value === "ar" ? "تم حفظ ردك. إليك إجمالي التوقعات." : "Your response was saved. Here are the event totals.";
    try {
      const { db } = initPublicFirebase();
      const aggregate = await getDoc(doc(db, "weddings", weddingId, "genderRevealResults", "aggregate"));
      renderResults(aggregate.exists() ? aggregate.data() : {});
    } catch {
      document.getElementById("results").hidden = false;
      pageStatus.textContent = language.value === "ar" ? "تم حفظ ردك. إجمالي التوقعات غير متاح مؤقتًا." : "Your response was saved. The totals are temporarily unavailable.";
    }
  } catch (error) {
    const message = error?.code === "failed-precondition"
        ? (error.message || "Responses are not open for this event.")
        : error?.code === "permission-denied"
          ? "We could not save this response. This number may already have a response. Check it and try again; your form is still here."
        : "We could not save your response. Your form is still here; please try again.";
    formStatus.textContent = message;
  } finally {
    submit.disabled = false;
  }
});

loadEvent().catch((error) => {
  pageStatus.textContent = error?.message || "This invitation could not be loaded.";
});
