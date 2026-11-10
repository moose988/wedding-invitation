import { DocumentReference, FieldPath, FieldValue, GeoPoint, Timestamp } from 'firebase-admin/firestore';
import { discoveryData } from '../../account-access.js';
import { AdminError, requireAdmin } from './admin-common.js';

// One event's whole record as a file an administrator keeps, and the way back from that file.
// The browser cannot read every internal record of an event, so both directions run here with
// the service account, in pages small enough for one request each.
export const BACKUP_FORMAT = 'qd-event-backup';
export const BACKUP_VERSION = 1;
// Subcollections that live under a document of an event collection. tests/event-backup.test.mjs
// compares this with firestore.rules, so a new nested collection cannot be left out of a backup.
export const NESTED_COLLECTIONS = Object.freeze({ senderCapabilities: Object.freeze(['recipients']) });
export const EXPORT_PAGE_DOCS = 300;
export const EXPORT_PAGE_BYTES = 1_500_000;
export const RESTORE_PAGE_DOCS = 400; // a Firestore batch holds 500 writes
const MAX_RELATED = 2000;

const validId = (id) => typeof id === 'string' && id.length >= 1 && id.length <= 128 && !id.includes('/') && id !== '.' && id !== '..' && !/^__.*__$/.test(id);
const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const bad = (code, message) => new AdminError(400, code, message);

// A collection inside an event: "guests", or "senderCapabilities/<id>/recipients".
export function validCollectionPath(path) {
  if (typeof path !== 'string' || path.length > 400) return false;
  const parts = path.split('/');
  return (parts.length === 1 || parts.length === 3) && parts.every(validId);
}

// Firestore values that JSON cannot hold are written as { __t: kind, ... }. A real map that
// happens to have a "__t" key is wrapped, so decoding can never mistake data for a marker.
export function encodeValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : { __t: 'num', v: String(value) };
  if (value instanceof Timestamp) return { __t: 'ts', s: value.seconds, n: value.nanoseconds };
  if (value instanceof GeoPoint) return { __t: 'geo', lat: value.latitude, lng: value.longitude };
  if (value instanceof DocumentReference) return { __t: 'ref', path: value.path };
  if (value instanceof Uint8Array) return { __t: 'bytes', b64: Buffer.from(value).toString('base64') };
  if (Array.isArray(value)) return value.map(encodeValue);
  if (isPlain(value)) {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = encodeValue(item);
    return Object.hasOwn(value, '__t') ? { __t: 'map', v: out } : out;
  }
  throw new AdminError(500, 'BACKUP_UNSUPPORTED_VALUE', 'This event holds a kind of value the backup cannot store.');
}

export function decodeValue(db, value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') { if (Number.isFinite(value)) return value; throw bad('INVALID_BACKUP', 'The backup file holds an invalid number.'); }
  if (Array.isArray(value)) return value.map((item) => decodeValue(db, item));
  if (!isPlain(value)) throw bad('INVALID_BACKUP', 'The backup file holds a value that cannot be restored.');
  if (!Object.hasOwn(value, '__t')) {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = decodeValue(db, item);
    return out;
  }
  const invalid = () => bad('INVALID_BACKUP', 'The backup file holds a damaged value.');
  switch (value.__t) {
    case 'ts': if (!Number.isInteger(value.s) || !Number.isInteger(value.n) || value.n < 0 || value.n > 999_999_999) throw invalid(); return new Timestamp(value.s, value.n);
    case 'geo': if (typeof value.lat !== 'number' || typeof value.lng !== 'number') throw invalid(); return new GeoPoint(value.lat, value.lng);
    case 'ref': if (typeof value.path !== 'string' || !value.path || value.path.split('/').length % 2 !== 0) throw invalid(); return db.doc(value.path);
    case 'bytes': if (typeof value.b64 !== 'string') throw invalid(); return Buffer.from(value.b64, 'base64');
    case 'num': if (!['NaN', 'Infinity', '-Infinity'].includes(value.v)) throw invalid(); return Number(value.v);
    case 'map': { if (!isPlain(value.v)) throw invalid(); const out = {}; for (const [key, item] of Object.entries(value.v)) out[key] = decodeValue(db, item); return out; }
    default: throw invalid();
  }
}

function eventRef(db, eventId) {
  if (!validId(eventId)) throw bad('INVALID_EVENT', 'Invalid event.');
  return db.doc(`weddings/${eventId}`);
}

function decodeDocument(db, data) {
  if (!isPlain(data) || Object.hasOwn(data, '__t')) throw bad('INVALID_BACKUP', 'The backup file holds a record that cannot be restored.');
  return decodeValue(db, data);
}

async function commitInBatches(db, writes) {
  for (let i = 0; i < writes.length; i += RESTORE_PAGE_DOCS) {
    const batch = db.batch();
    writes.slice(i, i + RESTORE_PAGE_DOCS).forEach((write) => write(batch));
    await batch.commit();
  }
}

// Everyone who may hold a card for this event: its members, its owner and a demo's account.
async function cardHolders(ref, event) {
  const members = await ref.collection('dashboardUsers').listDocuments();
  return [...new Set([...members.map((row) => row.id), event?.ownerUserId, event?.demoAccountUid].filter(validId))];
}

/* ------------------------------------------------------------------ download */

export async function startEventExport({ auth, db, token, eventId, now = Date.now }) {
  const caller = await requireAdmin(auth, db, token);
  const ref = eventRef(db, eventId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new AdminError(404, 'EVENT_NOT_FOUND', 'This event no longer exists.');
  const event = snapshot.data();
  if (event.deleting === true) throw new AdminError(409, 'EVENT_DELETING', 'This event is being deleted, so it cannot be backed up.');

  const collections = [];
  const top = (await ref.listCollections()).sort((a, b) => a.id.localeCompare(b.id));
  for (const collection of top) {
    collections.push(collection.id);
    for (const nested of NESTED_COLLECTIONS[collection.id] || []) {
      // listDocuments also returns parents that were deleted while their children remain.
      for (const parent of await collection.listDocuments()) collections.push(`${collection.id}/${parent.id}/${nested}`);
    }
  }

  const holders = await cardHolders(ref, event);
  const [cardRows, grantRows] = await Promise.all([
    holders.length ? db.getAll(...holders.map((uid) => db.doc(`users/${uid}/weddingAccess/${eventId}`))) : [],
    db.collection('customerGrants').where('weddingId', '==', eventId).limit(MAX_RELATED).get(),
  ]);
  return {
    format: BACKUP_FORMAT, version: BACKUP_VERSION,
    exportedAt: new Date(now()).toISOString(), exportedBy: caller.email,
    eventId, event: encodeValue(event), collections,
    cards: cardRows.filter((row) => row.exists).map((row) => ({ uid: row.ref.parent.parent.id, data: encodeValue(row.data()) })),
    grants: grantRows.docs.map((row) => ({ id: row.id, data: encodeValue(row.data()) })),
  };
}

// One page of one collection, in document id order. `next` is the id to pass back as the
// cursor, or null at the end. A page stops early at a byte budget so the response stays small.
export async function exportEventPage({ auth, db, token, eventId, path, cursor = null, pageDocs = EXPORT_PAGE_DOCS, pageBytes = EXPORT_PAGE_BYTES }) {
  await requireAdmin(auth, db, token);
  const ref = eventRef(db, eventId);
  if (!validCollectionPath(path)) throw bad('INVALID_PATH', 'Invalid backup section.');
  if (cursor !== null && !validId(cursor)) throw bad('INVALID_CURSOR', 'Invalid backup position.');
  let query = ref.collection(path).orderBy(FieldPath.documentId()).limit(pageDocs);
  if (cursor) query = query.startAfter(cursor);
  const rows = (await query.get()).docs;
  const docs = [];
  let bytes = 0;
  for (const row of rows) {
    const item = { id: row.id, data: encodeValue(row.data()) };
    bytes += JSON.stringify(item).length;
    if (docs.length && bytes > pageBytes) break;
    docs.push(item);
  }
  const more = docs.length < rows.length || rows.length === pageDocs;
  return { path, docs, next: more && docs.length ? docs[docs.length - 1].id : null };
}

/* ------------------------------------------------------------------- restore */

// Step 1, repeated until done: clears the event so the file can be put back exactly. The
// event document goes first; the rules deny every non-administrator while it is missing, so
// nobody can save into a half-restored event. Memberships go last because they are how the
// members' cards are found if this step has to be repeated.
export async function beginEventRestore({ auth, db, token, eventId, budgetMs = 40000, clock = Date.now }) {
  await requireAdmin(auth, db, token);
  const ref = eventRef(db, eventId);
  const end = clock() + budgetMs;
  const snapshot = await ref.get();
  const holders = await cardHolders(ref, snapshot.exists ? snapshot.data() : null);
  const grants = await db.collection('customerGrants').where('weddingId', '==', eventId).limit(MAX_RELATED).get();
  await commitInBatches(db, [
    ...holders.map((uid) => (batch) => batch.delete(db.doc(`users/${uid}/weddingAccess/${eventId}`))),
    ...grants.docs.map((row) => (batch) => batch.delete(row.ref)),
  ]);
  if (snapshot.exists) await ref.delete();
  const collections = (await ref.listCollections()).sort((a, b) => (a.id === 'dashboardUsers') - (b.id === 'dashboardUsers') || a.id.localeCompare(b.id));
  for (const collection of collections) {
    if (clock() >= end) return { done: false, existed: snapshot.exists };
    await db.recursiveDelete(collection);
  }
  return { done: true, existed: snapshot.exists };
}

// Step 2, once per page of the file. Refused while the event document exists: that means
// step 1 has not run (or step 3 already has), and these writes would land in a live event.
export async function writeEventRestorePage({ auth, db, token, eventId, path, docs }) {
  await requireAdmin(auth, db, token);
  const ref = eventRef(db, eventId);
  if (!validCollectionPath(path)) throw bad('INVALID_PATH', 'Invalid backup section.');
  if (!Array.isArray(docs) || docs.length === 0 || docs.length > RESTORE_PAGE_DOCS) throw bad('INVALID_BACKUP', `Send between 1 and ${RESTORE_PAGE_DOCS} records at a time.`);
  if (!docs.every((item) => isPlain(item) && validId(item.id))) throw bad('INVALID_BACKUP', 'The backup file holds a record with an invalid name.');
  if ((await ref.get()).exists) throw new AdminError(409, 'RESTORE_NOT_STARTED', 'The restore was not started for this event. Start it again.');
  const collection = ref.collection(path);
  const batch = db.batch();
  for (const item of docs) batch.set(collection.doc(item.id), decodeDocument(db, item.data));
  await batch.commit();
  return { path, written: docs.length };
}

// Step 3: checks every section arrived complete, then writes the access records and, last
// of all, the event document, which is what makes the event visible and usable again.
export async function finishEventRestore({ auth, db, token, eventId, event, cards = [], grants = [], expected = {} }) {
  const caller = await requireAdmin(auth, db, token);
  const ref = eventRef(db, eventId);
  if (!isPlain(expected) || !Object.entries(expected).every(([path, count]) => validCollectionPath(path) && Number.isInteger(count) && count >= 0)) throw bad('INVALID_BACKUP', 'The backup file has an invalid summary.');
  if (!Array.isArray(cards) || !Array.isArray(grants) || cards.length > MAX_RELATED || grants.length > MAX_RELATED) throw bad('INVALID_BACKUP', 'The backup file has invalid access records.');
  if (!cards.every((row) => isPlain(row) && validId(row.uid)) || !grants.every((row) => isPlain(row) && validId(row.id))) throw bad('INVALID_BACKUP', 'The backup file has invalid access records.');
  const data = decodeDocument(db, event);
  if (typeof data.ownerUserId !== 'string' || !data.ownerUserId) throw bad('INVALID_BACKUP', 'The backup file has no event owner.');
  const grantData = grants.map((row) => ({ id: row.id, data: decodeDocument(db, row.data) }));
  if (!grantData.every((row) => row.data.weddingId === eventId)) throw bad('INVALID_BACKUP', 'The backup file has an access record for another event.');
  const cardData = cards.map((row) => ({ uid: row.uid, data: decodeDocument(db, row.data) }));
  if ((await ref.get()).exists) throw new AdminError(409, 'RESTORE_NOT_STARTED', 'The restore was not started for this event. Start it again.');

  const found = await Promise.all(Object.keys(expected).map(async (path) => [path, (await ref.collection(path).count().get()).data().count]));
  const mismatched = found.filter(([path, count]) => count !== expected[path]).map(([path, count]) => ({ path, expected: expected[path], found: count }));
  if (mismatched.length) throw new AdminError(409, 'RESTORE_INCOMPLETE', 'Some of the backup did not arrive. Run the restore again.', { mismatched });

  delete data.deleting;
  // The owner in the file may have been retired since. An event must always have an enabled
  // administrator as owner, so the person restoring takes it over in that case.
  const owner = await db.doc(`platformAdmins/${data.ownerUserId}`).get();
  const ownerChanged = !owner.exists || owner.data().enabled !== true;
  const stamp = FieldValue.serverTimestamp();
  const writes = [
    ...cardData.map((row) => (batch) => batch.set(db.doc(`users/${row.uid}/weddingAccess/${eventId}`), row.data)),
    ...grantData.map((row) => (batch) => batch.set(db.doc(`customerGrants/${row.id}`), row.data)),
  ];
  if (ownerChanged) {
    data.ownerUserId = caller.uid;
    // Same owner records as demo creation in demo-accounts.js.
    writes.push((batch) => batch.set(ref.collection('dashboardUsers').doc(caller.uid), { userId: caller.uid, email: caller.email, canViewDashboard: true, canEditGuests: true, canEditSeating: true, canCheckIn: true, canManageUsers: true, role: 'owner', createdAt: stamp, updatedAt: stamp }));
    writes.push((batch) => batch.set(db.doc(`users/${caller.uid}/weddingAccess/${eventId}`), { ...discoveryData(eventId, data), createdAt: stamp, updatedAt: stamp }));
  }
  await commitInBatches(db, writes);
  await ref.create(data);
  return { ok: true, eventId, ownerChanged, restored: Object.values(expected).reduce((sum, count) => sum + count, 0) + 1 };
}

/* --------------------------------------------------------------------- usage */

// How many records an event holds, per section, for the "Usage and cost" panel. Each count is
// one aggregation query (billed as one read per 1,000 records), so this stays cheap for any size.
export async function eventUsage({ auth, db, token, eventId }) {
  await requireAdmin(auth, db, token);
  const ref = eventRef(db, eventId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new AdminError(404, 'EVENT_NOT_FOUND', 'This event no longer exists.');
  const event = snapshot.data();
  const collections = await ref.listCollections();
  const counts = await Promise.all(collections.map(async (collection) => [collection.id, (await collection.count().get()).data().count]));
  return {
    eventId, eventCategory: event.eventCategory || 'wedding_engagement', seatingEnabled: event.seatingEnabled !== false,
    customSong: event.musicMode === 'custom', counts: Object.fromEntries(counts.sort(([a], [b]) => a.localeCompare(b))),
  };
}
