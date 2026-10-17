function personKeyForIndex(index) { return Number(index) === 0 ? "main" : `guest-${Number(index)}`; }
function normalizeGuestSide(value) {
  const side = String(value || "").trim().toLowerCase();
  if (side === "general") return "general";
  if (["bride", "bride side", "brides side"].includes(side)) return "bride";
  if (["groom", "groom side", "grooms side", "both", "both sides", "shared"].includes(side)) return "groom";
  return "family";
}
function getChairAssignment(_tableId, chair) { return chair.assignment?.guestId ? chair.assignment : null; }
function seatSlotMap(tables) {
  const slots = new Map();
  for (const table of tables || []) {
    for (const chair of table.chairs || []) {
      const chairId = String(chair.id || "");
      if (!chairId) continue;
      const key = `${table.id}\u0000${chairId}`;
      slots.set(key, { table, chair, assignment: getChairAssignment(table.id, chair) });
    }
  }
  return slots;
}

function seatPersonKey(assignment) {
  return `${assignment.guestId}\u0000${assignment.personKey || personKeyForIndex(assignment.partyMemberIndex)}`;
}

function sameSeatPerson(left, right) {
  if (!left && !right) return true;
  return Boolean(left && right)
    && left.guestId === right.guestId
    && Number(left.partyMemberIndex) === Number(right.partyMemberIndex)
    && (left.personKey || personKeyForIndex(left.partyMemberIndex)) === (right.personKey || personKeyForIndex(right.partyMemberIndex));
}

export async function persistCanonicalSeatDiff({ api, db, weddingId, transaction, beforeTables, afterTables }) {
  const { doc, serverTimestamp } = api;
  const before = seatSlotMap(beforeTables);
  const after = seatSlotMap(afterTables);
  const keys = new Set([...before.keys(), ...after.keys()]);
  const changed = [...keys].filter((key) => {
    const oldSlot = before.get(key);
    const newSlot = after.get(key);
    if (!oldSlot || !newSlot) return true;
    if (!sameSeatPerson(oldSlot.assignment, newSlot.assignment)) return true;
    return Boolean(oldSlot.assignment && Number(oldSlot.chair.seatNumber) !== Number(newSlot.chair.seatNumber));
  });
  if (!changed.length) return;

  const parsed = changed.map((key) => {
    const [tableId, chairId] = key.split("\u0000");
    const oldSlot = before.get(key) || null;
    const newSlot = after.get(key) || null;
    const oldAssignment = oldSlot?.assignment || null;
    const newAssignment = newSlot?.assignment || null;
    return {
      key, tableId, chairId, oldSlot, newSlot, oldAssignment, newAssignment,
      seatRef: doc(db, "weddings", weddingId, "seatAssignments", `${tableId}~${chairId}`),
      occupancyRef: doc(db, "weddings", weddingId, "seatOccupancy", `${tableId}~${chairId}`),
    };
  });
  const personEntries = new Map();
  for (const item of parsed) {
    for (const assignment of [item.oldAssignment, item.newAssignment]) {
      if (!assignment) continue;
      const personKey = assignment.personKey || personKeyForIndex(assignment.partyMemberIndex);
      const personId = `${assignment.guestId}\u0000${personKey}`;
      const entry = personEntries.get(personId) || {
        guestId: assignment.guestId,
        personKey,
        ref: doc(db, "weddings", weddingId, "seatedPeople", `${assignment.guestId}~${personKey}`),
        oldLocations: [],
        newLocation: null,
      };
      if (assignment === item.oldAssignment) entry.oldLocations.push({ tableId: item.tableId, chairId: item.chairId });
      if (assignment === item.newAssignment) {
        if (entry.newLocation && (entry.newLocation.tableId !== item.tableId || entry.newLocation.chairId !== item.chairId)) {
          throw new Error("One party member is assigned to more than one chair.");
        }
        entry.newLocation = { tableId: item.tableId, chairId: item.chairId, side: "" };
      }
      personEntries.set(personId, entry);
    }
  }
  const guestIds = [...new Set(parsed.map((item) => item.newAssignment?.guestId).filter(Boolean))];
  const guestRefs = guestIds.map((guestId) => doc(db, "weddings", weddingId, "seatingGuests", guestId));
  const readRefs = [
    ...parsed.flatMap((item) => [item.seatRef, item.occupancyRef]),
    ...[...personEntries.values()].map((entry) => entry.ref),
    ...guestRefs,
  ];
  const snapshots = await Promise.all(readRefs.map((ref) => transaction.get(ref)));
  let cursor = 0;
  const seatSnapshots = new Map();
  const occupancySnapshots = new Map();
  parsed.forEach((item) => {
    seatSnapshots.set(item.key, snapshots[cursor++]);
    occupancySnapshots.set(item.key, snapshots[cursor++]);
  });
  const personSnapshots = new Map();
  [...personEntries.keys()].forEach((key) => personSnapshots.set(key, snapshots[cursor++]));
  const seatingGuests = new Map();
  guestIds.forEach((guestId) => {
    const snapshot = snapshots[cursor++];
    if (!snapshot.exists()) throw new Error("A guest's seating record is missing. Ask the event owner to repair seating.");
    seatingGuests.set(guestId, snapshot.data());
  });

  for (const item of parsed) {
    const seatSnapshot = seatSnapshots.get(item.key);
    const occupancySnapshot = occupancySnapshots.get(item.key);
    if (item.oldAssignment) {
      if (!seatSnapshot.exists() || !sameSeatPerson(seatSnapshot.data(), item.oldAssignment)) {
        throw new Error("A chair changed on another device. Review the refreshed seating plan and try again.");
      }
      if (!occupancySnapshot.exists() || occupancySnapshot.data().occupied !== true) {
        throw new Error("The seating occupancy records are out of sync. Ask the event owner to repair seating.");
      }
    } else if (seatSnapshot.exists() || (occupancySnapshot.exists() && occupancySnapshot.data().occupied === true)) {
      throw new Error("A chair was assigned on another device. Review the refreshed seating plan and try again.");
    }
    if (item.newAssignment) {
      const guest = seatingGuests.get(item.newAssignment.guestId);
      const index = Number(item.newAssignment.partyMemberIndex);
      if (!Number.isInteger(index) || index < 0 || index > Number(guest.additionalGuests || 0)) {
        throw new Error("That party member is no longer included in the RSVP.");
      }
      item.newAssignment.side = normalizeGuestSide(guest.side);
      const entry = personEntries.get(seatPersonKey(item.newAssignment));
      if (entry?.newLocation) entry.newLocation.side = item.newAssignment.side;
    }
  }

  for (const [personId, entry] of personEntries) {
    const snapshot = personSnapshots.get(personId);
    if (entry.oldLocations.length > 1) throw new Error("A party member appears in more than one seat record. Ask the event owner to repair seating.");
    if (entry.oldLocations.length) {
      const oldLocation = entry.oldLocations[0];
      if (!snapshot?.exists() || snapshot.data().tableId !== oldLocation.tableId || snapshot.data().chairId !== oldLocation.chairId) {
        throw new Error("A party member's seat binding changed on another device. Refresh and try again.");
      }
    } else if (snapshot?.exists() && (!entry.newLocation || snapshot.data().tableId !== entry.newLocation.tableId || snapshot.data().chairId !== entry.newLocation.chairId)) {
      throw new Error("That party member already has a chair. Refresh the seating plan.");
    }
    if (snapshot?.exists() && entry.newLocation
      && (snapshot.data().tableId !== entry.newLocation.tableId || snapshot.data().chairId !== entry.newLocation.chairId)
      && !entry.oldLocations.some((location) => location.tableId === snapshot.data().tableId && location.chairId === snapshot.data().chairId)) {
      throw new Error("That party member already has a chair. Refresh the seating plan.");
    }
  }

  for (const item of parsed) {
    if (!item.newSlot) {
      transaction.delete(item.seatRef);
      transaction.delete(item.occupancyRef);
      continue;
    }
    if (!item.newAssignment) {
      transaction.delete(item.seatRef);
      transaction.set(item.occupancyRef, {
        weddingId: weddingId, tableId: item.tableId, chairId: item.chairId,
        occupied: false, updatedAt: serverTimestamp(),
      });
      continue;
    }
    const assignment = item.newAssignment;
    const personKey = assignment.personKey || personKeyForIndex(assignment.partyMemberIndex);
    const side = assignment.side || normalizeGuestSide(seatingGuests.get(assignment.guestId).side);
    transaction.set(item.seatRef, {
      weddingId: weddingId, tableId: item.tableId, chairId: item.chairId,
      guestId: assignment.guestId, partyMemberIndex: Number(assignment.partyMemberIndex), personKey,
      side, seatNumber: Number(item.newSlot.chair.seatNumber || assignment.seatNumber || 0),
      updatedAt: serverTimestamp(),
    });
    transaction.set(item.occupancyRef, {
      weddingId: weddingId, tableId: item.tableId, chairId: item.chairId,
      occupied: true, updatedAt: serverTimestamp(),
    });
  }
  for (const entry of personEntries.values()) {
    if (!entry.newLocation) {
      transaction.delete(entry.ref);
      continue;
    }
    const guest = seatingGuests.get(entry.guestId);
    transaction.set(entry.ref, {
      weddingId: weddingId, guestId: entry.guestId, personKey: entry.personKey,
      tableId: entry.newLocation.tableId, chairId: entry.newLocation.chairId,
      side: entry.newLocation.side || normalizeGuestSide(guest.side),
      updatedAt: serverTimestamp(),
    });
  }
}

