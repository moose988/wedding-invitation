export const EVENT_CATEGORIES = Object.freeze({
  WEDDING_ENGAGEMENT: "wedding_engagement",
  CELEBRATION: "celebration",
});

export function getEventCategory(event) {
  return event?.eventCategory === EVENT_CATEGORIES.CELEBRATION
    ? EVENT_CATEGORIES.CELEBRATION
    : EVENT_CATEGORIES.WEDDING_ENGAGEMENT;
}

export function isWeddingEvent(event) {
  return getEventCategory(event) === EVENT_CATEGORIES.WEDDING_ENGAGEMENT;
}

export function isCelebrationEvent(event) {
  return getEventCategory(event) === EVENT_CATEGORIES.CELEBRATION;
}

export function getEventDisplayTitle(event) {
  const title = String(event?.eventTitle || "").trim();
  if (title) return title;
  if (isCelebrationEvent(event)) return "Untitled event";
  const coupleName = String(event?.coupleName || "").trim();
  if (coupleName) return coupleName;
  const brideName = String(event?.brideName || "").trim();
  const groomName = String(event?.groomName || "").trim();
  const names = [brideName, groomName].filter(Boolean).join(" & ");
  return names || "Untitled event";
}

export function getDefaultGuestSide(event) {
  return isCelebrationEvent(event) ? "general" : "bride";
}

export function eventUsesGuestSides(event) {
  return isWeddingEvent(event);
}
