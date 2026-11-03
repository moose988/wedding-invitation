// Mirror of backend/src/sizes.mjs (the sizing subset the UI needs). Keep in step; tests/photo-bucket-w5.test.mjs checks it.
export const BUCKET_SIZES_GB = Object.freeze([15, 20, 25, 30, 35, 40, 45, 50]);
export const DEFAULT_BUCKET_GB = 15;
export const estimatePhotos = gb => Math.floor(gb * 1024 / 3 * 0.8);
// Friendly figure for people: rounded down to the nearest 100, e.g. 15 GB -> 4,000.
export const estimateLabel = gb => `About ${(Math.floor(estimatePhotos(gb) / 100) * 100).toLocaleString('en-US')} photos`;
