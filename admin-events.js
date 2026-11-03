// One loader for "every event" on the admin pages. It reads the weddings collection
// in pages of 100, in document id order (the default order, which every document has
// and which does not change when an event is edited), and keeps going until the
// collection is exhausted or the safety cap is reached. Ordering by createdAt is not
// used because Firestore leaves out documents that lack that field, and older events
// may not have it. Callers sort the loaded rows themselves.
export const ADMIN_EVENT_PAGE = 100;
export const ADMIN_EVENT_CAP = 2000;

export async function loadAllAdminEvents(api, db, { pageSize = ADMIN_EVENT_PAGE, cap = ADMIN_EVENT_CAP, onPage = () => {} } = {}) {
  const rows = [];
  let cursor = null, truncated = false;
  for (;;) {
    const parts = [api.collection(db, "weddings"), ...(cursor ? [api.startAfter(cursor)] : []), api.limit(pageSize)];
    const snapshot = await api.getDocs(api.query(...parts));
    for (const item of snapshot.docs) rows.push({ ...item.data(), id: item.id });
    cursor = snapshot.docs.at(-1) || cursor;
    onPage(rows.slice());
    if (snapshot.docs.length < pageSize) break;
    if (rows.length >= cap) { truncated = true; break; }
  }
  return { rows, truncated };
}

// Pages that show events in more than one panel (Customers has a list and a link panel) share one load per page
// view instead of reading every event twice. A later call within 60 seconds reuses it; a failed load is not kept.
const SHARED_TTL_MS = 60_000;
const shared = new WeakMap(); // db -> { at, promise }
export function loadAdminEventsShared(api, db, { now = Date.now } = {}) {
  const hit = shared.get(db);
  if (hit && now() - hit.at < SHARED_TTL_MS) return hit.promise;
  const promise = loadAllAdminEvents(api, db).catch((error) => { shared.delete(db); throw error; });
  shared.set(db, { at: now(), promise });
  return promise;
}
export function forgetSharedAdminEvents(db) { shared.delete(db); }

// Replace a list with a fresh load without losing rows that are still loading: rows
// keep any fields the caller computed (such as stats) when their id is unchanged.
export function mergeById(previous, fresh, keep = []) {
  const old = new Map(previous.map((row) => [row.id, row]));
  return fresh.map((row) => {
    const before = old.get(row.id);
    return before ? { ...row, ...Object.fromEntries(keep.filter((key) => before[key] !== undefined).map((key) => [key, before[key]])) } : row;
  });
}

export const truncationNote = (count) => `Showing the first ${count} events. More exist, so search cannot find the rest.`;
