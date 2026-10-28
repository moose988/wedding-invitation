// Run as a parser-blocking script in the document head. Module scripts are
// deferred until after HTML parsing, which let the generic invitation paint
// before the bespoke design redirect. Keep this map aligned with registry.js.
(() => {
  const routes = {
    "luxury-wedding-demo": "./invitations/wedding-designs/layla-zaid/index.html",
    "M1S1aBL9134GSAozWh6G": "./invitations/wedding-designs/ali-salma/index.html",
  };
  const params = new URLSearchParams(window.location.search);
  const fragment = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
  const weddingId = params.get("wedding")?.trim();
  const pathname = new URL(window.location.href).pathname;
  // Only public entry points may route to a design. Login/sign-out context
  // never becomes an invitation credential, even if an event ID is retained.
  const publicEntry = pathname === "/" || pathname === "/index.html";
  const legacyTokenEntry = /\/dashboard-login(\.html)?$/.test(pathname) && Boolean(fragment.get("guest")) && !params.has("message");
  if (!publicEntry && !legacyTokenEntry) return;
  const isPlannerLogin = /\/dashboard-login(\.html)?$/.test(pathname);
  // The login page also receives legacy session-required URLs containing an
  // event ID. Only treat it as an invitation entry when its bearer fragment
  // is present; preserve organizer sign-in flows otherwise.
  if (isPlannerLogin && !fragment.get("guest")) return;
  const route = weddingId ? routes[weddingId] : null;
  if (!route) {
    // Resolve the event-selected design before revealing the generic invitation.
    if (publicEntry && weddingId && fragment.get("guest")) document.documentElement.style.visibility = "hidden";
    return;
  }

  const destination = new URL(route, window.location.href);
  destination.search = window.location.search;
  destination.hash = window.location.hash;
  if (destination.href === window.location.href) return;

  // If navigation is delayed, keep the generic card from flashing underneath.
  document.documentElement.style.visibility = "hidden";
  window.location.replace(destination.href);
})();
