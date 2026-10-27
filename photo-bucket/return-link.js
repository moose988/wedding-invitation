// After sign-in, the login page may send people back to ONE page only: a Photo Bucket management page on this site.
// Anything else (other sites, other pages, odd ids) is ignored so the link can never be used as an open redirect.
export function photoBucketReturn(raw, base) {
  try {
    if (!raw || raw.length > 300) return '';
    const url = new URL(raw, base);
    if (url.origin !== new URL(base).origin || !url.pathname.endsWith('/photo-bucket-manage.html')) return '';
    const id = url.searchParams.get('bucket');
    return /^[a-zA-Z0-9_-]{1,80}$/.test(id || '') ? `./photo-bucket-manage.html?bucket=${encodeURIComponent(id)}` : '';
  } catch { return ''; }
}
// Where to send a signed-out visitor so they come back here after signing in.
export const loginWithReturn = (page = location) => `./dashboard-login.html?message=session-required&next=${encodeURIComponent(page.pathname.split('/').pop() + page.search)}`;
// A customer with exactly one Photo Bucket skips the My Events list and opens it directly. Done once per sign-in
// so they can still return to My Events (for example if more events are added later).
export function autoOpenTarget({ customer, buckets, seen }) {
  const id = buckets?.length === 1 ? buckets[0].id : '';
  return customer && !seen && /^[a-zA-Z0-9_-]{1,80}$/.test(id || '') ? `./photo-bucket-manage.html?bucket=${encodeURIComponent(id)}` : '';
}
