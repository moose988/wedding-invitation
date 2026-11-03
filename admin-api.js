// Small helpers for the platform-admin pages. No Firebase import, so they can be
// tested in Node. Everything that reaches the page as HTML goes through esc().
export const esc = value => String(value ?? "").replace(/[&<>"'`]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#096;" })[c]);

export const DEMO_TYPES = Object.freeze([
  { value: "wedding_engagement", label: "Wedding / Engagement", note: "An event with guests, invitations and seating." },
  { value: "celebration", label: "Celebration", note: "Birthdays, graduations and other occasions." },
  { value: "gender_reveal", label: "Gender Reveal Party", note: "Shared invitation and RSVP." },
  { value: "photo_bucket", label: "Photo Bucket", note: "A 1 GB photo bucket." },
]);
export const DEMO_DURATIONS = Object.freeze([
  { hours: 6, label: "6 hours" }, { hours: 12, label: "12 hours" }, { hours: 24, label: "24 hours" },
  { hours: 48, label: "2 days" }, { hours: 72, label: "3 days" }, { hours: 168, label: "7 days" },
]);
export const DEFAULT_DEMO_HOURS = 24;
export const DEMO_NOTICE = "Demo photo buckets hold 1 GB. Each demo's access ends at the time you choose when you create it, and its data and sign-in account are removed soon after.";
export const demoDurationLabel = hours => DEMO_DURATIONS.find(d => d.hours === Number(hours))?.label || "";
export const OVERDUE_HOURS = 48;

// Turns a failed call into a message that says what failed and what to do. The three setup problems
// (server function missing, server not configured, server not reachable) are named exactly.
export function explainFailure({ status = 0, code = "", message = "", what = "The request" } = {}) {
  if (!status) return `${what} could not reach the server. Check your internet connection and try again. If it keeps failing, contact an admin.`;
  if (status === 404) return `Server setup is incomplete: ${what} needs a server function that was not found on this site. Contact an admin.`;
  if (status === 503 || /NOT_CONFIGURED|UNCONFIGURED/.test(code)) return `Server setup is incomplete: ${message || "a required setting is missing on the server"}. Contact an admin.`;
  if (status === 401) return "Your session has expired. Sign in again and retry.";
  if (status === 403 || code === "ADMIN_ONLY") return `${what} was refused: this account is not recognised as an admin by the server. Contact an admin.`;
  if (status >= 500) return `${what} failed on the server${code ? ` (${code})` : ""}. Try again in a minute; if it keeps failing, contact an admin.`;
  return message || `${what} failed (${status}). Check the details and try again.`;
}

// POST JSON with the admin's ID token. Throws an Error whose message is already explained, and that carries code, status and data.
export async function adminPost(auth, path, body, fetchImpl = globalThis.fetch, { what = "This action", method = "POST" } = {}) {
  const token = await auth.currentUser.getIdToken();
  let response;
  try { response = await fetchImpl(path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }) }); }
  catch { throw Object.assign(new Error(explainFailure({ what })), { code: "NETWORK", status: 0, data: null }); }
  let data = null;
  try { data = await response.json(); } catch { /* not JSON: handled below */ }
  if (!response.ok || data === null) {
    // A page or empty body instead of JSON means the function is not there (a static host answers every path).
    const status = response.ok ? 404 : response.status;
    throw Object.assign(new Error(explainFailure({ status, code: data?.code || "", message: data?.error || "", what })), { code: data?.code || "", status, data });
  }
  return data;
}

// Reads the admin health report. Accepts { checks: [{ name, ok, message }] } or { checks: { name: { ok, message } } }.
export function failedChecks(report) {
  const raw = report?.checks;
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.entries(raw).map(([name, value]) => ({ name, ...(typeof value === "object" ? value : { ok: value === true || value === "ok" }) })) : [];
  const failures = list.filter(c => c.ok === false || c.status === "fail" || c.status === "failed").map(c => ({ name: String(c.name || c.id || "check"), message: String(c.message || c.error || c.detail || "") }));
  if (!failures.length && report?.ok === false) failures.push({ name: "server", message: String(report.error || "The server reports a problem.") });
  return failures;
}

export function formatCountdown(expiresAtMs, now = Date.now()) {
  const left = Number(expiresAtMs) - now;
  if (!Number.isFinite(left)) return "";
  if (left <= 0) return "Expired";
  const s = Math.floor(left / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s % 60).padStart(2, "0")}s left`;
}

// A bucket is overdue when more than 48 hours have passed since the END of its event date (UTC).
// The server flag wins when present; the date is the fallback.
export function bucketOverdue(bucket, now = Date.now()) {
  if (!bucket || bucket.demo) return false;
  if (typeof bucket.overdue === "boolean") return bucket.overdue;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bucket.date || "");
  if (!match) return false;
  const endOfDay = Date.UTC(+match[1], +match[2] - 1, +match[3]) + 86_400_000;
  return now > endOfDay + OVERDUE_HOURS * 3_600_000;
}

const OK = { linked: "Linked", already_linked: "Already a customer", preserved: "Already has access", unlinked: "Access removed", not_linked: "Was not linked" };
const FAIL = { EVENT_NOT_FOUND: "Event not found", EVENT_DELETING: "Event is being deleted", EVENT_EXPIRED: "Event has expired", PRESERVED_ROLE: "Owner or staff role, not removed here", NOT_ATTEMPTED: "Ran out of time, try again", BUCKET_API_UNCONFIGURED: "Photo bucket service is not set up", TOO_MANY_OWNERS: "Bucket already has 20 owners", BUCKET_NOT_FOUND: "Bucket not found", ADMIN_ONLY: "Bucket service does not recognise this admin" };
export function describeTargetResult(result) {
  if (result?.ok) return OK[result.status] || "Done";
  return FAIL[result?.code] || result?.error || "Failed";
}
export const targetRetryable = result => result?.ok !== true && result?.retryable === true;

export function timeText(value) {
  const ms = value?.toMillis?.() ?? (typeof value?.seconds === "number" ? value.seconds * 1000 : Number(value) || 0);
  return ms ? new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Unknown time";
}
