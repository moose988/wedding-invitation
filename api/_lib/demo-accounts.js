import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { customerMembership, discoveryData } from '../../account-access.js';
import { AdminError, BucketError, createBucketClient, requireAdmin, serviceTokenProvider } from './admin-common.js';
import { generateDemoPassword } from './demo-password.js';
import { DEFAULT_DEMO_HOURS, DEMO_EXPIRY_HOURS, isExpiredDemo, MIN_SECRET_LENGTH } from './demo-rules.js';

const HOUR_MS = 60 * 60 * 1000;
// The bucket API sets its own expiry from its own clock, so allow for request time.
const BUCKET_EXPIRY_TOLERANCE_MS = 5 * 60 * 1000;
export const DEMO_EMAIL_DOMAIN = 'qd-demo.test'; // RFC 2606: can never receive mail.
export const DEMO_UID_PREFIX = 'demo-';
const EVENT_TYPES = ['wedding_engagement', 'celebration', 'gender_reveal'];
// Server-only write-ahead record. firestore.rules has no match for it, so every
// client is denied; only the Admin SDK can read or write it. It holds no password.
const LEDGER = 'demoLedger';

function cleanName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  // 100 is the bucket API's limit; it is applied to every type for one UI rule.
  if (!name || name.length > 100 || /[\u0000-\u001f]/.test(name)) throw new AdminError(400, 'INVALID_NAME', 'Use a name between 1 and 100 characters.');
  return name;
}

function demoEventData({ type, name, callerUid, uid, nowMs, expiresMs }) {
  const created = Timestamp.fromMillis(nowMs);
  const base = {
    eventCategory: type, eventTitle: name, eventDateISO: new Date(nowMs + 14 * 24 * HOUR_MS).toISOString(), eventTimeZone: 'Asia/Dubai',
    venueEn: 'Demo venue', location: 'Demo', mapsUrl: '', whatsAppCountryCode: '971', invitationLanguage: 'en', plannerNotes: '', status: 'active',
    seatingSchemaVersion: 2, seatingEnabled: true, showInvitationQr: true, ownerUserId: callerUid,
    isDemo: true, demoExpiresAt: Timestamp.fromMillis(expiresMs), demoAccountUid: uid, createdAt: created, updatedAt: created,
  };
  if (type === 'wedding_engagement') {
    const [bride, groom = ''] = name.split('&').map((part) => part.trim());
    return { ...base, brideName: bride, groomName: groom, coupleName: name, invitationTemplate: 'layla-zaid' };
  }
  if (type === 'gender_reveal') {
    // Defaults copied from the event form in weddings.js.
    return {
      ...base, seatingEnabled: false, showInvitationQr: false, guestGroupMode: 'general', genderRevealTemplate: 'gender-reveal-classic',
      genderRevealArtworkUrl: '/images/gender-reveal-cover.png', genderRevealOpeningVideoUrl: '/videos/gender-reveal-opening.mp4',
      genderRevealMusicUrl: '/music/gender-reveal-party.mp3', genderRevealMessageEn: 'A little surprise is on the way…',
      genderRevealMessageAr: 'مفاجأة جميلة بانتظارنا…', eventTitleAr: 'حفل الكشف عن جنس المولود',
    };
  }
  return base;
}

export async function createDemo({ auth, db, token, type, name, expiresInHours = DEFAULT_DEMO_HOURS, bucketClient = null, now = Date.now }) {
  const caller = await requireAdmin(auth, db, token);
  if (type !== 'photo_bucket' && !EVENT_TYPES.includes(type)) throw new AdminError(400, 'INVALID_TYPE', 'Choose a valid demo type.');
  name = cleanName(name);
  if (!DEMO_EXPIRY_HOURS.includes(expiresInHours)) throw new AdminError(400, 'INVALID_EXPIRY', `Choose an expiry of ${DEMO_EXPIRY_HOURS.join(', ')} hours.`);
  if (type === 'photo_bucket' && !bucketClient) throw new AdminError(503, 'BUCKET_API_UNCONFIGURED', 'The photo bucket service is not configured.');

  const nowMs = now();
  const expiresMs = nowMs + expiresInHours * HOUR_MS;
  const ledgerRef = db.collection(LEDGER).doc();
  const demoId = ledgerRef.id;
  const uid = `${DEMO_UID_PREFIX}${randomBytes(16).toString('hex')}`;
  const email = `demo-${randomBytes(6).toString('hex')}@${DEMO_EMAIL_DOMAIN}`;
  const password = generateDemoPassword();
  const isBucket = type === 'photo_bucket';
  const ledger = { demoId, kind: isBucket ? 'photo_bucket' : 'event', type, targetId: isBucket ? null : demoId, uid, email, state: 'creating', createdBy: caller.uid, createdAt: Timestamp.fromMillis(nowMs), expiresAt: Timestamp.fromMillis(expiresMs) };

  // Written first with the pre-chosen uid. If this function dies at any later
  // point, cleanup still knows what to remove once the record expires.
  await ledgerRef.set(ledger);
  let bucket = null;
  try {
    await auth.createUser({ uid, email, password, emailVerified: false });
    const stamp = FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.set(db.doc(`customerDirectory/${uid}`), { userId: uid, email, updatedAt: stamp });
    if (isBucket) {
      bucket = await bucketClient.createDemo({ name, date: new Date(nowMs).toISOString().slice(0, 10), location: 'Demo', owners: [uid], expiresInHours });
      if (typeof bucket?.id !== 'string' || !bucket.id.startsWith('demo-') || bucket.demo !== true) {
        bucket = null; // Not recognisably a demo, so rollback must not delete it.
        throw new BucketError(0, 'BUCKET_API_CONTRACT', 'The photo bucket service did not return a demo bucket.');
      }
      // A stack that ignored expiresInHours would delete the demo at the wrong time.
      // The bucket is kept in scope here, so rollback removes it.
      if (!(Math.abs(Number(bucket.expiresAt) - expiresMs) <= BUCKET_EXPIRY_TOLERANCE_MS)) {
        throw new BucketError(0, 'BUCKET_API_CONTRACT', 'The photo bucket service did not apply the chosen expiry.');
      }
      batch.update(ledgerRef, { state: 'active', targetId: bucket.id, expiresAt: Timestamp.fromMillis(Number(bucket.expiresAt)) });
    } else {
      const event = demoEventData({ type, name, callerUid: caller.uid, uid, nowMs, expiresMs });
      const eventRef = db.doc(`weddings/${demoId}`);
      batch.create(eventRef, event);
      batch.set(eventRef.collection('dashboardUsers').doc(uid), customerMembership(uid, email, stamp));
      batch.set(db.doc(`users/${uid}/weddingAccess/${demoId}`), { ...discoveryData(demoId, event), updatedAt: stamp });
      // Same owner records as the normal create flow in weddings.js.
      batch.set(eventRef.collection('dashboardUsers').doc(caller.uid), { userId: caller.uid, email: caller.email, canViewDashboard: true, canEditGuests: true, canEditSeating: true, canCheckIn: true, canManageUsers: true, role: 'owner', createdAt: stamp, updatedAt: stamp });
      batch.set(db.doc(`users/${caller.uid}/weddingAccess/${demoId}`), { ...discoveryData(demoId, event), createdAt: stamp, updatedAt: stamp });
      batch.update(ledgerRef, { state: 'active' });
    }
    await batch.commit();
  } catch (error) {
    const rolledBack = await rollback({ auth, db, ledgerRef, demoId, uid, callerUid: caller.uid, isBucket, bucket, bucketClient });
    const extra = { rolledBack };
    if (error instanceof BucketError) throw new AdminError(502, error.code, error.message, extra);
    console.error('Demo creation failed:', error?.code || error?.name);
    throw new AdminError(500, 'DEMO_CREATE_FAILED', 'The demo could not be created. Please retry.', extra);
  }
  return {
    demoId, type, kind: ledger.kind, eventId: isBucket ? null : demoId, bucketId: bucket?.id ?? null,
    expiresInHours, expiresAt: isBucket ? Number(bucket.expiresAt) : expiresMs,
    credentials: { email, password },
  };
}

// Every path is attempted even if the failure looked early: a commit or createUser
// that reported an error can still have taken effect. If anything here fails the
// ledger stays, and the scheduled cleanup finishes the job after expiry.
async function rollback({ auth, db, ledgerRef, demoId, uid, callerUid, isBucket, bucket, bucketClient }) {
  try {
    if (bucket) await bucketClient.deleteBucket(bucket.id);
    await auth.deleteUser(uid).catch((error) => { if (error.code !== 'auth/user-not-found') throw error; });
    const batch = db.batch();
    batch.delete(db.doc(`customerDirectory/${uid}`));
    if (!isBucket) {
      const eventRef = db.doc(`weddings/${demoId}`);
      const event = await eventRef.get();
      if (event.exists && event.data().isDemo !== true) throw new Error('Refusing to remove a non-demo event.');
      batch.delete(eventRef);
      batch.delete(eventRef.collection('dashboardUsers').doc(uid));
      batch.delete(eventRef.collection('dashboardUsers').doc(callerUid));
      batch.delete(db.doc(`users/${uid}/weddingAccess/${demoId}`));
      batch.delete(db.doc(`users/${callerUid}/weddingAccess/${demoId}`));
    }
    batch.delete(ledgerRef);
    await batch.commit();
    return true;
  } catch (error) {
    console.error('Demo rollback incomplete, left for cleanup:', error?.code || error?.name);
    return false;
  }
}

async function deleteRefs(db, refs) {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = db.batch();
    refs.slice(i, i + 400).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

// The only code that deletes event data. It takes no caller-chosen rule: the event
// must prove it is an expired demo from a fresh read, both before anything is removed
// and again in the transaction that removes the event itself.
// The event document goes last, so a run that dies midway is found again by the next.
async function deleteExpiredDemoEvent(db, ref, nowMs) {
  const snapshot = await ref.get();
  if (!snapshot.exists || !isExpiredDemo(snapshot.data(), nowMs)) return false;
  const eventId = ref.id;
  const event = snapshot.data();
  const members = ref.collection('dashboardUsers');
  const memberDocs = (await members.get()).docs;
  const userIds = new Set([...memberDocs.map((row) => row.id), ...[event.ownerUserId, event.demoAccountUid].filter((id) => typeof id === 'string' && id)]);
  for (const collection of await ref.listCollections()) {
    if (collection.id !== 'dashboardUsers') await db.recursiveDelete(collection);
  }
  const grants = await db.collection('customerGrants').where('weddingId', '==', eventId).get();
  await deleteRefs(db, [...grants.docs.map((row) => row.ref), ...[...userIds].map((id) => db.doc(`users/${id}/weddingAccess/${eventId}`))]);
  // Memberships are how the cards above are found, so they go after them.
  await db.recursiveDelete(members);
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    if (current.exists && isExpiredDemo(current.data(), nowMs)) transaction.delete(ref);
  });
  return true;
}

// Returns the other events holding this account: { real, liveDemo } counts.
async function otherEvents({ db, bucketClient, uid, targetId, nowMs }) {
  const [memberships, cards, owned] = await Promise.all([
    db.collectionGroup('dashboardUsers').where('userId', '==', uid).get(),
    db.collection(`users/${uid}/weddingAccess`).get(),
    db.collection('weddings').where('ownerUserId', '==', uid).get(),
  ]);
  const ids = new Set([...memberships.docs.map((row) => row.ref.parent.parent.id), ...cards.docs.map((row) => row.id), ...owned.docs.map((row) => row.id)]);
  ids.delete(targetId);
  const rows = ids.size ? await db.getAll(...[...ids].map((id) => db.doc(`weddings/${id}`))) : [];
  // A card or membership whose event no longer exists grants nothing.
  const events = rows.filter((row) => row.exists);
  let real = events.filter((row) => row.data().isDemo !== true).length;
  let liveDemo = events.length - real;
  const buckets = (await bucketClient.listOwned(uid)).filter((bucket) => bucket.id !== targetId && bucket.status !== 'deleting' && (!Array.isArray(bucket.owners) || bucket.owners.includes(uid)));
  for (const bucket of buckets) {
    if (!bucket.demo) real += 1;
    else if (!bucket.expired && !(Number(bucket.expiresAt) <= nowMs)) liveDemo += 1;
  }
  return { real, liveDemo };
}

async function settleLedger({ auth, db, bucketClient, ledger, nowMs, result }) {
  const { demoId, uid, email, targetId, kind } = ledger.data();
  // Only an account this system generated is ever a candidate for deletion.
  if (typeof uid !== 'string' || !uid.startsWith(DEMO_UID_PREFIX) || typeof email !== 'string' || !email.endsWith(`@${DEMO_EMAIL_DOMAIN}`)) {
    result.accounts.failed.push({ demoId: ledger.id, code: 'INVALID_LEDGER' });
    return;
  }
  if (kind === 'event') {
    const event = await db.doc(`weddings/${targetId}`).get();
    if (event.exists) { // Its event pass failed or the event is not removable: account work waits.
      result.accounts.deferred.push({ demoId, uid, code: 'EVENT_STILL_PRESENT' });
      return;
    }
  }
  const identity = await auth.getUser(uid).catch((error) => { if (error.code === 'auth/user-not-found') return null; throw error; });
  if (identity) {
    const admin = await db.doc(`platformAdmins/${uid}`).get();
    const changed = !identity.email || identity.email.toLowerCase() !== email;
    if (admin.exists || changed) {
      await ledger.ref.delete();
      result.accounts.retained.push({ demoId, uid, code: admin.exists ? 'IS_ADMIN' : 'EMAIL_CHANGED' });
      return;
    }
    if (!bucketClient) { // Buckets cannot be checked, so "no other event" is unproven.
      result.accounts.deferred.push({ demoId, uid, code: 'BUCKET_API_UNCONFIGURED' });
      return;
    }
    const others = await otherEvents({ db, bucketClient, uid, targetId, nowMs });
    if (others.real > 0) {
      // Now a real customer. The directory entry and account stay; the record is done.
      await ledger.ref.delete();
      result.accounts.retained.push({ demoId, uid, code: 'HAS_OTHER_EVENT' });
      return;
    }
    if (others.liveDemo > 0) { // Rechecked each run; removed when the last demo expires.
      result.accounts.deferred.push({ demoId, uid, code: 'HAS_LIVE_DEMO' });
      return;
    }
    await auth.deleteUser(uid).catch((error) => { if (error.code !== 'auth/user-not-found') throw error; });
  }
  const [cards, grants] = await Promise.all([
    db.collection(`users/${uid}/weddingAccess`).get(),
    db.collection('customerGrants').where('email', '==', email).get(),
  ]);
  await deleteRefs(db, [...cards.docs.map((row) => row.ref), ...grants.docs.map((row) => row.ref), db.doc(`customerDirectory/${uid}`), ledger.ref]);
  result.accounts.deleted.push({ demoId, uid });
}

// Pages by the last document seen rather than re-reading from the top, so a demo
// that keeps failing cannot starve the ones after it.
async function* expiredDocs(query) {
  let last = null;
  for (;;) {
    const page = await (last ? query.startAfter(last) : query).limit(50).get();
    if (page.empty) return;
    yield* page.docs;
    last = page.docs[page.docs.length - 1];
  }
}

// Takes no event ids. The candidates are chosen here, from a single-field index
// (no composite index needed) that cannot return a document without demoExpiresAt.
// Demo buckets are not deleted here: the backend's own demo sweep removes them every
// 15 minutes and can only touch demo-* ids. This handles their accounts.
// Each pass gets its own share, measured from when it starts, so a backlog of events
// can never stop accounts from being settled. A run is not cut short mid-demo, so one
// very large event can overrun; vercel.json allows 60 s against this 45 s default.
export async function cleanupExpiredDemos({ auth, db, bucketClient = null, now = Date.now, budgetMs = 45000, clock = Date.now }) {
  const nowMs = now();
  const cutoff = Timestamp.fromMillis(nowMs);
  const passTimer = (share) => { const end = clock() + budgetMs * share; return () => clock() < end; };
  const result = {
    ok: true, done: true,
    events: { deleted: [], skipped: [], failed: [] },
    accounts: { deleted: [], retained: [], deferred: [], failed: [] },
  };
  const eventsInBudget = passTimer(0.7);
  for await (const row of expiredDocs(db.collection('weddings').where('demoExpiresAt', '<=', cutoff).orderBy('demoExpiresAt'))) {
    if (!eventsInBudget()) { result.done = false; break; }
    try {
      if (await deleteExpiredDemoEvent(db, row.ref, nowMs)) result.events.deleted.push(row.id);
      else result.events.skipped.push(row.id);
    } catch (error) {
      result.events.failed.push({ id: row.id, code: String(error?.code || error?.name) });
    }
  }
  const accountsInBudget = passTimer(0.3);
  for await (const ledger of expiredDocs(db.collection(LEDGER).where('expiresAt', '<=', cutoff).orderBy('expiresAt'))) {
    if (!accountsInBudget()) { result.done = false; break; }
    try {
      await settleLedger({ auth, db, bucketClient, ledger, nowMs, result });
    } catch (error) {
      result.accounts.failed.push({ demoId: ledger.id, code: String(error?.code || error?.name) });
    }
  }
  result.ok = result.events.failed.length === 0 && result.accounts.failed.length === 0;
  return result;
}

function secretMatches(given, secret) {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH || !given) return false;
  const digest = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(secret));
}

// GET is for Vercel Cron, which sends only GET with `Authorization: Bearer $CRON_SECRET`.
export async function runCleanupRequest({ auth, db, method, bearer, env = process.env, fetchImpl = fetch, now = Date.now }) {
  if (method !== 'GET' && method !== 'POST') throw new AdminError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
  const scheduler = secretMatches(bearer, env.CRON_SECRET);
  if (!scheduler) {
    if (method !== 'POST') throw new AdminError(401, 'UNAUTHENTICATED', 'Sign in is required.');
    await requireAdmin(auth, db, bearer);
  }
  let getToken = null;
  if (!scheduler) getToken = async () => bearer;
  else if (env.DEMO_SERVICE_ADMIN_UID && env.FIREBASE_WEB_API_KEY) getToken = serviceTokenProvider({ auth, uid: env.DEMO_SERVICE_ADMIN_UID, apiKey: env.FIREBASE_WEB_API_KEY, fetchImpl });
  const bucketClient = env.PHOTO_BUCKET_API_URL && getToken ? createBucketClient({ baseUrl: env.PHOTO_BUCKET_API_URL, getToken, fetchImpl }) : null;
  const budget = Number(env.DEMO_CLEANUP_BUDGET_MS);
  return cleanupExpiredDemos({ auth, db, bucketClient, now, ...(budget > 0 ? { budgetMs: budget } : {}) });
}
