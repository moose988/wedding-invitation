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
  const restrictedSeatingRoute = route.seatingOnly === true || route.seatingEditor === true;
  return restrictedSeatingRoute ? initializers.seating() : initializers.dashboard();
}

export function buildAuthRouteUrl(base, { weddingId = "", seatingOnly = false, side = "", message = "", demo = false } = {}) {
  const params = new URLSearchParams();
  if (weddingId) params.set("wedding", weddingId);
  if (seatingOnly) params.set("seatingOnly", "1");
  if (["bride", "groom", "family"].includes(side)) params.set("side", side);
  if (demo) params.set("demo", "1");
  if (message) params.set("message", message);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export async function waitForFirebaseSessionPersistence(services) {
  await services.persistenceReady;
  return services;
}
