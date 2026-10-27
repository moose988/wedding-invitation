export const LIMITS = Object.freeze({
  fileBytes: 20 * 1024 * 1024, batch: 30, pixels: 40_000_000,
  edge: 2560, thumbnail: 480, concurrency: 2,
  queuedBytes: 200 * 1024 * 1024, zipBytes: 128 * 1024 * 1024, zipCount: 500,
  types: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
});
export function validateFile(file) {
  if (!file?.size) throw new Error('This file is empty. Choose another photo.');
  if (file.size > LIMITS.fileBytes) throw new Error('Choose a photo smaller than 20 MB.');
  if (!LIMITS.types.includes(file.type)) throw new Error('Choose a JPEG, PNG, WebP or AVIF photo. HEIC is not converted; export it as JPEG first.');
}
export function friendlyError(error) {
  if (error?.name === 'QuotaExceededError') return 'This device is out of storage. Free some browser storage, then retry.';
  if (['SecurityError', 'InvalidStateError'].includes(error?.name)) return 'This browser cannot save photos right now. Allow site storage or try a regular browser window, then retry.';
  return error?.message || 'Could not save on this device. Please try again.';
}
