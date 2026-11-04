import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { deleteApp as deleteAdminApp, initializeApp as initializeAdmin } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore, Timestamp } from 'firebase-admin/firestore';
import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { connectFirestoreEmulator, doc, getDoc, getFirestore, serverTimestamp, updateDoc } from 'firebase/firestore';
import { createBucketClient } from '../api/_lib/admin-common.js';
import { lookupCustomer, manageCustomerAccess } from '../api/_lib/customer-access.js';
import { cleanupExpiredDemos, createDemo, DEMO_EMAIL_DOMAIN, runCleanupRequest } from '../api/_lib/demo-accounts.js';
import { DEMO_EXPIRY_HOURS } from '../api/_lib/demo-rules.js';

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST);
const options = { skip: !enabled };
// Overridable so a run against already-running emulators cannot reach a preview's data:
// both emulators keep each project's data apart.
const PROJECT = process.env.ADMIN_API_TEST_PROJECT || 'demo-wedding-security';
const HOUR = 60 * 60 * 1000;
const DEFAULT_TTL_MS = 24 * HOUR;
const PASSWORD = 'emulator-only-password';
const SECRET = 'x'.repeat(40);
const BUCKET_BASE = 'https://bucket.test';
let adminApp, auth, db, adminToken, customerToken, adminUid;
const clientApps = [];
let counter = 0;
const unique = (label) => `${label}-${Date.now()}-${counter += 1}`;

async function signIn(email, password) {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-key' }, unique('client'));
  clientApps.push(app);
  const clientAuth = getAuth(app);
  connectAuthEmulator(clientAuth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  const clientDb = getFirestore(app);
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(clientDb, host, Number(port));
  const { user } = await signInWithEmailAndPassword(clientAuth, email, password);
  return { db: clientDb, token: await user.getIdToken(), uid: user.uid };
}

async function newUser(label) {
  const email = `${unique(label)}@example.test`.toLowerCase();
  const user = await auth.createUser({ email, password: PASSWORD });
  return { uid: user.uid, email };
}

// In-memory stand-in for the bucket API, speaking the contract over the real client.
function fakeBucketApi() {
  const buckets = new Map();
  const state = { buckets, failNext: null, down: false, ignoreExpiry: false, calls: [], createBodies: [] };
  state.fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    if (parsed.origin !== BUCKET_BASE) return fetch(url, init);
    state.calls.push({ method: init.method, path: parsed.pathname, token: init.headers.authorization });
    const reply = (status, body) => new Response(JSON.stringify(body), { status });
    if (state.down) throw new TypeError('fetch failed');
    if (state.failNext) { const failure = state.failNext; state.failNext = null; return reply(failure.status, { code: failure.code, error: 'Refused.' }); }
    const body = init.body ? JSON.parse(init.body) : {};
    if (init.method === 'POST' && parsed.pathname === '/owner/create') {
      state.createBodies.push(body);
      const id = `demo-${unique('b').replace(/[^a-z0-9]/g, '')}`;
      const bucket = { id, demo: true, name: body.name, limitGb: 1, owners: body.owners, expiresAt: Date.now() + (state.ignoreExpiry ? 24 : body.expiresInHours ?? 24) * HOUR, status: 'active', expired: false };
      buckets.set(id, bucket);
      return reply(201, bucket);
    }
    if (parsed.pathname === '/owner/list') {
      const uid = parsed.searchParams.get('uid');
      return reply(200, { items: [...buckets.values()].filter((row) => row.owners.includes(uid)), nextCursor: null });
    }
    const eventFiles = parsed.pathname.match(/^\/events\/([^/]+)$/);
    if (eventFiles && init.method === 'DELETE') { state.deletedEventFiles = [...(state.deletedEventFiles || []), decodeURIComponent(eventFiles[1])]; return reply(200, { removed: true }); }
    const match = parsed.pathname.match(/^\/b\/([^/]+)(\/owners(?:\/([^/]+))?)?$/);
    const bucket = match && buckets.get(match[1]);
    if (!bucket) return reply(404, { code: 'BUCKET_NOT_FOUND', error: 'Not found.' });
    if (init.method === 'POST' && match[2]) { if (!bucket.owners.includes(body.uid)) bucket.owners.push(body.uid); return reply(200, bucket); }
    if (init.method === 'DELETE' && match[3]) { bucket.owners = bucket.owners.filter((uid) => uid !== match[3]); return reply(200, bucket); }
    if (init.method === 'DELETE') { buckets.delete(match[1]); return reply(202, { id: match[1], status: 'deleting' }); }
    return reply(404, { code: 'NOT_FOUND', error: 'Not found.' });
  };
  state.client = createBucketClient({ baseUrl: BUCKET_BASE, getToken: async () => adminToken, fetchImpl: state.fetch });
  return state;
}

const exists = async (path) => (await db.doc(path).get()).exists;
const authExists = (uid) => auth.getUser(uid).then(() => true, (error) => { if (error.code === 'auth/user-not-found') return false; throw error; });
const past = (hours = 25) => () => Date.now() - hours * HOUR;
const newRealEvent = async (extra = {}) => {
  const id = unique('real');
  await db.doc(`weddings/${id}`).set({ eventTitle: 'Real', eventCategory: 'celebration', ownerUserId: adminUid, ...extra });
  return id;
};

before(async () => {
  if (!enabled) return;
  adminApp = initializeAdmin({ projectId: PROJECT }, 'admin-api-test');
  auth = getAdminAuth(adminApp);
  db = getAdminFirestore(adminApp);
  const admin = await newUser('admin');
  adminUid = admin.uid;
  await db.doc(`platformAdmins/${adminUid}`).set({ enabled: true });
  adminToken = (await signIn(admin.email, PASSWORD)).token;
  const customer = await newUser('plain');
  customerToken = (await signIn(customer.email, PASSWORD)).token;
});

after(async () => {
  await Promise.all(clientApps.map((app) => deleteApp(app)));
  if (adminApp) await deleteAdminApp(adminApp);
});

test('demo endpoints are admin only, including a disabled admin', options, async () => {
  const disabled = await newUser('disabled');
  await db.doc(`platformAdmins/${disabled.uid}`).set({ enabled: false });
  const disabledToken = (await signIn(disabled.email, PASSWORD)).token;
  const input = { auth, db, type: 'celebration', name: 'Nope' };
  await assert.rejects(createDemo({ ...input, token: '' }), { status: 401 });
  await assert.rejects(createDemo({ ...input, token: 'garbage' }), { status: 401 });
  await assert.rejects(createDemo({ ...input, token: customerToken }), { status: 403 });
  await assert.rejects(createDemo({ ...input, token: disabledToken }), { status: 403 });
  await assert.rejects(lookupCustomer({ auth, db, token: customerToken, email: 'a@example.test' }), { status: 403 });
  await assert.rejects(manageCustomerAccess({ auth, db, token: customerToken, action: 'link', userId: 'x', targets: [{ kind: 'event', id: 'e' }] }), { status: 403 });
  await assert.rejects(createDemo({ ...input, token: adminToken, type: 'bogus' }), { status: 400 });
  await assert.rejects(createDemo({ ...input, token: adminToken, name: '   ' }), { status: 400 });
});

for (const type of ['wedding_engagement', 'celebration', 'gender_reveal']) {
  test(`create ${type} demo: exact 24h, working credentials, no stored password`, options, async () => {
    const fixed = Date.now();
    const demo = await createDemo({ auth, db, token: adminToken, type, name: 'Sara & Ali', now: () => fixed });
    assert.equal(demo.expiresAt, fixed + DEFAULT_TTL_MS, 'omitted expiry defaults to 24 hours');
    assert.ok(demo.credentials.email.endsWith(`@${DEMO_EMAIL_DOMAIN}`));
    const event = (await db.doc(`weddings/${demo.eventId}`).get()).data();
    assert.equal(event.isDemo, true);
    assert.equal(event.eventCategory, type);
    assert.equal(event.demoExpiresAt.toMillis() - event.createdAt.toMillis(), DEFAULT_TTL_MS);
    assert.equal(event.ownerUserId, adminUid);

    const customer = await signIn(demo.credentials.email, demo.credentials.password);
    assert.equal(customer.uid, event.demoAccountUid);
    const paths = [`weddings/${demo.eventId}/dashboardUsers/${customer.uid}`, `users/${customer.uid}/weddingAccess/${demo.eventId}`, `customerDirectory/${customer.uid}`, `demoLedger/${demo.demoId}`, `weddings/${demo.eventId}`];
    const rows = await Promise.all(paths.map((path) => db.doc(path).get()));
    assert.ok(rows.every((row) => row.exists), 'membership, card, directory, ledger and event all exist');
    assert.equal(rows[0].data().role, 'customer');
    assert.equal(rows[3].data().state, 'active');
    assert.ok(!JSON.stringify(rows.map((row) => row.data())).includes(demo.credentials.password), 'the password is stored nowhere');

    // Real rules: the generated account can open and edit its event, but not the ledger.
    const ref = doc(customer.db, 'weddings', demo.eventId);
    assert.equal((await getDoc(ref)).exists(), true);
    await updateDoc(ref, { eventTitle: 'Edited by customer', updatedAt: serverTimestamp() });
    await assert.rejects(getDoc(doc(customer.db, 'demoLedger', demo.demoId)));
    const adminClient = await signIn((await auth.getUser(adminUid)).email, PASSWORD);
    await assert.rejects(getDoc(doc(adminClient.db, 'demoLedger', demo.demoId)), 'even admins have no client path to the ledger');
    await db.doc(`weddings/${demo.eventId}`).update({ demoExpiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    await assert.rejects(getDoc(ref), 'expired demos are closed by the rules');
  });
}

test('expiry choice: each allowed value is exact on the event and the ledger', options, async () => {
  assert.deepEqual([...DEMO_EXPIRY_HOURS], [6, 12, 24, 48, 72, 168]);
  for (const expiresInHours of DEMO_EXPIRY_HOURS) {
    const fixed = Date.now();
    const demo = await createDemo({ auth, db, token: adminToken, type: 'celebration', name: 'Timed', expiresInHours, now: () => fixed });
    const expected = fixed + expiresInHours * HOUR;
    assert.equal(demo.expiresAt, expected);
    assert.equal(demo.expiresInHours, expiresInHours);
    assert.equal((await db.doc(`weddings/${demo.eventId}`).get()).data().demoExpiresAt.toMillis(), expected);
    assert.equal((await db.doc(`demoLedger/${demo.demoId}`).get()).data().expiresAt.toMillis(), expected);
  }
});

test('expiry choice: anything else is rejected before anything is created', options, async () => {
  const before = (await db.collection('demoLedger').get()).size;
  const users = (await auth.listUsers(1000)).users.length;
  for (const expiresInHours of [0, -6, 1, 25, 24.5, 169, '24', null, true, [24], Infinity, NaN]) {
    await assert.rejects(createDemo({ auth, db, token: adminToken, type: 'celebration', name: 'Bad', expiresInHours }), { status: 400, code: 'INVALID_EXPIRY' }, String(expiresInHours));
  }
  assert.equal((await db.collection('demoLedger').get()).size, before);
  assert.equal((await auth.listUsers(1000)).users.length, users);
});

test('expiry choice: the real rules keep a member in past 24h and close at the chosen time', options, async () => {
  // Created 30 hours ago with 168 hours: older than the 24h the rules were written around.
  const long = await createDemo({ auth, db, token: adminToken, type: 'wedding_engagement', name: 'Long', expiresInHours: 168, now: past(30) });
  const member = await signIn(long.credentials.email, long.credentials.password);
  const ref = doc(member.db, 'weddings', long.eventId);
  assert.equal((await getDoc(ref)).exists(), true);
  await updateDoc(ref, { eventTitle: 'Still open', updatedAt: serverTimestamp() });
  assert.equal((await getDoc(doc(member.db, 'users', member.uid, 'weddingAccess', long.eventId))).exists(), true);
  const uid = member.uid;
  await cleanupExpiredDemos({ auth, db, bucketClient: fakeBucketApi().client });
  assert.equal(await exists(`weddings/${long.eventId}`), true, 'cleanup leaves it until the chosen time');
  assert.equal(await authExists(uid), true);

  // Created 7 hours ago with 6 hours: younger than 24h, already expired.
  const short = await createDemo({ auth, db, token: adminToken, type: 'celebration', name: 'Short', expiresInHours: 6, now: past(7) });
  const shortMember = await signIn(short.credentials.email, short.credentials.password);
  await assert.rejects(getDoc(doc(shortMember.db, 'weddings', short.eventId)));
  const result = await cleanupExpiredDemos({ auth, db, bucketClient: fakeBucketApi().client });
  assert.ok(result.events.deleted.includes(short.eventId));
  assert.equal(await authExists(shortMember.uid), false);
});

test('expiry choice: buckets receive it, and a stack that ignores it is rolled back', options, async () => {
  const api = fakeBucketApi();
  const demo = await createDemo({ auth, db, token: adminToken, type: 'photo_bucket', name: 'Album', expiresInHours: 72, bucketClient: api.client });
  assert.equal(api.createBodies[0].expiresInHours, 72);
  const bucket = api.buckets.get(demo.bucketId);
  assert.equal(demo.expiresAt, bucket.expiresAt);
  assert.equal((await db.doc(`demoLedger/${demo.demoId}`).get()).data().expiresAt.toMillis(), bucket.expiresAt);
  await createDemo({ auth, db, token: adminToken, type: 'photo_bucket', name: 'Default', bucketClient: api.client });
  assert.equal(api.createBodies[1].expiresInHours, 24);

  const stale = fakeBucketApi();
  stale.ignoreExpiry = true;
  const users = (await auth.listUsers(1000)).users.length;
  await assert.rejects(createDemo({ auth, db, token: adminToken, type: 'photo_bucket', name: 'Stale', expiresInHours: 72, bucketClient: stale.client }), (error) => error.status === 502 && error.code === 'BUCKET_API_CONTRACT' && error.extra.rolledBack === true);
  assert.equal(stale.buckets.size, 0, 'the bucket with the wrong expiry is deleted');
  assert.equal((await auth.listUsers(1000)).users.length, users);
});

test('create photo_bucket demo calls the demo route and links the account as owner', options, async () => {
  const api = fakeBucketApi();
  const demo = await createDemo({ auth, db, token: adminToken, type: 'photo_bucket', name: 'Album', bucketClient: api.client });
  const bucket = api.buckets.get(demo.bucketId);
  assert.equal(bucket.demo, true);
  const ledger = (await db.doc(`demoLedger/${demo.demoId}`).get()).data();
  assert.deepEqual(bucket.owners, [ledger.uid]);
  assert.equal(ledger.targetId, demo.bucketId);
  assert.equal(ledger.expiresAt.toMillis(), bucket.expiresAt);
  assert.equal(await exists(`customerDirectory/${ledger.uid}`), true);
  await assert.rejects(createDemo({ auth, db, token: adminToken, type: 'photo_bucket', name: 'Album' }), { status: 503, code: 'BUCKET_API_UNCONFIGURED' });
});

function dbWithBatchFailure(applyThenFail) {
  let failed = false; // Only the first commit fails, so rollback's own commit works.
  return new Proxy(db, { get(target, key) {
    if (key !== 'batch') { const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; }
    return () => {
      const real = target.batch();
      return new Proxy(real, { get(batch, name) {
        if (name === 'commit' && !failed) return async () => { failed = true; if (applyThenFail) await batch.commit(); throw Object.assign(new Error('injected'), { code: 'deadline-exceeded' }); };
        const value = batch[name];
        return typeof value === 'function' ? value.bind(batch) : value;
      } });
    };
  } });
}

async function assertNoTrace(ledgersBefore) {
  const after = await db.collection('demoLedger').get();
  const added = after.docs.filter((row) => !ledgersBefore.has(row.id));
  assert.equal(added.length, 0, 'the ledger record is removed after a full rollback');
}

for (const applyThenFail of [false, true]) {
  test(`partial failure rolls back when the commit ${applyThenFail ? 'applied but reported an error' : 'failed'}`, options, async () => {
    const before = new Set((await db.collection('demoLedger').get()).docs.map((row) => row.id));
    const users = (await auth.listUsers(1000)).users.length;
    const logged = [];
    const original = console.error;
    console.error = (...args) => logged.push(args.join(' '));
    try {
      await assert.rejects(createDemo({ auth, db: dbWithBatchFailure(applyThenFail), token: adminToken, type: 'celebration', name: 'Fail' }), (error) => error.status === 500 && error.extra.rolledBack === true);
    } finally { console.error = original; }
    assert.ok(logged.every((line) => !/password/i.test(line) && !line.includes(DEMO_EMAIL_DOMAIN)));
    assert.equal((await auth.listUsers(1000)).users.length, users, 'the Auth user is removed');
    await assertNoTrace(before);
    const leftovers = await db.collection('weddings').where('eventTitle', '==', 'Fail').get();
    assert.equal(leftovers.size, 0);
  });
}

test('bucket failures roll back the account, and a created bucket is deleted', options, async () => {
  const before = new Set((await db.collection('demoLedger').get()).docs.map((row) => row.id));
  const users = (await auth.listUsers(1000)).users.length;
  const api = fakeBucketApi();
  api.failNext = { status: 403, code: 'ADMIN_ONLY' };
  await assert.rejects(createDemo({ auth, db, token: adminToken, type: 'photo_bucket', name: 'Fail', bucketClient: api.client }), (error) => error.status === 502 && error.code === 'ADMIN_ONLY' && error.extra.rolledBack === true);
  const original = console.error;
  console.error = () => {};
  try {
    await assert.rejects(createDemo({ auth, db: dbWithBatchFailure(false), token: adminToken, type: 'photo_bucket', name: 'Fail', bucketClient: api.client }), { status: 500 });
  } finally { console.error = original; }
  assert.equal(api.buckets.size, 0, 'the bucket made before the failure is deleted');
  assert.equal((await auth.listUsers(1000)).users.length, users);
  await assertNoTrace(before);
});

test('a demo that crashed during creation is recovered from its ledger after expiry', options, async () => {
  const uid = `demo-${unique('crash')}`;
  const email = `${unique('crash')}@${DEMO_EMAIL_DOMAIN}`;
  await db.doc(`demoLedger/${uid}`).set({ demoId: uid, kind: 'event', type: 'celebration', targetId: unique('never-made'), uid, email, state: 'creating', expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
  await auth.createUser({ uid, email, password: PASSWORD });
  const result = await cleanupExpiredDemos({ auth, db, bucketClient: fakeBucketApi().client });
  assert.deepEqual(result.accounts.deleted.filter((row) => row.uid === uid).length, 1);
  assert.equal(await authExists(uid), false);
  assert.equal(await exists(`demoLedger/${uid}`), false);
});

async function seedExpiredDemo() {
  const demo = await createDemo({ auth, db, token: adminToken, type: 'wedding_engagement', name: 'Old demo', now: past() });
  const eventId = demo.eventId;
  const uid = (await db.doc(`weddings/${eventId}`).get()).data().demoAccountUid;
  for (const path of ['guests/g1', 'tables/t1', 'customerAudit/a1', 'senderCapabilities/c1', 'senderCapabilities/c1/recipients/r1', 'invitationTokens/tok', 'someFutureCollection/x']) {
    await db.doc(`weddings/${eventId}/${path}`).set({ seeded: true });
  }
  await db.doc(`customerGrants/grant-${eventId}`).set({ email: 'someone@example.test', weddingId: eventId, role: 'customer' });
  return { demo, eventId, uid };
}

async function assertDemoGone({ eventId, uid }) {
  assert.equal(await exists(`weddings/${eventId}`), false);
  for (const collection of ['guests', 'tables', 'customerAudit', 'senderCapabilities', 'invitationTokens', 'someFutureCollection', 'dashboardUsers']) {
    assert.equal((await db.collection(`weddings/${eventId}/${collection}`).get()).size, 0, `${collection} is empty`);
  }
  assert.equal((await db.collection(`weddings/${eventId}/senderCapabilities/c1/recipients`).get()).size, 0);
  assert.equal(await exists(`users/${uid}/weddingAccess/${eventId}`), false);
  assert.equal(await exists(`users/${adminUid}/weddingAccess/${eventId}`), false);
  assert.equal(await exists(`customerDirectory/${uid}`), false);
  assert.equal(await exists(`customerGrants/grant-${eventId}`), false);
  assert.equal(await authExists(uid), false);
}

test('cleanup removes an expired demo completely and is idempotent', options, async () => {
  const seeded = await seedExpiredDemo();
  const api = fakeBucketApi();
  const first = await cleanupExpiredDemos({ auth, db, bucketClient: api.client });
  assert.equal(first.ok, true);
  assert.ok(first.events.deleted.includes(seeded.eventId));
  assert.ok(first.accounts.deleted.some((row) => row.uid === seeded.uid));
  await assertDemoGone(seeded);
  assert.equal(await authExists(adminUid), true, 'the admin who made it is untouched');
  const second = await cleanupExpiredDemos({ auth, db, bucketClient: api.client });
  assert.equal(second.ok, true);
  assert.ok(!second.events.deleted.includes(seeded.eventId));
});

test('cleanup cannot touch a non-demo or unexpired event, and has no id input', options, async () => {
  const pastStamp = Timestamp.fromMillis(Date.now() - 48 * HOUR);
  const member = await newUser('decoy-member');
  const decoys = {
    noFlag: { demoExpiresAt: pastStamp },
    flagFalse: { isDemo: false, demoExpiresAt: pastStamp },
    flagString: { isDemo: 'true', demoExpiresAt: pastStamp },
    numberExpiry: { isDemo: true, demoExpiresAt: 1 },
    noExpiry: { isDemo: true },
    live: { isDemo: true, demoExpiresAt: Timestamp.fromMillis(Date.now() + HOUR) },
    plain: {},
  };
  const ids = {};
  for (const [label, fields] of Object.entries(decoys)) {
    const id = await newRealEvent(fields);
    ids[label] = id;
    await db.doc(`weddings/${id}/guests/g`).set({ name: 'Kept' });
    await db.doc(`weddings/${id}/customerAudit/a`).set({ kept: true });
    await db.doc(`weddings/${id}/dashboardUsers/${member.uid}`).set({ userId: member.uid, role: 'customer' });
    await db.doc(`users/${member.uid}/weddingAccess/${id}`).set({ weddingId: id });
  }
  // Even an expired-looking ledger pointing at a real event must not remove it.
  const uid = `demo-${unique('hostile')}`;
  const email = `${unique('hostile')}@${DEMO_EMAIL_DOMAIN}`;
  await auth.createUser({ uid, email, password: PASSWORD });
  await db.doc(`demoLedger/${uid}`).set({ demoId: uid, kind: 'event', targetId: ids.plain, uid, email, state: 'active', expiresAt: pastStamp });

  const result = await cleanupExpiredDemos({ auth, db, bucketClient: fakeBucketApi().client, eventId: ids.plain, ids: Object.values(ids) });
  for (const [label, id] of Object.entries(ids)) {
    assert.ok(!result.events.deleted.includes(id), `${label} is not reported deleted`);
    assert.equal(await exists(`weddings/${id}`), true, `${label} event kept`);
    assert.equal(await exists(`weddings/${id}/guests/g`), true, `${label} guests kept`);
    assert.equal(await exists(`weddings/${id}/customerAudit/a`), true, `${label} audit kept`);
    assert.equal(await exists(`weddings/${id}/dashboardUsers/${member.uid}`), true, `${label} membership kept`);
    assert.equal(await exists(`users/${member.uid}/weddingAccess/${id}`), true, `${label} card kept`);
  }
  assert.ok(result.accounts.deferred.some((row) => row.uid === uid && row.code === 'EVENT_STILL_PRESENT'));
  await db.doc(`demoLedger/${uid}`).delete();
  await auth.deleteUser(uid);
  // Decoys must not linger for later tests.
  for (const id of Object.values(ids)) await db.recursiveDelete(db.doc(`weddings/${id}`));
});

test('cleanup resumes after dying at each stage', options, async () => {
  for (const failOn of ['recursiveDelete', 'batch', 'runTransaction']) {
    const seeded = await seedExpiredDemo();
    let thrown = false;
    const flaky = new Proxy(db, { get(target, key) {
      if (key === failOn && !thrown) return () => { thrown = true; throw Object.assign(new Error('injected'), { code: 'unavailable' }); };
      const value = target[key];
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const api = fakeBucketApi();
    const first = await cleanupExpiredDemos({ auth, db: flaky, bucketClient: api.client });
    assert.equal(first.ok, false, `${failOn}: failure is reported`);
    assert.ok(first.events.failed.some((row) => row.id === seeded.eventId && row.code === 'unavailable'));
    assert.equal(await exists(`weddings/${seeded.eventId}`), true, `${failOn}: event survives until the end`);
    assert.equal(await authExists(seeded.uid), true, `${failOn}: account waits for its event`);
    const second = await cleanupExpiredDemos({ auth, db, bucketClient: api.client });
    assert.equal(second.ok, true, `${failOn}: resume succeeds`);
    await assertDemoGone(seeded);
  }
});

test('a time budget stops cleanly and the next run continues', options, async () => {
  const seeded = await seedExpiredDemo();
  const stopped = await cleanupExpiredDemos({ auth, db, bucketClient: fakeBucketApi().client, budgetMs: 0 });
  assert.equal(stopped.done, false);
  assert.equal(await exists(`weddings/${seeded.eventId}`), true);
  const finished = await cleanupExpiredDemos({ auth, db, bucketClient: fakeBucketApi().client });
  assert.equal(finished.done, true);
  await assertDemoGone(seeded);
});

test('the account pass still runs when the event pass ran out of time', options, async () => {
  const seeded = await seedExpiredDemo();
  const uid = `demo-${unique('backlog')}`;
  const email = `${unique('backlog')}@${DEMO_EMAIL_DOMAIN}`;
  await db.doc(`demoLedger/${uid}`).set({ demoId: uid, kind: 'event', targetId: unique('never-made'), uid, email, state: 'creating', expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
  await auth.createUser({ uid, email, password: PASSWORD });
  // The event pass starts at 0 and is out of time by its first check; the account pass gets a fresh share.
  let calls = 0;
  const clock = () => { calls += 1; return calls === 1 ? 0 : 1e12; };
  const result = await cleanupExpiredDemos({ auth, db, bucketClient: fakeBucketApi().client, clock, budgetMs: 60000 });
  assert.equal(result.done, false);
  assert.equal(result.events.deleted.length, 0);
  assert.equal(await exists(`weddings/${seeded.eventId}`), true);
  assert.equal(await authExists(uid), false, 'the account is settled despite the event backlog');
  assert.ok(result.accounts.deferred.some((row) => row.uid === seeded.uid && row.code === 'EVENT_STILL_PRESENT'));
  assert.equal((await cleanupExpiredDemos({ auth, db, bucketClient: fakeBucketApi().client })).done, true);
  await assertDemoGone(seeded);
});

test('cleanup keeps the Auth user when the account has another event', options, async () => {
  const api = fakeBucketApi();
  const link = (userId, targets) => manageCustomerAccess({ auth, db, token: adminToken, action: 'link', userId, targets, bucketClient: api.client });

  // A real customer who joined a demo loses only that demo.
  const realCustomer = await newUser('real-customer');
  const seeded = await seedExpiredDemo();
  await db.doc(`customerDirectory/${realCustomer.uid}`).set({ userId: realCustomer.uid, email: realCustomer.email });
  await db.doc(`weddings/${seeded.eventId}/dashboardUsers/${realCustomer.uid}`).set({ userId: realCustomer.uid, role: 'customer' });
  await db.doc(`users/${realCustomer.uid}/weddingAccess/${seeded.eventId}`).set({ weddingId: seeded.eventId });

  // Demo account also on a real event.
  const onEvent = await seedExpiredDemo();
  const realEvent = await newRealEvent();
  assert.equal((await link(onEvent.uid, [{ kind: 'event', id: realEvent }])).ok, true);

  // Demo account also owning a real bucket.
  const onBucket = await seedExpiredDemo();
  const realBucket = `b-${'a'.repeat(32)}`;
  api.buckets.set(realBucket, { id: realBucket, demo: false, owners: [], status: 'active' });
  assert.equal((await link(onBucket.uid, [{ kind: 'bucket', id: realBucket }])).ok, true);

  // Demo account also on a live demo: waits, then goes when that demo expires.
  const onLive = await seedExpiredDemo();
  const liveDemo = await createDemo({ auth, db, token: adminToken, type: 'celebration', name: 'Live', bucketClient: api.client });
  assert.equal((await link(onLive.uid, [{ kind: 'event', id: liveDemo.eventId }])).ok, true);

  const result = await cleanupExpiredDemos({ auth, db, bucketClient: api.client });
  assert.equal(result.ok, true);

  assert.equal(await authExists(realCustomer.uid), true);
  assert.equal(await exists(`customerDirectory/${realCustomer.uid}`), true);
  assert.equal(await exists(`users/${realCustomer.uid}/weddingAccess/${seeded.eventId}`), false, 'its demo card is removed');
  await assertDemoGone(seeded);

  for (const [label, row, code] of [['event', onEvent, 'HAS_OTHER_EVENT'], ['bucket', onBucket, 'HAS_OTHER_EVENT']]) {
    assert.equal(await authExists(row.uid), true, `${label}: account kept`);
    assert.equal(await exists(`customerDirectory/${row.uid}`), true, `${label}: directory kept`);
    assert.equal(await exists(`weddings/${row.eventId}`), false, `${label}: the expired demo itself is gone`);
    assert.ok(result.accounts.retained.some((item) => item.uid === row.uid && item.code === code));
  }
  assert.equal(await exists(`users/${onEvent.uid}/weddingAccess/${realEvent}`), true);
  assert.equal(await exists(`weddings/${realEvent}/dashboardUsers/${onEvent.uid}`), true);

  assert.ok(result.accounts.deferred.some((item) => item.uid === onLive.uid && item.code === 'HAS_LIVE_DEMO'));
  assert.equal(await authExists(onLive.uid), true);
  await db.doc(`weddings/${liveDemo.eventId}`).update({ demoExpiresAt: Timestamp.fromMillis(Date.now() - 1000) });
  await db.doc(`demoLedger/${liveDemo.demoId}`).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
  const later = await cleanupExpiredDemos({ auth, db, bucketClient: api.client });
  assert.equal(later.ok, true);
  assert.equal(await authExists(onLive.uid), false, 'removed once the last demo has expired');
});

test('accounts are not deleted while buckets cannot be checked', options, async () => {
  const seeded = await seedExpiredDemo();
  const unconfigured = await cleanupExpiredDemos({ auth, db });
  assert.ok(unconfigured.accounts.deferred.some((row) => row.uid === seeded.uid && row.code === 'BUCKET_API_UNCONFIGURED'));
  assert.equal(await exists(`weddings/${seeded.eventId}`), false, 'event data is still removed');
  assert.equal(await authExists(seeded.uid), true);

  const api = fakeBucketApi();
  api.down = true;
  const unreachable = await cleanupExpiredDemos({ auth, db, bucketClient: api.client });
  assert.equal(unreachable.ok, false);
  assert.ok(unreachable.accounts.failed.some((row) => row.demoId === seeded.demo.demoId && row.code === 'BUCKET_API_UNREACHABLE'));
  assert.equal(await authExists(seeded.uid), true);

  api.down = false;
  assert.equal((await cleanupExpiredDemos({ auth, db, bucketClient: api.client })).ok, true);
  assert.equal(await authExists(seeded.uid), false);
});

test('photo bucket demo account is removed after expiry; a non-demo bucket is never deleted', options, async () => {
  const api = fakeBucketApi();
  const demo = await createDemo({ auth, db, token: adminToken, type: 'photo_bucket', name: 'Album', bucketClient: api.client });
  const { uid } = (await db.doc(`demoLedger/${demo.demoId}`).get()).data();
  const live = await cleanupExpiredDemos({ auth, db, bucketClient: api.client });
  assert.ok(!live.accounts.deleted.some((row) => row.uid === uid));
  assert.equal(await authExists(uid), true, 'not before expiry');
  await db.doc(`demoLedger/${demo.demoId}`).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
  await cleanupExpiredDemos({ auth, db, bucketClient: api.client });
  assert.equal(await authExists(uid), false);
  assert.equal(await exists(`customerDirectory/${uid}`), false);
  assert.ok(!api.calls.some((call) => call.method === 'DELETE'), 'bucket data is left to the backend demo sweep');
});

test('cleanup endpoint auth: secret, admin, and refusals', options, async () => {
  const api = fakeBucketApi();
  const env = { CRON_SECRET: SECRET, PHOTO_BUCKET_API_URL: BUCKET_BASE };
  const request = (method, bearer, overrides = {}) => runCleanupRequest({ auth, db, method, bearer, env: { ...env, ...overrides }, fetchImpl: api.fetch });
  await assert.rejects(request('GET', ''), { status: 401 });
  await assert.rejects(request('GET', 'wrong-secret'), { status: 401 });
  await assert.rejects(request('GET', adminToken), { status: 401 }, 'GET is only for the scheduler secret');
  await assert.rejects(request('POST', 'wrong-secret'), { status: 401 });
  await assert.rejects(request('POST', customerToken), { status: 403 });
  await assert.rejects(request('DELETE', SECRET), { status: 405 });
  await assert.rejects(request('GET', 'short', { CRON_SECRET: 'short' }), { status: 401 }, 'a weak secret is treated as unset');
  await assert.rejects(request('GET', 'undefined', { CRON_SECRET: undefined }), { status: 401 });
  assert.equal((await request('POST', adminToken)).ok, true);
  assert.equal((await request('GET', SECRET)).ok, true);
  assert.equal((await request('POST', SECRET)).ok, true);

  // Without a service identity the scheduler removes events and defers accounts.
  const first = await seedExpiredDemo();
  const noService = await request('GET', SECRET);
  assert.ok(noService.accounts.deferred.some((row) => row.uid === first.uid && row.code === 'BUCKET_API_UNCONFIGURED'));

  // With one, it mints a real ID token that only goes to the bucket API.
  api.calls.length = 0;
  const service = await request('GET', SECRET, { DEMO_SERVICE_ADMIN_UID: adminUid, FIREBASE_WEB_API_KEY: 'demo-key' });
  assert.ok(service.accounts.deleted.some((row) => row.uid === first.uid));
  const sent = api.calls[0].token.slice('Bearer '.length);
  assert.equal((await auth.verifyIdToken(sent)).uid, adminUid);
  assert.ok(!sent.includes(SECRET));
});

test('lookup finds a customer by email, case-insensitively', options, async () => {
  const user = await newUser('Lookup');
  const found = await lookupCustomer({ auth, db, token: adminToken, email: `  ${user.email.toUpperCase()} ` });
  assert.equal(found.uid, user.uid);
  assert.equal(found.isAdmin, false);
  await assert.rejects(lookupCustomer({ auth, db, token: adminToken, email: 'nobody-here@example.test' }), { status: 404 });
  await assert.rejects(lookupCustomer({ auth, db, token: adminToken, email: 'not-an-email' }), { status: 400 });
});

test('multi-event link and unlink report per event and never downgrade', options, async () => {
  const api = fakeBucketApi();
  const user = await newUser('multi');
  const call = (action, targets, extra = {}) => manageCustomerAccess({ auth, db, token: adminToken, action, userId: user.uid, targets, bucketClient: api.client, ...extra });
  const [plain, ownedByUser, seating, existing, deleting] = await Promise.all([
    newRealEvent({ eventTitle: 'Plain', venueEn: 'Hall' }), newRealEvent({ ownerUserId: user.uid }), newRealEvent(), newRealEvent(), newRealEvent({ deleting: true }),
  ]);
  const expired = await newRealEvent({ isDemo: true, demoExpiresAt: Timestamp.fromMillis(Date.now() - HOUR) });
  await db.doc(`weddings/${seating}/dashboardUsers/${user.uid}`).set({ userId: user.uid, role: 'seating', seatingOnly: true, canEditSeating: true });
  await db.doc(`weddings/${existing}/dashboardUsers/${user.uid}`).set({ userId: user.uid, email: user.email, role: 'customer', allowedViews: ['guests'] });
  const bucketId = `b-${'1'.repeat(32)}`, missingBucketId = `demo-${'2'.repeat(32)}`;
  api.buckets.set(bucketId, { id: bucketId, demo: false, owners: [], status: 'active' });
  for (const id of ['b-one', `b-${'A'.repeat(32)}`, `demo-${'2'.repeat(31)}`]) {
    await assert.rejects(call('link', [{ kind: 'bucket', id }]), { status: 400, code: 'INVALID_TARGETS' });
  }
  assert.equal(api.calls.length, 0, 'invalid bucket IDs never reach the photo service');

  const targets = [
    { kind: 'event', id: plain }, { kind: 'event', id: plain }, { kind: 'event', id: ownedByUser }, { kind: 'event', id: seating }, { kind: 'event', id: existing },
    { kind: 'event', id: deleting }, { kind: 'event', id: expired }, { kind: 'event', id: 'missing-event' }, { kind: 'bucket', id: bucketId }, { kind: 'bucket', id: missingBucketId },
  ];
  const linked = await call('link', targets);
  const by = Object.fromEntries(linked.results.map((row) => [row.id, row]));
  assert.equal(linked.results.length, 9, 'duplicates are merged');
  assert.equal(linked.ok, false);
  assert.equal(by[plain].status, 'linked');
  assert.equal(by[ownedByUser].status, 'preserved');
  assert.equal(by[seating].status, 'preserved');
  assert.equal(by[existing].status, 'already_linked');
  assert.equal(by[deleting].code, 'EVENT_DELETING');
  assert.equal(by[expired].code, 'EVENT_EXPIRED');
  assert.equal(by['missing-event'].code, 'EVENT_NOT_FOUND');
  assert.equal(by[bucketId].status, 'linked');
  assert.equal(by[missingBucketId].code, 'BUCKET_NOT_FOUND');
  assert.equal(linked.failed, 4);
  assert.deepEqual(api.buckets.get(bucketId).owners, [user.uid]);

  const member = (await db.doc(`weddings/${plain}/dashboardUsers/${user.uid}`).get()).data();
  assert.equal(member.role, 'customer');
  assert.equal(member.canViewDashboard, true);
  assert.equal((await db.doc(`users/${user.uid}/weddingAccess/${plain}`).get()).data().venueEn, 'Hall');
  assert.equal((await db.doc(`customerDirectory/${user.uid}`).get()).data().email, user.email);
  assert.equal((await db.doc(`weddings/${seating}/dashboardUsers/${user.uid}`).get()).data().role, 'seating');
  assert.equal(await exists(`weddings/${ownedByUser}/dashboardUsers/${user.uid}`), false, 'no customer row added for the owner');
  assert.deepEqual((await db.doc(`weddings/${existing}/dashboardUsers/${user.uid}`).get()).data().allowedViews, ['guests'], 'existing settings kept');

  const customer = await signIn(user.email, PASSWORD);
  assert.equal((await getDoc(doc(customer.db, 'weddings', plain))).exists(), true, 'the rules honour the membership');

  await db.doc(`customerGrants/${encodeURIComponent(user.email)}~${encodeURIComponent(plain)}`).set({ email: user.email, weddingId: plain, role: 'customer' });
  const unlinked = await call('unlink', [{ kind: 'event', id: plain }, { kind: 'event', id: seating }, { kind: 'event', id: ownedByUser }, { kind: 'bucket', id: bucketId }, { kind: 'event', id: 'never-linked' }]);
  const out = Object.fromEntries(unlinked.results.map((row) => [row.id, row]));
  assert.equal(out[plain].status, 'unlinked');
  assert.equal(out[seating].code, 'PRESERVED_ROLE');
  assert.equal(out[ownedByUser].code, 'PRESERVED_ROLE');
  assert.equal(out[bucketId].status, 'unlinked');
  assert.equal(out['never-linked'].status, 'not_linked');
  assert.equal(await exists(`weddings/${plain}/dashboardUsers/${user.uid}`), false);
  assert.equal(await exists(`users/${user.uid}/weddingAccess/${plain}`), false);
  assert.equal(await exists(`customerGrants/${encodeURIComponent(user.email)}~${encodeURIComponent(plain)}`), false);
  assert.equal((await db.doc(`weddings/${seating}/dashboardUsers/${user.uid}`).get()).data().role, 'seating');
  assert.deepEqual(api.buckets.get(bucketId).owners, []);

  const timedOut = await call('link', [{ kind: 'event', id: plain }], { budgetMs: 0 });
  assert.equal(timedOut.results[0].code, 'NOT_ATTEMPTED');
  const noApi = await manageCustomerAccess({ auth, db, token: adminToken, action: 'link', userId: user.uid, targets: [{ kind: 'bucket', id: bucketId }] });
  assert.equal(noApi.results[0].code, 'BUCKET_API_UNCONFIGURED');
});

test('multi-event input and target validation', options, async () => {
  const user = await newUser('validate');
  const call = (fields) => manageCustomerAccess({ auth, db, token: adminToken, action: 'link', userId: user.uid, targets: [{ kind: 'event', id: 'e' }], ...fields });
  await assert.rejects(call({ action: 'delete' }), { status: 400 });
  await assert.rejects(call({ userId: 'a/b' }), { status: 400 });
  await assert.rejects(call({ targets: [] }), { status: 400 });
  await assert.rejects(call({ targets: Array.from({ length: 51 }, (_, i) => ({ kind: 'event', id: `e${i}` })) }), { status: 400 });
  await assert.rejects(call({ targets: [{ kind: 'event', id: 'x/../../platformAdmins/me' }] }), { status: 400 });
  await assert.rejects(call({ targets: [{ kind: 'bucket', id: '../owner' }] }), { status: 400 });
  await assert.rejects(call({ targets: [{ kind: 'other', id: 'e' }] }), { status: 400 });
  await assert.rejects(call({ userId: 'no-such-user' }), { status: 404 });
  await assert.rejects(call({ userId: adminUid }), { status: 409, code: 'TARGET_IS_ADMIN' });
});

test('handlers refuse wrong methods and report missing configuration without an emulator', async () => {
  const saved = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const invoke = async (handler, method) => {
    const out = {};
    const res = { setHeader(key, value) { out[key] = value; }, status(code) { out.status = code; return this; }, json(body) { out.body = body; return this; } };
    await handler({ method, headers: {}, body: {} }, res);
    return out;
  };
  try {
    const handlers = await Promise.all(['admin-demos', 'admin-customer-access', 'demo-cleanup'].map((name) => import(`../api/${name}.js`)));
    for (const { default: handler } of handlers) {
      const result = await invoke(handler, 'POST');
      assert.equal(result.status, 503);
      assert.equal(result['Cache-Control'], 'no-store');
    }
    assert.equal((await invoke(handlers[0].default, 'GET')).status, 405);
    assert.equal((await invoke(handlers[1].default, 'GET')).status, 405);
    const malformed = { method: 'POST', headers: {}, get body() { throw new Error('Invalid JSON'); } };
    for (const handler of [handlers[0].default, handlers[1].default]) {
      const out = {};
      await handler(malformed, { setHeader() {}, status(code) { out.status = code; return this; }, json(body) { out.body = body; return this; } });
      assert.equal(out.status, 400);
      assert.equal(out.body.code, 'INVALID_JSON');
    }
  } finally { if (saved !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT_JSON = saved; }
});

test('cleanup removes the custom song files of a demo event first, and waits when the service is down', options, async () => {
  const seeded = await seedExpiredDemo();
  await db.doc(`weddings/${seeded.eventId}`).update({ musicMode: 'custom', musicVersion: 1, musicName: 'demo song' });
  const down = fakeBucketApi(); down.down = true;
  const waiting = await cleanupExpiredDemos({ auth, db, bucketClient: down.client });
  assert.ok(waiting.events.deferred.includes(seeded.eventId), 'kept for the next run, so its files are not orphaned');
  assert.equal(await exists(`weddings/${seeded.eventId}`), true);
  const without = await cleanupExpiredDemos({ auth, db, bucketClient: null });
  assert.ok(without.events.deferred.includes(seeded.eventId), 'no service configured: also deferred');
  const api = fakeBucketApi();
  const done = await cleanupExpiredDemos({ auth, db, bucketClient: api.client });
  assert.ok(done.events.deleted.includes(seeded.eventId));
  assert.deepEqual(api.deletedEventFiles, [seeded.eventId]);
  assert.equal(await exists(`weddings/${seeded.eventId}`), false);
});
