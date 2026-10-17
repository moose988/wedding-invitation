function normalizeGuestSide(value) {
  const side = String(value || "").trim().toLowerCase();
  if (side === "general") return "general";
  if (["bride", "bride side", "brides side"].includes(side)) return "bride";
  if (["groom", "groom side", "grooms side", "both", "both sides", "shared"].includes(side)) return "groom";
  return "family";
}

function pathPart(value) {
  const part = String(value || "");
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(part)) {
    throw error("This seating record has an unsupported identifier. Contact the event owner to repair the layout.");
  }
  return part;
}

export function seatAssignmentId(tableId, chairId) {
  return `${pathPart(tableId)}~${pathPart(chairId)}`;
}

export function seatedPersonId(guestId, personKey) {
  return `${pathPart(guestId)}~${pathPart(personKey)}`;
}

export function seatAssignmentRef(api, db, weddingId, tableId, chairId) {
  return api.doc(db, "weddings", weddingId, "seatAssignments", seatAssignmentId(tableId, chairId));
}

export function seatedPersonRef(api, db, weddingId, guestId, personKey) {
  return api.doc(db, "weddings", weddingId, "seatedPeople", seatedPersonId(guestId, personKey));
}

export function seatOccupancyRef(api, db, weddingId, tableId, chairId) {
  return api.doc(db, "weddings", weddingId, "seatOccupancy", seatAssignmentId(tableId, chairId));
}

export function projectSeatAssignments(tables = [], snapshots = [], occupancySnapshots = []) {
  const bySeat = new Map();
  const occupiedSeats = new Set();
  for (const snapshot of snapshots) {
    const value = typeof snapshot.data === "function" ? snapshot.data() : snapshot;
    if (!value?.tableId || !value?.chairId || !value?.guestId) continue;
    bySeat.set(`${value.tableId}\u0000${value.chairId}`, value);
  }
  for (const snapshot of occupancySnapshots) {
    const value = typeof snapshot.data === "function" ? snapshot.data() : snapshot;
    if (value?.tableId && value?.chairId && value?.occupied === true) {
      occupiedSeats.add(`${value.tableId}\u0000${value.chairId}`);
    }
  }
  return tables.map((table) => ({
    ...table,
    chairs: (table.chairs || []).map((chair) => {
      const value = bySeat.get(`${table.id}\u0000${chair.id}`);
      if (!value) {
        const { assignment: _assignment, guestId: _guestId, status: _status, ...layout } = chair;
        const isRestricted = occupiedSeats.has(`${table.id}\u0000${chair.id}`);
        return { ...layout, assignment: isRestricted ? { restricted: true } : null, guestId: "", status: isRestricted ? "assigned" : "available" };
      }
      const guest = value.guest || {};
      return {
        ...chair,
        guestId: value.guestId,
        status: "assigned",
        assignment: {
          guestId: value.guestId,
          partyMemberIndex: Number(value.partyMemberIndex || 0),
          personKey: value.personKey || (Number(value.partyMemberIndex || 0) === 0 ? "main" : `guest-${value.partyMemberIndex}`),
          label: Number(value.partyMemberIndex || 0) === 0 ? "Main guest" : `Additional guest ${value.partyMemberIndex}`,
          tableId: table.id,
          tableName: table.name || table.tableName || "",
          chairId: chair.id,
          seatNumber: Number(chair.seatNumber || value.seatNumber || 0),
          side: value.side || normalizeGuestSide(guest.side),
        },
      };
    }),
  }));
}

function error(message) {
  const value = new Error(message);
  value.code = "seating/invalid-operation";
  return value;
}

function personKeyForIndex(index) {
  return Number(index) === 0 ? "main" : `guest-${Number(index)}`;
}

function allowedSide(permission, side) {
  const allowed = String(permission?.allowedSide || "").toLowerCase();
  return allowed === "all" || (allowed !== "family" && allowed === normalizeGuestSide(side));
}

function assignmentFromSnapshot(snapshot, tableId, chairId) {
  if (!snapshot?.exists()) return null;
  const value = snapshot.data();
  if (!value?.guestId || !Number.isInteger(Number(value.partyMemberIndex))) return null;
  return {
    ...value,
    tableId,
    chairId,
    personKey: value.personKey || personKeyForIndex(value.partyMemberIndex),
  };
}

function requireSeat(tableSnapshot, tableId, chairId) {
  if (!tableSnapshot?.exists()) throw error("That table is no longer available.");
  const table = tableSnapshot.data();
  const chair = Array.isArray(table.chairs) ? table.chairs.find((item) => item.id === chairId) : null;
  if (!chair) throw error("That chair is no longer available.");
  return { table, chair };
}

export async function mutateSeating({ api, db, weddingId, uid, permission, type, source, destination = {} }) {
  if (!api || !db || !weddingId || !uid) throw error("Sign in to an authorized event account first.");
  if (!["assign", "move", "swap", "unassign"].includes(type)) throw error("That seating action is not available.");
  if (String(permission?.allowedSide || "").toLowerCase() === "family") throw error("Family seating access is read-only.");

  return api.runTransaction(db, async (transaction) => {
    // Seating accounts do not have access to the private event document.
    // The owner-maintained summary exposes only the event fields needed here.
    const eventRef = api.doc(db, "weddings", weddingId, "publicSummary", "summary");
    const memberRef = api.doc(db, "weddings", weddingId, "dashboardUsers", uid);
    const [eventSnapshot, memberSnapshot] = await Promise.all([
      transaction.get(eventRef), transaction.get(memberRef),
    ]);
    if (!eventSnapshot.exists()) throw error("This event is unavailable.");
    if (!memberSnapshot.exists()) throw error("This account no longer has access to this event.");
    const livePermission = memberSnapshot.data();
    if (livePermission.canEditSeating !== true || livePermission.seatingOnly === true && livePermission.canEditSeating !== true) {
      throw error("This account cannot edit seating.");
    }
    if (eventSnapshot.data().seatingSchemaVersion !== 2) throw error("The event owner must finish seating setup before this workspace can be used.");
    if (eventSnapshot.data().seatingEnabled === false) throw error("Seating is disabled for this event.");
    if (eventSnapshot.data().eventCategory === "celebration" && !["all", "general"].includes(String(livePermission.allowedSide || "").toLowerCase())) {
      throw error("This account cannot edit seating for this event.");
    }

    const sourceTableId = type === "assign" ? "" : String(source?.tableId || "");
    const sourceChairId = type === "assign" ? "" : String(source?.chairId || "");
    const destinationTableId = type === "unassign" ? "" : String(destination?.tableId || "");
    const destinationChairId = type === "unassign" ? "" : String(destination?.chairId || "");
    if (type !== "assign" && (!sourceTableId || !sourceChairId)) throw error("Choose an occupied chair first.");
    if (type !== "unassign" && (!destinationTableId || !destinationChairId)) throw error("Choose a destination chair.");

    const tableIds = [...new Set([sourceTableId, destinationTableId].filter(Boolean))];
    const tableRefs = tableIds.map((id) => api.doc(db, "weddings", weddingId, "tables", id));
    const tableSnapshots = await Promise.all(tableRefs.map((ref) => transaction.get(ref)));
    const tablesById = new Map(tableIds.map((id, index) => [id, tableSnapshots[index]]));
    const sourceSeatRef = sourceTableId ? seatAssignmentRef(api, db, weddingId, sourceTableId, sourceChairId) : null;
    const destinationSeatRef = destinationTableId ? seatAssignmentRef(api, db, weddingId, destinationTableId, destinationChairId) : null;
    const occupancyRefs = [...new Set([sourceTableId ? seatOccupancyRef(api, db, weddingId, sourceTableId, sourceChairId) : null,
      destinationTableId ? seatOccupancyRef(api, db, weddingId, destinationTableId, destinationChairId) : null].filter(Boolean))];
    const seatRefs = [...new Set([sourceSeatRef, destinationSeatRef].filter(Boolean))];
    const [seatSnapshots, occupancySnapshots] = await Promise.all([
      Promise.all(seatRefs.map((ref) => transaction.get(ref))),
      Promise.all(occupancyRefs.map((ref) => transaction.get(ref))),
    ]);
    const seatByPath = new Map(seatRefs.map((ref, index) => [ref.path, seatSnapshots[index]]));
    const occupancyByPath = new Map(occupancyRefs.map((ref, index) => [ref.path, occupancySnapshots[index]]));
    const sourceAssignment = sourceSeatRef
      ? assignmentFromSnapshot(seatByPath.get(sourceSeatRef.path), sourceTableId, sourceChairId)
      : null;
    const destinationAssignment = destinationSeatRef
      ? assignmentFromSnapshot(seatByPath.get(destinationSeatRef.path), destinationTableId, destinationChairId)
      : null;

    const requestedGuestId = type === "assign" ? String(source?.guestId || "") : "";
    const affectedGuestIds = [...new Set([
      requestedGuestId,
      sourceAssignment?.guestId,
      type === "swap" ? destinationAssignment?.guestId : "",
    ].filter(Boolean))];
    const guestRefs = affectedGuestIds.map((id) => api.doc(db, "weddings", weddingId, "seatingGuests", id));
    const guestSnapshots = await Promise.all(guestRefs.map((ref) => transaction.get(ref)));
    const guestsById = new Map(affectedGuestIds.map((id, index) => [id, guestSnapshots[index]?.exists() ? guestSnapshots[index].data() : null]));
    if (affectedGuestIds.some((id) => !guestsById.get(id))) throw error("A guest in this seating change no longer exists.");

    for (const [tableId, chairId] of [[sourceTableId, sourceChairId], [destinationTableId, destinationChairId]]) {
      if (!tableId) continue;
      requireSeat(tablesById.get(tableId), tableId, chairId);
    }
    const sourceOccupancy = sourceSeatRef
      ? occupancyByPath.get(seatOccupancyRef(api, db, weddingId, sourceTableId, sourceChairId).path)
      : null;
    const destinationOccupancy = destinationSeatRef
      ? occupancyByPath.get(seatOccupancyRef(api, db, weddingId, destinationTableId, destinationChairId).path)
      : null;
    if (sourceSeatRef && (!sourceOccupancy?.exists() || sourceOccupancy.data().occupied !== true)) throw error("The selected chair is no longer occupied.");
    if (destinationSeatRef && !destinationOccupancy?.exists()) throw error("The destination chair has not been prepared yet. Ask the event owner to repair seating.");
    if (sourceSeatRef && !sourceAssignment) throw error("The selected chair's assignment record is missing. Ask the event owner to repair seating.");
    if (destinationSeatRef && destinationOccupancy.data().occupied !== Boolean(destinationAssignment)) throw error("The destination chair records are out of sync. Ask the event owner to repair seating.");
    if (["assign", "move"].includes(type) && destinationOccupancy.data().occupied === true) throw error("That chair was just assigned by someone else.");
    if (type === "swap" && destinationOccupancy.data().occupied !== true) throw error("That chair is no longer occupied.");
    if (type === "move" && !sourceAssignment) throw error("The selected chair is no longer occupied.");
    if (type === "swap" && (!sourceAssignment || !destinationAssignment)) throw error("Both chairs must still be occupied to swap.");
    if (["move", "unassign"].includes(type) && !sourceAssignment) throw error("The selected chair is no longer occupied.");
    if (sourceTableId === destinationTableId && sourceChairId === destinationChairId && type !== "unassign") return { unchanged: true };
    if (type === "move" && destinationAssignment) throw error("Choose an empty chair to move this person.");
    if (type === "swap" && !destinationAssignment) throw error("Choose an occupied chair to swap.");

    const people = new Map();
    const addPerson = (assignment) => {
      if (!assignment) return;
      const id = seatedPersonId(assignment.guestId, assignment.personKey);
      people.set(id, { assignment, ref: seatedPersonRef(api, db, weddingId, assignment.guestId, assignment.personKey) });
    };
    addPerson(sourceAssignment);
    if (type === "swap") addPerson(destinationAssignment);
    if (type === "assign") {
      const index = Number(source?.partyMemberIndex);
      if (!Number.isInteger(index) || index < 0 || index > 10) throw error("That guest party member is invalid.");
      const guest = guestsById.get(requestedGuestId);
      if (index > Math.max(0, Number(guest.additionalGuests || 0))) throw error("That additional guest is not included in this RSVP.");
      if (!allowedSide(livePermission, guest.side)) throw error("This account cannot seat guests on the other side.");
      const personKey = personKeyForIndex(index);
      const id = seatedPersonId(requestedGuestId, personKey);
      people.set(id, { assignment: null, ref: seatedPersonRef(api, db, weddingId, requestedGuestId, personKey) });
    }
    for (const { assignment } of people.values()) {
      if (assignment && !allowedSide(livePermission, guestsById.get(assignment.guestId)?.side)) {
        throw error("This account cannot edit a guest from the other side.");
      }
    }
    const personRefs = [...people.values()].map((item) => item.ref);
    const personSnapshots = await Promise.all(personRefs.map((ref) => transaction.get(ref)));
    const personByPath = new Map(personRefs.map((ref, index) => [ref.path, personSnapshots[index]]));
    for (const { assignment, ref } of people.values()) {
      const snapshot = personByPath.get(ref.path);
      if (assignment) {
        const binding = snapshot?.exists() ? snapshot.data() : null;
        if (!binding || binding.tableId !== assignment.tableId || binding.chairId !== assignment.chairId) {
          throw error("The guest's existing chair binding changed. Refresh the seating plan.");
        }
      } else if (snapshot?.exists()) {
        throw error("That person already has a chair. Refresh the seating plan.");
      }
    }

    let first = sourceAssignment;
    let second = destinationAssignment;
    if (type === "assign") {
      const guest = guestsById.get(requestedGuestId);
      const index = Number(source.partyMemberIndex);
      first = {
        guestId: requestedGuestId, partyMemberIndex: index, personKey: personKeyForIndex(index),
        side: normalizeGuestSide(guest.side), tableId: destinationTableId, chairId: destinationChairId,
      };
      second = null;
    } else if (type === "move") {
      first = { ...sourceAssignment, tableId: destinationTableId, chairId: destinationChairId };
      second = null;
    } else if (type === "unassign") {
      first = null;
      second = null;
    } else {
      first = { ...sourceAssignment, tableId: destinationTableId, chairId: destinationChairId };
      second = { ...destinationAssignment, tableId: sourceTableId, chairId: sourceChairId };
    }

    const setSeat = (tableId, chairId, assignment, tableSnapshot) => {
      const ref = seatAssignmentRef(api, db, weddingId, tableId, chairId);
      const occupancyRef = seatOccupancyRef(api, db, weddingId, tableId, chairId);
      if (!assignment) {
        transaction.delete(ref);
        transaction.set(occupancyRef, { weddingId, tableId, chairId, occupied: false, updatedAt: api.serverTimestamp() });
        return;
      }
      const { table, chair } = requireSeat(tableSnapshot, tableId, chairId);
      const guest = guestsById.get(assignment.guestId);
      transaction.set(ref, {
        weddingId, tableId, chairId, guestId: assignment.guestId,
        partyMemberIndex: Number(assignment.partyMemberIndex),
        personKey: assignment.personKey || personKeyForIndex(assignment.partyMemberIndex),
        side: normalizeGuestSide(guest.side),
        seatNumber: Number(chair.seatNumber || 0),
        updatedAt: api.serverTimestamp(),
      });
      transaction.set(occupancyRef, { weddingId, tableId, chairId, occupied: true, updatedAt: api.serverTimestamp() });
    };
    if (type === "assign") {
      setSeat(destinationTableId, destinationChairId, first, tablesById.get(destinationTableId));
      const bindingRef = seatedPersonRef(api, db, weddingId, first.guestId, first.personKey);
      transaction.set(bindingRef, { weddingId, guestId: first.guestId, personKey: first.personKey,
        tableId: destinationTableId, chairId: destinationChairId, side: first.side, updatedAt: api.serverTimestamp() });
    } else if (type === "move") {
      setSeat(sourceTableId, sourceChairId, null);
      setSeat(destinationTableId, destinationChairId, first, tablesById.get(destinationTableId));
      const bindingRef = seatedPersonRef(api, db, weddingId, first.guestId, first.personKey);
      transaction.update(bindingRef, { tableId: destinationTableId, chairId: destinationChairId, updatedAt: api.serverTimestamp() });
    } else if (type === "unassign") {
      setSeat(sourceTableId, sourceChairId, null);
      const bindingRef = seatedPersonRef(api, db, weddingId, sourceAssignment.guestId, sourceAssignment.personKey);
      transaction.delete(bindingRef);
    } else {
      setSeat(sourceTableId, sourceChairId, second, tablesById.get(sourceTableId));
      setSeat(destinationTableId, destinationChairId, first, tablesById.get(destinationTableId));
      const firstBinding = seatedPersonRef(api, db, weddingId, sourceAssignment.guestId, sourceAssignment.personKey);
      const secondBinding = seatedPersonRef(api, db, weddingId, destinationAssignment.guestId, destinationAssignment.personKey);
      transaction.update(firstBinding, { tableId: destinationTableId, chairId: destinationChairId, updatedAt: api.serverTimestamp() });
      transaction.update(secondBinding, { tableId: sourceTableId, chairId: sourceChairId, updatedAt: api.serverTimestamp() });
    }
    return { unchanged: false };
  });
}

export async function migrateLegacySeating({ api, db, weddingId, uid }) {
  const eventRef = api.doc(db, "weddings", weddingId);
  const [eventSnapshot, tablesSnapshot, guestsSnapshot, existingAssignmentsSnapshot] = await Promise.all([
    api.getDoc(eventRef),
    api.getDocs(api.collection(db, "weddings", weddingId, "tables")),
    api.getDocs(api.collection(db, "weddings", weddingId, "guests")),
    api.getDocs(api.collection(db, "weddings", weddingId, "seatAssignments")),
  ]);
  if (!eventSnapshot.exists() || eventSnapshot.data().ownerUserId !== uid) throw error("Only the event owner can prepare seating data.");
  if (eventSnapshot.data().seatingSchemaVersion === 2) return { migrated: 0 };
  const migrationRef = api.doc(db, "weddings", weddingId, "seatingMigrations", "canonical-v2");
  await api.setDoc(migrationRef, {
    status: "running", startedAt: api.serverTimestamp(), updatedAt: api.serverTimestamp(),
    lastTableId: "", migratedTables: 0, migratedGuests: 0,
  }, { merge: true });

  const guests = new Map(guestsSnapshot.docs.map((snapshot) => [snapshot.id, { ...snapshot.data(), id: snapshot.id }]));
  const assignments = new Map();
  const personSeats = new Map();
  const tableData = new Map(tablesSnapshot.docs.map((snapshot) => [snapshot.id, snapshot.data()]));
  function add(tableId, chairId, guestId, partyMemberIndex = 0) {
    const guest = guests.get(guestId);
    if (!guest) throw error(`Cannot migrate seating: guest ${guestId} is missing.`);
    const index = Number(partyMemberIndex || 0);
    if (!Number.isInteger(index) || index < 0 || index > Math.max(0, Number(guest.additionalGuests || 0))) {
      throw error(`Cannot migrate seating: party member index for ${guestId} is invalid.`);
    }
    const key = `${tableId}\u0000${chairId}`;
    const personKey = personKeyForIndex(index);
    const personId = seatedPersonId(guestId, personKey);
    const value = { weddingId, tableId, chairId, guestId, partyMemberIndex: index, personKey,
      side: normalizeGuestSide(guest.side), seatNumber: 0 };
    const priorSeat = assignments.get(key);
    if (priorSeat && (priorSeat.guestId !== guestId || priorSeat.personKey !== personKey)) {
      throw error(`Cannot migrate seating: ${tableId}/${chairId} has conflicting assignments.`);
    }
    const priorPersonSeat = personSeats.get(personId);
    if (priorPersonSeat && (priorPersonSeat.tableId !== tableId || priorPersonSeat.chairId !== chairId)) {
      throw error(`Cannot migrate seating: ${guestId} ${personKey} occupies more than one chair.`);
    }
    assignments.set(key, value);
    personSeats.set(personId, value);
  }

  for (const tableDoc of tablesSnapshot.docs) {
    const table = tableDoc.data();
    for (const [index, chair] of (Array.isArray(table.chairs) ? table.chairs : []).entries()) {
      const legacy = chair.assignment || (chair.guestId ? { guestId: chair.guestId } : null);
      if (!legacy?.guestId) continue;
      const chairId = chair.id || `${tableDoc.id}-chair-${index + 1}`;
      add(tableDoc.id, chairId, legacy.guestId, legacy.partyMemberIndex ?? (legacy.personKey === "main" ? 0 : Number(String(legacy.personKey || "").replace("guest-", "")) || 0));
    }
  }
  for (const [guestId, guest] of guests) {
    for (const assignment of Array.isArray(guest.seatingAssignments) ? guest.seatingAssignments : []) {
      const tableId = String(assignment?.tableId || "");
      const table = tableData.get(tableId);
      const chair = table?.chairs?.find((item) => item.id === assignment.chairId || Number(item.seatNumber) === Number(assignment.seatNumber));
      if (!table || !chair) throw error(`Cannot migrate seating: ${guestId} references a missing chair.`);
      add(tableId, chair.id, guestId, assignment.partyMemberIndex ?? (assignment.personKey === "main" ? 0 : Number(String(assignment.personKey || "").replace("guest-", "")) || 0));
    }
  }

  // If a previous attempt completed a table transaction before interruption,
  // keep those canonical assignments as input on the next idempotent run.
  for (const snapshot of existingAssignmentsSnapshot.docs) {
    const item = snapshot.data();
    if (!item?.tableId || !item?.chairId || !item?.guestId) throw error(`Cannot resume seating migration: ${snapshot.id} is malformed.`);
    add(item.tableId, item.chairId, item.guestId, item.partyMemberIndex);
  }

  const perTable = new Map();
  for (const assignment of assignments.values()) {
    const table = tableData.get(assignment.tableId);
    const chair = table?.chairs?.find((item) => item.id === assignment.chairId);
    if (!chair) throw error(`Cannot migrate seating: ${assignment.tableId}/${assignment.chairId} is missing.`);
    assignment.seatNumber = Number(chair.seatNumber || 0);
    if (!perTable.has(assignment.tableId)) perTable.set(assignment.tableId, []);
    perTable.get(assignment.tableId).push(assignment);
  }

  // Create the private, minimal guest projection before seat documents. Rules
  // validate every assignment against this projection rather than reading the
  // full guest record from a side-scoped seating account.
  for (let offset = 0; offset < guestsSnapshot.docs.length; offset += 400) {
    const batch = api.writeBatch(db);
    guestsSnapshot.docs.slice(offset, offset + 400).forEach((snapshot) => {
      const value = snapshot.data();
      batch.set(api.doc(db, "weddings", weddingId, "seatingGuests", snapshot.id), {
        fullName: String(value.fullName || "Guest").slice(0, 160),
        side: normalizeGuestSide(value.side),
        additionalGuests: Math.max(0, Math.min(10, Number(value.additionalGuests || 0))),
        rsvpStatus: ["confirmed", "declined"].includes(value.rsvpStatus) ? value.rsvpStatus : "pending",
        updatedAt: api.serverTimestamp(),
      }, { merge: true });
    });
    await batch.commit();
  }

  for (const tableDoc of tablesSnapshot.docs) {
    const tableId = tableDoc.id;
    await api.runTransaction(db, async (transaction) => {
      const liveTableSnapshot = await transaction.get(tableDoc.ref);
      if (!liveTableSnapshot.exists()) return;
      const liveTable = liveTableSnapshot.data();
      const currentAssignments = perTable.get(tableId) || [];
      const chairs = Array.isArray(liveTable.chairs) ? liveTable.chairs : [];
      const chairIds = chairs.map((chair, index) => chair.id || `${tableId}-chair-${index + 1}`);
      if (new Set(chairIds).size !== chairIds.length) throw error(`Cannot migrate seating: ${tableId} contains duplicate chair IDs.`);
      const seatRefs = chairIds.map((chairId) => seatAssignmentRef(api, db, weddingId, tableId, chairId));
      const seatRefByChair = new Map(chairIds.map((chairId, index) => [chairId, seatRefs[index]]));
      const occupancyRefs = chairIds.map((chairId) => seatOccupancyRef(api, db, weddingId, tableId, chairId));
      const personRefs = currentAssignments.map((item) => seatedPersonRef(api, db, weddingId, item.guestId, item.personKey));
      const allRefs = [...seatRefs, ...occupancyRefs, ...personRefs];
      const snapshots = await Promise.all(allRefs.map((ref) => transaction.get(ref)));
      const assignmentByChair = new Map(currentAssignments.map((item) => [item.chairId, item]));
      chairIds.forEach((chairId, index) => {
        const seat = snapshots[index];
        const expected = assignmentByChair.get(chairId);
        if (expected && (!seat.exists() || seat.data().guestId !== expected.guestId || seat.data().personKey !== expected.personKey)) {
          if (seat.exists() && (seat.data().guestId !== expected.guestId || seat.data().personKey !== expected.personKey)) {
            throw error(`Cannot migrate seating: ${tableId}/${chairId} is already bound to another person.`);
          }
        }
        if (!expected && seat.exists()) throw error(`Cannot migrate seating: ${tableId}/${chairId} has an unrecognized assignment.`);
      });
      currentAssignments.forEach((item, index) => {
        const binding = snapshots[chairIds.length + occupancyRefs.length + index];
        if (binding.exists() && (binding.data().tableId !== tableId || binding.data().chairId !== item.chairId)) {
          throw error(`Cannot migrate seating: ${item.guestId} ${item.personKey} is already bound to another chair.`);
        }
      });
      const nextChairs = chairs.map((chair, index) => {
        const { assignment: _assignment, guestId: _guestId, status: _status, ...layout } = chair;
        if (!layout.id) layout.id = `${tableId}-chair-${index + 1}`;
        return layout;
      });
      const assignedByChair = assignmentByChair;
      chairIds.forEach((chairId, index) => {
        const occupancyRef = occupancyRefs[index];
        const priorOccupancy = snapshots[chairIds.length + index];
        const shouldBeOccupied = assignedByChair.has(chairId);
        const occupancy = priorOccupancy.exists() ? priorOccupancy.data() : null;
        if (occupancy && occupancy.occupied === true && !shouldBeOccupied && !assignedByChair.has(chairId)) {
          throw error(`Cannot migrate seating: ${tableId}/${chairId} has an existing canonical occupancy marker.`);
        }
        transaction.set(occupancyRef, {
          weddingId, tableId, chairId, occupied: shouldBeOccupied, updatedAt: api.serverTimestamp(),
        });
      });
      for (const [index, item] of currentAssignments.entries()) {
        transaction.set(seatRefByChair.get(item.chairId), { ...item, updatedAt: api.serverTimestamp() });
        transaction.set(personRefs[index], { weddingId, guestId: item.guestId, personKey: item.personKey,
          tableId, chairId: item.chairId, side: item.side, updatedAt: api.serverTimestamp() });
      }
      if (JSON.stringify(liveTable.chairs) !== JSON.stringify(nextChairs) || liveTable.guestIds) {
        transaction.update(tableDoc.ref, { chairs: nextChairs, guestIds: [], updatedAt: api.serverTimestamp() });
      }
    });
    await api.updateDoc(migrationRef, {
      lastTableId: tableId,
      migratedTables: (tablesSnapshot.docs.findIndex((item) => item.id === tableId) + 1),
      updatedAt: api.serverTimestamp(),
    });
  }

  for (let offset = 0; offset < guestsSnapshot.docs.length; offset += 400) {
    const batch = api.writeBatch(db);
    guestsSnapshot.docs.slice(offset, offset + 400).forEach((snapshot) => {
      const value = snapshot.data();
      const patch = { seatingAssignments: [], tableId: "", tableName: "", seatNumber: "", updatedAt: api.serverTimestamp() };
      if (Array.isArray(value.seatingAssignments) && value.seatingAssignments.length || value.tableId || value.seatNumber) {
        batch.update(snapshot.ref, patch);
      }
    });
    await batch.commit();
  }
  await api.updateDoc(eventRef, { seatingSchemaVersion: 2, updatedAt: api.serverTimestamp() });
  await api.updateDoc(migrationRef, { status: "complete", migratedGuests: guestsSnapshot.size, updatedAt: api.serverTimestamp() });
  return { migrated: assignments.size };
}
