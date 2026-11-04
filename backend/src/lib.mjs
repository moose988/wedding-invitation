import { createHmac, timingSafeEqual } from 'node:crypto';

// One deployment serves one event. Sizes are GiB, shown to people as "GB".
export const LIMITS = Object.freeze({
  fileBytes: 20 * 1024 * 1024,
  thumbBytes: 300 * 1024,
  pixels: 40_000_000,
  edge: 2560,
  usableBytes: 15 * 1024 ** 3,
  backupBytes: 9 * 1024 ** 3,
  guestTokenSeconds: 120 * 24 * 3600,
});

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const b64 = buffer => Buffer.from(buffer).toString('base64url');

export function signGuestToken(secret, bucketId, contributorId, now = Date.now()) {
  const body = b64(JSON.stringify({ b: bucketId, c: contributorId, exp: Math.floor(now / 1000) + LIMITS.guestTokenSeconds }));
  return `g.${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

export function verifyGuestToken(secret, token, now = Date.now()) {
  const [prefix, body, signature] = String(token).split('.');
  if (prefix !== 'g' || !body || !signature) return null;
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (typeof claims.b !== 'string' || typeof claims.c !== 'string' || claims.exp * 1000 < now) return null;
    return { bucketId: claims.b, contributorId: claims.c };
  } catch { return null; }
}

// Walk JPEG segments to the first start-of-frame marker. Returns null unless this is a real JPEG.
export function jpegSize(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) return null;
  let i = 2;
  while (i + 4 <= buffer.length) {
    if (buffer[i] !== 0xff) return null;
    const marker = buffer[i + 1];
    if (marker === 0xff) { i += 1; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const length = buffer.readUInt16BE(i + 2);
    if (length < 2) return null;
    const baseline = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (baseline) {
      if (i + 9 > buffer.length) return null;
      const height = buffer.readUInt16BE(i + 5), width = buffer.readUInt16BE(i + 7);
      return width && height ? { width, height } : null;
    }
    i += 2 + length;
  }
  return null;
}

export function assertPhotoBytes(buffer, { maxBytes = LIMITS.fileBytes, maxEdge = LIMITS.edge } = {}) {
  if (!buffer.length || buffer.length > maxBytes) throw new HttpError(400, 'The photo is empty or too large.');
  const size = jpegSize(buffer);
  if (!size) throw new HttpError(400, 'The upload is not a valid JPEG photo.');
  if (Math.max(size.width, size.height) > maxEdge || size.width * size.height > LIMITS.pixels) throw new HttpError(400, 'The photo dimensions are too large.');
  return size;
}

export const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);

export function cleanDetails(input) {
  const name = String(input?.name || '').trim(), date = String(input?.date || '').trim(), location = String(input?.location || '').trim();
  if (!name || name.length > 100 || !location || location.length > 160 || /[\u0000-\u001f]/.test(name + location)) throw new HttpError(400, 'Enter an event name (up to 100 characters) and location (up to 160 characters).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new HttpError(400, 'Choose a valid event date.');
  return { name, date, location };
}
