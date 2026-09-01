import { Hono } from "hono";
import { z } from "zod";
import { db } from "@sponsee/db";
import { waitlistSignups } from "@sponsee/db/schema";
import { eq, desc } from "drizzle-orm";
import { clientIp } from "../client-ip.js";
import { SlidingWindowLimiter } from "../rate-limit.js";

// The insert is unauthenticated and writes to Neon on every call. The honeypot
// alone stops naive bots but nothing scripted, so cap signups per client IP.
// Duplicate detection also makes the endpoint an email-existence oracle; this
// is what bounds enumeration to a few probes per window.
export const WAITLIST_MAX_PER_WINDOW = 5;
export const WAITLIST_WINDOW_MS = 10 * 60 * 1000;

export const waitlistLimiter = new SlidingWindowLimiter(
  WAITLIST_MAX_PER_WINDOW,
  WAITLIST_WINDOW_MS
);

// Header the admin export reads the token from. A query string ends up in
// request logs and in any referrer, so the token never travels there.
export const ADMIN_TOKEN_HEADER = "x-waitlist-admin-token";

// Cap on rows returned in one export call. The list is small today; this stops
// a single request from trying to serialize an unbounded table later on.
export const EXPORT_MAX_ROWS = 5000;

/**
 * Constant-time string comparison for the admin token.
 *
 * Both sides are HMAC'd under a freshly generated random key and the fixed-width
 * digests are compared, so neither the timing nor the length of the comparison
 * leaks anything about the expected token.
 */
export async function constantTimeEquals(a: string, b: string): Promise<boolean> {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const encoder = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.sign("HMAC", key, encoder.encode(a)),
    crypto.subtle.sign("HMAC", key, encoder.encode(b)),
  ]);
  const bytesA = new Uint8Array(digestA);
  const bytesB = new Uint8Array(digestB);
  let diff = 0;
  for (let i = 0; i < bytesA.length; i++) diff |= bytesA[i] ^ bytesB[i];
  return diff === 0;
}

const waitlistSchema = z.object({
  email: z.string().email(),
  // Trimmed and truncated rather than rejected. The column is varchar(128), but
  // an over-long handle must never cost us the email — the address is the thing
  // we cannot afford to lose.
  streamerName: z
    .string()
    .transform((s) => s.trim().slice(0, 128))
    .optional(),
  platforms: z.array(z.string()).optional(),
  ccvBand: z.string().optional(),
  source: z.string().optional().default("landing"),
  website: z.string().optional(), // honeypot
});

const app = new Hono();

app.post("/", async (c) => {
  try {
    // Callers we cannot attribute share one bucket rather than bypassing the
    // limit entirely.
    const ip = clientIp(c.req.raw.headers) ?? "unknown";
    const decision = waitlistLimiter.check(ip);
    if (!decision.allowed) {
      return c.json(
        { ok: false, error: "Too many signups from this network. Try again later." },
        429,
        { "Retry-After": String(decision.retryAfter) }
      );
    }

    const body = await c.req.json();
    const parsed = waitlistSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        { ok: false, error: "Invalid email address." },
        400
      );
    }

    const { email, streamerName, platforms, ccvBand, source, website } = parsed.data;

    // Honeypot: silently accept bots
    if (website && website.length > 0) {
      return c.json({ ok: true });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check for existing signup
    const existing = await db.query.waitlistSignups.findFirst({
      where: eq(waitlistSignups.email, normalizedEmail),
    });

    if (existing) {
      // A repeat signup is the one chance to backfill details the first
      // submission left blank; never overwrite something we already have with
      // an empty value.
      const backfill: Partial<typeof waitlistSignups.$inferInsert> = {};
      if (streamerName && !existing.streamerName) backfill.streamerName = streamerName;
      if (ccvBand && !existing.ccvBand) backfill.ccvBand = ccvBand;
      if (platforms?.length && !existing.platforms?.length) backfill.platforms = platforms;

      if (Object.keys(backfill).length > 0) {
        await db
          .update(waitlistSignups)
          .set({ ...backfill, updatedAt: new Date() })
          .where(eq(waitlistSignups.email, normalizedEmail));
      }

      return c.json({
        ok: true,
        duplicate: true,
        confirmed: existing.confirmed,
      });
    }

    // Generate a simple confirm token (not cryptographically secure, good enough for v1)
    const confirmToken = crypto.randomUUID();

    await db.insert(waitlistSignups).values({
      email: normalizedEmail,
      streamerName: streamerName || null,
      platforms: platforms ?? [],
      ccvBand: ccvBand ?? null,
      source: source ?? "landing",
      confirmToken,
    });

    return c.json({ ok: true, duplicate: false, confirmed: false });
  } catch (err) {
    console.error("Waitlist signup error:", err);
    return c.json(
      { ok: false, error: "Something went wrong. Try again in a minute." },
      500
    );
  }
});

export default app;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = Array.isArray(value) ? value.join(" ") : String(value);
  // Leading =, +, - or @ make a spreadsheet treat the cell as a formula, and
  // these rows are attacker-supplied. Prefix so Sheets/Excel keep it as text.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * Admin export, mounted away from /api/waitlist/* so the public CORS policy for
 * the signup endpoint can never apply to it. This returns PII: it is
 * deliberately given no CORS headers, so no browser origin can read the
 * response even if it somehow obtained the token.
 */
export const waitlistAdminApp = new Hono();

waitlistAdminApp.get("/export", async (c) => {
  const adminToken = process.env.WAITLIST_ADMIN_TOKEN ?? "";
  // Fail closed. A default token would mean an unset env var silently
  // publishes every captured email address.
  if (adminToken.length === 0) {
    return c.json({ ok: false, error: "Waitlist export is not configured." }, 503);
  }

  const presented = c.req.header(ADMIN_TOKEN_HEADER) ?? "";
  if (!(await constantTimeEquals(presented, adminToken))) {
    return c.json({ ok: false, error: "Unauthorized" }, 401);
  }

  const rows = await db.query.waitlistSignups.findMany({
    orderBy: [desc(waitlistSignups.createdAt)],
    limit: EXPORT_MAX_ROWS,
  });

  if (c.req.query("format") === "csv") {
    const header = "email,streamer_name,platforms,ccv_band,source,confirmed,created_at";
    const body = rows
      .map((r) =>
        [
          r.email,
          r.streamerName,
          r.platforms,
          r.ccvBand,
          r.source,
          r.confirmed,
          r.createdAt?.toISOString(),
        ]
          .map(csvCell)
          .join(",")
      )
      .join("\n");
    return c.body([header, body].filter(Boolean).join("\n"), 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="sponsee-waitlist.csv"',
    });
  }

  return c.json({
    ok: true,
    count: rows.length,
    truncated: rows.length === EXPORT_MAX_ROWS,
    entries: rows,
  });
});
