import { createShareUrl } from '../share-link.js';
// Guest page and A5 card themes: [stored value, admin label, card class]. Only admins choose one.
export const THEMES = [['olive', 'Olive garden', 'olive'], ['garden', 'Wedding garden', 'wedding'], ['memories', 'Wedding memories', 'memories'], ['twilight', 'Twilight romance', 'twilight'], ['gender_reveal', 'Gender reveal', 'gender-reveal']];
export const themeOf = bucket => THEMES.some(([value]) => value === bucket?.theme) ? bucket.theme : 'olive';
export function details(input) {
  const name = String(input?.name || '').trim();
  const date = String(input?.date || '').trim();
  const location = String(input?.location || '').trim();
  if (!name || name.length > 100 || !location || location.length > 160 || /[\u0000-\u001f]/.test(name + location)) throw new Error('Enter an event name (up to 100 characters) and location (up to 160 characters).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Choose a valid event date.');
  const theme = input?.theme;
  if (theme !== undefined && !THEMES.some(([value]) => value === theme)) throw new Error("Choose a valid theme.");
  return { name, date, location, ...(theme !== undefined ? { theme } : {}) };
}
export function validId(id) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id || '')) throw new Error('This photo link is incomplete or invalid. Ask your host for a new link.');
  return id;
}
export function guestUrl(bucket, base = globalThis.location.href, configured = globalThis.PHOTO_BUCKET_PUBLIC_ORIGIN) {
  let url = createShareUrl('photo-bucket', base);
  if (configured) {
    const origin = new URL(configured);
    if (origin.protocol !== 'https:' || origin.username || origin.password) throw new Error('The public origin must be an HTTPS URL.');
    url = new URL('/photo-bucket', origin.origin);
  }
  url.searchParams.set('bucket', validId(bucket.id));
  // Public display information only. No owner ID, token, guest identity or photo data.
  url.hash = 'event=' + encodeURIComponent(JSON.stringify({ v: 1, ...details(bucket) }));
  return url.href;
}
export function readGuestUrl(href) {
  const url = new URL(href);
  const id = validId(url.searchParams.get('bucket'));
  const raw = new URLSearchParams(url.hash.slice(1)).get('event');
  if (!raw || raw.length > 2000) throw new Error('Ask your host for the complete photo link.');
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error('This photo link is invalid. Ask your host for a new link.'); }
  if (value.v !== 1) throw new Error('This version of the photo link is not supported.');
  return { id, ...details(value) };
}
export function dateLabel(date) {
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));
}
export function isLoopback(href) { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(href).hostname); }
