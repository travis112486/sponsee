import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { db } from "@sponsee/db";
import { waitlistSignups } from "@sponsee/db/schema";
import waitlistApp, {
  ADMIN_TOKEN_HEADER,
  WAITLIST_MAX_PER_WINDOW,
  constantTimeEquals,
  waitlistAdminApp,
  waitlistLimiter,
} from "./waitlist.js";
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

// SPO-207. A lead we cannot look up is much less useful, so the form now asks
// for a channel handle.
describe("streamer name capture", () => {
  function signupWith(body: Record<string, unknown>) {
    return waitlistApp.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify(body),
    });
  }

  it("stores the channel handle alongside the email", async () => {
    await signupWith({ email: "new@example.com", streamerName: "  pokimane  " });

    const [row] = await db.select().from(waitlistSignups);
    expect(row.streamerName).toBe("pokimane");
  });

  it("stores null rather than an empty string when it is omitted", async () => {
    await signupWith({ email: "new@example.com" });

    const [row] = await db.select().from(waitlistSignups);
    expect(row.streamerName).toBeNull();
  });

  it("truncates an over-long handle instead of losing the lead", async () => {
    // The email is the thing we cannot afford to lose; an over-long handle must
    // not turn a real lead into a 400.
    const res = await signupWith({ email: "new@example.com", streamerName: "x".repeat(200) });

    expect(res.status).toBe(200);
    const [row] = await db.select().from(waitlistSignups);
    expect(row.streamerName).toHaveLength(128);
  });

  it("backfills a handle a repeat signup supplies, without overwriting one we have", async () => {
    await signupWith({ email: "dupe@example.com" });
    await signupWith({ email: "dupe@example.com", streamerName: "first_handle" });
    await signupWith({ email: "dupe@example.com", streamerName: "second_handle" });

    const rows = await db.select().from(waitlistSignups);
    expect(rows).toHaveLength(1);
    expect(rows[0].streamerName).toBe("first_handle");
  });
});

// SPO-88 MEDIUM-1, carried over from the marketing edge function. The export
// returns every captured waitlist email; these pin fail-closed, header-only,
// and no-browser-origin. It now reads Postgres rather than one isolate's memory.
describe("waitlist admin export", () => {
  const originalToken = process.env.WAITLIST_ADMIN_TOKEN;

  function exportRequest(headers: Record<string, string> = {}, path = "/export") {
    return waitlistAdminApp.request(path, { method: "GET", headers });
  }

  beforeEach(() => {
    delete process.env.WAITLIST_ADMIN_TOKEN;
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.WAITLIST_ADMIN_TOKEN;
    else process.env.WAITLIST_ADMIN_TOKEN = originalToken;
  });

  it("fails closed when WAITLIST_ADMIN_TOKEN is unset", async () => {
    const res = await exportRequest({ [ADMIN_TOKEN_HEADER]: "anything" });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body).not.toHaveProperty("entries");
  });

  it("no longer accepts the old hardcoded dev-token", async () => {
    const res = await exportRequest({ [ADMIN_TOKEN_HEADER]: "dev-token" });

    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("entries");
  });

  it("ignores a token in the query string even when it is the right value", async () => {
    process.env.WAITLIST_ADMIN_TOKEN = "s3cret";

    const res = await exportRequest({}, "/export?token=s3cret");

    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("entries");
  });

  it("rejects a wrong token presented in the header", async () => {
    process.env.WAITLIST_ADMIN_TOKEN = "s3cret";

    const res = await exportRequest({ [ADMIN_TOKEN_HEADER]: "s3crey" });

    expect(res.status).toBe(401);
  });

  it("returns entries that survive a restart, for the correct header token", async () => {
    process.env.WAITLIST_ADMIN_TOKEN = "s3cret";
    await waitlistApp.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify({ email: "streamer@example.com", streamerName: "pokimane" }),
    });

    const res = await exportRequest({ [ADMIN_TOKEN_HEADER]: "s3cret" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.entries.map((e: { email: string }) => e.email)).toContain(
      "streamer@example.com"
    );
    expect(body.entries[0].streamerName).toBe("pokimane");
  });

  it("sends no CORS headers on the export, so no browser origin can read it", async () => {
    process.env.WAITLIST_ADMIN_TOKEN = "s3cret";

    const res = await exportRequest({
      [ADMIN_TOKEN_HEADER]: "s3cret",
      origin: "https://sponsee.app",
    });

    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("serves CSV on request, neutralising spreadsheet formula injection", async () => {
    process.env.WAITLIST_ADMIN_TOKEN = "s3cret";
    await waitlistApp.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify({ email: "streamer@example.com", streamerName: "=cmd|'/c calc'!A1" }),
    });

    const res = await exportRequest({ [ADMIN_TOKEN_HEADER]: "s3cret" }, "/export?format=csv");

    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const text = await res.text();
    expect(text).toContain("email,streamer_name");
    expect(text).toContain("\"'=cmd|'/c calc'!A1\"");
  });
});

describe("constantTimeEquals", () => {
  it("matches equal strings", async () => {
    await expect(constantTimeEquals("abc", "abc")).resolves.toBe(true);
  });

  it("rejects strings differing only in the last character", async () => {
    await expect(constantTimeEquals("abc", "abd")).resolves.toBe(false);
  });

  it("rejects a prefix of the expected value", async () => {
    await expect(constantTimeEquals("abc", "abcdef")).resolves.toBe(false);
  });

  it("rejects the empty string against a real token", async () => {
    await expect(constantTimeEquals("", "s3cret")).resolves.toBe(false);
  });
});
