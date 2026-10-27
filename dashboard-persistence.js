import { createEventPublisher, projectionEqual, publicEventData, publicTableData } from "./event-publishing.js?v=20261018-guest-invitation-regressions-2";

const invitationFields = new Set(["fullName", "side", "additionalGuests", "additionalGuestAllowance", "rsvpStatus", "rsvpMessage", "seatingAssignments", "tableId", "tableName", "seatNumber"]);

// Only explicit successful mutations enter this publisher. Snapshot callbacks,
// rendering and navigation use the raw read API and cannot schedule a write.
export function createDashboardPersistence({ api, db, weddingId, checkinRead = false, isCurrent = () => true, onPublishFailure = () => {}, beforeCanonical = () => {}, beforePublish = () => {} }) {
  const publisher = createEventPublisher({ api, db, weddingId, isCurrent, beforePublish });
  const pending = { guests: new Map(), scene: false, venue: false, schedule: false, repair: false };
  let sceneRevision = 0;
  const markGuest = (id, seating, repair = false) => pending.guests.set(id, { seating: seating || pending.guests.get(id)?.seating || false, repair: repair || pending.guests.get(id)?.repair || false });
  let publishing = null, lastError = null;
  const maxAutomaticRetries = 3;
  const transientCodes = new Set(["aborted", "deadline-exceeded", "network-request-failed", "resource-exhausted", "unavailable"]);
  const isTransient = (error) => transientCodes.has(String(error?.code || "").replace(/^firestore\//, ""));
  const retryDelay = (attempt) => new Promise((resolve) => setTimeout(resolve, Math.min(250 * (2 ** attempt), 2000)));
  const current = () => { if (!isCurrent()) throw Object.assign(new Error("This editing session has ended."), { code: "cancelled" }); };
  function collect(intents, reads = new Map()) {
    for (const { type, ref, data = {}, publishSchedule = false } of intents) {
      const parts = ref.path.split("/");
      if (parts[0] !== "weddings" || parts[1] !== weddingId) continue;
      const kind = parts[2], id = parts[3];
      if (!kind || kind === "tables") { pending.scene = true; sceneRevision += 1; }
      if (!kind && "hallObjects" in data) pending.venue = true;
      if (!kind && publishSchedule) pending.schedule = true;
      if (kind === "guests" && type !== "set" && Object.keys(data).some((key) => invitationFields.has(key))) {
        markGuest(id, false);
      }
      if (["seatAssignments", "seatedPeople"].includes(kind) && !(type === "update" && Object.keys(data).every((key) => ["side", "updatedAt"].includes(key)))) {
        const guestId = data.guestId || reads.get(ref.path)?.data()?.guestId;
        if (guestId) markGuest(guestId, true);
      }
    }
  }
  async function drain() {
    // Bounded coalescing. Further explicit mutations can drain remaining work.
    for (let pass = 0; pass < 2 && isCurrent(); pass++) {
      const scene = pending.scene, venue = pending.venue, revision = sceneRevision;
      if (scene) {
        await publisher.publishScene({ venue, schedule: pending.schedule, repair: pending.repair });
        if (revision === sceneRevision) { pending.scene = false; pending.venue = false; pending.schedule = false; pending.repair = false; }
      }
      const jobs = [...pending.guests].slice(0, 50);
      for (const [id, job] of jobs) {
        current();
        if (job.repair) await publisher.repairGuest(id, { checkinRead });
        else await publisher.publishGuest(id, job.seating);
        if (pending.guests.get(id) === job) pending.guests.delete(id);
      }
      if (!pending.scene && !pending.guests.size) break;
    }
  }
  async function flush() {
    if (publishing) return publishing;
    publishing = (async () => {
      lastError = null;
      for (let attempt = 0; ; attempt++) {
        try {
          await drain();
          lastError = null;
          return true;
        } catch (error) {
          if (!isCurrent()) return false;
          if (!isTransient(error) || attempt >= maxAutomaticRetries) throw error;
          await retryDelay(attempt);
        }
      }
    })().catch((error) => {
      if (!isCurrent()) return;
      lastError = error;
      onPublishFailure(error);
      return false;
    }).finally(() => { publishing = null; });
    return publishing;
  }

  async function afterCommit(intents, reads) { collect(intents, reads); await flush(); }
  async function replay(transaction, intents, reads) {
    // All application writes are buffered until the callback completes. Fetch
    // only the shared documents for canonical event/tables actually written.
    const staged = [];
    for (const intent of intents) {
      const parts = intent.ref.path.split("/");
      if (parts[0] !== "weddings" || parts[1] !== weddingId || !(!parts[2] || parts[2] === "tables")) continue;
      const before = reads.get(intent.ref.path) || await transaction.get(intent.ref);
      reads.set(intent.ref.path, before);
      const target = api.doc(db, "weddings", weddingId, parts[2] === "tables" ? "publicLayouts" : "publicEvent", parts[2] === "tables" ? parts[3] : "details");
      const previous = await transaction.get(target);
      if (intent.type === "delete") { if (previous.exists()) staged.push({ type: "delete", ref: target }); continue; }
      const next = intent.type === "update" || intent.options?.merge ? { ...before.data(), ...intent.data } : intent.data;
      if (!parts[2]) intent.publishSchedule = !previous.exists() || previous.data().scheduleCount === undefined || !projectionEqual(before.data()?.schedule || [], next.schedule || []);
      const projected = parts[2] === "tables" ? publicTableData(next, previous.data(), before.data()) : publicEventData(next);
      if (!previous.exists() || !projectionEqual(previous.data(), projected)) staged.push({ type: "set", ref: target, data: { ...projected, updatedAt: api.serverTimestamp() } });
    }
    current(); beforeCanonical(); current();
    for (const intent of [...intents, ...staged]) {
      if (intent.type === "delete") transaction.delete(intent.ref);
      else if (intent.type === "update") transaction.update(intent.ref, intent.data);
      else if (intent.options) transaction.set(intent.ref, intent.data, intent.options);
      else transaction.set(intent.ref, intent.data);
    }
  }

  async function runTransaction(database, callback, options) {
    let committedIntents = [], committedReads = new Map();
    const result = await api.runTransaction(database, async (transaction) => {
      current();
      const intents = [], reads = new Map();
      const proxy = {
        async get(ref) { const snapshot = await transaction.get(ref); reads.set(ref.path, snapshot); return snapshot; },
        set(ref, data, options) { intents.push({ type: "set", ref, data, options }); return proxy; },
        update(ref, data) { intents.push({ type: "update", ref, data }); return proxy; },
        delete(ref) { intents.push({ type: "delete", ref }); return proxy; },
      };
      const value = await callback(proxy);
      await replay(transaction, intents, reads);
      committedIntents = intents; committedReads = reads;
      return value;
    }, options);
    await afterCommit(committedIntents, committedReads);
    return result;
  }
  function writeBatch(database) {
    const intents = [];
    const batch = {
      set(ref, data, options) { intents.push({ type: "set", ref, data, options }); return batch; },
      update(ref, data) { intents.push({ type: "update", ref, data }); return batch; },
      delete(ref) { intents.push({ type: "delete", ref }); return batch; },
      async commit() {
        if (intents.some(({ ref }) => ref.path.split("/").length === 2 || ref.path.split("/")[2] === "tables")) {
          return runTransaction(database, async (transaction) => {
            for (const intent of intents) {
              if (intent.type === "delete") transaction.delete(intent.ref);
              else if (intent.type === "update") transaction.update(intent.ref, intent.data);
              else transaction.set(intent.ref, intent.data, intent.options);
            }
          });
        }
        current(); beforeCanonical(); current();
        const native = api.writeBatch(database);
        for (const intent of intents) {
          if (intent.type === "delete") native.delete(intent.ref);
          else if (intent.type === "update") native.update(intent.ref, intent.data);
          else if (intent.options) native.set(intent.ref, intent.data, intent.options);
          else native.set(intent.ref, intent.data);
        }
        await native.commit();
        await afterCommit(intents);
      },
    };
    return batch;
  }
  const one = (type) => async (ref, data, options) => {
    const batch = writeBatch(db);
    if (type === "delete") batch.delete(ref);
    else if (type === "update") batch.update(ref, data);
    else batch.set(ref, data, options);
    return batch.commit();
  };
  return { runTransaction, writeBatch, updateDoc: one("update"), setDoc: one("set"), deleteDoc: one("delete"), flush, isCurrent,
    get publicationError() { return lastError; }, get pendingCount() { return pending.guests.size + Number(pending.scene); },
    async prepareScene({ repair = false } = {}) { current(); pending.scene = true; pending.repair ||= repair; sceneRevision += 1; await flush(); },
    async repairGuest(guestId) { current(); markGuest(guestId, true, true); await flush(); },
  };
}
