import { getEventDisplayTitle } from "../../event-utils.js";

const htmlEntities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "\u0060": "&#096;" };

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"'\u0060]/g, character => htmlEntities[character]);
}

export function hideFailedInvitationImages(root) {
  for (const image of root.querySelectorAll("img[data-hide-on-error]")) {
    const hide = () => { image.hidden = true; };
    image.addEventListener("error", hide, { once: true });
    if (image.complete && image.naturalWidth === 0) hide();
  }
}

export function formatEventDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date to be announced" : new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" }).format(date);
}

export function guestSeat(guest) {
  if (!guest?.tableName && !guest?.seatNumber) return "Your seating details will be shared soon.";
  return [guest.tableName, guest.seatNumber ? `Seat ${guest.seatNumber}` : ""].filter(Boolean).join(" · ");
}

export function setDocumentTitle(wedding) {
  document.title = `${getEventDisplayTitle(wedding)} | Event Invitation`;
}
