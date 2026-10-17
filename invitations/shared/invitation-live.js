import { generateTableChairs } from "../../seating-utils.js";

export function invitationReadError(error) {
  const code = String(error?.code || "").replace(/^firestore\//, "");
  const transient = ["resource-exhausted", "unavailable", "deadline-exceeded", "network-request-failed"].includes(code);
  const message = code === "resource-exhausted" ? "Invitation updates are temporarily paused because Firebase quota is exhausted. Please try again later."
    : transient ? "Invitation updates could not be reached. Check your connection and retry."
      : "This invitation is unavailable.";
  return Object.assign(new Error(message), { code: code || "not-found", transient });
}
export function validInvitation(data, weddingId) {
  return data?.eventId === weddingId && data.wedding && data.guest && ["pending", "confirmed", "declined"].includes(data.rsvpStatus);
}

export function composeInvitation(context, invitation, shared, scene, layouts, venue) {
  let wedding = { ...invitation.wedding, ...(shared || {}) };
  const useShared = scene?.version === 1 || invitation.wedding.canonicalLayout === true;
  if (useShared && layouts && venue) wedding = { ...wedding, canonicalLayout: true,
    tables: layouts.map((row) => { const table = { ...row.data(), id: row.id }; return { ...table, chairs: generateTableChairs(table.shape, table.seatCount, table.width, table.height, [], table.id) }; }),
    hallObjects: venue.map((row) => row.data()).sort((a, b) => a.index - b.index),
  };
  const guest = { ...invitation.guest, rsvpStatus: invitation.rsvpStatus, additionalGuests: invitation.additionalGuests,
    additionalGuestAllowance: invitation.guest.additionalGuestAllowance, rsvpMessage: invitation.rsvpMessage || "" };
  if (wedding.tables?.length) {
    guest.seatingAssignments = (guest.seatingAssignments || []).map((seat) => {
      const direct = wedding.tables?.find((table) => table.id === seat.tableId);
      const oldName = seat.tableName || invitation.wedding.tables?.find((table) => table.id === seat.tableId)?.name;
      const matches = direct ? [direct] : wedding.tables?.filter((table) => table.name === oldName || table.aliases?.includes(oldName)) || [];
      return matches.length === 1 ? { ...seat, tableId: matches[0].id, tableName: matches[0].name } : seat;
    });
    const primary = guest.seatingAssignments.find((seat) => seat.personKey === "main") || guest.seatingAssignments[0];
    if (primary) { guest.tableName = primary.tableName; guest.seatNumber = primary.seatNumber; }
  }
  return { ...context, wedding: { id: context.weddingId, ...wedding }, guest };
}

export function createInvitationSubscription({ api, db, context, onChange, onError }) {
  let active = true, invitation = null, shared = null, scene = null, layouts = null, venue = null;
  const stops = [], layoutStops = [];
  let layoutGeneration = 0;
  const ref = (...parts) => api.doc(db, "weddings", context.weddingId, ...parts);
  function dispose() { if (!active) return; active = false; [...stops, ...layoutStops].forEach((stop) => stop()); }
  function fail(error, capability = false) {
    if (!active) return;
    const normalized = invitationReadError(error);
    if (capability && !normalized.transient) dispose();
    onError(normalized);
  }
  function emit() {
    if (!active || !invitation) return;
    const event = { ...invitation.wedding, ...(shared || {}) };
    const needsLayout = event.seatingEnabled !== false && (scene?.version === 1 || invitation.wedding.canonicalLayout === true);
    if (needsLayout && !layoutStops.length) {
      const generation = ++layoutGeneration;
      layoutStops.push(api.onSnapshot(api.collection(db, "weddings", context.weddingId, "publicLayouts"), (rows) => { if (active && generation === layoutGeneration) { layouts = rows.docs; emit(); } }, (error) => { if (generation === layoutGeneration) fail(error); }));
      layoutStops.push(api.onSnapshot(api.collection(db, "weddings", context.weddingId, "publicVenue"), (rows) => { if (active && generation === layoutGeneration) { venue = rows.docs; emit(); } }, (error) => { if (generation === layoutGeneration) fail(error); }));
    } else if (!needsLayout && layoutStops.length) {
      layoutGeneration++;
      layoutStops.splice(0).forEach((stop) => stop()); layouts = null; venue = null;
    }
    onChange(composeInvitation(context, invitation, shared, scene, layouts, venue));
  }
  stops.push(api.onSnapshot(ref("publicGuests", context.guestToken), (snapshot) => {
    if (!active) return;
    if (!snapshot.exists() || !validInvitation(snapshot.data(), context.weddingId)) { fail({ code: "not-found" }, true); return; }
    invitation = snapshot.data(); emit();
  }, (error) => fail(error, true)));
  stops.push(api.onSnapshot(ref("publicEvent", "details"), (snapshot) => { if (active) { shared = snapshot.exists() ? snapshot.data() : null; emit(); } }, (error) => fail(error)));
  stops.push(api.onSnapshot(ref("publicScene", "state"), (snapshot) => { if (active) { scene = snapshot.exists() ? snapshot.data() : null; emit(); } }, (error) => fail(error)));
  return dispose;
}
