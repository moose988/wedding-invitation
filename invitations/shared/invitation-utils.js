export function escapeHtml(value = "") {
  const node = document.createElement("span");
  node.textContent = String(value);
  return node.innerHTML;
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
  document.title = `${wedding?.coupleName || `${wedding?.brideName || "Bride"} & ${wedding?.groomName || "Groom"}`} | Wedding Invitation`;
}
