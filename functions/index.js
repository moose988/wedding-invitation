const crypto = require("crypto");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const {
  decryptInvitationToken: decryptInvitationTokenWithKey,
  encryptInvitationToken: encryptInvitationTokenWithKey,
  isValidInvitationToken,
  randomInvitationToken: createRandomInvitationToken,
  tokenHash: hashToken,
} = require("./invitation-crypto");

initializeApp();
const db = getFirestore();
const ROLES = new Set(["bride", "groom", "family"]);
const seatingLinkEncryptionKey = defineSecret("SEATING_LINK_ENCRYPTION_KEY");
const invitationTokenEncryptionKey = defineSecret("INVITATION_TOKEN_ENCRYPTION_KEY");
const MAX_INVITATION_TOKEN_BATCH = 100;
const MAX_CHECKIN_ROSTER_GUESTS = 5000;
const MAX_SENDER_SESSION_GUESTS = 100;
const SENDER_SESSION_HOURS = 24;
const INVITATION_PURPOSE = "guest-invitation";
const INVITATION_VALID_DAYS_AFTER_EVENT = 90;
const LEGACY_INVITATION_FIELDS = ["guestToken", "inviteLink", "qrCodeValue", "invitationTokenHash", "invitationTokenCiphertext"];
const SUPPORTED_GUEST_FIELDS = new Set([
  "fullName", "phone", "side", "additionalGuests", "additionalGuestAllowance",
  "rsvpStatus", "rsvpMessage", "tableId", "tableName", "seatNumber",
  "seatingAssignments", "checkedIn", "checkedInAt", "notes", "inviteSentAt",
  "reminderSentAt", "createdAt", "updatedAt",
  ...LEGACY_INVITATION_FIELDS,
]);

function tokenHash(token) {
  return hashToken(token);
}

function invitationEncryptionKey() {
  const value = invitationTokenEncryptionKey.value();
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") < 32) {
    throw new HttpsError("failed-precondition", "Invitation access is not configured.");
  }
  return crypto.createHash("sha256").update(value, "utf8").digest();
}

function encryptInvitationToken(token) {
  return encryptInvitationTokenWithKey(token, invitationEncryptionKey());
}

function decryptInvitationToken(value) {
  return decryptInvitationTokenWithKey(value, invitationEncryptionKey());
}

function invitationSecretPath(weddingId, guestId) {
  // Hash the tuple to keep Firestore document IDs unambiguous even when either
  // caller-controlled identifier contains underscores.
  const id = crypto.createHash("sha256").update(`${weddingId}\0${guestId}`, "utf8").digest("hex");
  return `invitationSecrets/${id}`;
}

function invitationIndexPath(token) {
  return `invitationAccessTokens/${tokenHash(token)}`;
}

function senderSessionPath(token) {
  return `senderSessions/${tokenHash(token)}`;
}

function randomInvitationToken() {
  return createRandomInvitationToken();
}

function invitationExpiry(wedding) {
  const date = new Date(wedding.eventDateISO || "");
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + INVITATION_VALID_DAYS_AFTER_EVENT * 24 * 60 * 60 * 1000);
}

function isInvitationExpired(wedding, now = Date.now()) {
  const expiry = invitationExpiry(wedding);
  return Boolean(expiry && expiry.getTime() < now);
}

function genericInvitationUnavailable() {
  return new HttpsError("not-found", "This invitation is unavailable.");
}

function setNoStore(request) {
  request?.rawRequest?.res?.set?.("Cache-Control", "no-store, max-age=0");
  request?.rawRequest?.res?.set?.("Pragma", "no-cache");
}

async function requireInvitationManager(auth, weddingId) {
  if (!auth) throw new HttpsError("unauthenticated", "Sign in is required.");
  if (typeof weddingId !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(weddingId)) {
    throw new HttpsError("invalid-argument", "Invalid event.");
  }
  const [wedding, membership] = await Promise.all([
    db.doc(`weddings/${weddingId}`).get(),
    db.doc(`weddings/${weddingId}/dashboardUsers/${auth.uid}`).get(),
  ]);
  if (!wedding.exists || wedding.data().ownerUserId !== auth.uid &&
      (!membership.exists || membership.data().canEditGuests !== true)) {
    throw new HttpsError("permission-denied", "You cannot manage invitations for this event.");
  }
  return wedding;
}

async function resolveInvitation(weddingId, token, { allowCompleted = false } = {}) {
  if (typeof weddingId !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(weddingId) ||
      !isValidInvitationToken(token)) throw genericInvitationUnavailable();
  const hash = tokenHash(token);
  const indexRef = db.doc(invitationIndexPath(token));
  const index = await indexRef.get();
  if (!index.exists) throw genericInvitationUnavailable();
  const access = index.data();
  if (access.status !== "active" || access.purpose !== INVITATION_PURPOSE ||
      access.weddingId !== weddingId || typeof access.guestId !== "string") {
    throw genericInvitationUnavailable();
  }
  const weddingRef = db.doc(`weddings/${weddingId}`);
  const guestRef = db.doc(`weddings/${weddingId}/guests/${access.guestId}`);
  const secretRef = db.doc(invitationSecretPath(weddingId, access.guestId));
  const [wedding, guest, secret] = await Promise.all([weddingRef.get(), guestRef.get(), secretRef.get()]);
  if (!wedding.exists || !guest.exists || !secret.exists) throw genericInvitationUnavailable();
  const weddingData = wedding.data();
  const secretData = secret.data();
  const allowedStatuses = allowCompleted ? ["active", "completed"] : ["active"];
  if (!allowedStatuses.includes(weddingData.status || "") ||
      isInvitationExpired(weddingData) || secretData.status !== "active" ||
      secretData.tokenHash !== hash || secretData.purpose !== INVITATION_PURPOSE ||
      access.version !== secretData.version) throw genericInvitationUnavailable();
  let decrypted;
  try { decrypted = decryptInvitationToken(secretData.encryptedToken || ""); } catch { throw genericInvitationUnavailable(); }
  if (decrypted !== token || !isValidInvitationToken(decrypted)) throw genericInvitationUnavailable();
  return { weddingRef, guestRef, secretRef, indexRef, wedding: weddingData, guest: guest.data(), access, secret: secretData };
}

async function consumeInvitationRateLimit(request, token) {
  const ip = request.rawRequest?.ip || "unknown";
  const minute = Math.floor(Date.now() / 60000);
  const identity = crypto.createHmac("sha256", invitationEncryptionKey())
    .update(ip)
    .digest("hex");
  const ref = db.doc(`invitationRateLimits/${minute}_${identity}`);
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    const data = current.exists ? current.data() : {};
    const count = Number(data.count || 0) + 1;
    if (count > 60) throw new HttpsError("resource-exhausted", "This invitation is temporarily unavailable.");
    transaction.set(ref, { minute, count, expiresAt: Timestamp.fromMillis((minute + 2) * 60000), updatedAt: FieldValue.serverTimestamp() });
  });
}

async function consumeCheckinRosterRateLimit(uid, weddingId) {
  const identity = crypto.createHash("sha256").update(`${uid}\0${weddingId}`, "utf8").digest("hex");
  const minute = Math.floor(Date.now() / 60000);
  const ref = db.doc(`checkinRosterRateLimits/${minute}_${identity}`);
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    const count = Number(current.data()?.count || 0) + 1;
    if (count > 4) throw new HttpsError("resource-exhausted", "Check-in guest data is temporarily unavailable.");
    transaction.set(ref, {
      count,
      weddingId,
      expiresAt: Timestamp.fromMillis((minute + 2) * 60000),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

function projectInvitationEvent(wedding, tables) {
  return {
    eventTitle: typeof wedding.eventTitle === "string" ? wedding.eventTitle : "",
    coupleName: typeof wedding.coupleName === "string" ? wedding.coupleName : "",
    brideName: typeof wedding.brideName === "string" ? wedding.brideName : "",
    groomName: typeof wedding.groomName === "string" ? wedding.groomName : "",
    brideNameAr: typeof wedding.brideNameAr === "string" ? wedding.brideNameAr : "",
    groomNameAr: typeof wedding.groomNameAr === "string" ? wedding.groomNameAr : "",
    eventCategory: wedding.eventCategory === "celebration" ? "celebration" : "wedding_engagement",
    eventDateISO: typeof wedding.eventDateISO === "string" ? wedding.eventDateISO : "",
    rsvpDeadlineISO: typeof wedding.rsvpDeadlineISO === "string" ? wedding.rsvpDeadlineISO : "",
    timeEn: typeof wedding.timeEn === "string" ? wedding.timeEn : "",
    timeAr: typeof wedding.timeAr === "string" ? wedding.timeAr : "",
    venueEn: typeof wedding.venueEn === "string" ? wedding.venueEn : "",
    location: typeof wedding.location === "string" ? wedding.location : "",
    locationEn: typeof wedding.locationEn === "string" ? wedding.locationEn : "",
    mapsUrl: typeof wedding.mapsUrl === "string" ? wedding.mapsUrl : "",
    venueMapEmbedUrl: typeof wedding.venueMapEmbedUrl === "string" ? wedding.venueMapEmbedUrl : "",
    subtitleEn: typeof wedding.subtitleEn === "string" ? wedding.subtitleEn.slice(0, 500) : "",
    subtitleAr: typeof wedding.subtitleAr === "string" ? wedding.subtitleAr.slice(0, 500) : "",
    invitationMessageEn: typeof wedding.invitationMessageEn === "string" ? wedding.invitationMessageEn.slice(0, 2000) : "",
    invitationMessageAr: typeof wedding.invitationMessageAr === "string" ? wedding.invitationMessageAr.slice(0, 2000) : "",
    invitationLanguage: wedding.invitationLanguage === "ar" ? "ar" : "en",
    showInvitationQr: wedding.showInvitationQr !== false,
    seatingEnabled: wedding.seatingEnabled !== false,
    schedule: Array.isArray(wedding.schedule) ? wedding.schedule.slice(0, 12).map((item) => ({
      titleEn: typeof item?.titleEn === "string" ? item.titleEn.slice(0, 160) : "",
      titleAr: typeof item?.titleAr === "string" ? item.titleAr.slice(0, 160) : "",
      timeEn: typeof item?.timeEn === "string" ? item.timeEn.slice(0, 80) : "",
      timeAr: typeof item?.timeAr === "string" ? item.timeAr.slice(0, 80) : "",
      descriptionEn: typeof item?.descriptionEn === "string" ? item.descriptionEn.slice(0, 500) : "",
      descriptionAr: typeof item?.descriptionAr === "string" ? item.descriptionAr.slice(0, 500) : "",
    })) : [],
    hallObjects: Array.isArray(wedding.hallObjects) ? wedding.hallObjects.slice(0, 100).map((item) => ({
      id: typeof item?.id === "string" ? item.id.slice(0, 80) : "",
      type: typeof item?.type === "string" ? item.type.slice(0, 40) : "",
      label: typeof item?.label === "string" ? item.label.slice(0, 100) : "",
      x: boundedNumber(item?.x, 0, 100, 50),
      y: boundedNumber(item?.y, 0, 100, 50),
      width: boundedNumber(item?.width, 0, 1200, 280),
      height: boundedNumber(item?.height, 0, 1200, 280),
      rotation: boundedNumber(item?.rotation, -360, 360, 0),
      shape: typeof item?.shape === "string" ? item.shape.slice(0, 40) : "",
      fillColor: validColor(item?.fillColor),
      borderColor: validColor(item?.borderColor),
    })) : [],
    tables: tables.map(({ sourceId, ...table }) => table),
  };
}

function boundedNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function validColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : "";
}

function projectInvitationGuest(guest, tables, guestId) {
  const tableById = new Map(tables.map((table) => [table.sourceId, table]));
  let rawAssignments = Array.isArray(guest.seatingAssignments) ? guest.seatingAssignments : [];
  if (!rawAssignments.length) {
    rawAssignments = tables.flatMap((table) => (table.chairs || []).flatMap((chair) => {
      const assignment = chair.assignment || (chair.guestId ? { guestId: chair.guestId, seatNumber: chair.seatNumber } : null);
      return assignment?.guestId === guestId ? [{
        tableId: table.sourceId,
        seatNumber: assignment.seatNumber || chair.seatNumber,
        personKey: assignment.personKey,
        label: assignment.label,
      }] : [];
    }));
  }
  const assignments = rawAssignments
    .slice(0, 11)
    .map((assignment) => {
      const table = tableById.get(String(assignment?.tableId || ""));
      if (!table || !Number.isInteger(Number(assignment?.seatNumber))) return null;
      return {
        tableId: table.id,
        tableName: table.name,
        seatNumber: String(assignment.seatNumber).slice(0, 4),
        personKey: typeof assignment.personKey === "string" ? assignment.personKey.slice(0, 40) : "",
        label: typeof assignment.label === "string" ? assignment.label.slice(0, 80) : "",
      };
    }).filter(Boolean);
  const partySize = Number(guest.additionalGuests);
  const allowance = Number(guest.additionalGuestAllowance);
  return {
    fullName: typeof guest.fullName === "string" ? guest.fullName.slice(0, 160) : "Guest",
    rsvpStatus: ["confirmed", "declined"].includes(guest.rsvpStatus) ? guest.rsvpStatus : "pending",
    additionalGuests: Number.isInteger(partySize) ? Math.max(0, Math.min(partySize, 10)) : 0,
    additionalGuestAllowance: Number.isInteger(allowance) ? Math.max(0, Math.min(allowance, 10)) :
      (Number.isInteger(partySize) ? Math.max(0, Math.min(partySize, 10)) : 0),
    seatingAssignments: assignments,
    tableId: "",
    tableName: assignments[0]?.tableName || "",
    seatNumber: assignments[0]?.seatNumber || "",
  };
}

async function projectInvitationTables(weddingId) {
  const snapshots = await db.collection(`weddings/${weddingId}/tables`).get();
  return snapshots.docs.slice(0, 200).map((snapshot, index) => {
    const table = snapshot.data();
    const shape = typeof table.shape === "string" ? table.shape.slice(0, 30) : "round";
    const chairs = Array.isArray(table.chairs) ? table.chairs.slice(0, 250).map((chair, chairIndex) => ({
      id: `c${chairIndex + 1}`,
      seatNumber: boundedNumber(chair?.seatNumber, 1, 250, chairIndex + 1),
      x: boundedNumber(chair?.x, 0, 100, 50),
      y: boundedNumber(chair?.y, 0, 100, 50),
      rotation: boundedNumber(chair?.rotation, -360, 360, 0),
    })) : [];
    return {
      id: `t${index + 1}`,
      sourceId: snapshot.id,
      name: typeof table.name === "string" ? table.name.slice(0, 100) : "Table",
      shape,
      x: boundedNumber(table.x, 0, 100, 50),
      y: boundedNumber(table.y, 0, 100, 50),
      width: boundedNumber(table.width, 80, 1200, 180),
      height: boundedNumber(table.height, 80, 1200, 180),
      rotation: boundedNumber(table.rotation, -360, 360, 0),
      seatCount: boundedNumber(table.seatCount || table.capacity, 0, 250, chairs.length),
      tableColor: validColor(table.tableColor),
      borderColor: validColor(table.borderColor),
      chairColor: validColor(table.chairColor),
      chairs,
    };
  });
}

async function ensureInvitationSecret(weddingId, guestId, wedding, action, requestId = "") {
  const guestRef = db.doc(`weddings/${weddingId}/guests/${guestId}`);
  const secretRef = db.doc(invitationSecretPath(weddingId, guestId));
  if (action === "revoke") {
    await db.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(secretRef);
      if (!currentSnapshot.exists || currentSnapshot.data().status !== "active") return;
      const current = currentSnapshot.data();
      transaction.update(secretRef, {
        status: "revoked",
        version: Number(current.version || 0) + 1,
        encryptedToken: FieldValue.delete(),
        tokenHash: FieldValue.delete(),
        revokedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (current.tokenHash) transaction.delete(db.doc(`invitationAccessTokens/${current.tokenHash}`));
    });
    return { revoked: true };
  }
  if ((wedding.status || "active") !== "active") {
    throw new HttpsError("failed-precondition", "This event's invitations are unavailable.");
  }
  if (isInvitationExpired(wedding)) throw new HttpsError("failed-precondition", "This event's invitations have expired.");
  const secret = await secretRef.get();
  if (secret.exists && secret.data().status === "active" && ["ensure", "reveal"].includes(action)) {
    const value = secret.data();
    try {
      const token = decryptInvitationToken(value.encryptedToken || "");
      if (isValidInvitationToken(token) && tokenHash(token) === value.tokenHash) return token;
    } catch {}
    throw new HttpsError("failed-precondition", "This invitation needs administrator repair.");
  }
  if (secret.exists && secret.data().status === "revoked" && action === "ensure") {
    throw new HttpsError("failed-precondition", "This invitation was revoked. Regenerate it to issue a new link.");
  }
  if (action === "reveal") throw genericInvitationUnavailable();
  const guest = await guestRef.get();
  if (!guest.exists) throw new HttpsError("not-found", "This guest is unavailable.");
  const rawToken = randomInvitationToken();
  const hash = tokenHash(rawToken);
  const issuedToken = await db.runTransaction(async (transaction) => {
    const [currentSecret, currentGuest] = await Promise.all([
      transaction.get(secretRef),
      transaction.get(guestRef),
    ]);
    const currentWedding = await transaction.get(db.doc(`weddings/${weddingId}`));
    if (!currentWedding.exists || (currentWedding.data().status || "active") !== "active" ||
        isInvitationExpired(currentWedding.data())) {
      throw new HttpsError("failed-precondition", "This event's invitations have expired.");
    }
    if (!currentGuest.exists) throw new HttpsError("not-found", "This guest is unavailable.");
    const existing = currentSecret.exists ? currentSecret.data() : {};
    if (action === "regenerate" && existing.status === "active" && existing.lastIssueRequestId === requestId) {
      const token = decryptInvitationToken(existing.encryptedToken || "");
      if (!isValidInvitationToken(token) || tokenHash(token) !== existing.tokenHash) {
        throw new HttpsError("failed-precondition", "This invitation needs administrator repair.");
      }
      return token;
    }
    if (action === "ensure" && existing.status === "active") {
      const token = decryptInvitationToken(existing.encryptedToken || "");
      if (!isValidInvitationToken(token) || tokenHash(token) !== existing.tokenHash) {
        throw new HttpsError("failed-precondition", "This invitation needs administrator repair.");
      }
      return token;
    }
    if (action === "ensure" && existing.status === "revoked") {
      throw new HttpsError("failed-precondition", "This invitation was revoked. Regenerate it to issue a new link.");
    }
    const version = Number(existing.version || 0) + 1;
    if (existing.tokenHash) transaction.delete(db.doc(`invitationAccessTokens/${existing.tokenHash}`));
    transaction.set(secretRef, {
      weddingId,
      guestId,
      purpose: INVITATION_PURPOSE,
      status: "active",
      version,
      tokenHash: hash,
      encryptedToken: encryptInvitationToken(rawToken),
      expiresAt: invitationExpiry(wedding) ? Timestamp.fromDate(invitationExpiry(wedding)) : null,
      ...(action === "regenerate" ? { lastIssueRequestId: requestId } : {}),
      createdAt: existing.createdAt || FieldValue.serverTimestamp(),
      issuedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: false });
    transaction.create(db.doc(`invitationAccessTokens/${hash}`), {
      weddingId,
      guestId,
      purpose: INVITATION_PURPOSE,
      status: "active",
      version,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: invitationExpiry(wedding) ? Timestamp.fromDate(invitationExpiry(wedding)) : null,
    });
    return rawToken;
  });
  return issuedToken;
}

exports.manageGuestInvitationAccess = onCall({ secrets: [invitationTokenEncryptionKey] }, async (request) => {
  setNoStore(request);
  const { weddingId, guestId, action, requestId } = request.data || {};
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(weddingId || "") || !/^[A-Za-z0-9_-]{1,150}$/.test(guestId || "")) {
    throw new HttpsError("invalid-argument", "Invalid invitation.");
  }
  if (!["ensure", "reveal", "regenerate", "revoke"].includes(action)) {
    throw new HttpsError("invalid-argument", "Invalid invitation action.");
  }
  if (action === "regenerate" && (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{16,100}$/.test(requestId))) {
    throw new HttpsError("invalid-argument", "A valid request ID is required to regenerate an invitation.");
  }
  const weddingSnapshot = await requireInvitationManager(request.auth, weddingId);
  return ensureInvitationSecret(weddingId, guestId, weddingSnapshot.data(), action, requestId);
});

exports.getGuestInvitationTokens = onCall({ secrets: [invitationTokenEncryptionKey] }, async (request) => {
  setNoStore(request);
  const { weddingId, guestIds, action = "ensure" } = request.data || {};
  if (!Array.isArray(guestIds) || guestIds.length < 1 || guestIds.length > MAX_INVITATION_TOKEN_BATCH ||
      !["ensure", "reveal"].includes(action) ||
      guestIds.some((id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(id))) {
    throw new HttpsError("invalid-argument", "Invalid invitation request.");
  }
  const weddingSnapshot = await requireInvitationManager(request.auth, weddingId);
  const wedding = weddingSnapshot.data();
  const uniqueGuestIds = [...new Set(guestIds)];
  const tokens = {};
  const unavailableGuestIds = [];
  for (const guestId of uniqueGuestIds) {
    try {
      tokens[guestId] = await ensureInvitationSecret(weddingId, guestId, wedding, action);
    } catch {
      unavailableGuestIds.push(guestId);
    }
  }
  return { tokens, unavailableGuestIds };
});

exports.createSenderSession = onCall({ secrets: [invitationTokenEncryptionKey] }, async (request) => {
  setNoStore(request);
  const { weddingId, guestIds, side = "all" } = request.data || {};
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(weddingId || "") ||
      !Array.isArray(guestIds) || guestIds.length < 1 || guestIds.length > MAX_SENDER_SESSION_GUESTS ||
      guestIds.some((id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(id)) ||
      new Set(guestIds).size !== guestIds.length || !["all", "bride", "groom", "family"].includes(side)) {
    throw new HttpsError("invalid-argument", "Invalid sender request.");
  }
  const weddingSnapshot = await requireInvitationManager(request.auth, weddingId);
  const wedding = weddingSnapshot.data();
  if (request.auth.uid !== wedding.ownerUserId) {
    const member = await db.doc(`weddings/${weddingId}/dashboardUsers/${request.auth.uid}`).get();
    if (!member.exists || member.data().canEditGuests !== true || member.data().seatingOnly === true) {
      throw new HttpsError("permission-denied", "You cannot create a sender link for this event.");
    }
  }
  if ((wedding.status || "active") !== "active" || isInvitationExpired(wedding)) {
    throw new HttpsError("failed-precondition", "This event's invitations are unavailable.");
  }
  const guests = await Promise.all(guestIds.map((guestId) => db.doc(`weddings/${weddingId}/guests/${guestId}`).get()));
  if (guests.some((guest) => !guest.exists) ||
      (side !== "all" && guests.some((guest) => normalizeSide(guest.data().side) !== side))) {
    throw new HttpsError("permission-denied", "The selected guests are unavailable.");
  }
  const guestAccess = await Promise.all(guestIds.map(async (guestId) => ({
    guestId,
    tokenHash: tokenHash(await ensureInvitationSecret(weddingId, guestId, wedding, "ensure")),
  })));
  const token = randomInvitationToken();
  const expiresAt = new Date(Date.now() + SENDER_SESSION_HOURS * 60 * 60 * 1000);
  await db.doc(senderSessionPath(token)).create({
    weddingId,
    guestAccess,
    side,
    purpose: "whatsapp-sender",
    status: "active",
    createdBy: request.auth.uid,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromDate(expiresAt),
  });
  return { token, senderId: tokenHash(token).slice(0, 16), expiresAt: expiresAt.toISOString() };
});

exports.getSenderSession = onCall({ secrets: [invitationTokenEncryptionKey] }, async (request) => {
  setNoStore(request);
  const token = request.data?.token;
  try {
    await consumeInvitationRateLimit(request, token);
    if (!isValidInvitationToken(token)) throw genericInvitationUnavailable();
    const sessionSnapshot = await db.doc(senderSessionPath(token)).get();
    if (!sessionSnapshot.exists) throw genericInvitationUnavailable();
    const session = sessionSnapshot.data();
    const now = Date.now();
    const sessionExpiresAt = session.expiresAt?.toMillis?.();
    if (session.status !== "active" || session.purpose !== "whatsapp-sender" ||
        !Number.isFinite(sessionExpiresAt) || sessionExpiresAt <= now || !Array.isArray(session.guestAccess) ||
        session.guestAccess.length < 1 || session.guestAccess.length > MAX_SENDER_SESSION_GUESTS ||
        !["all", "bride", "groom", "family"].includes(session.side) ||
        session.guestAccess.some((guest) => typeof guest?.guestId !== "string" ||
          !/^[A-Za-z0-9_-]{1,150}$/.test(guest.guestId) || !/^[a-f0-9]{64}$/.test(guest.tokenHash || ""))) {
      throw genericInvitationUnavailable();
    }
    const [weddingSnapshot, creatorMembership] = await Promise.all([
      db.doc(`weddings/${session.weddingId}`).get(),
      db.doc(`weddings/${session.weddingId}/dashboardUsers/${session.createdBy}`).get(),
    ]);
    if (!weddingSnapshot.exists) throw genericInvitationUnavailable();
    const wedding = weddingSnapshot.data();
    if ((wedding.status || "active") !== "active" || isInvitationExpired(wedding) ||
        (wedding.ownerUserId !== session.createdBy &&
          (!creatorMembership.exists || creatorMembership.data().canEditGuests !== true || creatorMembership.data().seatingOnly === true))) {
      throw genericInvitationUnavailable();
    }
    const senderGuests = await Promise.all(session.guestAccess.map(async ({ guestId, tokenHash: sessionTokenHash }) => {
      const [guestSnapshot, secretSnapshot] = await Promise.all([
        db.doc(`weddings/${session.weddingId}/guests/${guestId}`).get(),
        db.doc(invitationSecretPath(session.weddingId, guestId)).get(),
      ]);
      if (!guestSnapshot.exists || !secretSnapshot.exists) return null;
      const guest = guestSnapshot.data();
      const secret = secretSnapshot.data();
      if (secret.status !== "active" || secret.purpose !== INVITATION_PURPOSE ||
          secret.tokenHash !== sessionTokenHash || typeof secret.encryptedToken !== "string") return null;
      let invitationToken;
      try { invitationToken = decryptInvitationToken(secret.encryptedToken); } catch { return null; }
      if (!isValidInvitationToken(invitationToken) || tokenHash(invitationToken) !== secret.tokenHash ||
          normalizeSide(guest.side) !== session.side && session.side !== "all") return null;
      const invitationIndexSnapshot = await db.doc(invitationIndexPath(invitationToken)).get();
      const invitationIndex = invitationIndexSnapshot.exists ? invitationIndexSnapshot.data() : {};
      if (invitationIndex.status !== "active" || invitationIndex.purpose !== INVITATION_PURPOSE ||
          invitationIndex.weddingId !== session.weddingId || invitationIndex.guestId !== guestId ||
          invitationIndex.version !== secret.version) return null;
      return {
        n: typeof guest.fullName === "string" ? guest.fullName.slice(0, 160) : "Guest",
        p: normalizeSenderPhone(guest.phone, wedding.whatsAppCountryCode || wedding.whatsappCountryCode),
        s: typeof guest.side === "string" ? guest.side.slice(0, 40) : "",
        t: invitationToken,
      };
    }));
    const guests = senderGuests.filter((guest) => guest?.p && guest?.t);
    if (!guests.length) throw genericInvitationUnavailable();
    return {
      w: session.weddingId,
      c: String(wedding.eventTitle || wedding.coupleName || "Event").slice(0, 160),
      side: session.side,
      sid: tokenHash(token).slice(0, 16),
      cat: wedding.eventCategory === "celebration" ? "celebration" : "wedding_engagement",
      g: guests,
    };
  } catch {
    throw genericInvitationUnavailable();
  }
});

exports.revokeSenderSession = onCall(async (request) => {
  setNoStore(request);
  const { weddingId, token } = request.data || {};
  if (!isValidInvitationToken(token) || !/^[A-Za-z0-9_-]{1,150}$/.test(weddingId || "")) {
    throw genericInvitationUnavailable();
  }
  await requireInvitationManager(request.auth, weddingId);
  const sessionRef = db.doc(senderSessionPath(token));
  const session = await sessionRef.get();
  if (!session.exists || session.data().weddingId !== weddingId || session.data().purpose !== "whatsapp-sender") {
    throw genericInvitationUnavailable();
  }
  await sessionRef.update({ status: "revoked", revokedAt: FieldValue.serverTimestamp() });
  return { revoked: true };
});

// Dry-run first. Apply is explicitly owner-confirmed, resumable by cursor, and
// never returns or logs raw invitation credentials. Old links intentionally
// stop working after this cutover and must be re-shared by the organizer.
exports.migrateInvitationAccess = onCall({ secrets: [invitationTokenEncryptionKey] }, async (request) => {
  setNoStore(request);
  const { weddingId, mode = "dry-run", confirmation = "", cursor = "", pageSize = 100 } = request.data || {};
  await requireWeddingOwner(request.auth, weddingId);
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(weddingId || "") || !["dry-run", "apply"].includes(mode) ||
      (cursor && (typeof cursor !== "string" || cursor.length > 150)) ||
      !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
    throw new HttpsError("invalid-argument", "Invalid migration request.");
  }
  if (mode === "apply" && confirmation !== `ROTATE INVITATIONS ${weddingId}`) {
    throw new HttpsError("failed-precondition", "Explicit invitation cutover confirmation is required.");
  }
  const weddingSnapshot = await db.doc(`weddings/${weddingId}`).get();
  if (!weddingSnapshot.exists || (mode === "apply" && weddingSnapshot.data().status !== "active")) {
    throw new HttpsError("failed-precondition", "This event is unavailable for invitation migration.");
  }
  const allGuests = await db.collection(`weddings/${weddingId}/guests`).get();
  const remaining = allGuests.docs.filter((snapshot) => snapshot.id > cursor).sort((left, right) => left.id.localeCompare(right.id));
  const page = remaining.slice(0, pageSize);
  const legacyMirrors = await db.collection(`weddings/${weddingId}/publicGuests`).get();
  const result = {
    mode,
    examined: page.length,
    legacyInvitationCount: 0,
    predictableDemoTokenCount: 0,
    randomLegacyTokenCount: 0,
    otherLegacyTokenCount: 0,
    legacyMirrorCount: legacyMirrors.size,
    unsupportedFieldCounts: {},
    migrated: 0,
    nextCursor: page.length && remaining.length > page.length ? page[page.length - 1].id : "",
    done: remaining.length <= page.length,
  };
  for (const snapshot of page) {
    const data = snapshot.data();
    const token = typeof data.guestToken === "string" ? data.guestToken : "";
    if (token) {
      result.legacyInvitationCount += 1;
      if (/^demo-token-\d+$/i.test(token)) result.predictableDemoTokenCount += 1;
      else if (/^[a-f0-9]{24}$/i.test(token)) result.randomLegacyTokenCount += 1;
      else result.otherLegacyTokenCount = (result.otherLegacyTokenCount || 0) + 1;
    }
    for (const key of Object.keys(data)) {
      if (!SUPPORTED_GUEST_FIELDS.has(key)) {
        result.unsupportedFieldCounts[key] = (result.unsupportedFieldCounts[key] || 0) + 1;
      }
    }
  }
  if (mode === "dry-run") return result;
  if (Object.keys(result.unsupportedFieldCounts).length) {
    throw new HttpsError("failed-precondition", "Guest records contain fields that need an explicit preservation mapping before cutover.");
  }
  let batch = db.batch();
  let writeCount = 0;
  for (const snapshot of page) {
    const data = snapshot.data();
    const secret = await db.doc(invitationSecretPath(weddingId, snapshot.id)).get();
    if (!secret.exists) await ensureInvitationSecret(weddingId, snapshot.id, weddingSnapshot.data(), "ensure");
    const patch = { updatedAt: FieldValue.serverTimestamp() };
    let changed = false;
    for (const field of LEGACY_INVITATION_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        patch[field] = FieldValue.delete();
        changed = true;
      }
    }
    if (!Number.isInteger(data.additionalGuestAllowance)) {
      const extra = Number.isInteger(data.additionalGuests) ? Math.max(0, Math.min(data.additionalGuests, 10)) : 0;
      patch.additionalGuestAllowance = extra;
      changed = true;
    }
    if (changed) {
      batch.update(snapshot.ref, patch);
      writeCount += 1;
      result.migrated += 1;
    }
    const legacyToken = typeof data.guestToken === "string" ? data.guestToken : "";
    if (legacyToken && !legacyToken.includes("/")) {
      batch.delete(db.doc(`weddings/${weddingId}/publicGuests/${legacyToken}`));
      writeCount += 1;
    }
    if (writeCount >= 400) {
      await batch.commit();
      batch = db.batch();
      writeCount = 0;
    }
  }
  if (writeCount) await batch.commit();
  if (result.done) {
    const mirrors = await db.collection(`weddings/${weddingId}/publicGuests`).get();
    for (let offset = 0; offset < mirrors.docs.length; offset += 400) {
      const mirrorBatch = db.batch();
      mirrors.docs.slice(offset, offset + 400).forEach((snapshot) => mirrorBatch.delete(snapshot.ref));
      await mirrorBatch.commit();
    }
    await rebuildPublicStats(weddingId);
  }
  return result;
});

exports.getGuestInvitation = onCall({ secrets: [invitationTokenEncryptionKey] }, async (request) => {
  setNoStore(request);
  const { weddingId, token } = request.data || {};
  try {
    await consumeInvitationRateLimit(request, token);
    const resolved = await resolveInvitation(weddingId, token);
    const tables = resolved.wedding.seatingEnabled === false ? [] : await projectInvitationTables(weddingId);
    const event = projectInvitationEvent(resolved.wedding, tables);
    const guest = projectInvitationGuest(resolved.guest, tables, resolved.access.guestId);
    return { wedding: { id: weddingId, ...event }, guest };
  } catch {
    throw genericInvitationUnavailable();
  }
});

exports.submitGuestInvitationRsvp = onCall({ secrets: [invitationTokenEncryptionKey] }, async (request) => {
  setNoStore(request);
  const { weddingId, token, rsvpStatus, additionalGuests, rsvpMessage } = request.data || {};
  if (!isValidInvitationToken(token) || !["confirmed", "declined"].includes(rsvpStatus) ||
      (additionalGuests !== undefined && (!Number.isInteger(additionalGuests) || additionalGuests < 0 || additionalGuests > 10)) ||
      (rsvpMessage !== undefined && (typeof rsvpMessage !== "string" || rsvpMessage.length > 1000))) {
    throw genericInvitationUnavailable();
  }
  try {
    await consumeInvitationRateLimit(request, token);
    const initial = await resolveInvitation(weddingId, token);
    const partyAllowance = Number.isInteger(initial.guest.additionalGuestAllowance)
      ? Math.max(0, Math.min(initial.guest.additionalGuestAllowance, 10))
      : (Number.isInteger(initial.guest.additionalGuests) ? Math.max(0, Math.min(initial.guest.additionalGuests, 10)) : 0);
    if (additionalGuests !== undefined && additionalGuests > partyAllowance) throw genericInvitationUnavailable();
    await db.runTransaction(async (transaction) => {
      const [indexSnapshot, secretSnapshot, weddingSnapshot, guestSnapshot] = await Promise.all([
        transaction.get(initial.indexRef),
        transaction.get(initial.secretRef),
        transaction.get(initial.weddingRef),
        transaction.get(initial.guestRef),
      ]);
      if (!indexSnapshot.exists || !secretSnapshot.exists || !weddingSnapshot.exists || !guestSnapshot.exists) throw genericInvitationUnavailable();
      const index = indexSnapshot.data();
      const secret = secretSnapshot.data();
      const wedding = weddingSnapshot.data();
      if (index.status !== "active" || index.purpose !== INVITATION_PURPOSE || index.weddingId !== weddingId ||
          index.guestId !== initial.access.guestId || index.version !== secret.version ||
          secret.status !== "active" || secret.tokenHash !== tokenHash(token) ||
          !["active"].includes(wedding.status || "") || isInvitationExpired(wedding)) throw genericInvitationUnavailable();
      const allowance = Number.isInteger(guestSnapshot.data().additionalGuestAllowance)
        ? Math.max(0, Math.min(guestSnapshot.data().additionalGuestAllowance, 10))
        : (Number.isInteger(guestSnapshot.data().additionalGuests) ? Math.max(0, Math.min(guestSnapshot.data().additionalGuests, 10)) : 0);
      if (additionalGuests !== undefined && additionalGuests > allowance) throw genericInvitationUnavailable();
      const patch = {
        rsvpStatus,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (additionalGuests !== undefined) patch.additionalGuests = additionalGuests;
      if (rsvpMessage !== undefined) patch.rsvpMessage = rsvpMessage.trim();
      transaction.update(initial.guestRef, patch);
    });
    const updated = await initial.guestRef.get();
    const tables = initial.wedding.seatingEnabled === false ? [] : await projectInvitationTables(weddingId);
    return { guest: projectInvitationGuest(updated.data(), tables, initial.access.guestId) };
  } catch {
    throw genericInvitationUnavailable();
  }
});

exports.resolveCheckinGuest = onCall({ secrets: [invitationTokenEncryptionKey] }, async (request) => {
  setNoStore(request);
  const { weddingId, token } = request.data || {};
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in is required.");
  try {
    await consumeInvitationRateLimit(request, token);
    const resolved = await resolveInvitation(weddingId, token, { allowCompleted: true });
    const member = await db.doc(`weddings/${weddingId}/dashboardUsers/${request.auth.uid}`).get();
    if (!member.exists || member.data().canCheckIn !== true) throw new HttpsError("permission-denied", "Check-in access is unavailable.");
    const guest = resolved.guest;
    const allowedSide = member.data().allowedSide || "all";
    if (!(["all", "bride", "groom", "family"].includes(allowedSide)) ||
        (allowedSide !== "all" && normalizeSide(guest.side) !== allowedSide)) {
      throw new HttpsError("permission-denied", "Check-in access is unavailable.");
    }
    return {
      guestId: resolved.access.guestId,
      fullName: typeof guest.fullName === "string" ? guest.fullName.slice(0, 160) : "Guest",
      phone: typeof guest.phone === "string" ? guest.phone.slice(0, 40) : "",
      rsvpStatus: ["confirmed", "declined"].includes(guest.rsvpStatus) ? guest.rsvpStatus : "pending",
      checkedIn: guest.checkedIn === true,
      checkedInAt: guest.checkedInAt || null,
      tableName: typeof guest.tableName === "string" ? guest.tableName.slice(0, 100) : "",
      seatNumber: typeof guest.seatNumber === "string" || typeof guest.seatNumber === "number" ? String(guest.seatNumber).slice(0, 8) : "",
    };
  } catch (error) {
    if (error instanceof HttpsError && error.code === "permission-denied") throw error;
    throw genericInvitationUnavailable();
  }
});

exports.getCheckinGuestList = onCall(async (request) => {
  setNoStore(request);
  const weddingId = request.data?.weddingId;
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in is required.");
  if (typeof weddingId !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(weddingId)) {
    throw new HttpsError("invalid-argument", "Invalid event.");
  }
  const member = await db.doc(`weddings/${weddingId}/dashboardUsers/${request.auth.uid}`).get();
  if (!member.exists || member.data().canCheckIn !== true) {
    throw new HttpsError("permission-denied", "Check-in access is unavailable.");
  }
  const allowedSide = member.data().allowedSide || "all";
  if (!new Set(["all", "bride", "groom", "family"]).has(allowedSide)) {
    throw new HttpsError("permission-denied", "Check-in access is unavailable.");
  }
  await consumeCheckinRosterRateLimit(request.auth.uid, weddingId);
  const guests = await db.collection(`weddings/${weddingId}/guests`).limit(MAX_CHECKIN_ROSTER_GUESTS + 1).get();
  if (guests.size > MAX_CHECKIN_ROSTER_GUESTS) {
    throw new HttpsError("resource-exhausted", "Check-in guest data is temporarily unavailable.");
  }
  return {
    guests: guests.docs
      .filter((snapshot) => allowedSide === "all" || normalizeSide(snapshot.data().side) === allowedSide)
      .map((snapshot) => {
        const guest = snapshot.data();
        return {
          id: snapshot.id,
          fullName: typeof guest.fullName === "string" ? guest.fullName.slice(0, 160) : "Guest",
          phone: typeof guest.phone === "string" ? guest.phone.slice(0, 40) : "",
          side: typeof guest.side === "string" ? guest.side.slice(0, 40) : "",
          rsvpStatus: ["confirmed", "declined"].includes(guest.rsvpStatus) ? guest.rsvpStatus : "pending",
          checkedIn: guest.checkedIn === true,
          checkedInAt: guest.checkedInAt || null,
          tableName: typeof guest.tableName === "string" ? guest.tableName.slice(0, 100) : "",
          seatNumber: typeof guest.seatNumber === "string" || typeof guest.seatNumber === "number" ? String(guest.seatNumber).slice(0, 8) : "",
        };
      }),
  };
});

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
  if (typeof weddingId !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(weddingId)) {
    throw new HttpsError("invalid-argument", "Invalid event.");
  }
  const [wedding, dashboardUser] = await Promise.all([
    db.doc(`weddings/${weddingId}`).get(),
    db.doc(`weddings/${weddingId}/dashboardUsers/${auth.uid}`).get(),
  ]);
  const isOwner = wedding.exists && wedding.data().ownerUserId === auth.uid;
  if (wedding.exists && wedding.data().eventCategory === "celebration") {
    throw new HttpsError("failed-precondition", "Wedding-side seating access is unavailable for celebration events.");
  }
  const isDashboardAdmin = dashboardUser.exists && dashboardUser.data().canManageUsers === true;
  if (!isOwner && !isDashboardAdmin) {
    throw new HttpsError("permission-denied", "Only the event owner or a dashboard administrator can manage seating editor access.");
  }
}

async function requireWeddingOwner(auth, weddingId) {
  if (!auth) throw new HttpsError("unauthenticated", "Sign in is required.");
  if (typeof weddingId !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(weddingId)) {
    throw new HttpsError("invalid-argument", "Invalid event.");
  }
  const wedding = await db.doc(`weddings/${weddingId}`).get();
  if (!wedding.exists || wedding.data().ownerUserId !== auth.uid) {
    throw new HttpsError("permission-denied", "Only the event owner can perform this migration.");
  }
}

// Return a narrow event-card projection for memberships owned by the caller.
// This avoids granting seating-only accounts direct reads of private event
// documents or using a client-controlled email address as a role signal.
exports.getAccessibleWorkspaceEvents = onCall(async (request) => {
  setNoStore(request);
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in is required.");
  const memberships = await db.collectionGroup("dashboardUsers")
    .where("userId", "==", request.auth.uid)
    .limit(101)
    .get();
  const events = await Promise.all(memberships.docs.slice(0, 100).map(async (memberSnapshot) => {
    const permissions = memberSnapshot.data();
    if (permissions.canViewDashboard !== true) return null;
    const weddingRef = memberSnapshot.ref.parent.parent;
    if (!weddingRef) return null;
    const weddingSnapshot = await weddingRef.get();
    if (!weddingSnapshot.exists) return null;
    const wedding = weddingSnapshot.data();
    const seatingOnly = permissions.seatingOnly === true;
    const allowedSide = permissions.allowedSide;
    if (seatingOnly && (permissions.canEditSeating !== true ||
        !["bride", "groom", "all"].includes(allowedSide) ||
        wedding.eventCategory === "celebration")) return null;
    return {
      id: weddingRef.id,
      eventCategory: wedding.eventCategory === "celebration" ? "celebration" : "wedding_engagement",
      eventTitle: typeof wedding.eventTitle === "string" ? wedding.eventTitle.slice(0, 160) : "",
      coupleName: typeof wedding.coupleName === "string" ? wedding.coupleName.slice(0, 160) : "",
      brideName: typeof wedding.brideName === "string" ? wedding.brideName.slice(0, 100) : "",
      groomName: typeof wedding.groomName === "string" ? wedding.groomName.slice(0, 100) : "",
      eventDateISO: typeof wedding.eventDateISO === "string" ? wedding.eventDateISO.slice(0, 40) : "",
      venueEn: typeof wedding.venueEn === "string" ? wedding.venueEn.slice(0, 200) : "",
      location: typeof wedding.location === "string" ? wedding.location.slice(0, 200) : "",
      status: ["draft", "upcoming", "active", "completed", "archived"].includes(wedding.status) ? wedding.status : "draft",
      createdAt: wedding.createdAt || null,
      updatedAt: wedding.updatedAt || null,
      isOwner: wedding.ownerUserId === request.auth.uid,
      seatingOnly,
      ...(seatingOnly ? { allowedSide } : {}),
    };
  }));
  return { events: events.filter(Boolean), hasMore: memberships.size > 100 };
});

// Safe migration/admin helper for account-based seating managers.  A caller
// cannot create a privileged account through this endpoint: the account must
// already be a dashboard member with the three required seating flags.
exports.setSeatingOnlyAccountSide = onCall(async (request) => {
  setNoStore(request);
  const { weddingId, userId, allowedSide } = request.data || {};
  if (!["bride", "groom", "all"].includes(allowedSide)) {
    throw new HttpsError("invalid-argument", "allowedSide must be bride, groom, or all.");
  }
  await requireSeatingAccessManager(request.auth, weddingId);
  if (!userId || typeof userId !== "string") {
    throw new HttpsError("invalid-argument", "Invalid dashboard user.");
  }
  const accountRef = db.doc(`weddings/${weddingId}/dashboardUsers/${userId}`);
  const account = await accountRef.get();
  if (!account.exists || account.data().canViewDashboard !== true ||
      account.data().canEditSeating !== true || account.data().seatingOnly !== true) {
    throw new HttpsError("failed-precondition", "The account must already be a seating-only dashboard editor.");
  }
  await accountRef.update({ userId, allowedSide, updatedAt: FieldValue.serverTimestamp() });
  return { userId, allowedSide };
});

exports.manageSeatingEditorAccess = onCall({ secrets: [seatingLinkEncryptionKey] }, async (request) => {
  setNoStore(request);
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
  setNoStore(request);
  const token = request.data?.token;
  if (!token || typeof token !== "string" || token.length < 40) {
    throw new HttpsError("permission-denied", "This access link is invalid or expired.");
  }
  const hash = tokenHash(token);
  const index = await db.doc(`seatingAccessTokens/${hash}`).get();
  if (!index.exists) throw new HttpsError("permission-denied", "This access link is invalid or expired.");
  const { weddingId, role, version } = index.data();
  requireRole(role);
  const wedding = await db.doc(`weddings/${weddingId}`).get();
  if (!wedding.exists || wedding.data().eventCategory === "celebration") {
    throw new HttpsError("permission-denied", "This wedding-side seating link is unavailable.");
  }
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
  if (side === "general") return "general";
  if (["bride", "bride side", "brides side"].includes(side)) return "bride";
  if (["groom", "groom side", "grooms side"].includes(side)) return "groom";
  if (["both", "both sides", "shared"].includes(side)) return "groom";
  return "family";
}

function normalizeSenderPhone(phone, countryCode) {
  const raw = String(phone || "").trim();
  const digits = raw.replace(/[٠-٩۰-۹]/g, (digit) => String(digit.charCodeAt(0) & 0xf)).replace(/[^0-9]/g, "");
  if (!digits) return "";
  if (raw.startsWith("+")) return digits.slice(0, 40);
  if (digits.startsWith("00")) return digits.replace(/^0+/, "").slice(0, 40);
  if (digits.startsWith("0")) {
    const country = String(countryCode || "971").replace(/[^0-9]/g, "") || "971";
    return `${country}${digits.replace(/^0+/, "")}`.slice(0, 40);
  }
  return digits.slice(0, 40);
}

function partySize(guest) {
  const extra = Number(guest.additionalGuests);
  return 1 + (Number.isInteger(extra) && extra > 0 ? extra : 0);
}

function sideMatches(guest, side) {
  const guestSide = normalizeSide(guest.side);
  return side === "all" || guestSide === side;
}

async function requireSeatingManagerIdentity(auth, weddingId) {
  if (!auth || !/^[A-Za-z0-9_-]{1,150}$/.test(weddingId || "")) {
    throw new HttpsError("permission-denied", "Seating access is unavailable.");
  }
  const weddingRef = db.doc(`weddings/${weddingId}`);
  const wedding = await weddingRef.get();
  if (!wedding.exists || wedding.data().eventCategory === "celebration") {
    throw new HttpsError("permission-denied", "Seating access is unavailable.");
  }
  const claims = auth.token || {};
  if (claims.seatingEditor === true) {
    const role = claims.seatingRole;
    const version = claims.seatingAccessVersion;
    if (claims.seatingWeddingId !== weddingId || !["bride", "groom"].includes(role) || !Number.isInteger(version)) {
      throw new HttpsError("permission-denied", "Seating access is unavailable.");
    }
    const access = await db.doc(`weddings/${weddingId}/seatingAccess/${role}`).get();
    if (!access.exists || access.data().status !== "active" || access.data().version !== version) {
      throw new HttpsError("permission-denied", "Seating access is unavailable.");
    }
    return { weddingRef, wedding: wedding.data(), role, editorType: "link" };
  }
  const member = await db.doc(`weddings/${weddingId}/dashboardUsers/${auth.uid}`).get();
  const data = member.exists ? member.data() : {};
  const allowedSide = data.allowedSide;
  if (!member.exists || data.canEditSeating !== true || data.seatingOnly !== true ||
      !["bride", "groom", "all"].includes(allowedSide)) {
    throw new HttpsError("permission-denied", "Seating access is unavailable.");
  }
  return { weddingRef, wedding: wedding.data(), role: allowedSide, editorType: "account" };
}

function seatingAssignment(table, chair) {
  const value = chair.assignment || (chair.guestId ? { guestId: chair.guestId } : null);
  if (!value?.guestId) return null;
  const partyMemberIndex = Number.isInteger(Number(value.partyMemberIndex))
    ? Number(value.partyMemberIndex)
    : value.personKey === "main" ? 0 : Number(String(value.personKey || "").replace("guest-", "")) || 0;
  return { ...value, guestId: value.guestId, tableId: table.id, tableName: table.name || "Table", seatNumber: Number(value.seatNumber || chair.seatNumber), partyMemberIndex };
}

function setSeatingAssignment(table, chair, assignment) {
  const index = Number(assignment.partyMemberIndex);
  chair.guestId = assignment.guestId;
  chair.status = "assigned";
  chair.assignment = {
    tableId: table.id,
    tableName: table.name || "Table",
    seatNumber: Number(chair.seatNumber),
    guestId: assignment.guestId,
    partyMemberIndex: index,
    personKey: index === 0 ? "main" : `guest-${index}`,
    label: index === 0 ? "Main guest" : `Additional guest ${index}`,
    isMainGuest: index === 0,
  };
}

function clearSeatingAssignment(chair) {
  chair.guestId = "";
  chair.assignment = null;
  chair.status = "available";
}

function projectSideSeatingState(weddingId, wedding, tableDocs, guestDocs, role) {
  const guestById = new Map(guestDocs.map((snapshot) => [snapshot.id, snapshot.data()]));
  const guests = guestDocs
    .filter((snapshot) => sideMatches(snapshot.data(), role))
    .map((snapshot) => {
      const data = snapshot.data();
      return {
        id: snapshot.id,
        fullName: typeof data.fullName === "string" ? data.fullName.slice(0, 160) : "Guest",
        side: normalizeSide(data.side),
        additionalGuests: Number.isInteger(data.additionalGuests) ? Math.max(0, Math.min(data.additionalGuests, 10)) : 0,
        rsvpStatus: ["confirmed", "declined"].includes(data.rsvpStatus) ? data.rsvpStatus : "pending",
      };
    });
  const tables = tableDocs.map((snapshot) => {
    const data = snapshot.data();
    const table = { ...data, id: snapshot.id };
    return {
      id: snapshot.id,
      name: typeof data.name === "string" ? data.name.slice(0, 100) : "Table",
      shape: data.shape || "round",
      x: boundedNumber(data.x, 0, 100, 20),
      y: boundedNumber(data.y, 0, 100, 20),
      width: boundedNumber(data.width, 80, 1200, 160),
      height: boundedNumber(data.height, 80, 1200, 160),
      rotation: boundedNumber(data.rotation, -360, 360, 0),
      seatCount: boundedNumber(data.seatCount || data.capacity, 0, 250, 0),
      tableColor: validColor(data.tableColor),
      borderColor: validColor(data.borderColor),
      chairColor: validColor(data.chairColor),
      chairs: (Array.isArray(data.chairs) ? data.chairs : []).slice(0, 250).map((chair, index) => {
        const assignment = seatingAssignment(table, chair);
        const guest = assignment ? guestById.get(assignment.guestId) : null;
        if (!assignment) return {
          id: typeof chair.id === "string" ? chair.id : `${snapshot.id}-chair-${index + 1}`,
          seatNumber: boundedNumber(chair.seatNumber, 1, 250, index + 1),
          x: boundedNumber(chair.x, 0, 100, 50),
          y: boundedNumber(chair.y, 0, 100, 50),
          rotation: boundedNumber(chair.rotation, -360, 360, 0),
          guestId: "",
          assignment: null,
          status: "available",
        };
        if (!guest || !sideMatches(guest, role)) return {
          id: typeof chair.id === "string" ? chair.id : `${snapshot.id}-chair-${index + 1}`,
          seatNumber: boundedNumber(chair.seatNumber, 1, 250, index + 1),
          x: boundedNumber(chair.x, 0, 100, 50),
          y: boundedNumber(chair.y, 0, 100, 50),
          rotation: boundedNumber(chair.rotation, -360, 360, 0),
          guestId: "__restricted__",
          assignment: { guestId: "__restricted__", restricted: true, label: "Other side" },
          status: "restricted",
        };
        return {
          id: typeof chair.id === "string" ? chair.id : `${snapshot.id}-chair-${index + 1}`,
          seatNumber: boundedNumber(chair.seatNumber, 1, 250, index + 1),
          x: boundedNumber(chair.x, 0, 100, 50),
          y: boundedNumber(chair.y, 0, 100, 50),
          rotation: boundedNumber(chair.rotation, -360, 360, 0),
          guestId: assignment.guestId,
          assignment: {
            ...assignment,
            personKey: assignment.personKey || (assignment.partyMemberIndex === 0 ? "main" : `guest-${assignment.partyMemberIndex}`),
            label: assignment.label || (assignment.partyMemberIndex === 0 ? "Main guest" : `Additional guest ${assignment.partyMemberIndex}`),
          },
          status: "assigned",
        };
      }),
    };
  });
  return {
    wedding: {
      id: weddingId,
      eventTitle: typeof wedding.eventTitle === "string" ? wedding.eventTitle.slice(0, 160) : "",
      coupleName: typeof wedding.coupleName === "string" ? wedding.coupleName.slice(0, 160) : "",
      eventCategory: wedding.eventCategory || "wedding_engagement",
      seatingEnabled: wedding.seatingEnabled !== false,
    },
    role,
    guests,
    tables,
  };
}

exports.getSideSeatingState = onCall(async (request) => {
  setNoStore(request);
  const weddingId = request.data?.weddingId;
  const access = await requireSeatingManagerIdentity(request.auth, weddingId);
  const [tables, guests] = await Promise.all([
    db.collection(`weddings/${weddingId}/tables`).get(),
    db.collection(`weddings/${weddingId}/guests`).get(),
  ]);
  return projectSideSeatingState(weddingId, access.wedding, tables.docs, guests.docs, access.role);
});

exports.mutateSideSeating = onCall(async (request) => {
  setNoStore(request);
  const { weddingId, type, source = {}, destination = {} } = request.data || {};
  const access = await requireSeatingManagerIdentity(request.auth, weddingId);
  if (!["assign", "move", "swap", "unassign"].includes(type)) {
    throw new HttpsError("invalid-argument", "Invalid seating change.");
  }
  const tablesRef = db.collection(`weddings/${weddingId}/tables`);
  const guestsRef = db.collection(`weddings/${weddingId}/guests`);
  await db.runTransaction(async (transaction) => {
    const [tableSnapshot, guestSnapshot] = await Promise.all([
      transaction.get(tablesRef),
      transaction.get(guestsRef),
    ]);
    const tables = tableSnapshot.docs.map((snapshot) => ({ ...snapshot.data(), id: snapshot.id, ref: snapshot.ref }));
    const guests = new Map(guestSnapshot.docs.map((snapshot) => [snapshot.id, { ...snapshot.data(), id: snapshot.id, ref: snapshot.ref }]));
    const findChair = (position) => {
      if (!position || typeof position.tableId !== "string" || typeof position.chairId !== "string") {
        throw new HttpsError("invalid-argument", "Invalid chair.");
      }
      const table = tables.find((row) => row.id === position.tableId);
      const chair = table?.chairs?.find((row) => row.id === position.chairId);
      if (!table || !chair) throw new HttpsError("failed-precondition", "That chair is unavailable.");
      return { table, chair };
    };
    const sourceSeat = type === "assign" ? null : findChair(source);
    const destinationSeat = type === "unassign" ? null : findChair(destination);
    const sourceAssignment = type === "assign"
      ? { guestId: source.guestId, partyMemberIndex: source.partyMemberIndex }
      : seatingAssignment(sourceSeat.table, sourceSeat.chair);
    if (!sourceAssignment?.guestId) throw new HttpsError("failed-precondition", "That chair is unavailable.");
    const sourceGuest = guests.get(sourceAssignment.guestId);
    if (!sourceGuest || !sideMatches(sourceGuest, access.role)) throw new HttpsError("permission-denied", "That seating change is unavailable.");
    if (type === "assign") {
      const index = Number(sourceAssignment.partyMemberIndex);
      if (!Number.isInteger(index) || index < 0 || index >= partySize(sourceGuest)) {
        throw new HttpsError("invalid-argument", "Invalid party member.");
      }
    }
    let destinationAssignment = null;
    if (destinationSeat) {
      destinationAssignment = seatingAssignment(destinationSeat.table, destinationSeat.chair);
      if (type === "swap") {
        if (!destinationAssignment) throw new HttpsError("failed-precondition", "Choose an occupied chair to swap.");
        const otherGuest = guests.get(destinationAssignment.guestId);
        if (!otherGuest || !sideMatches(otherGuest, access.role)) throw new HttpsError("permission-denied", "That seating change is unavailable.");
      } else if (destinationAssignment) {
        throw new HttpsError("failed-precondition", "That chair is no longer empty.");
      }
    }
    const sourceIndex = Number(sourceAssignment.partyMemberIndex || 0);
    const allAssignments = () => tables.flatMap((table) => (table.chairs || []).map((chair) => ({
      table,
      chair,
      assignment: seatingAssignment(table, chair),
    })).filter((row) => row.assignment));
    const before = allAssignments();
    const duplicate = before.some((row) => row.assignment.guestId === sourceGuest.id &&
      row.assignment.partyMemberIndex === sourceIndex &&
      (!sourceSeat || row.chair.id !== sourceSeat.chair.id || row.table.id !== sourceSeat.table.id));
    if (duplicate) throw new HttpsError("failed-precondition", "This person already has a chair.");
    if (type === "swap") {
      setSeatingAssignment(sourceSeat.table, sourceSeat.chair, destinationAssignment);
      setSeatingAssignment(destinationSeat.table, destinationSeat.chair, sourceAssignment);
    } else if (type === "unassign") {
      clearSeatingAssignment(sourceSeat.chair);
    } else {
      if (type === "move") clearSeatingAssignment(sourceSeat.chair);
      setSeatingAssignment(destinationSeat.table, destinationSeat.chair, sourceAssignment);
    }
    const affectedGuestIds = new Set([sourceGuest.id]);
    if (destinationAssignment?.guestId) affectedGuestIds.add(destinationAssignment.guestId);
    const after = allAssignments();
    const personKeys = new Set();
    for (const row of after) {
      const assignment = row.assignment;
      const guest = guests.get(assignment.guestId);
      if (!guest) throw new HttpsError("failed-precondition", "A seating assignment is invalid.");
      const index = Number(assignment.partyMemberIndex || 0);
      if (!Number.isInteger(index) || index < 0 || index >= partySize(guest)) {
        throw new HttpsError("failed-precondition", "A seating assignment is invalid.");
      }
      const key = `${assignment.guestId}:${index}`;
      if (personKeys.has(key)) throw new HttpsError("failed-precondition", "A party member cannot occupy two chairs.");
      personKeys.add(key);
    }
    const changedTables = new Set([sourceSeat?.table.id, destinationSeat?.table.id].filter(Boolean));
    for (const table of tables.filter((row) => changedTables.has(row.id))) {
      transaction.update(table.ref, {
        chairs: table.chairs,
        guestIds: [...new Set((table.chairs || []).map((chair) => seatingAssignment(table, chair)?.guestId).filter(Boolean))],
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    for (const guestId of affectedGuestIds) {
      const guest = guests.get(guestId);
      const assigned = after.filter((row) => row.assignment.guestId === guestId)
        .map((row) => row.assignment)
        .sort((a, b) => Number(a.partyMemberIndex) - Number(b.partyMemberIndex));
      const primary = assigned.find((row) => Number(row.partyMemberIndex) === 0) || assigned[0];
      transaction.update(guest.ref, {
        seatingAssignments: assigned.map((row) => ({
          tableId: row.tableId,
          tableName: row.tableName || "Table",
          seatNumber: row.seatNumber,
          guestId,
          partyMemberIndex: Number(row.partyMemberIndex),
          personKey: Number(row.partyMemberIndex) === 0 ? "main" : `guest-${Number(row.partyMemberIndex)}`,
          label: Number(row.partyMemberIndex) === 0 ? "Main guest" : `Additional guest ${Number(row.partyMemberIndex)}`,
          isMainGuest: Number(row.partyMemberIndex) === 0,
        })),
        tableId: primary?.tableId || "",
        tableName: primary?.tableName || "",
        seatNumber: primary ? String(primary.seatNumber) : "",
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });
  return { updated: true };
});

// Owner-only, idempotent migration for legacy side aliases, including "Both" -> "Groom".
// It is intentionally server-side so the client never receives authority to
// rewrite guests outside its normal dashboard permissions.
exports.normalizeSeatingGuestSides = onCall(async (request) => {
  setNoStore(request);
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

// Permanent deletion is deliberately server-side so nested Firestore
// collections cannot be orphaned. The UI requires the exact confirmation
// phrase before it calls this owner-only endpoint.
exports.deleteWedding = onCall(async (request) => {
  setNoStore(request);
  const { weddingId, confirmation } = request.data || {};
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in is required.");
  if (!weddingId || confirmation !== `DELETE ${weddingId}`) {
    throw new HttpsError("invalid-argument", "Confirmation does not match this event.");
  }
  const weddingRef = db.doc(`weddings/${weddingId}`);
  const wedding = await weddingRef.get();
  if (!wedding.exists || wedding.data().ownerUserId !== request.auth.uid) {
    throw new HttpsError("permission-denied", "Only the event owner can permanently delete it.");
  }
  // Remove every collaborator's private workspace index first. Otherwise a
  // deleted wedding could remain as a stale card in another planner's view.
  const members = await weddingRef.collection("dashboardUsers").get();
  let batch = db.batch();
  let writes = 0;
  for (const member of members.docs) {
    batch.delete(db.doc(`users/${member.id}/weddingAccess/${weddingId}`));
    writes += 1;
    if (writes === 400) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }
  if (writes) await batch.commit();
  await db.recursiveDelete(weddingRef);
  return { deleted: true };
});

// Public side pages deliberately expose only this aggregate. Keeping it server
// generated means editor links cannot write arbitrary public documents.
async function rebuildPublicStats(weddingId) {
  const controlRef = db.doc(`weddings/${weddingId}/publicSummaryControl/control`);
  const revision = await db.runTransaction(async (transaction) => {
    const current = await transaction.get(controlRef);
    const next = Number(current.exists ? current.data().revision : 0) + 1;
    transaction.set(controlRef, { revision: next, updatedAt: FieldValue.serverTimestamp() });
    return next;
  });
  const [wedding, guests, tables] = await Promise.all([
    db.doc(`weddings/${weddingId}`).get(),
    db.collection(`weddings/${weddingId}/guests`).get(),
    db.collection(`weddings/${weddingId}/tables`).get(),
  ]);
  if (!wedding.exists) return;
  const allGuests = guests.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data(), side: normalizeSide(snapshot.data().side) }));
  const assignedGuestIds = new Set();
  tables.docs.forEach((snapshot) => (snapshot.data().chairs || []).forEach((chair) => {
    const assignment = chair.assignment || (chair.guestId ? { guestId: chair.guestId } : null);
    if (assignment?.guestId) assignedGuestIds.add(assignment.guestId);
  }));
  if (wedding.data().eventCategory === "celebration") {
    const confirmed = allGuests.filter((guest) => guest.rsvpStatus === "confirmed");
    const all = {
      invited: allGuests.length,
      seats: allGuests.reduce((sum, guest) => sum + partySize(guest), 0),
      confirmed: confirmed.length,
      confirmedSeats: confirmed.reduce((sum, guest) => sum + partySize(guest), 0),
      pending: allGuests.filter((guest) => !["confirmed", "declined"].includes(guest.rsvpStatus)).length,
      declined: allGuests.filter((guest) => guest.rsvpStatus === "declined").length,
      seated: allGuests.filter((guest) => assignedGuestIds.has(guest.id)).length,
      invitesSent: allGuests.filter((guest) => guest.inviteSentAt || guest.reminderSentAt).length,
    };
    await writePublicSummaryIfCurrent(weddingId, controlRef, revision, { eventCategory: "celebration", eventTitle: String(wedding.data().eventTitle || "").trim() || "Untitled event", seatingEnabled: wedding.data().seatingEnabled !== false, all });
    await db.doc(`weddings/${weddingId}/publicStats/summary`).delete().catch(() => {});
    return;
  }
  const sides = {};
  ["bride", "groom", "family"].forEach((side) => {
    const members = allGuests.filter((guest) => sideMatches(guest, side));
    const confirmed = members.filter((guest) => guest.rsvpStatus === "confirmed");
    sides[side] = {
      invited: members.length, seats: members.reduce((sum, guest) => sum + partySize(guest), 0),
      confirmed: confirmed.length, confirmedSeats: confirmed.reduce((sum, guest) => sum + partySize(guest), 0),
      pending: members.filter((guest) => !["confirmed", "declined"].includes(guest.rsvpStatus)).length,
      declined: members.filter((guest) => guest.rsvpStatus === "declined").length,
      seated: members.filter((guest) => assignedGuestIds.has(guest.id)).length,
      invitesSent: members.filter((guest) => guest.inviteSentAt || guest.reminderSentAt).length,
    };
  });
  await writePublicSummaryIfCurrent(weddingId, controlRef, revision, { eventCategory: "wedding_engagement", eventTitle: wedding.data().eventTitle || wedding.data().coupleName || "", seatingEnabled: wedding.data().seatingEnabled !== false, sides });
  await db.doc(`weddings/${weddingId}/publicStats/summary`).delete().catch(() => {});
}

async function writePublicSummaryIfCurrent(weddingId, controlRef, revision, summary) {
  await db.runTransaction(async (transaction) => {
    const control = await transaction.get(controlRef);
    if (!control.exists || control.data().revision !== revision) return;
    transaction.set(db.doc(`weddings/${weddingId}/publicSummary/summary`), {
      ...summary,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

exports.refreshPublicSeatingStats = onDocumentWritten("weddings/{weddingId}/{collectionId}/{documentId}", async (event) => {
  if (!["guests", "tables"].includes(event.params.collectionId)) return;
  await rebuildPublicStats(event.params.weddingId);
});

exports.refreshPublicStatsForEventChange = onDocumentWritten("weddings/{weddingId}", async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!event.data?.after?.exists) return;
  if (before && before.eventCategory === after.eventCategory &&
      before.eventTitle === after.eventTitle && before.coupleName === after.coupleName &&
      before.seatingEnabled === after.seatingEnabled) return;
  await rebuildPublicStats(event.params.weddingId);
});

exports.cleanupInvitationRecordsForDeletedGuest = onDocumentWritten("weddings/{weddingId}/guests/{guestId}", async (event) => {
  if (!event.data?.before?.exists || event.data?.after?.exists) return;
  const secretRef = db.doc(invitationSecretPath(event.params.weddingId, event.params.guestId));
  await db.runTransaction(async (transaction) => {
    const secret = await transaction.get(secretRef);
    if (!secret.exists) return;
    if (secret.data().tokenHash) transaction.delete(db.doc(`invitationAccessTokens/${secret.data().tokenHash}`));
    transaction.delete(secretRef);
  });
});

exports.cleanupInvitationRecordsForDeletedEvent = onDocumentWritten("weddings/{weddingId}", async (event) => {
  if (!event.data?.before?.exists || event.data?.after?.exists) return;
  const weddingId = event.params.weddingId;
  for (const collectionName of ["invitationSecrets", "invitationAccessTokens", "senderSessions"]) {
    const records = await db.collection(collectionName).where("weddingId", "==", weddingId).get();
    for (let offset = 0; offset < records.docs.length; offset += 400) {
      const batch = db.batch();
      records.docs.slice(offset, offset + 400).forEach((snapshot) => batch.delete(snapshot.ref));
      await batch.commit();
    }
  }
});
