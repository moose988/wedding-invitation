import { getInvitationRoute } from "./wedding-designs/registry.js";

// `index.html` remains the compatibility-safe public entry point used by
// existing dashboard, sender, QR, and WhatsApp links. It forwards only mapped
// weddings to a bespoke coded design and otherwise leaves the current fallback
// invitation untouched.
const params = new URLSearchParams(window.location.search);
const weddingId = params.get("wedding")?.trim();
const destination = weddingId ? getInvitationRoute(weddingId, window.location.href) : null;

if (destination) {
  destination.search = window.location.search;
  destination.hash = window.location.hash;
  if (destination.href !== window.location.href) {
    window.location.replace(destination.href);
  }
}
