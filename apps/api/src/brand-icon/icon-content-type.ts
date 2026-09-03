// SPO-374 F1: raster-only allowlist for icon bytes we serve back from our own
// origin. `image/svg+xml` (and any other markup/script-capable type) executes
// when rendered in a browser — apps/api/src/storage/mime.ts excludes it from
// ALLOWED_MIME_TYPES for the identical reason. Here it's worse: the endpoint's
// 200 response lands on the app's own origin via the `/api/*` Vercel rewrite
// (SPO-104), sits next to the session cookie, and gets cached for 28 days, so
// an attacker-controlled favicon.ico or unavatar response with this
// Content-Type is stored XSS on first render, not merely reflected.
//
// Applied on both fetch paths (origin-favicon.ts and unavatar-fallback.ts) —
// each source is equally attacker-influenced, the origin because the domain
// itself is user-supplied, unavatar because it proxies arbitrary origins.
const ALLOWED_ICON_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

/**
 * True when `contentType` is absent (callers default an absent header to
 * `image/x-icon` themselves — plenty of real favicon hosts omit it, and
 * penalizing that would cost hit rate for nothing) or is one of the raster
 * types above. False for everything else, `image/svg+xml` explicitly
 * included.
 */
export function isAllowedIconContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return true;
  const base = contentType.split(";")[0]?.trim().toLowerCase();
  return base !== undefined && ALLOWED_ICON_CONTENT_TYPES.has(base);
}
