import { buildInvitationProjection, isValidInvitationToken } from "./invitations/shared/invitation-token.js?v=20261018-guest-invitation-regressions-2";
import { checkinGuestData, seatingGuestData } from "./guest-edit.js?v=20261018-guest-invitation-regressions-2";

function comparable(value) {
  if (Array.isArray(value)) return value.map(comparable);
  if (value?.toMillis) return value.toMillis();
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).filter((key) => !["updatedAt", "createdAt"].includes(key)).sort().map((key) => [key, comparable(value[key])]));
  return value;
}
export const projectionEqual = (left, right) => JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
export const publicEventFields = ["eventTitle", "eventTitleAr", "coupleName", "brideName", "groomName", "brideNameAr", "groomNameAr", "eventCategory", "eventStatus", "eventDateISO", "eventTimeZone", "rsvpDeadlineISO", "timeEn", "timeAr", "venueEn", "location", "locationEn", "mapsUrl", "venueMapEmbedUrl", "subtitleEn", "subtitleAr", "invitationMessageEn", "invitationMessageAr", "genderRevealArtworkUrl", "genderRevealOpeningVideoUrl", "genderRevealMusicUrl", "genderRevealMessageEn", "genderRevealMessageAr", "invitationLanguage", "showInvitationQr", "seatingEnabled", "schedule"];
const scheduleFields = ["titleEn", "titleAr", "time", "timeEn", "timeAr", "descriptionEn", "descriptionAr"];
export function publicEventData(event) {
  const genderReveal = event.eventCategory === "gender_reveal";
  const defaults = { eventCategory: "wedding_engagement", eventStatus: "draft", invitationLanguage: "en", showInvitationQr: true, seatingEnabled: true, schedule: [], eventTitleAr: "", eventTimeZone: "", genderRevealArtworkUrl: "", genderRevealOpeningVideoUrl: "", genderRevealMusicUrl: "", genderRevealMessageEn: "", genderRevealMessageAr: "" };
  const data = Object.fromEntries(publicEventFields.map((key) => [key, event[key] ?? defaults[key] ?? ""]));
  if (event.invitationTemplate) data.invitationTemplate = event.invitationTemplate;
  data.eventStatus = event.status || "draft";
  if (genderReveal) {
    data.showInvitationQr = false;
    data.seatingEnabled = false;
    data.coupleName = "";
    data.brideName = "";
    data.groomName = "";
    data.brideNameAr = "";
    data.groomNameAr = "";
    data.venueEn = event.venueEn || "";
    data.mapsUrl = event.mapsUrl || "";
  }
  data.schedule = [];
  data.scheduleCount = (event.schedule || []).length;
  return data;
}
export function publicScheduleData(item, index) {
  return { index, ...Object.fromEntries(scheduleFields.map((key) => [key, typeof item[key] === "string" ? item[key] : ""])) };
}
export function publicTableData(table, previous = {}, before = table) {
  const defaults = { name: "Table", shape: "round", x: 20, y: 20, width: 180, height: 180, rotation: 0, seatCount: 0, tableColor: "", borderColor: "", chairColor: "" };
  return { ...Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, table[key] ?? value])),
    aliases: [...new Set([...(previous.aliases || []), ...[previous.name, before?.name].filter((name) => name !== table.name)].filter((name) => typeof name === "string" && name))].slice(-100) };
}
export function publicVenueData(item, index) {
  const defaults = { id: "", type: "", label: "", x: 50, y: 50, width: 280, height: 280, rotation: 0, shape: "", fillColor: "", borderColor: "" };
  return { index, ...Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, item[key] ?? value])) };
}

export function createEventPublisher({ api, db, weddingId, isCurrent = () => true, beforePublish = () => {} }) {
  const current = () => { if (!isCurrent()) throw Object.assign(new Error("This editing session has ended."), { code: "cancelled" }); };
  const ref = (...parts) => api.doc(db, "weddings", weddingId, ...parts);
  let initialized = false;

  async function refreshGuestSeating(guestId) {
    current();
    await api.runTransaction(db, async (transaction) => {
      const guestRef = ref("guests", guestId);
      const [snapshot, event] = await Promise.all([transaction.get(guestRef), transaction.get(ref())]);
      if (!snapshot.exists()) return;
      // Older seating schemas require their existing explicit migration. A
      // projection repair must never erase legacy assignments or identities.
      if (event.data()?.seatingSchemaVersion !== 2) return;
      const guest = snapshot.data();
      const bindings = await Promise.all(Array.from({ length: 11 }, (_, index) => transaction.get(ref("seatedPeople", `${guestId}~${index ? `guest-${index}` : "main"}`))));
      const seats = bindings.filter((row) => row.exists()).map((row) => row.data());
      const ids = [...new Set(seats.map((seat) => seat.tableId))];
      const tables = await Promise.all(ids.map((id) => transaction.get(ref("tables", id))));
      const byId = new Map(tables.filter((row) => row.exists()).map((row) => [row.id, row.data()]));
      const assignments = seats.flatMap((seat) => {
        const table = byId.get(seat.tableId), chair = table?.chairs?.find((item) => item.id === seat.chairId);
        if (!chair) return [];
        return [{ tableId: seat.tableId, tableName: table.name || "", seatNumber: String(chair.seatNumber), personKey: seat.personKey, label: seat.personKey === "main" ? "Main guest" : `Additional guest ${seat.personKey.slice(6)}` }];
      });
      const primary = assignments.find((seat) => seat.personKey === "main") || assignments[0];
      const patch = { seatingAssignments: assignments, tableId: primary?.tableId || "", tableName: primary?.tableName || "", seatNumber: primary?.seatNumber || "" };
      if (Object.entries(patch).every(([key, value]) => projectionEqual(guest[key] ?? (Array.isArray(value) ? [] : ""), value))) return;
      current();
      transaction.update(guestRef, { ...patch, updatedAt: api.serverTimestamp() });
      transaction.set(ref("checkinGuests", guestId), { ...checkinGuestData(guestId, { ...guest, ...patch }), updatedAt: api.serverTimestamp() });
    });
  }

  async function publishGuest(guestId, seating = false) {
    current(); beforePublish(); current();
    if (seating) await refreshGuestSeating(guestId);
    current();
    await api.runTransaction(db, async (transaction) => {
      current();
      const [guestSnapshot, secretSnapshot] = await Promise.all([transaction.get(ref("guests", guestId)), transaction.get(ref("invitationSecrets", guestId))]);
      if (!guestSnapshot.exists()) return;
      const secret = secretSnapshot.data();
      current();
      if (secret?.status !== "active" || !isValidInvitationToken(secret.token)) return;
      const publicRef = ref("publicGuests", secret.token);
      const [index, old] = await Promise.all([transaction.get(ref("invitationTokens", secret.token)), transaction.get(publicRef)]);
      current();
      if (!old.exists() || !index.exists() || index.data().status !== "active" || index.data().guestId !== guestId) return;
      const guest = guestSnapshot.data();
      const data = { ...buildInvitationProjection(weddingId, {}, guest, [], { canonicalLayout: true }), wedding: old.data().wedding,
        rsvpStatus: guest.rsvpStatus || "pending", additionalGuests: guest.additionalGuests || 0, rsvpMessage: guest.rsvpMessage || "", expiresAt: index.data().expiresAt ?? null };
      // Reading canonical RSVP and the capability in this transaction means a
      // concurrent RSVP/revocation causes an SDK retry, never an overwrite.
      const assignmentsChanged = !projectionEqual(index.data().seatingAssignments, data.guest.seatingAssignments);
      if (projectionEqual(old.data(), data) && !assignmentsChanged) return;
      current();
      if (assignmentsChanged) transaction.update(ref("invitationTokens", secret.token), {
        seatingAssignments: data.guest.seatingAssignments, updatedAt: api.serverTimestamp(),
      });
      if (!projectionEqual(old.data(), data)) transaction.set(publicRef, { ...data, updatedAt: api.serverTimestamp() });
    });
  }

  async function repairGuest(guestId, { checkinRead = false } = {}) {
    current(); beforePublish(); current();
    await refreshGuestSeating(guestId);
    await api.runTransaction(db, async (transaction) => {
      const targets = [ref("seatingGuests", guestId), ref("checkinGuests", guestId)];
      const [guest, ...previous] = await Promise.all([transaction.get(ref("guests", guestId)), transaction.get(targets[0]), ...(checkinRead ? [transaction.get(targets[1])] : [])]);
      current();
      if (!guest.exists()) return;
      const values = [seatingGuestData(guest.data()), checkinGuestData(guestId, guest.data())];
      targets.forEach((target, index) => {
        // Check-in readers can repair that mirror independently. Customer
        // repair keeps its existing read permissions and only refreshes it
        // when the seating derivative actually needs repair.
        const needsWrite = index === 1 && !checkinRead
          ? !previous[0].exists() || !projectionEqual(previous[0].data(), values[0])
          : !previous[index].exists() || !projectionEqual(previous[index].data(), values[index]);
        if (needsWrite) transaction.set(target, { ...values[index], updatedAt: api.serverTimestamp() });
      });
    });
    await publishGuest(guestId);
  }

  async function publishTable(tableId) {
    await api.runTransaction(db, async (transaction) => {
      const target = ref("publicLayouts", tableId);
      const [table, previous] = await Promise.all([transaction.get(ref("tables", tableId)), transaction.get(target)]);
      current();
      if (!table.exists()) { if (previous.exists()) transaction.delete(target); return; }
      const data = publicTableData(table.data(), previous.data());
      if (!previous.exists() || !projectionEqual(previous.data(), data)) transaction.set(target, { ...data, updatedAt: api.serverTimestamp() });
    });
  }

  async function publishVenue() {
    current();
    const [event, old] = await Promise.all([api.getDoc(ref()), api.getDocs(api.collection(db, "weddings", weddingId, "publicVenue"))]);
    if (!event.exists()) return;
    const objects = event.data().hallObjects || [];
    const ids = new Set([...objects.map((item) => item.id), ...old.docs.map((row) => row.id)]);
    for (const id of ids) {
      current();
      await api.runTransaction(db, async (transaction) => {
        const target = ref("publicVenue", id);
        const [fresh, previous] = await Promise.all([transaction.get(ref()), transaction.get(target)]);
        const rows = fresh.data()?.hallObjects || [];
        const index = rows.findIndex((item) => item.id === id);
        current();
        if (index < 0) { if (previous.exists()) transaction.delete(target); return; }
        const data = publicVenueData(rows[index], index);
        if (!previous.exists() || !projectionEqual(previous.data(), data)) transaction.set(target, { ...data, updatedAt: api.serverTimestamp() });
      });
    }
  }

  async function publishEvent() {
    await api.runTransaction(db, async (transaction) => {
      const [event, previous] = await Promise.all([transaction.get(ref()), transaction.get(ref("publicEvent", "details"))]);
      current();
      if (!event.exists()) return;
      const data = publicEventData(event.data());
      if (!previous.exists() || !projectionEqual(previous.data(), data)) transaction.set(ref("publicEvent", "details"), { ...data, updatedAt: api.serverTimestamp() });
    });
  }

  async function publishSchedule() {
    current();
    const [event, previous] = await Promise.all([api.getDoc(ref()), api.getDocs(api.collection(db, "weddings", weddingId, "publicSchedule"))]);
    current();
    if (!event.exists()) return;
    const items = event.data().schedule || [];
    if (items.length > 12 || previous.size > 12) throw Object.assign(new Error("Schedule repair is limited to twelve public items."), { code: "failed-precondition" });
    const ids = new Set([...items.map((_, index) => String(index)), ...previous.docs.map((row) => row.id)]);
    for (const id of ids) {
      current();
      await api.runTransaction(db, async (transaction) => {
        const target = ref("publicSchedule", id);
        const [fresh, old] = await Promise.all([transaction.get(ref()), transaction.get(target)]);
        const index = Number(id), rows = fresh.data()?.schedule || [];
        current();
        if (index >= rows.length) { if (old.exists()) transaction.delete(target); return; }
        const data = publicScheduleData(rows[index], index);
        if (!old.exists() || !projectionEqual(old.data(), data)) transaction.set(target, { ...data, updatedAt: api.serverTimestamp() });
      });
    }
  }

  async function publishScene({ venue = false, schedule = false, repair = false } = {}) {
    current(); beforePublish(); current();
    if (!initialized || repair) {
      const marker = await api.getDoc(ref("publicScene", "state"));
      if (!marker.exists() || repair) {
        // Explicit save/repair only. Resuming rechecks actual content and skips
        // completed documents; it never touches guests, tokens or responses.
        await publishEvent();
        await publishSchedule();
        const [tables, old] = await Promise.all([api.getDocs(api.collection(db, "weddings", weddingId, "tables")), api.getDocs(api.collection(db, "weddings", weddingId, "publicLayouts"))]);
        if (tables.size > 200 || old.size > 200) throw Object.assign(new Error("This scene exceeds the bounded repair size. Publish a scoped layout repair."), { code: "failed-precondition" });
        for (const id of new Set([...tables.docs.map((row) => row.id), ...old.docs.map((row) => row.id)])) await publishTable(id);
        await publishVenue();
        await api.runTransaction(db, async (transaction) => {
          const target = ref("publicScene", "state"), previous = await transaction.get(target);
          current();
          if (!previous.exists()) transaction.set(target, { version: 1, updatedAt: api.serverTimestamp() });
        });
      }
      initialized = true;
    }
    if (venue) await publishVenue();
    if (schedule) await publishSchedule();
  }

  return { publishGuest, publishScene, publishTable, publishVenue, repairGuest };
}
