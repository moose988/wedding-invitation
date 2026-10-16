export function normalizeInvitationRsvpStatus(status) {
  return ["pending", "confirmed", "declined"].includes(status) ? status : "pending";
}

export function invitationRsvpView(guest) {
  const status = ["confirmed", "declined"].includes(guest?.rsvpStatus)
    ? guest.rsvpStatus
    : "pending";
  return { status, showForm: status === "pending", showSummary: status !== "pending" };
}

export function invitationRefreshIsCurrent(requestVersion, latestVersion) {
  return requestVersion === latestVersion;
}

export function invitationRsvpStorageKey(weddingId = "", guestToken = "") {
  return `premium-invitation-demo-rsvp:${weddingId || "demo"}:${guestToken || "demo"}`;
}

export function buildInvitationRsvpPatch(status, additionalGuests, message, allowance = 10) {
  if (!["confirmed", "declined"].includes(status)) throw new Error("Invalid RSVP status.");
  const patch = { rsvpStatus: status };
  if (additionalGuests !== undefined && additionalGuests !== null) {
    const count = Number(additionalGuests);
    const max = Number.isInteger(Number(allowance)) ? Math.max(0, Math.min(10, Number(allowance))) : 0;
    if (!Number.isInteger(count) || count < 0 || count > max) throw new Error("Invalid additional guest count.");
    patch.additionalGuests = count;
  }
  if (message !== undefined) {
    if (typeof message !== "string" || message.length > 1000) throw new Error("Message must be 1000 characters or fewer.");
    patch.rsvpMessage = message.trim();
  }
  return patch;
}
