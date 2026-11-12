export function buildSatelliteMapEmbedUrl(wedding, apiKey) {
  const suppliedUrl = String(wedding?.venueMapEmbedUrl || "").trim();
  if (suppliedUrl) {
    try {
      const url = new URL(suppliedUrl);
      if (url.protocol === "https:" && url.hostname === "www.google.com" &&
          url.pathname === "/maps/embed" && url.searchParams.has("pb")) {
        return url.toString();
      }
    } catch {
      // An invalid saved embed URL falls through to the configured API path.
    }
  }
  const key = String(apiKey || "").trim();
  const venue = String(wedding?.venueEn || wedding?.venueName || "").trim();
  const placeId = String(wedding?.venuePlaceId || "").trim();
  const query = String(wedding?.venueMapQuery || [venue, wedding?.locationEn].filter(Boolean).join(", ")).trim();
  if (!key || !venue || (!placeId && !query)) return "";
  const parameters = new URLSearchParams({
    key,
    q: placeId ? `place_id:${placeId}` : query,
    maptype: "satellite",
    zoom: "16",
  });
  return `https://www.google.com/maps/embed/v1/place?${parameters}`;
}

// Keyless Google Maps embed for designs that opt in (invitationDesign.keylessMapPreview).
// Used only when no API key or saved /maps/embed URL is available. Returns "" when
// there is nothing to search for. Hostname and path are fixed; only q/z/t vary.
export function buildKeylessMapEmbedUrl(wedding) {
  const venue = String(wedding?.venueEn || wedding?.venueName || "").trim();
  const query = String(wedding?.venueMapQuery || [venue, wedding?.locationEn].filter(Boolean).join(", ")).trim();
  const placeId = String(wedding?.venuePlaceId || "").trim();
  if (!query && !placeId) return "";
  const parameters = new URLSearchParams({ q: placeId ? `place_id:${placeId}` : query, z: "15", t: "m", output: "embed" });
  return `https://www.google.com/maps?${parameters}`;
}
