import { publicEventData, projectionEqual } from './event-publishing.js';

// Synchronize the public invitation from the latest event inside a transaction.
export async function ensureGenderRevealPublished(api, db, weddingId) {
  const eventRef = api.doc(db, 'weddings', weddingId);
  const publicRef = api.doc(db, 'weddings', weddingId, 'publicEvent', 'details');
  return api.runTransaction(db, async transaction => {
    const [event, published] = await Promise.all([transaction.get(eventRef), transaction.get(publicRef)]);
    if (!event.exists() || event.data().eventCategory !== 'gender_reveal') throw new Error('Gender reveal event is unavailable.');
    if (published.exists() && published.data().eventCategory !== 'gender_reveal') throw new Error('Invitation details need to be updated by the event owner.');
    const projection = publicEventData(event.data());
    if (published.exists() && projectionEqual(published.data(), projection)) return false;
    transaction.set(publicRef, { ...projection, updatedAt: api.serverTimestamp() });
    return true;
  });
}
