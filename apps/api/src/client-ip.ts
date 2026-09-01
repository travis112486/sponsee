// Client IP resolution for rate limiting.
//
// Better Auth's default is `x-forwarded-for` only, and it refuses a multi-hop
// value unless trusted proxies are configured — falling back to a single shared
// bucket for every caller. A shared bucket turns the per-caller sign-in rules
// into a site-wide outage, so the header list is explicit, chosen from headers
// this deployment was observed to actually receive, and overridable per host.

import { getIPFromHeader } from "@better-auth/core/utils/ip";
import { frontDoorVerified } from "./front-door.js";

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
 *
 * Trust in `x-vercel-forwarded-for` is conditional (SPO-200): Vercel sets it and
 * strips client-supplied values, so it is only worth reading on a request that
 * demonstrably came through the front door. The static list below is what Better
 * Auth's `advanced.ipAddress` reads — it must still name the header so legitimate
 * front-door traffic keys per client. `ipAddressHeadersForRequest` below applies
 * the conditional trust for our own resolution, dropping the header when the
 * front-door secret was not present.
 */
export const DEFAULT_IP_HEADERS = ["x-vercel-forwarded-for", "x-forwarded-for"];

const VERCEL_FORWARDED_FOR = "x-vercel-forwarded-for";

type Env = Record<string, string | undefined>;

/**
 * The `advanced.ipAddress` block handed to Better Auth.
 *
 * Every knob here changes how Better Auth resolves a caller, so `auth.ts` and
 * `resolvesAuthClientIp` below both read this one object rather than each
 * building their own. `ipv6Subnet` and `trustedProxies` are unset today; they
 * are threaded through anyway so that setting one later cannot move Better
 * Auth's verdict without moving the guard's with it.
 */
export interface IpAddressOptions {
  ipAddressHeaders: string[];
  ipv6Subnet?: number;
  trustedProxies?: string[];
}

export function ipAddressOptions(env: Env = process.env): IpAddressOptions {
  return { ipAddressHeaders: ipAddressHeaders(env) };
}

/** Header names to read the client IP from, `AUTH_IP_HEADERS` overriding. */
export function ipAddressHeaders(env: Env = process.env): string[] {
  const configured = (env.AUTH_IP_HEADERS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return configured.length > 0 ? configured : DEFAULT_IP_HEADERS;
}

/**
 * Headers to read the client IP from for a *specific request*.
 *
 * Same as `ipAddressHeaders`, minus `x-vercel-forwarded-for` when the request
 * did not carry a valid front-door secret. A request that bypasses Vercel can
 * forge that header — trusting it would let a stranger pick their rate-limit
 * bucket, or a victim's, which is exactly the SPO-102 hole. This is separate
 * from the static list so the front-door gate and the trust decision move
 * together while Better Auth's `advanced.ipAddress` still names the header for
 * legitimate traffic.
 */
export function ipAddressHeadersForRequest(
  headers: Headers,
  env: Env = process.env,
): string[] {
  const list = ipAddressHeaders(env);
  if (frontDoorVerified(headers, env)) return list;
  return list.filter((h) => h !== VERCEL_FORWARDED_FOR);
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
  for (const name of ipAddressHeadersForRequest(headers, env)) {
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
 * The address-parsing rule is not reimplemented here — it *calls* the same
 * `getIPFromHeader` that `getIP` calls inside Better Auth's rate limiter, over
 * the same header list and options. That matters because a second
 * implementation only has to disagree once to be a site-wide outage, and it
 * did: a hand-rolled `node:net.isIP` check accepted `fe80::1%eth0` (zone IDs
 * are valid to `isIP`, rejected by Better Auth's zod IPv6 parser), so the guard
 * would report a resolved caller — leaving the tight 5-per-60s per-caller rule
 * in force — while Better Auth put that request, and every other one, in the
 * single shared bucket. One header from any stranger pinned the whole site to
 * five sign-ins a minute.
 *
 * What is left is the `isTest()`/`isDevelopment()` fallback, which cannot be
 * delegated: Better Auth captures `nodeENV` at module load and reads the real
 * process environment, so calling it would ignore the `env` argument these
 * tests use to simulate production. It is mirrored below as the same three
 * comparisons plus the same `toBoolean(TEST)` semantics, and pinned by
 * `auth.shared-bucket.integration.test.ts`, which stubs the environment before
 * import and compares this predicate against the key Better Auth actually
 * wrote.
 *
 * It stays a separate function from `clientIp` above, which is looser
 * (leftmost-of-chain) because our own limiters can afford to be.
 */
export function resolvesAuthClientIp(
  source: Request | Headers,
  env: Env = process.env
): boolean {
  const headers = source instanceof Headers ? source : source.headers;
  const { ipAddressHeaders: _names, ...options } = ipAddressOptions(env);

  for (const name of ipAddressHeadersForRequest(headers, env)) {
    const value = headers.get(name);
    if (value === null) continue;
    if (getIPFromHeader(value, options)) return true;
  }

  // Off production Better Auth substitutes 127.0.0.1 rather than giving up, so
  // there is no shared bucket to guard against.
  const nodeEnv = env.NODE_ENV ?? "";
  if (nodeEnv === "dev" || nodeEnv === "development" || nodeEnv === "test") return true;
  // `toBoolean` in @better-auth/core/env, which treats the string "false" as
  // false rather than as a non-empty (truthy) string.
  return env.TEST ? env.TEST !== "false" : false;
}
