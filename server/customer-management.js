export class CustomerError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function manageCustomer({ auth, db, token, action, userId, password }) {
  if (!token) throw new CustomerError(401, 'Sign in is required.');
  let caller;
  try { caller = await auth.verifyIdToken(token, true); } catch { throw new CustomerError(401, 'Your session has expired. Sign in again.'); }
  const admin = await db.doc(`platformAdmins/${caller.uid}`).get();
  if (!admin.exists || admin.data().enabled !== true) throw new CustomerError(403, 'Administrator access is required.');
  if (!['password', 'delete'].includes(action) || typeof userId !== 'string' || !userId || userId.includes('/') || userId.length > 128 || userId === caller.uid) throw new CustomerError(400, 'Invalid customer request.');
  if (action === 'password' && (typeof password !== 'string' || password.length < 6 || password.length > 128)) throw new CustomerError(400, 'Use a password between 6 and 128 characters.');
  const [directory, targetAdmin, memberships, access] = await Promise.all([
    db.doc(`customerDirectory/${userId}`).get(), db.doc(`platformAdmins/${userId}`).get(),
    db.collectionGroup('dashboardUsers').where('userId', '==', userId).get(),
    db.collection(`users/${userId}/weddingAccess`).get(),
  ]);
  const indexed = await Promise.all(access.docs.map(row => db.doc(`weddings/${row.id}/dashboardUsers/${userId}`).get()));
  if (!directory.exists || targetAdmin.exists || memberships.docs.some(row => row.id !== userId || row.data().role !== 'customer') || indexed.some(row => row.exists && row.data().role !== 'customer')) throw new CustomerError(409, 'This account cannot be managed as a customer.');
  const identity = await auth.getUser(userId).catch(error => { if (error.code === 'auth/user-not-found') return null; throw error; });
  if (identity && (!identity.email || identity.email.toLowerCase() !== String(directory.data().email || '').toLowerCase())) throw new CustomerError(409, 'The account identity does not match the customer directory.');
  if (action === 'password') {
    if (!identity) throw new CustomerError(404, 'The sign-in account no longer exists.');
    await auth.updateUser(userId, { password });
    await auth.revokeRefreshTokens(userId);
    return;
  }
  if (identity) await auth.updateUser(userId, { disabled: true });
  const grants = await db.collection('customerGrants').where('email', '==', String(directory.data().email).toLowerCase()).get();
  const refs = [...new Map([...memberships.docs, ...indexed.filter(row => row.exists), ...access.docs, ...grants.docs].map(row => [row.ref.path, row.ref])).values()];
  for (let i = 0; i < refs.length; i += 400) { const batch = db.batch(); refs.slice(i, i + 400).forEach(ref => batch.delete(ref)); await batch.commit(); }
  if (identity) await auth.deleteUser(userId);
  await directory.ref.delete();
}
