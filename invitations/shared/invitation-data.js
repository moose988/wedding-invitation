import {
  collection,
  doc,
  getDoc,
  getDocs,
  initFirebase,
  isFirebaseConfigured,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from "../../firebase-config.js";
import { buildInvitationRsvpPatch, commitInvitationRsvpPatch, normalizeInvitationRsvpStatus } from "./rsvp-state.js";

export function getInvitationParams(location = window.location) {
  const params = new URLSearchParams(location.search);
  return { weddingId: params.get("wedding")?.trim() || "", guestToken: params.get("guest")?.trim() || "" };
}

// Existing event documents omit this field; preserve their current seating UI.
export function invitationSeatingEnabled(wedding) {
  return wedding?.seatingEnabled !== false;
}

export async function loadInvitationContext({ weddingId, guestToken } = getInvitationParams()) {
  if (!weddingId || !guestToken) throw new Error("Invitation link is incomplete.");
  if (!isFirebaseConfigured()) throw new Error("Invitation service is not configured.");
  const { db } = initFirebase();
  const [weddingSnapshot, guestSnapshot, tablesSnapshot] = await Promise.all([
    getDoc(doc(db, "weddings", weddingId)),
    getDoc(doc(db, "weddings", weddingId, "publicGuests", guestToken)),
    getDocs(collection(db, "weddings", weddingId, "tables")),
  ]);
  if (!weddingSnapshot.exists()) throw new Error("Event not found.");
  if (!guestSnapshot.exists()) throw new Error("Guest not found.");
  const publicGuest = guestSnapshot.data();
  if (publicGuest.guestToken !== guestToken || !publicGuest.guestId) {
    throw new Error("This invitation link is invalid or incomplete.");
  }
  return {
    weddingId,
    guestToken,
    wedding: { id: weddingSnapshot.id, ...weddingSnapshot.data() },
    guest: { id: guestSnapshot.id, ...publicGuest },
    tables: tablesSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
  };
}

// Each design owns its rendering, while this shared layer owns live Firebase
// reads. Return the unsubscribe function from the design's boot sequence.
export function subscribeToInvitation(context, onChange, onError = console.error) {
  const { db } = initFirebase();
  let requestVersion = 0;
  let active = true;
  const refresh = async () => {
    const currentVersion = ++requestVersion;
    try {
      const next = await loadInvitationContext(context);
      if (active && currentVersion === requestVersion) onChange(next);
    } catch (error) {
      if (active && currentVersion === requestVersion) onError(error);
    }
  };
  const unsubscribers = [
    onSnapshot(doc(db, "weddings", context.weddingId), refresh, onError),
    onSnapshot(doc(db, "weddings", context.weddingId, "publicGuests", context.guestToken), refresh, onError),
    onSnapshot(collection(db, "weddings", context.weddingId, "tables"), refresh, onError),
  ];
  return () => {
    active = false;
    requestVersion += 1;
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
}

export async function saveInvitationRsvp(context, status, additionalGuests, message) {
  const normalizedStatus = normalizeInvitationRsvpStatus(status);
  if (!context?.weddingId || !context?.guestToken || !context?.guest?.guestId ||
      context.guest.guestToken !== context.guestToken || !normalizedStatus ||
      !context.guest.id || context.guest.id !== context.guestToken) {
    throw new Error("Guest data is unavailable or does not match this invitation link.");
  }
  const privatePayload = { ...buildInvitationRsvpPatch(normalizedStatus, additionalGuests, message), updatedAt: serverTimestamp() };
  const publicPayload = { ...privatePayload };
  delete publicPayload.rsvpMessage;
  const { db } = initFirebase();
  // Firestore commits both copies atomically. update() preserves guest identity,
  // seating, check-in, and any party size omitted by this invitation form.
  await commitInvitationRsvpPatch({ db, context, payload: publicPayload, privatePayload, writeBatch, doc });
}

export function invitationCheckinUrl(context) {
  // This module sits at invitations/shared, so two parent traversals always
  // resolve to the shared check-in application at the hosting root.
  const url = new URL("../../checkin.html", import.meta.url);
  url.searchParams.set("wedding", context.weddingId);
  url.searchParams.set("guest", context.guestToken);
  return url.toString();
}
