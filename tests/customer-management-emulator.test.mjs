import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import * as firestore from 'firebase/firestore';
import { createRequire } from 'node:module';
import { manageCustomer } from '../server/customer-management.js';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
import { assignCustomer } from '../account-access.js';

const enabled = process.env.CUSTOMER_FUNCTIONS_EMULATOR_TEST === '1';
test('customer creation, assignment, password change and deletion in local emulators', { skip: !enabled }, async () => {
  const config = { projectId: 'demo-wedding-security', apiKey: 'demo-key' };
  const apps = ['customer-test-admin', 'customer-test-user', 'customer-test-attacker'].map(name => initializeApp(config, name));
  const [adminApp, customerApp, attackerApp] = apps;
  const auths = apps.map(app => { const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }); return auth; });
  const [adminAuth, customerAuth, attackerAuth] = auths;
  const db = firestore.getFirestore(adminApp); firestore.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const { initializeApp: initializeAdmin, deleteApp: deleteAdmin } = require('firebase-admin/app');
  const { getAuth: getAdminAuth } = require('firebase-admin/auth');
  const { getFirestore: getAdminFirestore } = require('firebase-admin/firestore');
  const adminAppServer = initializeAdmin({ projectId: config.projectId }, 'customer-management-test');
  const server = { auth: getAdminAuth(adminAppServer), db: getAdminFirestore(adminAppServer) };
  const call = async (auth, data) => manageCustomer({ ...server, token: await auth.currentUser.getIdToken(), ...data });
  const email = `test-${Date.now()}@example.test`;
  try {
    await signInWithEmailAndPassword(adminAuth, 'admin@example.test', 'emulator-only');
    const user = (await createUserWithEmailAndPassword(customerAuth, email, 'initial-password')).user;
    const weddingRef = firestore.doc(db, 'weddings/luxury-wedding-demo');
    const event = (await firestore.getDoc(weddingRef)).data();
    await assignCustomer(firestore, db, weddingRef.id, event, { userId: user.uid, email });
    assert.equal((await firestore.getDoc(firestore.doc(db, 'weddings', weddingRef.id, 'dashboardUsers', user.uid))).data().role, 'customer');
    await signInWithEmailAndPassword(attackerAuth, 'customer-a@example.test', 'emulator-only');
    await assert.rejects(call(attackerAuth, { action: 'password', userId: user.uid, password: 'bad-password' }), { status: 403 });
    await assert.rejects(call(attackerAuth, { action: 'delete', userId: user.uid }), { status: 403 });
    await call(adminAuth, { action: 'password', userId: user.uid, password: 'changed-password' });
    await signOut(customerAuth);
    await assert.rejects(signInWithEmailAndPassword(customerAuth, email, 'initial-password'));
    await signInWithEmailAndPassword(customerAuth, email, 'changed-password');
    await call(adminAuth, { action: 'delete', userId: user.uid });
    assert.equal((await firestore.getDoc(firestore.doc(db, 'customerDirectory', user.uid))).exists(), false);
    assert.equal((await firestore.getDoc(firestore.doc(db, 'weddings', weddingRef.id, 'dashboardUsers', user.uid))).exists(), false);
    assert.equal((await firestore.getDoc(firestore.doc(db, 'users', user.uid, 'weddingAccess', weddingRef.id))).exists(), false);
    assert.equal((await firestore.getDoc(weddingRef)).exists(), true);
    await signOut(customerAuth);
    await assert.rejects(signInWithEmailAndPassword(customerAuth, email, 'changed-password'));
  } finally { await Promise.all([...apps.map(deleteApp), deleteAdmin(adminAppServer)]); }
});
