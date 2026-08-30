import { describe, it, expect, vi } from "vitest";
import * as schema from "@sponsee/db/schema";
import { getTableConfig } from "drizzle-orm/pg-core";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Nodemailer must be mocked before auth.ts evaluates — importing it creates the
// magic-link transport at module scope.
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: vi.fn() })) },
}));

const { smtpTransportOptions, rateLimitEnabled } = await import("./auth.js");
const { ipAddressHeaders, resolvesAuthClientIp, clientIp, DEFAULT_IP_HEADERS } =
  await import("./client-ip.js");

/**
 * Headers as they actually arrived at the container, captured 2026-08-30 by
 * deploying a token-gated header probe to the Render service and calling it
 * through the front door (browser -> Vercel rewrite -> Render's Cloudflare edge
 * -> container) and again straight at the Render origin.
 *
 * These fixtures are the point of this suite: the limiter counting correctly is
 * cheap to prove in isolation and was never the risk. The risk is it counting
 * everyone into one bucket because the header we read does not survive the two
 * proxy hops — which is what production was doing.
 */
const LIVE_CLIENT_IP = "69.213.239.195";

const LIVE_HEADERS_VIA_VERCEL = {
  "x-vercel-forwarded-for": LIVE_CLIENT_IP,
  "x-vercel-proxied-for": LIVE_CLIENT_IP,
  "x-forwarded-for": `${LIVE_CLIENT_IP},54.226.216.119, 104.22.100.156`,
  "cf-connecting-ip": "54.226.216.119",
  "true-client-ip": "54.226.216.119",
  forwarded: `for=${LIVE_CLIENT_IP};host=sponsee.onrender.com;proto=https`,
  "x-forwarded-host": "sponsee.vercel.app",
};

const LIVE_HEADERS_DIRECT_TO_RENDER = {
  "x-forwarded-for": `${LIVE_CLIENT_IP}, 172.69.132.173`,
  "cf-connecting-ip": LIVE_CLIENT_IP,
  "true-client-ip": LIVE_CLIENT_IP,
};

// No NODE_ENV: Better Auth substitutes 127.0.0.1 off production, which would
// mask exactly the failure these cases are about.
const PROD_ENV = {};

// SPO-88 MEDIUM-2 / LOW-1, from the QA Gate 2 security pass.

describe("magic-link SMTP transport (MEDIUM-2)", () => {
  it("verifies the relay's TLS certificate in production", () => {
    const options = smtpTransportOptions(true);

    // Absent `tls` means nodemailer's default, which is to verify. An explicit
    // `rejectUnauthorized: false` here would make every magic link — a 10-minute
    // single-use account-takeover token — readable by a MITM on the relay path.
    expect(options).not.toHaveProperty("tls");
  });

  it("relaxes verification outside production for Mailpit's self-signed cert", () => {
    expect(smtpTransportOptions(false).tls).toEqual({ rejectUnauthorized: false });
  });
});

describe("auth rate limiting (LOW-1)", () => {
  it("is on by default outside the test runner", () => {
    // Better Auth only self-enables when NODE_ENV === "production", which left
    // staging and any misconfigured deploy accepting unlimited magic-link sends.
    expect(rateLimitEnabled({ NODE_ENV: "staging" })).toBe(true);
    expect(rateLimitEnabled({ NODE_ENV: "production" })).toBe(true);
    expect(rateLimitEnabled({})).toBe(true);
  });

  it("is off under the test runner, where every request shares one IP bucket", () => {
    expect(rateLimitEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(rateLimitEnabled({ VITEST: "true" })).toBe(false);
  });

  it("honours an explicit override in both directions", () => {
    expect(rateLimitEnabled({ NODE_ENV: "test", AUTH_RATE_LIMIT_ENABLED: "true" })).toBe(
      true
    );
    expect(
      rateLimitEnabled({ NODE_ENV: "production", AUTH_RATE_LIMIT_ENABLED: "false" })
    ).toBe(false);
  });

  it("backs database storage with a rate_limit table the Drizzle adapter can find", () => {
    // `storage: "database"` makes Better Auth look up a `rateLimit` model by
    // its own field names. A missing table or a renamed property throws at the
    // adapter on the first limited request.
    const config = getTableConfig(schema.rateLimit);
    expect(config.name).toBe("rate_limit");

    const byProperty = Object.fromEntries(
      config.columns.map((c) => [c.name, c])
    );
    expect(Object.keys(schema.rateLimit)).toEqual(
      expect.arrayContaining(["id", "key", "count", "lastRequest"])
    );
    expect(byProperty.key.isUnique).toBe(true);
    // Epoch milliseconds overflow int4.
    expect(byProperty.last_request.getSQLType()).toBe("bigint");
  });

  it("ships a migration that creates the table", () => {
    const drizzleDir = path.resolve(__dirname, "../../../packages/db/drizzle");
    const sql = readdirSync(drizzleDir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(path.join(drizzleDir, f), "utf8"))
      .join("\n");

    expect(sql).toContain('CREATE TABLE "rate_limit"');
  });
});

describe("client IP resolution", () => {
  it("prefers the host-set forwarded header over the spoofable one", () => {
    expect(ipAddressHeaders({})).toEqual(DEFAULT_IP_HEADERS);
    expect(DEFAULT_IP_HEADERS[0]).toBe("x-vercel-forwarded-for");

    const headers = new Headers({
      "x-vercel-forwarded-for": "203.0.113.7",
      "x-forwarded-for": "198.51.100.1",
    });
    expect(clientIp(headers, {})).toBe("203.0.113.7");
  });

  it("falls back to x-forwarded-for and takes the client-most hop", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    expect(clientIp(headers, {})).toBe("203.0.113.7");
  });

  it("returns null when no forwarded header is present", () => {
    expect(clientIp(new Headers(), {})).toBeNull();
  });

  it("is overridable per host", () => {
    expect(ipAddressHeaders({ AUTH_IP_HEADERS: "cf-connecting-ip, X-Real-IP" })).toEqual([
      "cf-connecting-ip",
      "x-real-ip",
    ]);
  });
});

describe("client IP resolution against the deployed topology", () => {
  it("resolves the real client from a request through the Vercel front door", () => {
    const headers = new Headers(LIVE_HEADERS_VIA_VERCEL);

    // The acceptance test for LOW-1. If this is false, every caller shares one
    // bucket and the sign-in rules become a site-wide cap.
    expect(resolvesAuthClientIp(headers, PROD_ENV)).toBe(true);
    expect(clientIp(headers, PROD_ENV)).toBe(LIVE_CLIENT_IP);
  });

  it("rejects the three-hop x-forwarded-for that made the bucket shared", () => {
    const chained = new Headers({
      "x-forwarded-for": LIVE_HEADERS_VIA_VERCEL["x-forwarded-for"],
    });

    // Better Auth will not trust a chain without trusted proxies, so reading
    // only this header — the pre-fix default — resolves to nothing.
    expect(resolvesAuthClientIp(chained, PROD_ENV)).toBe(false);
  });

  it("does not read the client from headers that carry Vercel's own address", () => {
    // cf-connecting-ip and true-client-ip are the real client when the origin is
    // called directly, and Vercel's egress when it is not. Adding either to the
    // header list would key every front-door caller into one bucket while still
    // looking resolved, so the shared-ceiling guard would never engage.
    expect(ipAddressHeaders(PROD_ENV)).not.toContain("cf-connecting-ip");
    expect(ipAddressHeaders(PROD_ENV)).not.toContain("true-client-ip");
    expect(LIVE_HEADERS_VIA_VERCEL["cf-connecting-ip"]).not.toBe(LIVE_CLIENT_IP);
  });

  it("falls back to the shared bucket for a request straight to the origin", () => {
    // Render sits behind Cloudflare, so even a direct call is two hops. This is
    // a shared bucket by design — sized by SHARED_BUCKET_RULE, and it cannot
    // affect front-door callers because they key on their own address.
    expect(resolvesAuthClientIp(new Headers(LIVE_HEADERS_DIRECT_TO_RENDER), PROD_ENV)).toBe(
      false,
    );
  });

  it("treats a malformed single hop as unresolved rather than a bucket name", () => {
    for (const value of ["unknown", "not-an-ip", "203.0.113.7:443", ""]) {
      const headers = new Headers({ "x-vercel-forwarded-for": value });
      expect(resolvesAuthClientIp(headers, PROD_ENV)).toBe(false);
    }
    expect(resolvesAuthClientIp(new Headers({ "x-vercel-forwarded-for": "::1" }), PROD_ENV)).toBe(
      true,
    );
  });

  it("assumes a resolvable address off production, as Better Auth does", () => {
    // getIP() substitutes 127.0.0.1 when NODE_ENV is test/development, so there
    // is no shared bucket to guard against and the guard must not engage.
    expect(resolvesAuthClientIp(new Headers(), { NODE_ENV: "test" })).toBe(true);
    expect(resolvesAuthClientIp(new Headers(), { NODE_ENV: "development" })).toBe(true);
    expect(resolvesAuthClientIp(new Headers(), { NODE_ENV: "production" })).toBe(false);
  });
});
