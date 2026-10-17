// This is the form's canonical save path, shared with emulator/browser tests.
// No token, roster, table collection or unrelated seat reads belong here.
export function normalizedGuestSide(value) {
  const side = String(value || "").trim().toLowerCase();
  if (side === "general") return "general";
  if (["bride", "bride side", "brides side"].includes(side)) return "bride";
  if (["groom", "groom side", "grooms side", "both", "both sides", "shared"].includes(side)) return "groom";
  return "family";
}

export function guestFormPatch(draft, baseline) {
  return Object.fromEntries(Object.entries(draft).filter(([key, value]) => key !== "updatedAt" && (!baseline || value !== baseline[key])));
}

export function seatingGuestData(guest) {
  return { fullName: guest.fullName, side: normalizedGuestSide(guest.side), additionalGuests: guest.additionalGuests || 0, rsvpStatus: guest.rsvpStatus || "pending" };
}

export function checkinGuestData(guestId, guest) {
  return { guestId, fullName: guest.fullName, phone: guest.phone || "", side: normalizedGuestSide(guest.side), rsvpStatus: guest.rsvpStatus || "pending",
    tableId: guest.tableId || "", tableName: guest.tableName || "", seatNumber: guest.seatNumber ?? "", checkedIn: guest.checkedIn === true, checkedInAt: guest.checkedInAt || null };
}

export async function commitGuestEdit({ api, db, weddingId, guestId, patch, isCurrent = () => true }) {
  const input = { ...patch };
  delete input.updatedAt;
  return api.runTransaction(db, async (transaction) => {
    if (!isCurrent()) throw Object.assign(new Error("This editing session has ended."), { code: "cancelled" });
    const guestRef = api.doc(db, "weddings", weddingId, "guests", guestId);
    const snapshot = await transaction.get(guestRef);
    if (!snapshot.exists()) throw Object.assign(new Error("This guest no longer exists."), { code: "not-found" });
    const current = snapshot.data();
    const candidate = { ...input };
    if ("additionalGuestAllowance" in input && !("additionalGuests" in input)) {
      candidate.additionalGuests = Math.min(Number(current.additionalGuests || 0), Number(input.additionalGuestAllowance));
    }
    const changes = Object.fromEntries(Object.entries(candidate).filter(([key, value]) => JSON.stringify(current[key] ?? "") !== JSON.stringify(value)));
    const changed = Object.keys(changes);
    if (!changed.length) return { guest: { ...current, id: guestId }, changed, committed: true };
    const updated = { ...current, ...changes };
    const sideChanged = normalizedGuestSide(current.side) !== normalizedGuestSide(updated.side);
    const reduced = Number(updated.additionalGuests || 0) < Number(current.additionalGuests || 0);
    if (sideChanged || reduced) {
      const bindings = await Promise.all(Array.from({ length: 11 }, (_, index) => {
        const personKey = index ? `guest-${index}` : "main";
        return transaction.get(api.doc(db, "weddings", weddingId, "seatedPeople", `${guestId}~${personKey}`));
      }));
      const occupied = bindings.filter((row) => row.exists());
      for (const row of occupied) {
        const binding = row.data();
        const index = binding.personKey === "main" ? 0 : Number(binding.personKey.slice(6));
        if (index > Number(updated.additionalGuests || 0)) throw Object.assign(new Error("Unassign additional party members before reducing the party size."), { code: "failed-precondition" });
      }
      if (sideChanged) {
        const seats = await Promise.all(occupied.map((row) => {
          const binding = row.data();
          return transaction.get(api.doc(db, "weddings", weddingId, "seatAssignments", `${binding.tableId}~${binding.chairId}`));
        }));
        occupied.forEach((row, index) => {
          const binding = row.data(), seat = seats[index];
          if (!seat.exists() || seat.data().guestId !== guestId || seat.data().personKey !== binding.personKey) {
            throw Object.assign(new Error("A seat changed on another device. Refresh and try again."), { code: "aborted" });
          }
        });
        occupied.forEach((row, index) => {
          transaction.update(row.ref, { side: normalizedGuestSide(updated.side), updatedAt: api.serverTimestamp() });
          transaction.update(seats[index].ref, { side: normalizedGuestSide(updated.side), updatedAt: api.serverTimestamp() });
        });
      }
    }
    if (!isCurrent()) throw Object.assign(new Error("This editing session has ended."), { code: "cancelled" });
    transaction.update(guestRef, { ...changes, updatedAt: api.serverTimestamp() });
    if (changed.some((key) => ["fullName", "side", "additionalGuests", "rsvpStatus"].includes(key))) {
      transaction.set(api.doc(db, "weddings", weddingId, "seatingGuests", guestId), { ...seatingGuestData(updated), updatedAt: api.serverTimestamp() });
    }
    if (changed.some((key) => ["fullName", "phone", "side", "rsvpStatus", "tableId", "tableName", "seatNumber"].includes(key))) {
      transaction.set(api.doc(db, "weddings", weddingId, "checkinGuests", guestId), { ...checkinGuestData(guestId, updated), updatedAt: api.serverTimestamp() });
    }
    return { guest: { ...updated, id: guestId }, changed, committed: true };
  });
}

export function saveFailureMessage(error, { committed = false } = {}) {
  const code = String(error?.code || "").replace(/^firestore\//, "");
  const reason = code === "resource-exhausted" ? "Firebase quota is exhausted. Wait for quota availability before retrying."
    : code === "permission-denied" ? "Your account does not have permission for this operation."
      : ["unavailable", "deadline-exceeded", "network-request-failed"].includes(code) ? "The service could not be reached. Check your connection before retrying."
        : error?.message || "The save could not be completed.";
  return committed ? `Guest saved. Invitation refresh is pending. ${reason}` : `${reason} Your draft is still here.`;
}
