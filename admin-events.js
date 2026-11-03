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
