import {
  httpsCallable,
  initPublicFirebase,
  isFirebaseConfigured,
} from "../../firebase-config.js?v=20261016-secure-invitation-1";

const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function getInvitationParams(location = window.location) {
  const params = new URLSearchParams(location.search);
  const credential = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
  return { weddingId: params.get("wedding")?.trim() || "", guestToken: credential.get("guest")?.trim() || "" };
}

// Existing event documents omit this field; preserve their current seating UI.
export function invitationSeatingEnabled(wedding) {
  return wedding?.seatingEnabled !== false;
}

export async function loadInvitationContext({ weddingId, guestToken } = getInvitationParams()) {
  if (!weddingId || !guestToken || !INVITATION_TOKEN_PATTERN.test(guestToken)) {
    throw new Error("This invitation is unavailable.");
  }
  if (!isFirebaseConfigured()) throw new Error("Invitation service is unavailable.");
  const { functions } = initPublicFirebase();
  try {
    const result = await httpsCallable(functions, "getGuestInvitation")({ weddingId, token: guestToken });
    const wedding = result.data?.wedding;
    const guest = result.data?.guest;
    if (!wedding || !guest) throw new Error("This invitation is unavailable.");
    return { weddingId, guestToken, wedding, guest };
  } catch {
    // Keep missing, malformed, revoked, expired, and wrong-event capabilities indistinguishable.
    throw new Error("This invitation is unavailable.");
  }
}

// Revalidate periodically so a revoked invitation stops refreshing an already
// open page. The callable checks the token on every refresh and RSVP request.
export function subscribeToInvitation(context, onChange, onError = console.error) {
  let active = true;
  let requestVersion = 0;
  const refresh = async () => {
    const version = ++requestVersion;
    try {
      const next = await loadInvitationContext(context);
      if (active && version === requestVersion) onChange(next);
    } catch (error) {
      if (active && version === requestVersion) onError(error);
    }
  };
  const timer = window.setInterval(refresh, 20000);
  return () => {
    active = false;
    requestVersion += 1;
    window.clearInterval(timer);
  };
}

export async function saveInvitationRsvp(context, status, additionalGuests, message) {
  const normalizedStatus = status;
  const count = additionalGuests === undefined || additionalGuests === null ? undefined : Number(additionalGuests);
  const allowance = Number.isInteger(Number(context?.guest?.additionalGuestAllowance))
    ? Number(context.guest.additionalGuestAllowance)
    : Number(context?.guest?.additionalGuests || 0);
  if (!context?.weddingId || !INVITATION_TOKEN_PATTERN.test(context?.guestToken || "") ||
      !["confirmed", "declined"].includes(normalizedStatus) || (count !== undefined && (!Number.isInteger(count) || count < 0 || count > allowance || count > 10)) ||
      (message !== undefined && (typeof message !== "string" || message.length > 1000))) {
    throw new Error("This invitation is unavailable.");
  }
  const { functions } = initPublicFirebase();
  try {
    const result = await httpsCallable(functions, "submitGuestInvitationRsvp")({
      weddingId: context.weddingId,
      token: context.guestToken,
      rsvpStatus: normalizedStatus,
      ...(count === undefined ? {} : { additionalGuests: count }),
      ...(message === undefined ? {} : { rsvpMessage: message.trim() }),
    });
    if (!result.data?.guest) throw new Error("This invitation is unavailable.");
    context.guest = { ...context.guest, ...result.data.guest };
    return context.guest;
  } catch {
    throw new Error("We could not save your response. Please try again.");
  }
}

export function invitationCheckinUrl(context) {
  const url = new URL("../../checkin.html", import.meta.url);
  url.searchParams.set("wedding", context.weddingId);
  url.hash = new URLSearchParams({ guest: context.guestToken }).toString();
  return url.toString();
}
