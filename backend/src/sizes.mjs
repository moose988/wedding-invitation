// Pure sizing rules with no imports, so the frontend can mirror this file as is. "GB" means GiB, as everywhere else here.
export const BUCKET_SIZES_GB = Object.freeze([15, 20, 25, 30, 35, 40, 45, 50]);
export const DEMO_SIZE_GB = 1;
export const DEMO_EXPIRY_HOURS = Object.freeze([6, 12, 24, 48, 72, 168]);
export const DEFAULT_DEMO_EXPIRY_HOURS = 24;
export const OVERDUE_HOURS = 48;

export const bytesForGb = gb => gb * 1024 ** 3;
export const isAllowedSize = gb => BUCKET_SIZES_GB.includes(gb);
// About 3 MB per photo, minus a 20% safety margin. An estimate for people, never a limit: only bytes are enforced.
export const estimatePhotos = gb => Math.floor(gb * 1024 / 3 * 0.8);

// Overdue is measured from the END of the event date (UTC) so a late-evening party is never flagged inside its 48 hours.
// It only drives an admin flag. Nothing deletes a non-demo bucket because of it.
export function overdueInfo(date, now = Date.now()) {
  const start = Date.parse(date);
  if (!Number.isFinite(start)) return { overdue: false, overdueAt: null };
  const overdueAt = start + (24 + OVERDUE_HOURS) * 3600 * 1000;
  return { overdue: now > overdueAt, overdueAt };
}
