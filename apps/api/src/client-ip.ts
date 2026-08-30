// Client IP resolution for rate limiting.
//
// Better Auth's default is `x-forwarded-for` only, and it refuses a multi-hop
// value unless trusted proxies are configured — falling back to a single shared
// bucket for every caller. A shared bucket turns the per-caller sign-in rules
// into a site-wide outage, so the header list is explicit, chosen from headers
// this deployment was observed to actually receive, and overridable per host.

import { isIP } from "node:net";

/**
 * Headers to read the client IP from, in order.
 *
 * Measured against the live topology (browser -> Vercel rewrite -> Render's
 * Cloudflare edge -> container) rather than assumed. A request through
 * sponsee.vercel.app arrives at the container as:
 *
 *   x-vercel-forwarded-for: 69.213.239.195               <- the client, one hop
 *   x-forwarded-for:        69.213.239.195,54.226.216.119, 104.22.100.156
 *   cf-connecting-ip:       54.226.216.119               <- Vercel's egress
 *   true-client-ip:         54.226.216.119               <- Vercel's egress
 *
 * So `x-vercel-forwarded-for` is the only header that both survives the two
 * proxy hops and stays single-valued, which is what Better Auth requires.
 * `x-forwarded-for` is kept as the fallback for hosts with a single proxy in
 * front (a plain Docker deploy); through Vercel it is three hops and resolves
 * to nothing, which is exactly why the limiter shared one bucket before this.
 *
 * `cf-connecting-ip`/`true-client-ip` are deliberately NOT in this list. They
 * do carry the real client on a request sent straight to the Render origin, but
 * on the Vercel path they carry Vercel's egress address — so including them
 * would silently key every user of the normal front door into one bucket if
 * `x-vercel-forwarded-for` ever stopped arriving. Resolving to nothing is a
 * failure `sharedBucketRule` below can detect and survive; resolving to the
 * wrong address is not.
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

/**
 * Whether Better Auth will key its rate limiter on this request's client
 * address, or fall back to the single shared `no-trusted-ip` bucket.
 *
 * This mirrors `getIPFromHeader` in @better-auth/core: with no trusted proxies
 * configured it accepts a header only when the value is a single hop that
 * parses as an IP address. It is deliberately a separate function from
 * `clientIp` above, which is looser (leftmost-of-chain) because our own
 * limiters can afford to be.
 *
 * The two implementations are pinned in agreement by
 * `auth.rate-limit.integration.test.ts`, which drives real requests through the
 * app and compares this predicate against the key Better Auth actually wrote —
 * so an upstream change to that rule surfaces as a failing test rather than as
 * a site-wide sign-in cap in production.
 */
export function resolvesAuthClientIp(headers: Headers, env: Env = process.env): boolean {
  for (const name of ipAddressHeaders(env)) {
    const value = headers.get(name);
    if (value === null) continue;
    const hops = value
      .split(",")
      .map((hop) => hop.trim())
      .filter(Boolean);
    if (hops.length === 1 && isIP(hops[0]!) !== 0) return true;
  }
  // Off production Better Auth substitutes 127.0.0.1 rather than giving up, so
  // there is no shared bucket to guard against. Mirrors `isTest()`/
  // `isDevelopment()` in @better-auth/core/env.
  const nodeEnv = env.NODE_ENV ?? "";
  return nodeEnv === "test" || nodeEnv === "dev" || nodeEnv === "development" || !!env.TEST;
}
