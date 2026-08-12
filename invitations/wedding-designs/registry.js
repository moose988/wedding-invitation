// Code-owned invitation routing. Add one entry whenever a wedding receives a
// bespoke public design. No Firestore field or dashboard control is required.
//
// The route must be relative to the hosting root so it works on the current
// Firebase Hosting site as well as local previews.
export const weddingDesignRegistry = {
  "luxury-wedding-demo": {
    designId: "example-custom-wedding",
    route: "./invitations/wedding-designs/example-custom-wedding/index.html",
    name: "Example Custom Wedding Invitation",
  },
};

export function getWeddingDesign(weddingId) {
  return weddingDesignRegistry[weddingId] || null;
}

export function getInvitationRoute(weddingId, baseUrl = window.location.href) {
  const design = getWeddingDesign(weddingId);
  return design ? new URL(design.route, baseUrl) : null;
}
