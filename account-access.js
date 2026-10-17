// The directory helps administrators find UIDs. Only canonical event memberships
// grant event access; neither directory entries nor discovery cards do so.
export const CUSTOMER_VIEWS = Object.freeze(["overview", "guests", "seating", "settings", "exports"]);

export function customerMembership(userId, email, timestamp) {
  return {
    userId, email: email.trim().toLowerCase(), role: "customer",
    canViewDashboard: true, canEditGuests: true, canEditSeating: true,
    canEditEventDetails: true, canViewEventSettings: true, canExport: true,
    canCheckIn: false, canManageUsers: false, seatingOnly: false, allowedSide: "all",
    allowedViews: [...CUSTOMER_VIEWS], createdAt: timestamp, updatedAt: timestamp,
  };
}

export async function isPlatformAdmin(api, db, uid) {
  if (!uid) return false;
  const snapshot = await api.getDoc(api.doc(db, "platformAdmins", uid));
  return snapshot.exists() && snapshot.data().enabled === true;
}

export function discoveryData(weddingId, wedding) {
  const keys = ["eventTitle", "coupleName", "brideName", "groomName", "eventCategory", "eventDateISO", "venueEn", "location", "status", "ownerUserId"];
  return { weddingId, ...Object.fromEntries(keys.filter((key) => wedding[key] !== undefined).map((key) => [key, wedding[key]])) };
}

export async function assignCustomer(api, db, weddingId, wedding, customer) {
  const batch = api.writeBatch(db);
  const timestamp = api.serverTimestamp();
  batch.set(api.doc(db, "customerDirectory", customer.userId), {
    userId: customer.userId, email: customer.email.trim().toLowerCase(), updatedAt: timestamp,
  }, { merge: true });
  batch.set(api.doc(db, "weddings", weddingId, "dashboardUsers", customer.userId), customerMembership(customer.userId, customer.email, timestamp));
  batch.set(api.doc(db, "users", customer.userId, "weddingAccess", weddingId), { ...discoveryData(weddingId, wedding), updatedAt: timestamp });
  await batch.commit();
}

export async function removeCustomer(api, db, weddingId, userId) {
  const batch = api.writeBatch(db);
  batch.delete(api.doc(db, "weddings", weddingId, "dashboardUsers", userId));
  batch.delete(api.doc(db, "users", userId, "weddingAccess", weddingId));
  await batch.commit();
}

export function grantIdFor(email, weddingId) {
  return `${encodeURIComponent(email.trim().toLowerCase())}~${encodeURIComponent(weddingId)}`;
}

export async function issueCustomerGrant(api, db, weddingId, email) {
  email = email.trim().toLowerCase();
  await api.setDoc(api.doc(db, "customerGrants", grantIdFor(email, weddingId)), {
    email, weddingId, role: "customer", updatedAt: api.serverTimestamp(),
  });
}

// Unverified accounts never claim email grants. Direct admin-created UID grants
// work immediately and do not depend on email verification.
export async function redeemCustomerGrants(api, db, user) {
  if (!user?.emailVerified || !user.email) return 0;
  const email = user.email.toLowerCase();
  const grants = await api.getDocs(api.query(api.collection(db, "customerGrants"), api.where("email", "==", email)));
  for (const grant of grants.docs) {
    const { weddingId } = grant.data();
    await api.runTransaction(db, async (transaction) => {
      const current = await transaction.get(grant.ref);
      if (!current.exists()) return;
      const timestamp = api.serverTimestamp();
      transaction.set(api.doc(db, "weddings", weddingId, "dashboardUsers", user.uid), {
        ...customerMembership(user.uid, email, timestamp), grantId: grant.id,
      });
      transaction.set(api.doc(db, "customerDirectory", user.uid), { userId: user.uid, email, updatedAt: timestamp });
      // Canonical event details are fetched only after the grant is redeemed.
      transaction.set(api.doc(db, "users", user.uid, "weddingAccess", weddingId), { weddingId, updatedAt: timestamp });
      transaction.delete(grant.ref);
    });
  }
  return grants.size;
}
