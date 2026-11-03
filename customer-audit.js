// Best-effort trail of actions taken by signed-in customer accounts, stored in
// weddings/{event}/customerAudit and readable only by platform administrators.
// Guests, RSVPs and invitation activity are never recorded here.
//
// Limitation: the browser writes these entries, so a hostile client can omit
// them. Treat the trail as a record of cooperating clients, not as proof that
// nothing else happened.
//
// Call it after the customer's own write has succeeded and do not await it: the
// returned promise never rejects, and stays pending while the browser is offline.
// Pass the native Firestore API rather than the dashboard persistence wrapper, so
// an audit failure is never reported as a failed save.
const CODE_PATTERN = /^[a-z][a-z0-9_.-]*$/;
const MAX_ACTION = 64;
const MAX_TARGET_TYPE = 40;
const MAX_TARGET_ID = 200;
const MAX_SUMMARY = 500;

function clip(value, maxSize) {
  // Clip by code point so an emoji or Arabic text is never split into invalid text.
  return Array.from(String(value ?? "")).slice(0, maxSize).join("");
}

function validCode(value, maxSize) {
  return typeof value === "string" && value.length <= maxSize && CODE_PATTERN.test(value);
}

export function buildCustomerAuditEntry({ user, action, targetType, targetId = "", summary = "" }, createdAt) {
  if (!user?.uid) throw new Error("A signed-in user is required.");
  if (!validCode(action, MAX_ACTION) || !validCode(targetType, MAX_TARGET_TYPE)) {
    throw new Error("Audit action and targetType must be short lowercase codes.");
  }
  return {
    actorUid: user.uid,
    actorEmail: String(user.email || "").trim().toLowerCase(),
    action,
    targetType,
    targetId: clip(targetId, MAX_TARGET_ID),
    summary: clip(summary, MAX_SUMMARY),
    createdAt,
  };
}

// Resolves true when written and false when skipped or refused. Never throws.
export async function recordCustomerAudit({ api, db, weddingId, user, permissions, action, targetType, targetId, summary }) {
  try {
    if (permissions?.role !== "customer" || !weddingId) return false;
    const entry = buildCustomerAuditEntry({ user, action, targetType, targetId, summary }, api.serverTimestamp());
    await api.setDoc(api.doc(api.collection(db, "weddings", weddingId, "customerAudit")), entry);
    return true;
  } catch (error) {
    // The code alone is logged: entries can contain guest names.
    console.warn("Customer audit entry was not saved", error?.code || "unknown");
    return false;
  }
}
