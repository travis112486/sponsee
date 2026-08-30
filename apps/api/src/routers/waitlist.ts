import { Hono } from "hono";
import { z } from "zod";
import { db } from "@sponsee/db";
import { waitlistSignups } from "@sponsee/db/schema";
import { eq } from "drizzle-orm";
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

const waitlistSchema = z.object({
  email: z.string().email(),
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

    const { email, platforms, ccvBand, source, website } = parsed.data;

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
