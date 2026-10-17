export const DEFAULT_FIREBASE_APP_NAME = "[DEFAULT]";

export function resolveFirebaseApp({ getApps, initializeApp }, config, name = DEFAULT_FIREBASE_APP_NAME) {
  const existing = getApps().find((app) => app.name === name);
  if (existing) return existing;
  return name === DEFAULT_FIREBASE_APP_NAME
    ? initializeApp(config)
    : initializeApp(config, name);
}

export function createScopedServiceCache() {
  const scopes = new Map();
  return {
    get(scope, createServices) {
      if (!scopes.has(scope)) scopes.set(scope, createServices());
      return scopes.get(scope);
    },
  };
}

export function initializeFirebaseServicesForRoute(route, initializers) {
  // Every signed-in workspace uses the same named, tab-scoped password session.
  // Event membership documents, never a URL role hint, determine access.
  return initializers.dashboard();
}

export function buildAuthRouteUrl(base, { weddingId = "", side = "", message = "", demo = false, workspace = "" } = {}) {
  const params = new URLSearchParams();
  if (weddingId) params.set("wedding", weddingId);
  if (["bride", "groom", "family"].includes(side)) params.set("side", side);
  if (demo) params.set("demo", "1");
  if (workspace === "side") params.set("workspace", "side");
  if (message) params.set("message", message);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export async function waitForFirebaseSessionPersistence(services) {
  await services.persistenceReady;
  return services;
}
