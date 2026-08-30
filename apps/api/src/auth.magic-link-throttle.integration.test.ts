import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { db } from "@sponsee/db";
import { rateLimit } from "@sponsee/db/schema";

// SPO-88 LOW-1, round 3: the per-destination cap on magic-link mail.
//
// Every other limit in auth.ts is keyed on the caller. That bounds what one
// client can do; it does not bound what one *inbox* receives, and the inbox is
// where this abuse lands. A caller with no resolvable address gets
// SHARED_BUCKET_RULE's 60-per-60s — deliberately loose, because tightening it
// is a site-wide sign-in outage — so without a destination-keyed limit our
// domain will send 60 sign-in emails a minute to any address an attacker names,
// and rotating source addresses raises that further.
//
// These tests drive real requests through the app rather than calling the
// limiter directly, because the risk is not that a sliding window counts (it
// does; rate-limit.test.ts covers that) but that the send path never consults
// it.

vi.stubEnv("AUTH_RATE_LIMIT_ENABLED", "true");

interface SentEmail {
  to: string;
}
const sentEmails: SentEmail[] = [];

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn(async ({ to }: { to: string }) => {
        sentEmails.push({ to });
      }),
    })),
  },
}));

const { default: app } = await import("./app.js");
const { magicLinkSendLimiter, allowMagicLinkSend } = await import("./auth.js");

import { initPgliteSchema } from "./test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "./test-utils/schema-sql.js";

/** MAGIC_LINK_SENDS_MAX in auth.ts. */
const SENDS_MAX = 3;

/**
 * Each request comes from a different client address on purpose.
 *
 * Better Auth's own rule is 5 per 60s *per caller*, so spreading the requests
 * across addresses keeps it from firing — which is exactly the gap being
 * demonstrated. A per-caller limit cannot see that all five emails are aimed at
 * one inbox.
 */
function signIn(email: string, ip: string) {
  return app.request("/api/auth/sign-in/magic-link", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-vercel-forwarded-for": ip },
    body: JSON.stringify({ email, callbackURL: "/" }),
  });
}

const IPS = ["203.0.113.1", "203.0.113.2", "203.0.113.3", "203.0.113.4", "203.0.113.5"];

beforeAll(async () => {
  await initPgliteSchema(SCHEMA_SQL);
});

beforeEach(async () => {
  await db.delete(rateLimit);
  sentEmails.length = 0;
  magicLinkSendLimiter.reset();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("magic-link sends are capped per destination address", () => {
  it("stops mailing one inbox after the cap, even from fresh source addresses", async () => {
    const target = "victim@example.com";

    for (const ip of IPS) {
      await signIn(target, ip);
    }

    // Five distinct callers, five requests Better Auth was happy to serve, and
    // the inbox still only sees three.
    expect(sentEmails).toHaveLength(SENDS_MAX);
    expect(sentEmails.every((e) => e.to === target)).toBe(true);
  });

  it("does not let Better Auth's per-caller rule be mistaken for this bound", async () => {
    // Guards the premise of the test above: if the per-caller limiter had
    // started returning 429s here, the send count would drop for the wrong
    // reason and the destination cap would be untested.
    const responses = [];
    for (const ip of IPS) {
      responses.push(await signIn("victim@example.com", ip));
    }

    expect(responses.map((r) => r.status)).toEqual(responses.map(() => 200));
  });

  it("answers identically whether it sent or suppressed, so it is not an oracle", async () => {
    const target = "victim@example.com";

    const allowed = await signIn(target, IPS[0]);
    for (const ip of IPS.slice(1, SENDS_MAX)) {
      await signIn(target, ip);
    }
    const suppressed = await signIn(target, IPS[SENDS_MAX]);

    // A thrown error inside sendMagicLink would surface as a different status
    // or body, which tells an attacker whether an address has been targeted
    // recently. Suppression must be invisible from outside.
    expect(suppressed.status).toBe(allowed.status);
    expect(await suppressed.text()).toBe(await allowed.text());
    expect(sentEmails).toHaveLength(SENDS_MAX);
  });

  it("keys on the destination, so one target cannot starve another", async () => {
    for (const ip of IPS.slice(0, SENDS_MAX + 1)) {
      await signIn("victim@example.com", ip);
    }
    expect(sentEmails).toHaveLength(SENDS_MAX);

    await signIn("someone-else@example.com", IPS[0]);

    expect(sentEmails).toHaveLength(SENDS_MAX + 1);
    expect(sentEmails.at(-1)!.to).toBe("someone-else@example.com");
  });

  it("normalises the destination, so case and padding do not buy extra sends", async () => {
    const spellings = [
      "victim@example.com",
      "Victim@Example.com",
      "  VICTIM@example.com  ",
      "victim@example.com",
    ];

    for (const [i, spelling] of spellings.entries()) {
      await signIn(spelling, IPS[i]);
    }

    expect(sentEmails).toHaveLength(SENDS_MAX);
  });
});

describe("allowMagicLinkSend", () => {
  it("shares the rate-limit switch with the rest of the auth surface", () => {
    // Off under the test runner, where suites sign the same fixture address in
    // repeatedly; on everywhere else, including staging.
    expect(allowMagicLinkSend("a@example.com", { NODE_ENV: "test" })).toBe(true);
    expect(allowMagicLinkSend("a@example.com", { VITEST: "true" })).toBe(true);
  });

  it("allows exactly the cap before refusing", () => {
    const env = { NODE_ENV: "production" };
    magicLinkSendLimiter.reset();

    for (let i = 0; i < SENDS_MAX; i++) {
      expect(allowMagicLinkSend("bounded@example.com", env)).toBe(true);
    }
    expect(allowMagicLinkSend("bounded@example.com", env)).toBe(false);
  });
});
