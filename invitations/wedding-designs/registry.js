// Code-owned invitation routing. Add one entry whenever a wedding receives a
// bespoke public design. No Firestore field or dashboard control is required.
//
// The route must be relative to the hosting root so it works on the current
// Firebase Hosting site as well as local previews.
export const weddingDesignRegistry = {
  "luxury-wedding-demo": {
    designId: "layla-zaid",
    route: "./invitations/wedding-designs/layla-zaid/index.html",
    name: "Layla & Zaid Invitation",
  },
  "M1S1aBL9134GSAozWh6G": {
    designId: "ali-salma",
    route: "./invitations/wedding-designs/ali-salma/index.html",
    name: "Ali & Salma Invitation",
  },
};

// Template choices apply only when an event has no code-owned assignment.
// Never infer a filesystem path from persisted input.
export const weddingTemplateRegistry = Object.freeze({
  "layla-zaid": Object.freeze({ designId: "layla-zaid", route: "./invitations/wedding-designs/layla-zaid/index.html", name: "Floral Wedding" }),
  "moonlit-conservatory": Object.freeze({ designId: "moonlit-conservatory", route: "./invitations/wedding-designs/moonlit-conservatory/index.html", name: "Moonlit Conservatory" }),
  "pomegranate-courtyard": Object.freeze({ designId: "pomegranate-courtyard", route: "./invitations/wedding-designs/pomegranate-courtyard/index.html", name: "Pomegranate Courtyard" }),
  "mandoos": Object.freeze({ designId: "mandoos", route: "./invitations/wedding-designs/mandoos/index.html", name: "Mandoos" }),
});

export function getWeddingDesign(weddingId, invitationTemplate = "") {
  return (Object.hasOwn(weddingDesignRegistry, weddingId) ? weddingDesignRegistry[weddingId] : null) || (Object.hasOwn(weddingTemplateRegistry, invitationTemplate) ? weddingTemplateRegistry[invitationTemplate] : null);
}

export function getInvitationRoute(weddingId, baseUrl = window.location.href, invitationTemplate = "") {
  const design = getWeddingDesign(weddingId, invitationTemplate);
  return design ? new URL(design.route, baseUrl) : null;
}
