// Dependency-free so other modules can use these without loading demo creation.
// tests/admin-shared-constants.test.mjs keeps the copies of the hours in step:
// backend/src/sizes.mjs and admin-api.js cannot import across deployments.
export const DEMO_EXPIRY_HOURS = Object.freeze([6, 12, 24, 48, 72, 168]);
export const DEFAULT_DEMO_HOURS = 24;
// Shorter cleanup secrets are treated as unset.
export const MIN_SECRET_LENGTH = 32;

export function isExpiredDemo(data, nowMs) {
  return data?.isDemo === true && typeof data.demoExpiresAt?.toMillis === 'function' && data.demoExpiresAt.toMillis() <= nowMs;
}
