// Gender reveal invitation designs. The classic design keeps its original
// public URL (/gender-reveal.html); newer designs live beside this file.
// The organizer's choice is stored on the private event as genderRevealTemplate,
// so the dashboards build the shared link from it.
export const DEFAULT_GENDER_REVEAL_TEMPLATE = "gender-reveal-classic";

export const GENDER_REVEAL_DESIGNS = Object.freeze({
  "gender-reveal-classic": Object.freeze({ designId: "gender-reveal-classic", route: "./gender-reveal.html", name: "Little Surprise" }),
  "petit-nuage": Object.freeze({ designId: "petit-nuage", route: "./invitations/gender-reveal-designs/petit-nuage/index.html", name: "Petit Nuage" }),
});

export function getGenderRevealDesign(templateId) {
  const id = typeof templateId === "string" ? templateId : "";
  return Object.hasOwn(GENDER_REVEAL_DESIGNS, id) ? GENDER_REVEAL_DESIGNS[id] : GENDER_REVEAL_DESIGNS[DEFAULT_GENDER_REVEAL_TEMPLATE];
}

// base is the URL of a page at the site root (the dashboards are), as in the
// original links, which resolve "gender-reveal.html" against location.href.
export function genderRevealInvitationUrl(eventId, templateId, base = globalThis.location?.href) {
  const url = new URL(getGenderRevealDesign(templateId).route, base);
  url.searchParams.set("wedding", String(eventId || ""));
  return url.href;
}
