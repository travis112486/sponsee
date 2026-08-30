import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { db } from "@sponsee/db";
import { rateLimit } from "@sponsee/db/schema";
import { eq } from "drizzle-orm";

// SPO-88 LOW-1, end to end.
//
// The rest of the suite runs with the limiter off, so nothing else exercises
// `storage: "database"`. That is the part that fails in production rather than
// in CI: a `rateLimit` model missing from the Drizzle adapter's schema map, or
// a column the adapter cannot find, throws on the first limited request — which
// is every sign-in. This file turns the limiter on and drives it against a real
// Postgres (PGlite) to prove the wiring holds.

process.env.AUTH_RATE_LIMIT_ENABLED = "true";

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: vi.fn(async () => {}) })),
  },
}));

const { default: app } = await import("./app.js");

// auth.ts reads the flag once at module scope, so it is safe to clear now — and
// necessary: vitest isolates modules per file but `process.env` is process-wide,
// so leaving it set would silently enable the limiter in every file loaded after
// this one.
delete process.env.AUTH_RATE_LIMIT_ENABLED;

import { initPgliteSchema } from "./test-utils/pglite-setup.js";
import { pgliteClient } from "@sponsee/db";

const SCHEMA_SQL = `
DROP TABLE IF EXISTS rate_limit CASCADE;
DROP TABLE IF EXISTS verification CASCADE;
DROP TABLE IF EXISTS session CASCADE;
DROP TABLE IF EXISTS account CASCADE;
DROP TABLE IF EXISTS "user" CASCADE;

CREATE TABLE "user" (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified BOOLEAN NOT NULL DEFAULT false,
  image TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Mirrors packages/db/drizzle/0005_rate_limit.sql.
CREATE TABLE rate_limit (
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  last_request BIGINT NOT NULL,
  CONSTRAINT rate_limit_key_unique UNIQUE(key)
);
`;

// Better Auth's magic-link plugin allows 5 requests per 60s per IP+path.
const MAGIC_LINK_MAX = 5;

function signIn(email: string, ip: string) {
  return app.request("/api/auth/sign-in/magic-link", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-vercel-forwarded-for": ip },
    body: JSON.stringify({ email, callbackURL: "/" }),
  });
}

beforeAll(async () => {
  await initPgliteSchema(SCHEMA_SQL);
});

beforeEach(async () => {
  await db.delete(rateLimit);
});

describe("Better Auth database-backed rate limiting", () => {
  it("allows the first requests from an IP and persists the counter", async () => {
    for (let i = 0; i < MAGIC_LINK_MAX; i++) {
      const res = await signIn("creator@example.com", "203.0.113.7");
      expect(res.status).toBe(200);
    }

    const rows = await db.select().from(rateLimit);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(MAGIC_LINK_MAX);
    expect(rows[0].key).toContain("203.0.113.7");
    expect(rows[0].lastRequest).toBeGreaterThan(0);
  });

  it("returns 429 once the window is exhausted", async () => {
    for (let i = 0; i < MAGIC_LINK_MAX; i++) {
      await signIn("creator@example.com", "203.0.113.7");
    }

    const res = await signIn("creator@example.com", "203.0.113.7");

    // This is the email-bombing bound: without it, an attacker can have our
    // domain send unlimited sign-in mail to any address they choose.
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("X-Retry-After"))).toBeGreaterThan(0);
  });

  it("counts per client IP, not one shared bucket", async () => {
    for (let i = 0; i < MAGIC_LINK_MAX; i++) {
      await signIn("creator@example.com", "203.0.113.7");
    }

    // A single global bucket would make the built-in sign-in rule a self-DoS
    // for every other creator the moment one IP hits the limit.
    const res = await signIn("other@example.com", "198.51.100.9");
    expect(res.status).toBe(200);

    const rows = await db.select().from(rateLimit);
    expect(rows).toHaveLength(2);
  });

  it("reads the IP from the host-set header rather than a spoofed chain", async () => {
    await app.request("/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-vercel-forwarded-for": "203.0.113.7",
        "x-forwarded-for": "1.2.3.4",
      },
      body: JSON.stringify({ email: "creator@example.com", callbackURL: "/" }),
    });

    const rows = await db.select().from(rateLimit);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toContain("203.0.113.7");
    expect(rows[0].key).not.toContain("1.2.3.4");
  });

  it("lets the caller through again after the window rolls over", async () => {
    for (let i = 0; i < MAGIC_LINK_MAX; i++) {
      await signIn("creator@example.com", "203.0.113.7");
    }
    expect((await signIn("creator@example.com", "203.0.113.7")).status).toBe(429);

    // Age the stored counter past the 60s window instead of sleeping.
    const [row] = await db.select().from(rateLimit);
    await db
      .update(rateLimit)
      .set({ lastRequest: Date.now() - 61_000 })
      .where(eq(rateLimit.key, row.key));

    expect((await signIn("creator@example.com", "203.0.113.7")).status).toBe(200);
    const [refreshed] = await db.select().from(rateLimit);
    expect(refreshed.count).toBe(1);
  });

  it("uses the table the migration creates", async () => {
    const result = await pgliteClient!.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'rate_limit'`,
    );

    expect(result.rows.map((r) => r.column_name).sort()).toEqual([
      "count",
      "id",
      "key",
      "last_request",
    ]);
  });
});
