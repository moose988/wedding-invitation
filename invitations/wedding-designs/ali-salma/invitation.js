import { getInvitationParams, invitationCheckinUrl, invitationSeatingEnabled, loadInvitationContext, saveInvitationRsvp, subscribeToInvitation } from "../../shared/invitation-data.js";
import { escapeHtml, formatEventDate, guestSeat, setDocumentTitle } from "../../shared/invitation-utils.js";
import { buildSatelliteMapEmbedUrl } from "../../shared/map-embed.js";
import { getEventDisplayTitle, isCelebrationEvent } from "../../../event-utils.js";
import { renderQrCode } from "../../../qr.js";

const app = document.getElementById("invitationApp");
let context;
let isSaving = false;
let isEditing = false;
let selectedStatus = "";
let saveMessage = "";
let additionalGuestsDraft = null;

boot();
async function boot() {
  try {
    context = await loadInvitationContext(getInvitationParams());
    render();
    subscribeToInvitation(context, (next) => { context = next; render(); }, showError);
  } catch (error) { showError(error); }
}

function render() {
  const { wedding, guest } = context;
  setDocumentTitle(wedding);
  const names = getEventDisplayTitle(wedding);
  const showQr = wedding.showInvitationQr !== false;
  const showSeating = invitationSeatingEnabled(wedding);
  const qrPass = showQr ? `<section class="custom-card pass"><p class="eyebrow">Entrance pass</p><h2>Your QR access</h2><div id="qrMount"></div><p>Present this code at the entrance.</p></section>` : "";
  const subtitle = isCelebrationEvent(wedding) ? "We invite you to celebrate this special occasion." : wedding.subtitleEn || "Together with their families, they invite you to celebrate.";
  const responseStatus = ["confirmed", "declined"].includes(guest.rsvpStatus) ? guest.rsvpStatus : "pending";
  const partyCount = additionalGuestsDraft !== null ? additionalGuestsDraft : (Number(guest.additionalGuests) || 0);
  const directions = safeMapsLink(wedding.mapsUrl) || (wedding.venueEn ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([wedding.venueEn, wedding.locationEn].filter(Boolean).join(", "))}` : "");
  const mapUrl = buildSatelliteMapEmbedUrl(wedding, window.GOOGLE_MAPS_EMBED_API_KEY);
  const locationCard = `<div class="venue-map-card"><p class="venue-map-card__venue">${escapeHtml(wedding.venueEn || "Venue")}</p>${mapUrl ? `<div class="venue-map-preview"><iframe src="${escapeHtml(mapUrl)}" title="Satellite preview for ${escapeHtml(wedding.venueEn)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" tabindex="-1" aria-hidden="true"></iframe></div>` : `<div class="venue-map-preview venue-map-preview--fallback"><p>Satellite preview unavailable. Use the venue directions below.</p></div>`}${directions ? `<a class="map-link" href="${escapeHtml(directions)}" target="_blank" rel="noopener noreferrer">Open in Maps</a>` : ""}</div>`;
  const rsvpMarkup = responseStatus !== "pending" && !isEditing
    ? `<div class="rsvp-summary rsvp-summary--${responseStatus}" role="status"><h3>${responseStatus === "confirmed" ? "Your attendance is confirmed" : "Your response is recorded as not attending"}</h3><p>${responseStatus === "confirmed" ? "We look forward to celebrating with you." : "Thank you for letting us know."}</p><button class="secondary" type="button" data-change-response>Change response</button></div>`
    : `<p class="rsvp-status" role="status" aria-live="polite">${isSaving ? "Saving your response…" : escapeHtml(saveMessage || "Please choose an option to respond.")}</p><form id="rsvpForm" aria-busy="${isSaving}"><label>Additional guests <input name="additionalGuests" type="number" min="0" max="10" value="${partyCount}" ${isSaving ? "disabled" : ""}></label><div class="rsvp-actions"><button name="status" value="confirmed" type="submit" ${selectedStatus === "confirmed" ? "aria-pressed=\"true\"" : ""} ${isSaving ? "disabled" : ""}>Joyfully accept</button><button name="status" value="declined" type="submit" class="secondary" ${selectedStatus === "declined" ? "aria-pressed=\"true\"" : ""} ${isSaving ? "disabled" : ""}>Respectfully decline</button></div></form>`;
  app.innerHTML = `<section class="custom-hero"><p class="eyebrow">${isCelebrationEvent(wedding) ? "Celebration invitation" : "A celebration of love"}</p><h1>${escapeHtml(names)}</h1><p class="subtitle">${escapeHtml(subtitle)}</p><div class="date">${escapeHtml(formatEventDate(wedding.eventDateISO))}</div></section><section class="custom-card"><p class="eyebrow">For ${escapeHtml(guest.fullName || "our cherished guest")}</p><h2>Your invitation</h2><p>${escapeHtml(wedding.invitationMessageEn || "Your presence would mean so much to us.")}</p><dl><div><dt>Venue</dt><dd>${escapeHtml(wedding.venueEn || "Venue to be announced")}</dd></div>${showSeating ? `<div><dt>Your seat</dt><dd>${escapeHtml(guestSeat(guest))}</dd></div>` : ""}</dl>${locationCard}</section><section class="custom-card rsvp"><p class="eyebrow">RSVP</p><h2>Will you join us?</h2>${rsvpMarkup}<p id="rsvpMessage" role="status"></p></section>${qrPass}`;
  document.getElementById("rsvpForm")?.addEventListener("submit", saveRsvp);
  document.getElementById("rsvpForm")?.addEventListener("change", (event) => {
    if (event.target.matches('[name="status"]')) selectedStatus = event.target.value;
  });
  app.querySelector("[data-change-response]")?.addEventListener("click", () => { isEditing = true; selectedStatus = ""; saveMessage = ""; render(); });
  app.querySelector(".venue-map-preview iframe")?.addEventListener("error", () => {
    const preview = app.querySelector(".venue-map-preview");
    if (!preview) return;
    preview.classList.add("venue-map-preview--fallback");
    preview.replaceChildren(Object.assign(document.createElement("p"), { textContent: "Satellite preview unavailable. Use the venue directions below." }));
  }, { once: true });
  if (showQr) renderQrCode(document.getElementById("qrMount"), invitationCheckinUrl(context), { size: 210 });
}

async function saveRsvp(event) {
  event.preventDefault();
  if (isSaving) return;
  const status = event.submitter?.value;
  if (!["confirmed", "declined"].includes(status)) return;
  selectedStatus = status;
  additionalGuestsDraft = event.currentTarget.additionalGuests.value;
  isSaving = true;
  saveMessage = "";
  render();
  try {
    await saveInvitationRsvp(context, status, additionalGuestsDraft);
    context.guest.rsvpStatus = status;
    context.guest.additionalGuests = Number(additionalGuestsDraft);
    isSaving = false;
    isEditing = false;
    selectedStatus = "";
    additionalGuestsDraft = null;
    saveMessage = "Your response has been saved.";
    render();
  } catch (error) {
    console.error(error);
    isSaving = false;
    isEditing = true;
    saveMessage = "We could not save your response. Please try again.";
    render();
  }
}

function safeMapsLink(value) {
  try { const url = new URL(String(value || "")); return ["https:", "http:"].includes(url.protocol) ? url.href : ""; }
  catch { return ""; }
}
function showError(error) { console.error(error); app.innerHTML = `<section class="invitation-error"><div><h1>Invitation unavailable</h1><p>${escapeHtml(error.message || "Please check your personal invitation link.")}</p></div></section>`; }
