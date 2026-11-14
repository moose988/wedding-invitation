export const LIMITS = Object.freeze({
  // fileBytes: the processed photo sent to the server (backend limit). inputBytes: the photo a guest picks, which is
  // only read on the phone and always shrunk to a 2560 px JPEG first, so high-resolution camera modes fit.
  // pixels: the largest picture decoded at full size; bigger JPEGs (up to maxPixels) are decoded already scaled down.
  fileBytes: 20 * 1024 * 1024, inputBytes: 40 * 1024 * 1024, batch: 30, pixels: 40_000_000, maxPixels: 210_000_000,
  edge: 2560, thumbnail: 480, concurrency: 2,
  queuedBytes: 200 * 1024 * 1024, zipBytes: 128 * 1024 * 1024, zipCount: 500,
  types: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
});
export function validateFile(file) {
  if (!file?.size) throw new Error('This file is empty. Choose another photo.');
  if (file.size > LIMITS.inputBytes) throw new Error('Choose a photo smaller than 40 MB.');
  if (!LIMITS.types.includes(file.type)) throw new Error('Choose a JPEG, PNG, WebP or AVIF photo. HEIC is not converted; export it as JPEG first.');
}
export function friendlyError(error) {
  if (error?.code === 'BUCKET_FULL') return 'The photo collection for this event is full, so this photo was not added. Please let your host know. It stays on your phone and Retry will work once they add space.';
  if (error?.name === 'QuotaExceededError') return 'This device is out of storage. Free some browser storage, then retry.';
  if (['SecurityError', 'InvalidStateError'].includes(error?.name)) return 'This browser cannot save photos right now. Allow site storage or try a regular browser window, then retry.';
  return error?.message || 'Could not save on this device. Please try again.';
}
