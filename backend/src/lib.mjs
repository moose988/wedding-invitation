import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Per-photo limits. Bucket sizes live in sizes.mjs.
export const LIMITS = Object.freeze({
  fileBytes: 20 * 1024 * 1024,
  thumbBytes: 300 * 1024,
  pixels: 40_000_000,
  edge: 2560,
  guestTokenSeconds: 120 * 24 * 3600,
  headerProbeBytes: 128 * 1024, // first ranged read of an upload; enough for every browser-made JPEG
  headerMaxBytes: 1024 * 1024, // one retry with this much for JPEGs with long metadata; beyond it the upload is refused
  tailBytes: 64, // last bytes read to find the end-of-image marker
  pageDefault: 100,
  pageMax: 200,
  maxOwners: 20,
});

export class HttpError extends Error {
  constructor(status, message, code = 'ERROR', retryAfter) { super(message); this.status = status; this.code = code; this.retryAfter = retryAfter; }
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

// Walk JPEG segments to the first start-of-frame marker. Returns { width, height }, 'truncated' if the frame header
// lies beyond this buffer, or null when this is not a real JPEG.
export function scanJpeg(buffer) {
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
      if (i + 9 > buffer.length) return 'truncated';
      const height = buffer.readUInt16BE(i + 5), width = buffer.readUInt16BE(i + 7);
      return width && height ? { width, height } : null;
    }
    i += 2 + length;
  }
  return 'truncated';
}
export function jpegSize(buffer) { const size = scanJpeg(buffer); return size === 'truncated' ? null : size; }

export function assertPhotoHeader(header, bytes, { maxBytes = LIMITS.fileBytes, maxEdge = LIMITS.edge } = {}) {
  if (!bytes || bytes > maxBytes) throw new HttpError(400, 'The photo is empty or too large.', 'INVALID_PHOTO');
  const size = jpegSize(header);
  if (!size) throw new HttpError(400, 'The upload is not a valid JPEG photo.', 'INVALID_PHOTO');
  if (Math.max(size.width, size.height) > maxEdge || size.width * size.height > LIMITS.pixels) throw new HttpError(400, 'The photo dimensions are too large.', 'INVALID_PHOTO');
  return size;
}

// A whole JPEG ends with the end-of-image marker FFD9, at most followed by zero padding. A body cut short does not.
// Browsers' canvas encoders always write it. Catches truncated uploads, not every corruption: the backup finds those.
export function hasJpegEnd(tail) {
  if (!tail?.length) return false;
  let end = tail.length;
  while (end > 0 && tail[end - 1] === 0) end -= 1;
  return end >= 2 && tail[end - 2] === 0xff && tail[end - 1] === 0xd9;
}

// Guest display names: control characters removed, trimmed, cut to 40. Empty means none.
export const GUEST_NAME_MAX = 40;
export function cleanGuestName(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new HttpError(400, 'Your name must be text.', 'INVALID_NAME');
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, GUEST_NAME_MAX).trim();
}

// Same rule as Firestore document ids (api/_lib/customer-access.js validEventId), plus no control characters, which
// S3 keys and logs should never carry.
export const validEventId = id => typeof id === 'string' && id.length >= 1 && id.length <= 128 && !id.includes('/') && id !== '.' && id !== '..' && !/^__.*__$/.test(id) && !/[\u0000-\u001f\u007f]/.test(id);
export const SONG_MAX_BYTES = 15 * 1024 * 1024;
// Firestore reserves __...__ ids, so the lifecycle prefix cannot contain a real event's song.
export const songUploadKey = (eventId, uploadId) => `audio/__uploads__/${eventId}/${uploadId}.mp3`;
export const songKey = (eventId, uploadId, revision) => `audio/${eventId}/${uploadId}-${revision}.mp3`;

// MP3 checks on the first bytes only. id3Skip says where audio frames start after an optional ID3v2 tag.
export function id3Skip(head) {
  if (head.length < 10 || head.toString('latin1', 0, 3) !== 'ID3') return 0;
  const size = ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f);
  return 10 + size + (head[5] & 0x10 ? 10 : 0);
}
const MP3_BITRATES = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
const MP3_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
// Length of the MPEG Layer III frame starting at i, or 0 if there is no valid frame header there.
export function mp3FrameLength(buf, i = 0) {
  if (i + 4 > buf.length || buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) return 0;
  const version = (buf[i + 1] >> 3) & 3, layer = (buf[i + 1] >> 1) & 3, rateIndex = (buf[i + 2] >> 2) & 3, bitIndex = buf[i + 2] >> 4;
  if (version === 1 || layer !== 1 || rateIndex === 3 || bitIndex === 0 || bitIndex === 15) return 0;
  const kbps = MP3_BITRATES[version === 3 ? 1 : 2][bitIndex], rate = MP3_RATES[version][rateIndex], padding = (buf[i + 2] >> 1) & 1;
  return Math.floor(((version === 3 ? 144000 : 72000) * kbps) / rate) + padding;
}
// Two consecutive valid frame headers: one alone could be chance bytes.
export function looksLikeMp3(frames) {
  const first = mp3FrameLength(frames, 0);
  return first > 4 && mp3FrameLength(frames, first) > 4;
}

export const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
export const validUid = value => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value);

// Server-made ids only. The demo- prefix is what the demo cleanup's IAM policy is scoped to, so no other id may carry it.
export const DEMO_ID = /^demo-[a-f0-9]{32}$/;
export const newBucketId = demo => `${demo ? 'demo' : 'b'}-${randomBytes(16).toString('hex')}`;
export const TOMBSTONE_ID = /^((?:b|demo)-[a-f0-9]{32})\/([a-zA-Z0-9_-]{1,80})\.([a-f0-9]{32})$/;
export const validBucketId = value => typeof value === 'string' && (DEMO_ID.test(value) || /^b-[a-f0-9]{32}$/.test(value));

// Every durable object lives under buckets/<id>/. Unfinished uploads sit under incoming/<id>/ because S3 lifecycle
// prefixes cannot contain a wildcard, and only a top-level prefix can expire them. Thumbnails do not end in .jpg, so
// the backup notification (suffix .jpg) never fires for them.
export const objectKeys = {
  incomingImage: (b, p, u) => `incoming/${b}/${p}/${u}.jpg`,
  incomingThumb: (b, p, u) => `incoming/${b}/${p}/${u}.thumb`,
  image: (b, p, u) => `buckets/${b}/photos/${p}/${u}.jpg`,
  thumb: (b, p, u) => `buckets/${b}/photos/${p}/${u}.thumb`,
  backup: (b, p, u) => `buckets/${b}/backup/${p}/${u}.jpg`,
};
// Everything a guest's own photo occupies, for a permanent delete. The incoming keys hold noncurrent copies of the bytes.
export const photoObjects = (b, p, u) => ({
  photos: [objectKeys.image(b, p, u), objectKeys.thumb(b, p, u), objectKeys.incomingImage(b, p, u), objectKeys.incomingThumb(b, p, u)],
  backups: [objectKeys.backup(b, p, u)],
});
export function parseImageKey(key) {
  const m = String(key).match(/^buckets\/([a-z0-9-]+)\/photos\/([a-zA-Z0-9_-]{1,80})\/([a-f0-9]{32})\.jpg$/);
  return m && validBucketId(m[1]) ? { bucketId: m[1], photoId: m[2], uploadId: m[3] } : null;
}

export function cleanDetails(input) {
  const name = String(input?.name || '').trim(), date = String(input?.date || '').trim(), location = String(input?.location || '').trim();
  if (!name || name.length > 100 || !location || location.length > 160 || /[\u0000-\u001f]/.test(name + location)) throw new HttpError(400, 'Enter an event name (up to 100 characters) and location (up to 160 characters).', 'INVALID_DETAILS');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new HttpError(400, 'Choose a valid event date.', 'INVALID_DETAILS');
  return { name, date, location };
}
