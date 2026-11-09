import { FieldValue } from 'firebase-admin/firestore';
import { customerMembership, discoveryData, grantIdFor } from '../../account-access.js';
import { AdminError, BucketError, requireAdmin } from './admin-common.js';
import { isExpiredDemo } from './demo-rules.js';

const MAX_TARGETS = 50;
const POOL = 5;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validEventId = (id) => typeof id === 'string' && id.length >= 1 && id.length <= 128 && !id.includes('/') && id !== '.' && id !== '..' && !/^__.*__$/.test(id);
const validBucketId = (id) => typeof id === 'string' && /^(?:b|demo)-[a-f0-9]{32}$/.test(id);

export async function lookupCustomer({ auth, db, token, email }) {
  await requireAdmin(auth, db, token);
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!EMAIL.test(normalized) || normalized.length > 254) throw new AdminError(400, 'INVALID_EMAIL', 'Enter a valid email address.');
  const user = await auth.getUserByEmail(normalized).catch((error) => { if (error.code === 'auth/user-not-found') return null; throw error; });
  if (!user) throw new AdminError(404, 'CUSTOMER_NOT_FOUND', 'No account uses this email address.');
  const [admin, directory] = await Promise.all([db.doc(`platformAdmins/${user.uid}`).get(), db.doc(`customerDirectory/${user.uid}`).get()]);
  return { uid: user.uid, email: user.email, disabled: user.disabled === true, isAdmin: admin.exists, inDirectory: directory.exists };
}

const fail = (target, code, error, retryable = false) => ({ ...target, ok: false, code, error, retryable });
const done = (target, status, extra = {}) => ({ ...target, ok: true, status, ...extra });

async function linkEvent(db, target, user) {
  const eventRef = db.doc(`weddings/${target.id}`);
  const memberRef = eventRef.collection('dashboardUsers').doc(user.uid);
  const cardRef = db.doc(`users/${user.uid}/weddingAccess/${target.id}`);
  return db.runTransaction(async (transaction) => {
    const [event, member] = await Promise.all([transaction.get(eventRef), transaction.get(memberRef)]);
    if (!event.exists) return fail(target, 'EVENT_NOT_FOUND', 'This event no longer exists.');
    const data = event.data();
    if (data.deleting === true) return fail(target, 'EVENT_DELETING', 'This event is being deleted.');
    if (isExpiredDemo(data, Date.now())) return fail(target, 'EVENT_EXPIRED', 'This demo has expired.');
    // Anything but a plain customer membership is stronger or differently scoped.
    if (data.ownerUserId === user.uid) return done(target, 'preserved', { role: 'owner' });
    if (member.exists && member.data().role !== 'customer') return done(target, 'preserved', { role: member.data().role ?? null });
    const stamp = FieldValue.serverTimestamp();
    // An existing customer membership is left as is: it may carry narrower settings.
    if (!member.exists) transaction.set(memberRef, customerMembership(user.uid, user.email, stamp));
    transaction.set(cardRef, { ...discoveryData(target.id, data), updatedAt: stamp });
    transaction.set(db.doc(`customerDirectory/${user.uid}`), { userId: user.uid, email: user.email, updatedAt: stamp }, { merge: true });
    return done(target, member.exists ? 'already_linked' : 'linked');
  });
}

async function unlinkEvent(db, target, user) {
  const eventRef = db.doc(`weddings/${target.id}`);
  const memberRef = eventRef.collection('dashboardUsers').doc(user.uid);
  return db.runTransaction(async (transaction) => {
    const [event, member] = await Promise.all([transaction.get(eventRef), transaction.get(memberRef)]);
    if (event.exists && event.data().ownerUserId === user.uid) return fail(target, 'PRESERVED_ROLE', 'The event owner cannot be unlinked here.');
    if (member.exists && member.data().role !== 'customer') return fail(target, 'PRESERVED_ROLE', 'This member has a specialized role, which is left unchanged.');
    transaction.delete(memberRef);
    transaction.delete(db.doc(`users/${user.uid}/weddingAccess/${target.id}`));
    // A pending email grant would otherwise link the customer again at next sign-in.
    transaction.delete(db.doc(`customerGrants/${grantIdFor(user.email, target.id)}`));
    return done(target, member.exists ? 'unlinked' : 'not_linked');
  });
}

async function applyBucket(db, bucketClient, target, action, user) {
  if (!bucketClient) return fail(target, 'BUCKET_API_UNCONFIGURED', 'The photo bucket service is not configured.', true);
  if (action === 'unlink') { await bucketClient.removeOwner(target.id, user.uid); return done(target, 'unlinked'); }
  await bucketClient.addOwner(target.id, user.uid);
  // Only an aid for finding the uid, so it does not turn a successful link into a failure.
  const warning = await db.doc(`customerDirectory/${user.uid}`)
    .set({ userId: user.uid, email: user.email, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    .then(() => null, () => 'DIRECTORY_NOT_UPDATED');
  return done(target, 'linked', warning ? { warning } : {});
}

export async function manageCustomerAccess({ auth, db, token, action, userId, targets, bucketClient = null, budgetMs = 8000 }) {
  await requireAdmin(auth, db, token);
  if (action !== 'link' && action !== 'unlink') throw new AdminError(400, 'INVALID_ACTION', 'Choose link or unlink.');
  if (!validEventId(userId)) throw new AdminError(400, 'INVALID_USER', 'Invalid customer.');
  if (!Array.isArray(targets) || targets.length === 0 || targets.length > MAX_TARGETS) throw new AdminError(400, 'INVALID_TARGETS', `Choose between 1 and ${MAX_TARGETS} events.`);
  const unique = new Map();
  for (const item of targets) {
    const valid = item?.kind === 'event' ? validEventId(item.id) : item?.kind === 'bucket' && validBucketId(item.id);
    if (!valid) throw new AdminError(400, 'INVALID_TARGETS', 'One of the chosen events is not valid.');
    unique.set(`${item.kind}:${item.id}`, { kind: item.kind, id: item.id });
  }
  const identity = await auth.getUser(userId).catch((error) => { if (error.code === 'auth/user-not-found') return null; throw error; });
  if (!identity) throw new AdminError(404, 'CUSTOMER_NOT_FOUND', 'This account no longer exists.');
  if (!identity.email) throw new AdminError(409, 'CUSTOMER_NO_EMAIL', 'This account has no email address.');
  if ((await db.doc(`platformAdmins/${userId}`).get()).exists) throw new AdminError(409, 'TARGET_IS_ADMIN', 'Administrators already have access and cannot be linked as customers.');
  const user = { uid: userId, email: identity.email.trim().toLowerCase() };

  const list = [...unique.values()];
  const results = new Array(list.length);
  const startedAt = Date.now();
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const index = next++;
      const target = list[index];
      if (Date.now() - startedAt >= budgetMs) { results[index] = fail(target, 'NOT_ATTEMPTED', 'Not attempted. Retry this event.', true); continue; }
      try {
        if (target.kind === 'bucket') results[index] = await applyBucket(db, bucketClient, target, action, user);
        else results[index] = await (action === 'link' ? linkEvent : unlinkEvent)(db, target, user);
      } catch (error) {
        results[index] = error instanceof BucketError
          ? fail(target, error.code, error.message, error.retryable)
          : fail(target, 'INTERNAL', 'This event could not be updated. Please retry.', true);
      }
    }
  };
  await Promise.all(Array.from({ length: POOL }, worker));
  const failed = results.filter((row) => !row.ok).length;
  return { ok: failed === 0, action, userId, succeeded: results.length - failed, failed, results };
}

/* ------------------------------------------------- Access section (one event or bucket) */
// These serve the Access section shown on event cards, the event dashboard and the photo
// bucket page. That section has no database connection of its own on the bucket page, so
// everything it shows comes from here. All of it is for platform administrators only.
const MAX_UIDS = 50;
const SEARCH_RESULTS = 8;
const normalEmail = (email) => {
  const value = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!EMAIL.test(value) || value.length > 254) throw new AdminError(400, 'INVALID_EMAIL', 'Enter a valid email address.');
  return value;
};

// Everyone who can open an event, with the fields the page needs to name their role, plus pending invitations.
export async function listEventAccess({ auth, db, token, eventId }) {
  await requireAdmin(auth, db, token);
  if (!validEventId(eventId)) throw new AdminError(400, 'INVALID_EVENT', 'Invalid event.');
  const eventRef = db.doc(`weddings/${eventId}`);
  const [event, members, grants] = await Promise.all([eventRef.get(), eventRef.collection('dashboardUsers').get(), db.collection('customerGrants').where('weddingId', '==', eventId).get()]);
  if (!event.exists) throw new AdminError(404, 'EVENT_NOT_FOUND', 'This event no longer exists.');
  const pick = (data) => ({ email: typeof data.email === 'string' ? data.email : '', role: typeof data.role === 'string' ? data.role : '', seatingOnly: data.seatingOnly === true, canCheckIn: data.canCheckIn === true, canViewDashboard: data.canViewDashboard === true, allowedSide: typeof data.allowedSide === 'string' ? data.allowedSide : 'all' });
  return {
    ownerUserId: event.data().ownerUserId || '',
    members: members.docs.map((row) => ({ id: row.id, ...pick(row.data()) })),
    invited: grants.docs.map((row) => ({ id: row.id, email: typeof row.data().email === 'string' ? row.data().email : '' })),
  };
}

// Emails for account ids, for a photo bucket's owner list (the bucket service stores ids only).
export async function resolveAccounts({ auth, db, token, uids }) {
  await requireAdmin(auth, db, token);
  if (!Array.isArray(uids) || uids.length > MAX_UIDS || !uids.every(validEventId)) throw new AdminError(400, 'INVALID_USER', 'Invalid account list.');
  const unique = [...new Set(uids)];
  if (!unique.length) return { accounts: [] };
  const found = new Map((await auth.getUsers(unique.map((uid) => ({ uid })))).users.map((user) => [user.uid, user.email || '']));
  return { accounts: unique.map((uid) => ({ uid, email: found.get(uid) || '', exists: found.has(uid) })) };
}

// Customers whose email starts with what was typed. One small indexed query, however many customers there are.
export async function searchCustomers({ auth, db, token, term }) {
  await requireAdmin(auth, db, token);
  const text = typeof term === 'string' ? term.trim().toLowerCase() : '';
  if (text.length > 254 || /[\u0000-\u001f]/.test(text)) throw new AdminError(400, 'INVALID_SEARCH', 'Invalid search.');
  let query = db.collection('customerDirectory').orderBy('email').limit(SEARCH_RESULTS + 1);
  if (text) query = query.startAt(text).endAt(`${text}\uf8ff`);
  const rows = (await query.get()).docs;
  return { results: rows.slice(0, SEARCH_RESULTS).map((row) => ({ uid: row.id, email: row.data().email || '' })), more: rows.length > SEARCH_RESULTS };
}

// A new sign-in account for a customer, made here with the service account so the page never
// uses the public sign-up call. The caller links it to an event or bucket afterwards.
export async function createCustomerAccount({ auth, db, token, email, password }) {
  await requireAdmin(auth, db, token);
  const normalized = normalEmail(email);
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw new AdminError(400, 'INVALID_PASSWORD', 'Use a password between 8 and 128 characters.');
  let user;
  try { user = await auth.createUser({ email: normalized, password, emailVerified: false }); }
  catch (error) {
    if (error.code === 'auth/email-already-exists') throw new AdminError(409, 'EMAIL_EXISTS', 'This email already has an account.');
    if (error.code === 'auth/invalid-email') throw new AdminError(400, 'INVALID_EMAIL', 'Enter a valid email address.');
    if (error.code === 'auth/invalid-password') throw new AdminError(400, 'INVALID_PASSWORD', 'Use a longer password.');
    throw error;
  }
  await db.doc(`customerDirectory/${user.uid}`).set({ userId: user.uid, email: normalized, updatedAt: FieldValue.serverTimestamp() });
  return { uid: user.uid, email: normalized };
}

// Withdraws an invitation that was never taken up. The grant must belong to the named event.
export async function cancelEventInvite({ auth, db, token, eventId, grantId }) {
  await requireAdmin(auth, db, token);
  if (!validEventId(eventId) || typeof grantId !== 'string' || !grantId || grantId.length > 600 || grantId.includes('/')) throw new AdminError(400, 'INVALID_INVITE', 'Invalid invitation.');
  const ref = db.doc(`customerGrants/${grantId}`);
  const grant = await ref.get();
  if (grant.exists && grant.data().weddingId !== eventId) throw new AdminError(400, 'INVALID_INVITE', 'Invalid invitation.');
  await ref.delete();
  return { ok: true };
}
