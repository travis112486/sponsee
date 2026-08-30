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
const { ipAddressHeaders, trustedProxies, clientIp, DEFAULT_IP_HEADERS } =
  await import("./client-ip.js");

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
    expect(trustedProxies({})).toBeUndefined();
    expect(trustedProxies({ AUTH_TRUSTED_PROXIES: "10.0.0.0/8, 172.16.0.1" })).toEqual([
      "10.0.0.0/8",
      "172.16.0.1",
    ]);
  });
});
