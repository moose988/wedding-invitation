import {
  collection,
  doc,
  getDoc,
  getDocs,
  initFirebase,
  isFirebaseConfigured,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "../../firebase-config.js";

export function getInvitationParams(location = window.location) {
  const params = new URLSearchParams(location.search);
  return { weddingId: params.get("wedding")?.trim() || "", guestToken: params.get("guest")?.trim() || "" };
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
  if (!weddingSnapshot.exists()) throw new Error("Wedding not found.");
  if (!guestSnapshot.exists()) throw new Error("Guest not found.");
  return {
    weddingId,
    guestToken,
    wedding: { id: weddingSnapshot.id, ...weddingSnapshot.data() },
    guest: { id: guestSnapshot.id, ...guestSnapshot.data() },
    tables: tablesSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
  };
}

// Each design owns its rendering, while this shared layer owns live Firebase
// reads. Return the unsubscribe function from the design's boot sequence.
export function subscribeToInvitation(context, onChange, onError = console.error) {
  const { db } = initFirebase();
  const refresh = async () => {
    try { onChange(await loadInvitationContext(context)); } catch (error) { onError(error); }
  };
  const unsubscribers = [
    onSnapshot(doc(db, "weddings", context.weddingId), refresh, onError),
    onSnapshot(doc(db, "weddings", context.weddingId, "publicGuests", context.guestToken), refresh, onError),
    onSnapshot(collection(db, "weddings", context.weddingId, "tables"), refresh, onError),
  ];
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}

export async function saveInvitationRsvp(context, status, additionalGuests = 0) {
  if (!context?.guest?.guestId) throw new Error("Guest data is unavailable.");
  if (!["confirmed", "declined"].includes(status)) throw new Error("Invalid RSVP status.");
  const nextAdditionalGuests = status === "confirmed" ? Math.max(0, Math.min(10, Number(additionalGuests) || 0)) : 0;
  const { db } = initFirebase();
  const payload = { rsvpStatus: status, additionalGuests: nextAdditionalGuests, updatedAt: serverTimestamp() };
  await updateDoc(doc(db, "weddings", context.weddingId, "guests", context.guest.guestId), payload);
  // The token-keyed mirror is what every public design reads; keep it in sync.
  await updateDoc(doc(db, "weddings", context.weddingId, "publicGuests", context.guestToken), payload);
}

export function invitationCheckinUrl(context) {
  // This module sits at invitations/shared, so two parent traversals always
  // resolve to the shared check-in application at the hosting root.
  const url = new URL("../../checkin.html", import.meta.url);
  url.searchParams.set("wedding", context.weddingId);
  url.searchParams.set("guest", context.guestToken);
  return url.toString();
}
