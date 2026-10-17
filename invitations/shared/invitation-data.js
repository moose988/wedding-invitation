import {
  doc,
  getDoc,
  initPublicFirebase,
  isFirebaseConfigured,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from "../../firebase-config.js?v=20261017-firestore-invitation-1";
import { isValidInvitationToken } from "./invitation-token.js";

const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function getInvitationParams(location = window.location) {
  const params = new URLSearchParams(location.search);
  const credential = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
  const guestId = credential.get("recipient")?.trim() || "";
  return {
    weddingId: params.get("wedding")?.trim() || "",
    guestToken: credential.get("guest")?.trim() || "",
    guestId: /^[A-Za-z0-9_-]{1,128}$/.test(guestId) ? guestId : "",
  };
}

// Existing event documents omit this field; preserve their current seating UI.
export function invitationSeatingEnabled(wedding) {
  return wedding?.seatingEnabled !== false;
}

export async function loadInvitationContext({ weddingId, guestToken, guestId = "" } = getInvitationParams()) {
  if (!weddingId || !guestToken || !INVITATION_TOKEN_PATTERN.test(guestToken)) {
    throw new Error("This invitation is unavailable.");
  }
  if (!isValidInvitationToken(guestToken)) throw new Error("This invitation is unavailable.");
  if (!isFirebaseConfigured()) throw new Error("Invitation service is unavailable.");
  const { db } = initPublicFirebase();
  try {
    const snapshot = await getDoc(doc(db, "weddings", weddingId, "publicGuests", guestToken));
    if (!snapshot.exists()) throw new Error("This invitation is unavailable.");
    const invitation = snapshot.data();
    if (invitation.eventId !== weddingId || !invitation.wedding || !invitation.guest ||
        !["pending", "confirmed", "declined"].includes(invitation.rsvpStatus)) {
      throw new Error("This invitation is unavailable.");
    }
    return {
      weddingId,
      guestToken,
      guestId,
      wedding: { id: weddingId, ...invitation.wedding },
      guest: {
        ...invitation.guest,
        rsvpStatus: invitation.rsvpStatus,
        additionalGuests: invitation.additionalGuests,
        additionalGuestAllowance: invitation.guest.additionalGuestAllowance,
        rsvpMessage: invitation.rsvpMessage || "",
      },
    };
  } catch {
    // Keep missing, malformed, revoked, expired, and wrong-event capabilities indistinguishable.
    throw new Error("This invitation is unavailable.");
  }
}

// Listen to the exact capability document. Revocation/deletion is delivered by
// Firestore, and the unsubscribe is owned by the invitation page lifecycle.
export function subscribeToInvitation(context, onChange, onError = console.error) {
  let active = true;
  if (!isFirebaseConfigured() || !context?.weddingId || !isValidInvitationToken(context?.guestToken || "")) {
    queueMicrotask(() => { if (active) onError(new Error("This invitation is unavailable.")); });
    return () => { active = false; };
  }
  const { db } = initPublicFirebase();
  let unsubscribe = () => {};
  const stopWithUnavailable = () => {
    if (!active) return;
    active = false;
    unsubscribe();
    onError(new Error("This invitation is unavailable."));
  };
  unsubscribe = onSnapshot(doc(db, "weddings", context.weddingId, "publicGuests", context.guestToken),
    (snapshot) => {
      if (!active) return;
      if (!snapshot.exists()) { stopWithUnavailable(); return; }
      const invitation = snapshot.data();
      if (invitation.eventId !== context.weddingId || !invitation.wedding || !invitation.guest ||
          !["pending", "confirmed", "declined"].includes(invitation.rsvpStatus)) {
        stopWithUnavailable();
        return;
      }
      onChange({
        ...context,
        wedding: { id: context.weddingId, ...invitation.wedding },
        guest: {
          ...invitation.guest,
          rsvpStatus: invitation.rsvpStatus,
          additionalGuests: invitation.additionalGuests,
          additionalGuestAllowance: invitation.guest.additionalGuestAllowance,
          rsvpMessage: invitation.rsvpMessage || "",
        },
      });
    },
    () => stopWithUnavailable(),
  );
  return () => {
    active = false;
    unsubscribe();
  };
}

export async function saveInvitationRsvp(context, status, additionalGuests, message) {
  const normalizedStatus = status;
  const count = additionalGuests === undefined || additionalGuests === null ? undefined : Number(additionalGuests);
  const allowance = Number.isInteger(Number(context?.guest?.additionalGuestAllowance))
    ? Number(context.guest.additionalGuestAllowance)
    : Number(context?.guest?.additionalGuests || 0);
  if (!context?.weddingId || !/^[A-Za-z0-9_-]{1,128}$/.test(context?.guestId || "") ||
      !INVITATION_TOKEN_PATTERN.test(context?.guestToken || "") ||
      !["confirmed", "declined"].includes(normalizedStatus) || (count !== undefined && (!Number.isInteger(count) || count < 0 || count > allowance || count > 10)) ||
      (message !== undefined && (typeof message !== "string" || message.length > 1000))) {
    throw new Error("This invitation is unavailable.");
  }
  const { db } = initPublicFirebase();
  try {
    const additionalGuestCount = count === undefined ? Number(context.guest.additionalGuests || 0) : count;
    const rsvpMessage = message === undefined ? String(context.guest.rsvpMessage || "").trim() : message.trim();
    const tokenRef = doc(db, "weddings", context.weddingId, "publicGuests", context.guestToken);
    const guestRef = doc(db, "weddings", context.weddingId, "guests", context.guestId);
    const batch = writeBatch(db);
    const rsvpPatch = {
      rsvpStatus: normalizedStatus,
      additionalGuests: additionalGuestCount,
      rsvpMessage,
      updatedAt: serverTimestamp(),
    };
    batch.update(tokenRef, rsvpPatch);
    batch.update(guestRef, rsvpPatch);
    await batch.commit();
    context.guest = {
      ...context.guest,
      rsvpStatus: normalizedStatus,
      additionalGuests: additionalGuestCount,
      rsvpMessage,
    };
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
