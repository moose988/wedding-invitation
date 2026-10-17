import { buildInvitationProjection, isValidInvitationToken } from "./invitations/shared/invitation-token.js";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
function normalizedSide(value) {
  const side = String(value || "").toLowerCase().trim();
  if (side === "general") return "general";
  if (["bride", "bride side", "brides side"].includes(side)) return "bride";
  if (["groom", "groom side", "grooms side", "both", "both sides", "shared"].includes(side)) return "groom";
  return "family";
}

export function publicTableLayout(table) {
  const defaults = { name: "Table", shape: "round", x: 20, y: 20, width: 180, height: 180, rotation: 0, seatCount: 0, tableColor: "", borderColor: "", chairColor: "" };
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, table[key] ?? fallback]));
}

// Each derivative is checked against canonical documents by the rules. Never
// enumerate the private check-in projection or write aggregate/maintenance data.
export async function syncCustomerEventProjections(api, db, weddingId) {
  const [guestRows, tableRows] = await Promise.all([
    api.getDocs(api.collection(db, "weddings", weddingId, "guests")),
    api.getDocs(api.collection(db, "weddings", weddingId, "tables")),
  ]);
  const tables = tableRows.docs.map((row) => ({ ...row.data(), id: row.id }));
  const event = await api.getDoc(api.doc(db, "weddings", weddingId));
  const hallObjects = buildInvitationProjection(weddingId, event.data()).wedding.hallObjects;
  const previousVenue = await api.getDocs(api.collection(db, "weddings", weddingId, "publicVenue"));
  const objectIds = hallObjects.map((item, index) => item.id || `object-${index}`);
  for (const row of previousVenue.docs) if (!objectIds.includes(row.id)) await api.deleteDoc(row.ref);
  for (let index = 0; index < hallObjects.length; index++) await api.setDoc(api.doc(db, "weddings", weddingId, "publicVenue", objectIds[index]), { ...hallObjects[index], index, updatedAt: api.serverTimestamp() });
  const oldLayouts = await api.getDocs(api.collection(db, "weddings", weddingId, "publicLayouts"));
  for (const layout of oldLayouts.docs) if (!tables.some((table) => table.id === layout.id)) await api.deleteDoc(layout.ref);
  for (const table of tables) {
    await api.setDoc(api.doc(db, "weddings", weddingId, "publicLayouts", table.id), { ...publicTableLayout(table), updatedAt: api.serverTimestamp() });
  }
  for (const row of guestRows.docs) {
    await api.runTransaction(db, async (transaction) => {
      const guestRef = row.ref;
      const guestSnap = await transaction.get(guestRef);
      if (!guestSnap.exists()) return;
      const guest = { ...guestSnap.data(), id: row.id };
      const bindings = await Promise.all(Array.from({ length: 1 + Number(guest.additionalGuests || 0) }, (_, index) =>
        transaction.get(api.doc(db, "weddings", weddingId, "seatedPeople", `${row.id}~${index ? `guest-${index}` : "main"}`))));
      const assignments = bindings.filter((snap) => snap.exists()).map((snap) => snap.data());
      const liveTableIds = [...new Set(assignments.map((item) => item.tableId))];
      const liveTables = await Promise.all(liveTableIds.map((id) => transaction.get(api.doc(db, "weddings", weddingId, "tables", id))));
      const tableById = new Map(liveTables.filter((snap) => snap.exists()).map((snap) => [snap.id, snap.data()]));
      const seatingAssignments = assignments.flatMap((item) => {
        const table = tableById.get(item.tableId);
        const chair = table?.chairs?.find((entry) => entry.id === item.chairId);
        return chair ? [{ tableId: item.tableId, chairId: item.chairId, tableName: table.name || "", seatNumber: Number(chair.seatNumber), personKey: item.personKey, partyMemberIndex: item.personKey === "main" ? 0 : Number(item.personKey.slice(6)), label: item.personKey === "main" ? "Main guest" : `Additional guest ${item.personKey.slice(6)}` }] : [];
      });
      const primary = seatingAssignments.find((item) => item.personKey === "main") || seatingAssignments[0];
      const patch = { seatingAssignments: seatingAssignments.map(({ tableId, tableName, seatNumber, personKey, label }) => ({ tableId, tableName, seatNumber: String(seatNumber), personKey, label })), tableId: primary?.tableId || "", tableName: primary?.tableName || "", seatNumber: primary ? String(primary.seatNumber) : "" };
      // Listener refreshes must never become a new canonical edit. In
      // particular, absent optional fields and empty strings are equivalent.
      if (!Object.entries(patch).every(([key, value]) => equal(guest[key] ?? (Array.isArray(value) ? [] : ""), value))) {
        transaction.update(guestRef, { ...patch, updatedAt: api.serverTimestamp() });
      }
      transaction.set(api.doc(db, "weddings", weddingId, "seatingGuests", row.id), {
        fullName: guest.fullName, side: normalizedSide(guest.side), additionalGuests: guest.additionalGuests || 0, rsvpStatus: guest.rsvpStatus || "pending", updatedAt: api.serverTimestamp(),
      });
      transaction.set(api.doc(db, "weddings", weddingId, "checkinGuests", row.id), {
        guestId: row.id, fullName: guest.fullName, phone: guest.phone || "", side: normalizedSide(guest.side),
        rsvpStatus: guest.rsvpStatus || "pending", tableId: patch.tableId, tableName: patch.tableName, seatNumber: patch.seatNumber,
        checkedIn: guest.checkedIn === true, checkedInAt: guest.checkedInAt || null, updatedAt: api.serverTimestamp(),
      });
    });
    // Projection validation has its own transaction/access budget. Re-read the
    // canonical source after the seating-summary commit; never publish a stale
    // in-memory snapshot or weaken the canonical validation to fit one batch.
    await api.runTransaction(db, async (transaction) => {
      const [guestSnap, eventSnap, secretSnap] = await Promise.all([
        transaction.get(row.ref), transaction.get(api.doc(db, "weddings", weddingId)),
        transaction.get(api.doc(db, "weddings", weddingId, "invitationSecrets", row.id)),
      ]);
      if (!guestSnap.exists()) return;
      const secret = secretSnap.data();
      if (secret?.status !== "active" || !isValidInvitationToken(secret.token)) return;
      const ref = api.doc(db, "weddings", weddingId, "publicGuests", secret.token);
      const old = await transaction.get(ref);
      if (!old.exists()) return; // Never resurrect a removed capability.
      const guest = guestSnap.data();
      const projection = buildInvitationProjection(weddingId, eventSnap.data(), guest, tables, { canonicalLayout: true });
      transaction.set(ref, { ...projection, rsvpStatus: guest.rsvpStatus || "pending", additionalGuests: guest.additionalGuests || 0,
        rsvpMessage: guest.rsvpMessage || "", expiresAt: null, updatedAt: api.serverTimestamp() });
    });
  }
}
