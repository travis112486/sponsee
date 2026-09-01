// Shared-secret front-door verification (SPO-200).
//
// The Render origin is reachable directly — `sponsee.onrender.com/health` returns
// 200 to anyone, and the same app-level 403 the front door returns for a
// rejected sign-in is reproducible straight at the origin. So nothing about a
// request can be trusted unless it demonstrably arrived through the Vercel front
// door. Vercel injects `x-sponsee-front-door` (set from FRONT_DOOR_SECRET) on the
// `/api/*` rewrite; the origin verifies that header before serving anything but
// health and webhook paths.
//
// Fail-open on an unset secret is deliberate and is the opposite of the waitlist
// admin token's fail-closed rule: that token guards a PII read, this one guards
// availability. An unset FRONT_DOOR_SECRET must not brick the API — enforcement
// is a separate flag (FRONT_DOOR_ENFORCE) so the header can be rolled out
// observed-then-enforced.

import { createHash, timingSafeEqual } from "node:crypto";

export const FRONT_DOOR_HEADER = "x-sponsee-front-door";

type Env = Record<string, string | undefined>;

export function frontDoorSecret(env: Env = process.env): string {
  return env.FRONT_DOOR_SECRET ?? "";
}

/** Enforcement gate. Unset means observe-only: log, reject nothing. */
export function frontDoorEnforced(env: Env = process.env): boolean {
  return env.FRONT_DOOR_ENFORCE === "true";
}

/**
 * Constant-time equality on fixed-width digests.
 *
 * `timingSafeEqual` throws on a length mismatch, so both sides are hashed first
 * — neither the timing nor the length of the comparison leaks anything about the
 * expected secret. The marketing waitlist's `constantTimeEquals` does the same
 * job over WebCrypto (Edge runtime); this is the Node form, and this module is
 * API-only, so `node:crypto` is always available.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}

/**
 * Whether the request carries a valid front-door secret. False when the secret
 * is unset or the header is absent — callers decide what an untrusted request
 * means (the middleware fails open on an *unset* secret but rejects on a
 * *present-but-wrong* one; the client-IP trust below always fails closed).
 */
export function frontDoorVerified(
  headers: Headers,
  env: Env = process.env,
): boolean {
  const secret = frontDoorSecret(env);
  if (!secret) return false;
  const presented = headers.get(FRONT_DOOR_HEADER);
  if (presented === null) return false;
  return constantTimeEquals(presented, secret);
}

/**
 * Paths exempt from the front-door gate. Health must stay reachable (Render's
 * own health checker hits the origin directly and cycles the service on a 403);
 * webhooks land direct-to-origin by design and are signature-verified in-handler
 * (Resend/Postmark at /api/webhooks/email/:provider, Stripe at
 * /api/webhooks/stripe). Blocking either breaks SPO-187 bounce auto-pause and
 * all billing.
 *
 * The prefix is a subtree: the email provider is a route param, so a literal
 * list could not name every value a provider may send.
 */
export const FRONT_DOOR_EXEMPT_PATHS: ReadonlyArray<{
  method: string;
  path: string;
}> = [{ method: "GET", path: "/health" }];

export const FRONT_DOOR_EXEMPT_PREFIXES: readonly string[] = ["/api/webhooks/"];

export function isFrontDoorExempt(method: string, path: string): boolean {
  const methodUpper = method.toUpperCase();
  if (
    FRONT_DOOR_EXEMPT_PATHS.some(
      (e) => e.method === methodUpper && e.path === path,
    )
  ) {
    return true;
  }
  return FRONT_DOOR_EXEMPT_PREFIXES.some((p) => path.startsWith(p));
}

export type FrontDoorDecision =
  | { kind: "exempt" }
  /** FRONT_DOOR_SECRET unset — fail open, caller logs loudly. */
  | { kind: "secret-unset" }
  /** Observe-only (enforcement off) — log header presence, reject nothing. */
  | { kind: "observe"; present: boolean; valid: boolean }
  | { kind: "pass" }
  | { kind: "reject" };

/**
 * Pure decision for the front-door middleware. Kept out of Hono so it can be
 * tested against a plain `Headers` object and a stubbed `env` without spinning
 * up the app.
 */
export function evaluateFrontDoor(
  method: string,
  path: string,
  headers: Headers,
  env: Env = process.env,
): FrontDoorDecision {
  if (isFrontDoorExempt(method, path)) return { kind: "exempt" };

  const secret = frontDoorSecret(env);
  if (!secret) return { kind: "secret-unset" };

  const present = headers.get(FRONT_DOOR_HEADER) !== null;
  const valid = present && frontDoorVerified(headers, env);

  if (!frontDoorEnforced(env)) return { kind: "observe", present, valid };

  return valid ? { kind: "pass" } : { kind: "reject" };
}
