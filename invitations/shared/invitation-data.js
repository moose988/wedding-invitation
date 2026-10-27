import {
  doc,
  getDoc,
  collection,
  initPublicFirebase,
  isFirebaseConfigured,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from "../../firebase-public.js";
import { isValidInvitationToken } from "./invitation-token.js?v=20261018-guest-invitation-regressions-2";
import { composeInvitation, createInvitationSubscription, invitationReadError } from "./invitation-live.js?v=20261018-guest-invitation-regressions-2";

export { isFirebaseConfigured };

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
    const [snapshot, shared] = await Promise.all([
      getDoc(doc(db, "weddings", weddingId, "publicGuests", guestToken)),
      getDoc(doc(db, "weddings", weddingId, "publicEvent", "details")),
    ]);
    if (!snapshot.exists()) throw new Error("This invitation is unavailable.");
    const invitation = snapshot.data();
    if (invitation.eventId !== weddingId || !invitation.wedding || !invitation.guest ||
        !["pending", "confirmed", "declined"].includes(invitation.rsvpStatus)) {
      throw new Error("This invitation is unavailable.");
    }
    return composeInvitation({ weddingId, guestToken, guestId }, invitation, shared.exists() ? shared.data() : null, null, null, null);
  } catch (error) {
    throw invitationReadError(error);
  }
}

// Listen to the exact capability document. Revocation/deletion is delivered by
// Firestore, and the unsubscribe is owned by the invitation page lifecycle.
export function subscribeToInvitation(context, onChange, onError = console.error, options = {}) {
  if (!isFirebaseConfigured() || !context?.weddingId || !isValidInvitationToken(context?.guestToken || "")) {
    queueMicrotask(() => onError(invitationReadError({ code: "not-found" })));
    return () => {};
  }
  const { db } = initPublicFirebase();
  const stop = createInvitationSubscription({ api: { doc, collection, onSnapshot }, db, context, onChange, onError, includeSchedule: options.schedule !== false, includeVenue: options.venue !== false });
  const dispose = () => { stop(); window.removeEventListener("pagehide", dispose); };
  window.addEventListener("pagehide", dispose, { once: true });
  return dispose;
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
    const seatingGuestRef = doc(db, "weddings", context.weddingId, "seatingGuests", context.guestId);
    const checkinGuestRef = doc(db, "weddings", context.weddingId, "checkinGuests", context.guestId);
    const rsvpPatch = {
      rsvpStatus: normalizedStatus,
      additionalGuests: additionalGuestCount,
      rsvpMessage,
      updatedAt: serverTimestamp(),
    };
    const responseBatch = (mirrors) => {
      const batch = writeBatch(db);
      batch.update(tokenRef, rsvpPatch);
      batch.update(guestRef, rsvpPatch);
      if (mirrors) {
        batch.update(seatingGuestRef, { rsvpStatus: normalizedStatus, additionalGuests: additionalGuestCount, updatedAt: serverTimestamp() });
        batch.update(checkinGuestRef, { rsvpStatus: normalizedStatus, updatedAt: serverTimestamp() });
      }
      return batch;
    };
    // A normal RSVP does not read private derivatives. Older events may lack
    // these mirrors: only not-found gets one fallback atomic canonical save.
    let batch = responseBatch(true);
    try { await batch.commit(); }
    catch (error) {
      if (error.code !== "not-found") throw error;
      batch = responseBatch(false); await batch.commit();
    }
    context.guest = {
      ...context.guest,
      rsvpStatus: normalizedStatus,
      additionalGuests: additionalGuestCount,
      rsvpMessage,
    };
    return context.guest;
  } catch (error) {
    const normalized = invitationReadError(error);
    if (normalized.transient) throw normalized;
    throw Object.assign(new Error(error.code === "permission-denied" ? "This response is not permitted. Check that your invitation is still active." : "We could not save your response. Please try again."), { code: error.code });
  }
}

export function invitationCheckinUrl(context) {
  const url = new URL("../../checkin.html", import.meta.url);
  url.searchParams.set("wedding", context.weddingId);
  url.hash = new URLSearchParams({ guest: context.guestToken }).toString();
  return url.toString();
}
