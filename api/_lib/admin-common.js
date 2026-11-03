export class AdminError extends Error {
  constructor(status, code, message, extra = {}) { super(message); this.status = status; this.code = code; this.extra = extra; }
}

// Same check as customer-management.js: a revocation-checked ID token plus
// an enabled platformAdmins document.
export async function requireAdmin(auth, db, token) {
  if (!token) throw new AdminError(401, 'UNAUTHENTICATED', 'Sign in is required.');
  let caller;
  try { caller = await auth.verifyIdToken(token, true); } catch { throw new AdminError(401, 'UNAUTHENTICATED', 'Your session has expired. Sign in again.'); }
  const admin = await db.doc(`platformAdmins/${caller.uid}`).get();
  if (!admin.exists || admin.data().enabled !== true) throw new AdminError(403, 'ADMIN_ONLY', 'Administrator access is required.');
  return { uid: caller.uid, email: caller.email || '' };
}

export class BucketError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
  get retryable() { return this.status === 0 || this.status === 429 || (this.status >= 500 && this.status !== 507 && this.code !== 'BUCKET_FROZEN'); }
}

// Thin client for the admin routes in briefs/bucket-api-contract.md. getToken
// supplies a Firebase ID token whose uid is in the stack's ADMIN_UIDS.
export function createBucketClient({ baseUrl, getToken, fetchImpl = fetch, timeoutMs = 5000 }) {
  const base = String(baseUrl).replace(/\/+$/, '');
  async function call(method, path, body) {
    let response;
    try {
      const token = await getToken();
      response = await fetchImpl(`${base}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error instanceof BucketError) throw error;
      throw new BucketError(0, 'BUCKET_API_UNREACHABLE', 'The photo bucket service could not be reached.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new BucketError(response.status, data.code || 'BUCKET_API_ERROR', data.error || 'The photo bucket service refused the request.');
    return data;
  }
  const segment = encodeURIComponent;
  return {
    createDemo: ({ name, date, location, owners, expiresInHours }) => call('POST', '/owner/create', { name, date, location, demo: true, owners, expiresInHours }),
    addOwner: (id, uid) => call('POST', `/b/${segment(id)}/owners`, { uid }),
    removeOwner: (id, uid) => call('DELETE', `/b/${segment(id)}/owners/${segment(uid)}`),
    deleteBucket: (id) => call('DELETE', `/b/${segment(id)}?confirm=${segment(id)}`),
    async listOwned(uid) {
      const items = [];
      let cursor = null;
      // Paging is capped so a misbehaving service cannot hold the function open;
      // reaching the cap is an error, because a partial list could hide an event.
      for (let page = 0; page < 20; page += 1) {
        const data = await call('GET', `/owner/list?uid=${segment(uid)}&limit=50${cursor ? `&cursor=${segment(cursor)}` : ''}`);
        items.push(...(data.items || []));
        cursor = data.nextCursor;
        if (!cursor) return items;
      }
      throw new BucketError(0, 'BUCKET_LIST_TOO_LONG', 'The photo bucket list could not be read completely.');
    },
  };
}

// A scheduler has no signed-in admin, but the bucket API only accepts Firebase ID
// tokens. This mints one for an operator-chosen admin uid. The token stays in
// memory and is only sent to the configured bucket API.
export function serviceTokenProvider({ auth, uid, apiKey, fetchImpl = fetch }) {
  let pending;
  return () => {
    pending ||= (async () => {
      const customToken = await auth.createCustomToken(uid);
      const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
      const origin = emulator ? `http://${emulator}/identitytoolkit.googleapis.com` : 'https://identitytoolkit.googleapis.com';
      const response = await fetchImpl(`${origin}/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }),
        signal: AbortSignal.timeout(5000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.idToken) throw new BucketError(0, 'SERVICE_TOKEN_FAILED', 'The cleanup service account could not sign in.');
      return data.idToken;
    })().catch((error) => { pending = undefined; throw error instanceof BucketError ? error : new BucketError(0, 'SERVICE_TOKEN_FAILED', 'The cleanup service account could not sign in.'); });
    return pending;
  };
}

// Vercel parses the JSON body lazily, so a malformed one throws on first read.
export function readBody(req) {
  let body;
  try { body = req.body; } catch { throw new AdminError(400, 'INVALID_JSON', 'The request body is not valid JSON.'); }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
}

export function bearerFrom(req) { return /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1] || ''; }

export function sendError(res, error, label) {
  if (error instanceof AdminError) return res.status(error.status).json({ error: error.message, code: error.code, ...error.extra });
  // Code or name only: never the message, which could quote request data.
  console.error(`${label} failed:`, error?.code || error?.name);
  return res.status(500).json({ error: 'The operation could not be completed. Please retry.', code: 'INTERNAL' });
}
