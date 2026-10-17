// Run as a parser-blocking script in the document head. Module scripts are
// deferred until after HTML parsing, which let the generic invitation paint
// before the bespoke design redirect. Keep this map aligned with registry.js.
(() => {
  const routes = {
    "luxury-wedding-demo": "./invitations/wedding-designs/layla-zaid/index.html",
    "M1S1aBL9134GSAozWh6G": "./invitations/wedding-designs/ali-salma/index.html",
  };
  const params = new URLSearchParams(window.location.search);
  const weddingId = params.get("wedding")?.trim();
  const route = weddingId ? routes[weddingId] : null;
  if (!route) return;

  const destination = new URL(route, window.location.href);
  destination.search = window.location.search;
  destination.hash = window.location.hash;
  if (destination.href === window.location.href) return;

  // If navigation is delayed, keep the generic card from flashing underneath.
  document.documentElement.style.visibility = "hidden";
  window.location.replace(destination.href);
})();
