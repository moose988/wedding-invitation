// Invitation credentials are stored in URL fragments. Vercel preview
// deployment protection redirects through SSO, which cannot reliably carry
// fragments across the authentication round trip. Keep local and custom-domain
// links local, but publish shareable links from this project's stable origin.
export const PUBLIC_SHARE_ORIGIN = "https://wedding-invitation-nlsf.vercel.app";

const VERCEL_PREVIEW_HOST = /^wedding-invitation-nlsf-.+\.vercel\.app$/i;

export function createShareUrl(path, baseHref = globalThis.location?.href) {
  if (!baseHref) throw new Error("A base URL is required to create a share link.");
  const base = new URL(baseHref);
  const isStablePublicOrigin = base.origin === PUBLIC_SHARE_ORIGIN;
  if (VERCEL_PREVIEW_HOST.test(base.hostname) && !isStablePublicOrigin) {
    base.href = new URL(path, `${PUBLIC_SHARE_ORIGIN}/`).href;
    return base;
  }
  return new URL(path, base);
}
