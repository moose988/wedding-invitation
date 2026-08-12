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

export function getWeddingDesign(weddingId) {
  return weddingDesignRegistry[weddingId] || null;
}

export function getInvitationRoute(weddingId, baseUrl = window.location.href) {
  const design = getWeddingDesign(weddingId);
  return design ? new URL(design.route, baseUrl) : null;
}
