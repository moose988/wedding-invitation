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

export function buildInvitationRsvpPatch(status, additionalGuests, message) {
  if (!["confirmed", "declined"].includes(status)) throw new Error("Invalid RSVP status.");
  const patch = { rsvpStatus: status, updatedAt: "server-timestamp" };
  if (additionalGuests !== undefined && additionalGuests !== null) {
    const count = Number(additionalGuests);
    if (!Number.isInteger(count) || count < 0 || count > 10) throw new Error("Invalid additional guest count.");
    patch.additionalGuests = count;
  }
  if (message !== undefined) {
    if (typeof message !== "string" || message.length > 1000) throw new Error("Message must be 1000 characters or fewer.");
    patch.rsvpMessage = message.trim();
  }
  return patch;
}

export async function commitInvitationRsvpPatch({ db, context, payload, privatePayload = payload, writeBatch, doc }) {
  const batch = writeBatch(db);
  batch.update(doc(db, "weddings", context.weddingId, "guests", context.guest.guestId), privatePayload);
  batch.update(doc(db, "weddings", context.weddingId, "publicGuests", context.guestToken), payload);
  await batch.commit();
}
