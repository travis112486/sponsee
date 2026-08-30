// Client IP resolution for rate limiting.
//
// Better Auth's default is `x-forwarded-for` only, and it refuses a multi-hop
// value unless trusted proxies are configured — falling back to a single shared
// bucket for every caller. On a shared bucket the sign-in rule (3 per 10s) is a
// self-inflicted outage, so the header list is explicit and overridable per host.

/**
 * Vercel sets `x-vercel-forwarded-for` to the client address and strips any
 * inbound copy, so it is preferred where present. `x-forwarded-for` is the
 * fallback for the Render/Docker deployment of the same app.
 */
export const DEFAULT_IP_HEADERS = ["x-vercel-forwarded-for", "x-forwarded-for"];

type Env = Record<string, string | undefined>;

/** Header names to read the client IP from, `AUTH_IP_HEADERS` overriding. */
export function ipAddressHeaders(env: Env = process.env): string[] {
  const configured = (env.AUTH_IP_HEADERS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return configured.length > 0 ? configured : DEFAULT_IP_HEADERS;
}

/** Trusted proxy IPs/CIDRs, so a forwarded chain can be walked to the client. */
export function trustedProxies(env: Env = process.env): string[] | undefined {
  const configured = (env.AUTH_TRUSTED_PROXIES ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return configured.length > 0 ? configured : undefined;
}

/**
 * Best-effort client IP for application-level abuse limits.
 *
 * The leftmost entry of a forwarded chain is what every host we deploy to puts
 * the real client address in, but it is client-controlled and therefore
 * spoofable. That is acceptable for bounding accidental floods and casual
 * scripted abuse; it is not an authentication or authorization signal.
 */
export function clientIp(headers: Headers, env: Env = process.env): string | null {
  for (const name of ipAddressHeaders(env)) {
    const value = headers.get(name);
    if (!value) continue;
    const first = value.split(",")[0]?.trim();
    if (first) return first;
  }
  return null;
}
