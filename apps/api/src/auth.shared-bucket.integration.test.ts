import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { db } from "@sponsee/db";
import { rateLimit } from "@sponsee/db/schema";
import { eq } from "drizzle-orm";

// SPO-88 LOW-1, the failure mode rather than the feature.
//
// `auth.rate-limit.integration.test.ts` proves the limiter counts. This file
// proves it counts *per caller*, and that when it cannot — because no header
// yields a client address — the limit it applies to the resulting shared bucket
// is survivable rather than a site-wide sign-in outage.
//
// That was not hypothetical: production ran for two days with every caller in
// one `no-trusted-ip` bucket under the magic-link plugin's 5-per-60s rule.
//
// Better Auth substitutes 127.0.0.1 for the client address whenever NODE_ENV is
// not production, which hides the shared bucket completely. So this file runs
// as production — set before importing app.js, because both Better Auth's
// `nodeENV` and our own `isProd` are captured at module scope.
vi.stubEnv("NODE_ENV", "production");
vi.stubEnv("TEST", "");
vi.stubEnv("AUTH_RATE_LIMIT_ENABLED", "true");
// Better Auth tolerates its default secret only off production, and refuses to
// initialise without one here.
vi.stubEnv("BETTER_AUTH_SECRET", "shared-bucket-test-secret");

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: vi.fn(async () => {}) })),
  },
}));

const { default: app } = await import("./app.js");
const { resolvesAuthClientIp } = await import("./client-ip.js");

import { initPgliteSchema } from "./test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "./test-utils/schema-sql.js";

/** The magic-link plugin's own rule, which applies once a caller is identified. */
const PER_CALLER_MAX = 5;
/** SHARED_BUCKET_RULE in auth.ts. */
const SHARED_MAX = 60;

const SIGN_IN_PATH = "/api/auth/sign-in/magic-link";

/**
 * The rate limiter runs before the route handler, so every request consumes a
 * slot whatever the handler then makes of it. These assertions are about the
 * 429 and the stored counter, never about the sign-in succeeding.
 */
function signIn(headers: Record<string, string> = {}) {
  return app.request(SIGN_IN_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ email: "creator@example.com", callbackURL: "/" }),
  });
}

beforeAll(async () => {
  await initPgliteSchema(SCHEMA_SQL);
});

beforeEach(async () => {
  await db.delete(rateLimit);
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("rate limiting when no client address can be resolved", () => {
  it("puts every caller in one bucket — the condition being guarded against", async () => {
    await signIn();

    const [row] = await db.select().from(rateLimit);
    expect(row.key).toBe("no-trusted-ip|/sign-in/magic-link");
  });

  it("does not apply the per-caller sign-in limit to that shared bucket", async () => {
    // Six requests would be a 429 under the magic-link plugin's 5-per-60s rule.
    // Applied globally that rule caps sign-in for the whole site at five a
    // minute, which is the outage this guard exists to prevent.
    for (let i = 0; i < PER_CALLER_MAX + 1; i++) {
      expect((await signIn()).status).not.toBe(429);
    }
  });

  it("still bounds the shared bucket, so the domain cannot be used to bomb an inbox", async () => {
    await signIn();

    // Wind the counter to the ceiling rather than sending 60 requests: the
    // assertion is about where the limit sits, not about the storage backend,
    // which auth.rate-limit.integration.test.ts already covers.
    const [row] = await db.select().from(rateLimit);
    const windTo = (count: number) =>
      db
        .update(rateLimit)
        .set({ count, lastRequest: Date.now() })
        .where(eq(rateLimit.key, row.key));

    // One below the ceiling is still allowed — this is what pins the limit to
    // SHARED_MAX rather than merely "some limit exists".
    await windTo(SHARED_MAX - 1);
    expect((await signIn()).status).not.toBe(429);

    await windTo(SHARED_MAX);
    const res = await signIn();
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("X-Retry-After"))).toBeGreaterThan(0);
  });

  it("covers the verify hop the user's browser makes on the emailed link", async () => {
    // /magic-link/verify carries the same 5-per-60s plugin rule as the sign-in
    // request, so on a shared bucket the sixth person to click a sign-in link
    // in a minute gets a 429 instead of a session.
    for (let i = 0; i < PER_CALLER_MAX + 1; i++) {
      const res = await app.request("/api/auth/magic-link/verify?token=not-a-real-token");
      expect(res.status).not.toBe(429);
    }

    const [row] = await db.select().from(rateLimit);
    expect(row.key).toBe("no-trusted-ip|/magic-link/verify");
  });

  it("keeps the tight per-caller limit for callers it can identify", async () => {
    // The guard must not loosen the limit for everyone — only for the bucket
    // that is shared. A caller with a resolvable address keeps 5 per 60s.
    for (let i = 0; i < PER_CALLER_MAX; i++) {
      expect((await signIn({ "x-vercel-forwarded-for": "203.0.113.7" })).status).not.toBe(429);
    }

    expect((await signIn({ "x-vercel-forwarded-for": "203.0.113.7" })).status).toBe(429);

    const [row] = await db.select().from(rateLimit);
    expect(row.key).toContain("203.0.113.7");
  });

  it("does not let one caller's exhausted bucket lock out another", async () => {
    for (let i = 0; i < PER_CALLER_MAX + 1; i++) {
      await signIn({ "x-vercel-forwarded-for": "203.0.113.7" });
    }

    expect((await signIn({ "x-vercel-forwarded-for": "198.51.100.9" })).status).not.toBe(429);
  });
});

describe("resolvesAuthClientIp agrees with the key Better Auth writes", () => {
  // The guard is only correct while our predicate and Better Auth's resolution
  // reach the same verdict. They are separate implementations, so pin them
  // together against real requests instead of trusting that they match.
  const cases: Array<{ name: string; headers: Record<string, string> }> = [
    { name: "no forwarded headers", headers: {} },
    { name: "single-hop host header", headers: { "x-vercel-forwarded-for": "203.0.113.7" } },
    {
      name: "the live three-hop chain through Vercel",
      headers: { "x-forwarded-for": "69.213.239.195,54.226.216.119, 104.22.100.156" },
    },
    {
      name: "the live front-door header set",
      headers: {
        "x-vercel-forwarded-for": "69.213.239.195",
        "x-forwarded-for": "69.213.239.195,54.226.216.119, 104.22.100.156",
        "cf-connecting-ip": "54.226.216.119",
      },
    },
    { name: "a single hop that is not an address", headers: { "x-forwarded-for": "unknown" } },
    // Everything below this line was added after round 3 of review. The cases
    // above were all well-formed dotted-quad or absent, which is why a guard
    // that disagreed with Better Auth on every IPv6 form still passed.
    {
      name: "an IPv6 zone ID, which node:net accepts and Better Auth rejects",
      headers: { "x-vercel-forwarded-for": "fe80::1%eth0" },
    },
    { name: "a numeric IPv6 zone ID", headers: { "x-vercel-forwarded-for": "fe80::1%1" } },
    { name: "loopback IPv6", headers: { "x-vercel-forwarded-for": "::1" } },
    { name: "compressed IPv6", headers: { "x-vercel-forwarded-for": "2001:db8::1" } },
    { name: "uppercase IPv6", headers: { "x-vercel-forwarded-for": "2001:DB8::1" } },
    { name: "IPv4-mapped IPv6", headers: { "x-vercel-forwarded-for": "::ffff:192.0.2.1" } },
    {
      name: "a bracketed IPv6 with a port",
      headers: { "x-vercel-forwarded-for": "[2001:db8::1]:443" },
    },
    { name: "IPv4 with a port", headers: { "x-vercel-forwarded-for": "203.0.113.7:443" } },
    { name: "an out-of-range octet", headers: { "x-vercel-forwarded-for": "256.1.1.1" } },
    { name: "a trailing comma", headers: { "x-vercel-forwarded-for": "203.0.113.7," } },
    { name: "surrounding whitespace", headers: { "x-vercel-forwarded-for": " 203.0.113.7 " } },
    { name: "an empty header value", headers: { "x-vercel-forwarded-for": "" } },
    {
      name: "an unresolvable first header falling through to the second",
      headers: { "x-vercel-forwarded-for": "unknown", "x-forwarded-for": "203.0.113.7" },
    },
  ];

  for (const { name, headers } of cases) {
    it(`agrees for ${name}`, async () => {
      await signIn(headers);

      const [row] = await db.select().from(rateLimit);
      const keyedOnClient = !row.key.startsWith("no-trusted-ip|");

      expect(resolvesAuthClientIp(new Headers(headers))).toBe(keyedOnClient);
    });
  }
});
