const crypto = require("crypto");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");

initializeApp();
const db = getFirestore();
const ROLES = new Set(["bride", "groom", "family"]);
const seatingLinkEncryptionKey = defineSecret("SEATING_LINK_ENCRYPTION_KEY");

function tokenHash(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function encryptionKey() {
  const value = seatingLinkEncryptionKey.value();
  if (!value) throw new HttpsError("failed-precondition", "Seating editor access is not configured.");
  return crypto.createHash("sha256").update(value, "utf8").digest();
}

function encryptToken(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

function decryptToken(value) {
  const payload = Buffer.from(value, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(12, 28));
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8");
}

function requireRole(role) {
  if (!ROLES.has(role)) throw new HttpsError("invalid-argument", "Invalid seating editor role.");
}

async function requireSeatingAccessManager(auth, weddingId) {
  if (!auth) throw new HttpsError("unauthenticated", "Sign in is required.");
  if (!weddingId || typeof weddingId !== "string") throw new HttpsError("invalid-argument", "Invalid wedding.");
  const [wedding, dashboardUser] = await Promise.all([
    db.doc(`weddings/${weddingId}`).get(),
    db.doc(`weddings/${weddingId}/dashboardUsers/${auth.uid}`).get(),
  ]);
  const isOwner = wedding.exists && wedding.data().ownerUserId === auth.uid;
  const isDashboardAdmin = dashboardUser.exists && dashboardUser.data().canManageUsers === true;
  if (!isOwner && !isDashboardAdmin) {
    throw new HttpsError("permission-denied", "Only the wedding owner or a dashboard administrator can manage seating editor access.");
  }
}

async function requireWeddingOwner(auth, weddingId) {
  if (!auth) throw new HttpsError("unauthenticated", "Sign in is required.");
  if (!weddingId || typeof weddingId !== "string") throw new HttpsError("invalid-argument", "Invalid wedding.");
  const wedding = await db.doc(`weddings/${weddingId}`).get();
  if (!wedding.exists || wedding.data().ownerUserId !== auth.uid) {
    throw new HttpsError("permission-denied", "Only the wedding owner can perform this migration.");
  }
}

exports.manageSeatingEditorAccess = onCall({ secrets: [seatingLinkEncryptionKey] }, async (request) => {
  const { weddingId, role, action } = request.data || {};
  requireRole(role);
  await requireSeatingAccessManager(request.auth, weddingId);
  if (!["generate", "regenerate", "revoke", "reveal"].includes(action)) {
    throw new HttpsError("invalid-argument", "Invalid access action.");
  }

  const accessRef = db.doc(`weddings/${weddingId}/seatingAccess/${role}`);
  if (action === "reveal") {
    const access = await accessRef.get();
    if (!access.exists || access.data().status !== "active" || !access.data().encryptedToken) {
      throw new HttpsError("failed-precondition", "This editor link is not active.");
    }
    return { status: "active", token: decryptToken(access.data().encryptedToken) };
  }
  if (action === "revoke") {
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(accessRef);
      if (!current.exists) throw new HttpsError("failed-precondition", "This editor link has not been created.");
      const oldHash = current.data().tokenHash;
      transaction.update(accessRef, { status: "revoked", version: (current.data().version || 0) + 1, revokedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      if (oldHash) transaction.delete(db.doc(`seatingAccessTokens/${oldHash}`));
    });
    return { status: "revoked" };
  }

  const rawToken = crypto.randomBytes(32).toString("base64url");
  const hash = tokenHash(rawToken);
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(accessRef);
    const existing = current.exists ? current.data() : {};
    if (action === "generate" && existing.status === "active") {
      throw new HttpsError("already-exists", "An active editor link already exists. Regenerate it instead.");
    }
    const version = Number(existing.version || 0) + 1;
    if (existing.tokenHash) transaction.delete(db.doc(`seatingAccessTokens/${existing.tokenHash}`));
    transaction.set(accessRef, {
      role,
      status: "active",
      version,
      tokenHash: hash,
      encryptedToken: encryptToken(rawToken),
      createdAt: existing.createdAt || FieldValue.serverTimestamp(),
      regeneratedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(db.doc(`seatingAccessTokens/${hash}`), { weddingId, role, version, createdAt: FieldValue.serverTimestamp() });
  });
  return { status: "active", token: rawToken };
});

exports.exchangeSeatingEditorLink = onCall(async (request) => {
  const token = request.data?.token;
  if (!token || typeof token !== "string" || token.length < 40) {
    throw new HttpsError("permission-denied", "This access link is invalid or expired.");
  }
  const hash = tokenHash(token);
  const index = await db.doc(`seatingAccessTokens/${hash}`).get();
  if (!index.exists) throw new HttpsError("permission-denied", "This access link is invalid or expired.");
  const { weddingId, role, version } = index.data();
  requireRole(role);
  const access = await db.doc(`weddings/${weddingId}/seatingAccess/${role}`).get();
  if (!access.exists || access.data().status !== "active" || access.data().tokenHash !== hash || access.data().version !== version) {
    throw new HttpsError("permission-denied", "This access link is invalid or expired.");
  }
  const uid = `seating-editor:${weddingId}:${role}:${version}`;
  const customToken = await getAuth().createCustomToken(uid, {
    seatingEditor: true,
    seatingWeddingId: weddingId,
    seatingRole: role,
    seatingAccessVersion: version,
  });
  return { customToken };
});

function normalizeSide(value) {
  const side = String(value || "").trim().toLowerCase().replace(/[ _-]+/g, " ");
  if (["bride", "bride side", "brides side"].includes(side)) return "bride";
  if (["groom", "groom side", "grooms side"].includes(side)) return "groom";
  if (["both", "both sides", "shared"].includes(side)) return "both";
  return "family";
}

function partySize(guest) {
  const extra = Number(guest.additionalGuests);
  return 1 + (Number.isInteger(extra) && extra > 0 ? extra : 0);
}

function sideMatches(guest, side) {
  const guestSide = normalizeSide(guest.side);
  return side === "family" ? guestSide === "family" : guestSide === side || guestSide === "both";
}

// Owner-only, idempotent migration for legacy values such as "Bride Side".
// It is intentionally server-side so the client never receives authority to
// rewrite guests outside its normal dashboard permissions.
exports.normalizeSeatingGuestSides = onCall(async (request) => {
  const weddingId = request.data?.weddingId;
  await requireWeddingOwner(request.auth, weddingId);
  const guests = await db.collection(`weddings/${weddingId}/guests`).get();
  let normalized = 0;
  let batch = db.batch();
  let writes = 0;
  for (const snapshot of guests.docs) {
    const side = normalizeSide(snapshot.data().side);
    if (snapshot.data().side === side) continue;
    batch.update(snapshot.ref, { side, updatedAt: FieldValue.serverTimestamp() });
    normalized += 1;
    writes += 1;
    if (writes === 400) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }
  if (writes) await batch.commit();
  return { normalized };
});

// Public side pages deliberately expose only this aggregate. Keeping it server
// generated means editor links cannot write arbitrary public documents.
exports.refreshPublicSeatingStats = onDocumentWritten("weddings/{weddingId}/{collectionId}/{documentId}", async (event) => {
  if (!["guests", "tables"].includes(event.params.collectionId)) return;
  const weddingId = event.params.weddingId;
  const [wedding, guests, tables] = await Promise.all([
    db.doc(`weddings/${weddingId}`).get(),
    db.collection(`weddings/${weddingId}/guests`).get(),
    db.collection(`weddings/${weddingId}/tables`).get(),
  ]);
  if (!wedding.exists) return;
  const tableRows = tables.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
  const assignmentsByGuest = new Map();
  tableRows.forEach((table) => (table.chairs || []).forEach((chair) => {
    const assignment = chair.assignment || (chair.guestId ? { guestId: chair.guestId, seatNumber: chair.seatNumber } : null);
    if (!assignment?.guestId) return;
    const list = assignmentsByGuest.get(assignment.guestId) || [];
    list.push({ t: assignment.tableName || table.name || "Table", n: Number(assignment.seatNumber || chair.seatNumber || 0) });
    assignmentsByGuest.set(assignment.guestId, list);
  }));
  const allGuests = guests.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data(), side: normalizeSide(snapshot.data().side) }));
  const sides = {}, roster = {};
  ["bride", "groom", "family"].forEach((side) => {
    const members = allGuests.filter((guest) => sideMatches(guest, side));
    const confirmed = members.filter((guest) => guest.rsvpStatus === "confirmed");
    sides[side] = {
      invited: members.length, seats: members.reduce((sum, guest) => sum + partySize(guest), 0),
      confirmed: confirmed.length, confirmedSeats: confirmed.reduce((sum, guest) => sum + partySize(guest), 0),
      pending: members.filter((guest) => !["confirmed", "declined"].includes(guest.rsvpStatus)).length,
      declined: members.filter((guest) => guest.rsvpStatus === "declined").length,
      seated: members.filter((guest) => (assignmentsByGuest.get(guest.id) || []).length).length,
      invitesSent: members.filter((guest) => guest.inviteSentAt || guest.reminderSentAt).length,
    };
    roster[side] = members.map((guest) => ({ id: guest.id, n: guest.fullName || "", a: guest.fullNameAr || "", r: ["confirmed", "declined"].includes(guest.rsvpStatus) ? guest.rsvpStatus : "pending", p: partySize(guest), seats: assignmentsByGuest.get(guest.id) || [] }));
  });
  await db.doc(`weddings/${weddingId}/publicStats/summary`).set({ coupleName: wedding.data().coupleName || "", sides, roster, updatedAt: FieldValue.serverTimestamp() });
});
