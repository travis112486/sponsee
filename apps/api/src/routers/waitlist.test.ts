import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { db } from "@sponsee/db";
import { waitlistSignups } from "@sponsee/db/schema";
import waitlistApp, { WAITLIST_MAX_PER_WINDOW, waitlistLimiter } from "./waitlist.js";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "../test-utils/schema-sql.js";

// SPO-88 LOW-2. The insert is unauthenticated and writes to Neon on every call;
// the honeypot stops naive bots but nothing scripted, leaving unbounded writes
// and — via the duplicate response — email enumeration.

function signup(email: string, ip?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ip) headers["x-forwarded-for"] = ip;
  return waitlistApp.request("/", {
    method: "POST",
    headers,
    body: JSON.stringify({ email }),
  });
}

beforeAll(async () => {
  await initPgliteSchema(SCHEMA_SQL);
});

beforeEach(async () => {
  waitlistLimiter.reset();
  await db.delete(waitlistSignups);
});

describe("waitlist signup rate limiting", () => {
  it("accepts signups up to the per-IP cap", async () => {
    for (let i = 0; i < WAITLIST_MAX_PER_WINDOW; i++) {
      const res = await signup(`creator${i}@example.com`, "203.0.113.7");
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
    }
  });

  it("rejects the next signup from the same IP with 429 and Retry-After", async () => {
    for (let i = 0; i < WAITLIST_MAX_PER_WINDOW; i++) {
      await signup(`creator${i}@example.com`, "203.0.113.7");
    }

    const res = await signup("overflow@example.com", "203.0.113.7");

    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("does not write the rejected signup to the database", async () => {
    for (let i = 0; i < WAITLIST_MAX_PER_WINDOW; i++) {
      await signup(`creator${i}@example.com`, "203.0.113.7");
    }
    await signup("overflow@example.com", "203.0.113.7");

    const rows = await db.select().from(waitlistSignups);
    expect(rows.map((r) => r.email)).not.toContain("overflow@example.com");
    expect(rows).toHaveLength(WAITLIST_MAX_PER_WINDOW);
  });

  it("bounds email enumeration through the duplicate response", async () => {
    // The duplicate flag is a deliberate product affordance ("you're already on
    // the list"), so it stays — the limit is what stops it being an oracle you
    // can sweep a list through.
    await signup("known@example.com", "198.51.100.9");
    for (let i = 0; i < WAITLIST_MAX_PER_WINDOW - 1; i++) {
      await signup(`probe${i}@example.com`, "198.51.100.9");
    }

    const res = await signup("known@example.com", "198.51.100.9");
    expect(res.status).toBe(429);
  });

  it("limits per IP, not globally", async () => {
    for (let i = 0; i < WAITLIST_MAX_PER_WINDOW; i++) {
      await signup(`creator${i}@example.com`, "203.0.113.7");
    }

    const res = await signup("elsewhere@example.com", "203.0.113.8");
    expect(res.status).toBe(200);
  });

  it("shares one bucket for callers with no forwarded header", async () => {
    for (let i = 0; i < WAITLIST_MAX_PER_WINDOW; i++) {
      await signup(`creator${i}@example.com`);
    }

    // Stripping the header must not be a way past the limit.
    const res = await signup("overflow@example.com");
    expect(res.status).toBe(429);
  });
});

describe("waitlist signup behaviour is otherwise unchanged", () => {
  it("stores a new signup", async () => {
    const res = await signup("new@example.com", "203.0.113.7");

    expect(await res.json()).toMatchObject({ ok: true, duplicate: false });
    const rows = await db.select().from(waitlistSignups);
    expect(rows).toHaveLength(1);
  });

  it("reports a duplicate without a second write", async () => {
    await signup("dupe@example.com", "203.0.113.7");
    const res = await signup("dupe@example.com", "203.0.113.7");

    expect(await res.json()).toMatchObject({ ok: true, duplicate: true });
    expect(await db.select().from(waitlistSignups)).toHaveLength(1);
  });

  it("silently accepts a honeypot hit", async () => {
    const res = await waitlistApp.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify({ email: "bot@example.com", website: "spam" }),
    });

    expect(res.status).toBe(200);
    expect(await db.select().from(waitlistSignups)).toHaveLength(0);
  });
});
