import {
  buildInvitationProjection,
  generateInvitationToken,
  isValidInvitationToken,
} from "./invitation-token.js";

function invitationRefs(api, db, weddingId, guestId, token = "") {
  const wedding = api.doc(db, "weddings", weddingId);
  const guest = api.doc(db, "weddings", weddingId, "guests", guestId);
  const secret = api.doc(db, "weddings", weddingId, "invitationSecrets", guestId);
  return {
    wedding,
    guest,
    secret,
    index: token ? api.doc(db, "weddings", weddingId, "invitationTokens", token) : null,
    public: token ? api.doc(db, "weddings", weddingId, "publicGuests", token) : null,
  };
}

function snapshotData(snapshot) {
  return snapshot?.exists?.() ? snapshot.data() : null;
}

export function createInvitationTokenService({ db, firestore, tokenFactory = generateInvitationToken }) {
  if (!db || !firestore) throw new Error("Invitation storage is unavailable.");
  const pending = new Map();

  function runOnce(scope, action, requestId, callback) {
    const key = JSON.stringify([scope.uid, scope.weddingId, scope.guestId, action, requestId || ""]);
    if (pending.has(key)) return pending.get(key);
    const request = Promise.resolve().then(callback);
    pending.set(key, request);
    request.finally(() => {
      if (pending.get(key) === request) pending.delete(key);
    }).catch(() => {});
    return request;
  }

  function ensure(scope) {
    return runOnce(scope, "ensure", "", () => update(scope, "ensure", ""));
  }

  function regenerate(scope, requestId) {
    if (typeof requestId !== "string" || requestId.length < 16 || requestId.length > 100) {
      return Promise.reject(new Error("Secure invitation request IDs are unavailable."));
    }
    return runOnce(scope, "regenerate", requestId, () => update(scope, "regenerate", requestId));
  }

  function revoke(scope) {
    return runOnce(scope, "revoke", "", () => update(scope, "revoke", ""));
  }

  async function update(scope, action, requestId) {
    const { uid, weddingId, guestId, tables = [], wedding: weddingData = {} } = scope || {};
    if (!uid || !weddingId || !guestId || !Array.isArray(tables)) throw new Error("Invitation unavailable.");
    return firestore.runTransaction(db, async (transaction) => {
      const refs = invitationRefs(firestore, db, weddingId, guestId);
      const [secretSnapshot, guestSnapshot] = await Promise.all([
        transaction.get(refs.secret), transaction.get(refs.guest),
      ]);
      if (!guestSnapshot.exists()) throw new Error("Invitation unavailable.");
      // Use the already-loaded event snapshot. Seating-only accounts can read
      // their authorized guests but must not gain access to the private parent
      // event document merely to prepare an invitation projection. Rules verify
      // the event still exists on every token/projection write.
      const wedding = { ...weddingData, id: weddingId };
      const sourceGuest = { ...guestSnapshot.data(), id: guestSnapshot.id };
      const secret = snapshotData(secretSnapshot) || {};

      if (action === "revoke") {
        if (!secretSnapshot.exists() || secret.status !== "active" || !isValidInvitationToken(secret.token)) return "";
        const tokenRefs = invitationRefs(firestore, db, weddingId, guestId, secret.token);
        const [indexSnapshot, publicSnapshot] = await Promise.all([
          transaction.get(tokenRefs.index), transaction.get(tokenRefs.public),
        ]);
        if (indexSnapshot.exists() && indexSnapshot.data().guestId === guestId) {
          transaction.update(tokenRefs.index, { status: "revoked", updatedAt: firestore.serverTimestamp() });
        }
        if (publicSnapshot.exists()) transaction.delete(tokenRefs.public);
        transaction.update(refs.secret, {
          status: "revoked", version: Number(secret.version || 0) + 1, updatedAt: firestore.serverTimestamp(),
        });
        return "";
      }

      if (action === "ensure" && secretSnapshot.exists() && secret.status === "revoked") {
        throw new Error("Invitation unavailable.");
      }
      if (action === "ensure" && secretSnapshot.exists() &&
          (secret.status !== "active" || !isValidInvitationToken(secret.token))) {
        throw new Error("Invitation unavailable.");
      }

      const oldToken = secret.status === "active" && isValidInvitationToken(secret.token) ? secret.token : "";
      const oldRefs = oldToken ? invitationRefs(firestore, db, weddingId, guestId, oldToken) : null;
      const oldSnapshots = oldRefs ? await Promise.all([
        transaction.get(oldRefs.index), transaction.get(oldRefs.public),
      ]) : [];
      const oldIndex = oldSnapshots.length ? snapshotData(oldSnapshots[0]) : null;
      const oldPublic = oldSnapshots.length ? snapshotData(oldSnapshots[1]) : null;

      if (action === "ensure" && oldToken) {
        if (!oldIndex || oldIndex.status !== "active" || oldIndex.guestId !== guestId ||
            !oldPublic || oldPublic.eventId !== weddingId) {
          // A missing or revoked capability must not be resurrected by Copy.
          // Use the explicit organizer regenerate action to issue a new token.
          throw new Error("Invitation unavailable.");
        }
        const projection = buildInvitationProjection(weddingId, wedding, sourceGuest, tables, { canonicalLayout: scope.customer === true });
        // Touch the private binding on each successful copy. Apart from keeping
        // the transaction auditable, this makes Firestore rules recheck event
        // existence even when the token and projection are already current.
        transaction.update(refs.secret, {
          ...(secret.expiresAt !== null ? { expiresAt: null } : {}),
          updatedAt: firestore.serverTimestamp(),
        });
        if (oldIndex.expiresAt !== null) {
          transaction.update(oldRefs.index, { expiresAt: null, updatedAt: firestore.serverTimestamp() });
        }
        if (JSON.stringify(oldPublic.wedding) !== JSON.stringify(projection.wedding) ||
            JSON.stringify(oldPublic.guest) !== JSON.stringify(projection.guest) ||
            oldPublic.expiresAt !== null) {
          transaction.update(oldRefs.public, {
            ...projection, expiresAt: null, updatedAt: firestore.serverTimestamp(),
          });
        }
        return oldToken;
      }

      if (action === "regenerate" && secret.status === "active" && secret.lastIssueRequestId === requestId && oldToken &&
          oldIndex?.status === "active" && oldIndex.guestId === guestId && oldPublic?.eventId === weddingId) {
        return oldToken;
      }

      const nextToken = tokenFactory();
      if (!isValidInvitationToken(nextToken)) throw new Error("Invitation unavailable.");
      if (nextToken === oldToken) throw new Error("Invitation unavailable.");
      const nextRefs = invitationRefs(firestore, db, weddingId, guestId, nextToken);
      const [nextIndexSnapshot, nextPublicSnapshot] = await Promise.all([
        transaction.get(nextRefs.index), transaction.get(nextRefs.public),
      ]);
      if (nextIndexSnapshot.exists() || nextPublicSnapshot.exists()) throw new Error("Invitation unavailable.");

      if (oldToken && oldToken !== nextToken) {
        if (oldIndex && oldIndex.guestId === guestId) {
          transaction.update(oldRefs.index, { status: "revoked", updatedAt: firestore.serverTimestamp() });
        }
        if (oldPublic) transaction.delete(oldRefs.public);
      }

      const version = Number(secret.version || 0) + (nextToken === oldToken ? 0 : 1);
      const projection = buildInvitationProjection(weddingId, wedding, sourceGuest, tables, { canonicalLayout: scope.customer === true });
      const publicData = {
        ...projection,
        rsvpStatus: ["confirmed", "declined"].includes(sourceGuest.rsvpStatus) ? sourceGuest.rsvpStatus : "pending",
        additionalGuests: Math.max(0, Math.min(10, Number(sourceGuest.additionalGuests) || 0)),
        rsvpMessage: typeof sourceGuest.rsvpMessage === "string" ? sourceGuest.rsvpMessage.slice(0, 1000) : "",
        expiresAt: null,
        updatedAt: firestore.serverTimestamp(),
      };
      transaction.set(refs.secret, {
        token: nextToken, status: "active", purpose: "guest-invitation", version,
        expiresAt: null, createdAt: secret.createdAt || firestore.serverTimestamp(),
        updatedAt: firestore.serverTimestamp(), ...(requestId ? { lastIssueRequestId: requestId } : {}),
      });
      transaction.set(nextRefs.index, {
        guestId, status: "active", purpose: "guest-invitation", version,
        expiresAt: null, createdAt: firestore.serverTimestamp(), updatedAt: firestore.serverTimestamp(),
      });
      transaction.set(nextRefs.public, publicData);
      return nextToken;
    });
  }

  return Object.freeze({ ensure, regenerate, revoke });
}
