import { createEventPublisher } from "./event-publishing.js?v=20261018-guest-invitation-regressions-1";
export { publicTableData as publicTableLayout } from "./event-publishing.js?v=20261018-guest-invitation-regressions-1";

// Compatibility/explicit repair entry point. Never called by render/listeners.
// One invocation repairs at most 50 explicitly selected guests (or one page).
export async function syncCustomerEventProjections(api, db, weddingId, { guestIds, isCurrent = () => true } = {}) {
  const publisher = createEventPublisher({ api, db, weddingId, isCurrent });
  await publisher.publishScene({ venue: true, repair: true });
  const ids = guestIds ? guestIds.slice(0, 50) : (await api.getDocs(api.query(api.collection(db, "weddings", weddingId, "guests"), api.limit(50)))).docs.map((row) => row.id);
  for (const id of ids) {
    if (!isCurrent()) break;
    await publisher.repairGuest(id);
  }
  return { repaired: ids.length, bounded: true };
}
