import { getInvitationParams, invitationCheckinUrl, loadInvitationContext, saveInvitationRsvp, subscribeToInvitation } from "../../shared/invitation-data.js";
import { escapeHtml, formatEventDate, guestSeat, setDocumentTitle } from "../../shared/invitation-utils.js";
import { renderQrCode } from "../../../qr.js";

const app = document.getElementById("invitationApp");
let context;

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
  const names = wedding.coupleName || `${wedding.brideName || "Bride"} & ${wedding.groomName || "Groom"}`;
  app.innerHTML = `<section class="custom-hero"><p class="eyebrow">A celebration of love</p><h1>${escapeHtml(names)}</h1><p class="subtitle">${escapeHtml(wedding.subtitleEn || "Together with their families, they invite you to celebrate.")}</p><div class="date">${escapeHtml(formatEventDate(wedding.eventDateISO))}</div></section><section class="custom-card"><p class="eyebrow">For ${escapeHtml(guest.fullName || "our cherished guest")}</p><h2>Your invitation</h2><p>${escapeHtml(wedding.invitationMessageEn || "Your presence would mean so much to us.")}</p><dl><div><dt>Venue</dt><dd>${escapeHtml(wedding.venueEn || "Venue to be announced")}</dd></div><div><dt>Your seat</dt><dd>${escapeHtml(guestSeat(guest))}</dd></div></dl>${wedding.mapsUrl ? `<a class="map-link" href="${escapeHtml(wedding.mapsUrl)}" target="_blank" rel="noopener">View venue location</a>` : ""}</section><section class="custom-card rsvp"><p class="eyebrow">RSVP</p><h2>Will you join us?</h2><p class="rsvp-status">Current response: ${escapeHtml(guest.rsvpStatus || "pending")}</p><form id="rsvpForm"><label>Additional guests <input name="additionalGuests" type="number" min="0" max="10" value="${Number(guest.additionalGuests) || 0}"></label><div class="rsvp-actions"><button name="status" value="confirmed" type="submit">Joyfully accept</button><button name="status" value="declined" type="submit" class="secondary">Respectfully decline</button></div><p id="rsvpMessage" role="status"></p></form></section><section class="custom-card pass"><p class="eyebrow">Entrance pass</p><h2>Your QR access</h2><div id="qrMount"></div><p>Present this code at the entrance.</p></section>`;
  document.getElementById("rsvpForm").addEventListener("submit", saveRsvp);
  renderQrCode(document.getElementById("qrMount"), invitationCheckinUrl(context), { size: 210 });
}

async function saveRsvp(event) {
  event.preventDefault(); const status = event.submitter?.value; const message = document.getElementById("rsvpMessage");
  try { await saveInvitationRsvp(context, status, event.currentTarget.additionalGuests.value); message.textContent = "Your response has been saved."; }
  catch (error) { console.error(error); message.textContent = "We could not save your response. Please try again."; }
}
function showError(error) { console.error(error); app.innerHTML = `<section class="invitation-error"><div><h1>Invitation unavailable</h1><p>${escapeHtml(error.message || "Please check your personal invitation link.")}</p></div></section>`; }
