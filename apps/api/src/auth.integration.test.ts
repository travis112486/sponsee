import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { db, pgliteClient } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { eq } from "drizzle-orm";

// Capture magic-link URLs sent during tests
const sentEmails: Array<{ email: string; url: string }> = [];

process.env.STRIPE_SECRET_KEY = "sk_test_dummy";

// Mock nodemailer BEFORE auth.ts evaluates so sendMagicLink uses the mock.
vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn(async ({ to, text }: { to: string; text: string }) => {
        // Extract the magic-link URL from the email body
        const match = text.match(/(http[^\s]+)/);
        if (match) {
          sentEmails.push({ email: to, url: match[1] });
        }
      }),
    })),
  },
}));

// Import app AFTER the nodemailer mock is registered.
const { default: app } = await import("./app.js");
const { auth, LINK_ONLY_PROVIDERS } = await import("./auth.js");

import { initPgliteSchema } from "./test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "./test-utils/schema-sql.js";

async function cleanTables() {
  await db.execute(`
    TRUNCATE TABLE
      activity_events, chase_events, invoice_chase_state, chase_templates,
      invoices, contracts, proofs, deliverables, deals, contacts, brands,
      creator_platforms, memberships, creators,
      verification, session, account, "user"
    CASCADE
  `);
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  if (!pgliteClient) throw new Error("PGlite client not available");
  await initPgliteSchema(SCHEMA_SQL);
});

beforeEach(async () => {
  await cleanTables();
  sentEmails.length = 0;
});

// ── Auth integration tests ───────────────────────────────────────────────────

describe("auth end-to-end flow", () => {
  it("provisions creator + membership + chase templates on first magic-link sign-in", async () => {
    const email = "creator@example.com";

    // Step 1: Request magic link
    const signInRes = await app.request("/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, callbackURL: "/" }),
    });

    expect(signInRes.status).toBe(200);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].email).toBe(email);

    // Step 2: Extract verification token from the magic-link URL
    const magicUrl = new URL(sentEmails[0].url);
    expect(magicUrl.searchParams.get("token")).toBeTruthy();

    // Step 3: Verify the magic link token (use full URL to preserve callbackURL)
    const verifyRes = await app.request(sentEmails[0].url.replace(magicUrl.origin, ""), {
      method: "GET",
    });

    expect(verifyRes.status).toBe(302); // redirect after success

    // Step 4: Extract session cookie
    const setCookie = verifyRes.headers.get("set-cookie") || "";
    expect(setCookie).toContain("sponsee.session_token");

    // Step 5: Verify session via auth endpoint
    const sessionRes = await app.request("/api/auth/get-session", {
      method: "GET",
      headers: { cookie: setCookie, Origin: "http://localhost:3000" },
    });

    expect(sessionRes.status).toBe(200);
    const sessionBody = (await sessionRes.json()) as { user?: { id: string; email: string } };
    expect(sessionBody.user?.email).toBe(email);
    const userId = sessionBody.user!.id;

    // Step 6: Verify creator workspace was provisioned
    const [membership] = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.userId, userId));

    expect(membership).toBeDefined();
    expect(membership.role).toBe("owner");

    const [creator] = await db
      .select()
      .from(schema.creators)
      .where(eq(schema.creators.id, membership.creatorId));

    expect(creator).toBeDefined();
    expect(creator.displayName).toBe("creator"); // from email prefix
    expect(creator.plan).toBe("starter");

    // Step 7: Verify default chase templates were seeded
    const templates = await db
      .select()
      .from(schema.chaseTemplates)
      .where(eq(schema.chaseTemplates.creatorId, creator.id));

    expect(templates).toHaveLength(3);
    expect(templates.map((t) => t.step).sort()).toEqual([1, 2, 3]);

    // Step 8: Sign out
    const signOutRes = await app.request("/api/auth/sign-out", {
      method: "POST",
      headers: { cookie: setCookie, Origin: "http://localhost:3000" },
    });

    expect(signOutRes.status).toBe(200);

    // Step 9: Verify session is invalidated
    const afterSignOutRes = await app.request("/api/auth/get-session", {
      method: "GET",
      headers: { cookie: setCookie, Origin: "http://localhost:3000" },
    });

    const afterBody = (await afterSignOutRes.json()) as { user?: unknown } | null;
    expect(afterBody?.user ?? afterBody).toBeNull();
  });

  it("does not double-provision workspace for existing user", async () => {
    const email = "repeat@example.com";

    // First sign-in
    await app.request("/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, callbackURL: "/" }),
    });

    const magicUrl1 = new URL(sentEmails[0].url);
    await app.request(sentEmails[0].url.replace(magicUrl1.origin, ""), { method: "GET" });

    const [user] = await db.select().from(schema.user).where(eq(schema.user.email, email));
    const [membership1] = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.userId, user.id));

    // Second sign-in (new magic link, same email)
    await app.request("/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, callbackURL: "/" }),
    });

    const magicUrl2 = new URL(sentEmails[1].url);
    await app.request(sentEmails[1].url.replace(magicUrl2.origin, ""), { method: "GET" });

    // Should still have exactly one membership / creator
    const memberships = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.userId, user.id));

    expect(memberships).toHaveLength(1);
    expect(memberships[0].creatorId).toBe(membership1.creatorId);

    const creators = await db.select().from(schema.creators);
    expect(creators).toHaveLength(1);
  });
});

describe("auth trusted origins", () => {
  it("rejects magic-link requests from untrusted origins with 403 INVALID_ORIGIN", async () => {
    const res = await app.request("/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.com",
        // Include a dummy cookie so Better Auth's validateOrigin runs
        Cookie: "sponsee.session_token=dummy",
      },
      body: JSON.stringify({ email: "test@example.com", callbackURL: "/" }),
    });

    // Hono CORS middleware does not set Access-Control-Allow-Origin for untrusted origins
    const allowOrigin = res.headers.get("access-control-allow-origin");
    expect(allowOrigin).not.toBe("https://evil.com");

    // Better Auth itself rejects the request
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("INVALID_ORIGIN");
  });

  it("sets CORS headers for the configured web origin", async () => {
    const res = await app.request("/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({ email: "test@example.com", callbackURL: "/" }),
    });

    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });
});

// SPO-109: Twitch/Kick sit in accountLinking.trustedProviders so the link
// callback accepts them (Kick reports emailVerified: false unconditionally).
// That trust also governs implicit account linking on social sign-IN, so the
// app-level guard must refuse these providers as a sign-in path outright.
describe("link-only providers refuse social sign-in", () => {
  it("trusts every link-only provider, satisfying the link callback's untrusted-provider gate", () => {
    const options = (
      auth as unknown as {
        options: { account?: { accountLinking?: { trustedProviders?: string[] } } };
      }
    ).options;
    for (const provider of LINK_ONLY_PROVIDERS) {
      expect(options.account?.accountLinking?.trustedProviders).toContain(provider);
    }
  });

  it.each(["twitch", "kick"])("rejects POST /sign-in/social for %s", async (provider) => {
    const res = await app.request("/api/auth/sign-in/social", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({ provider, callbackURL: "/" }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("PROVIDER_NOT_ALLOWED");
  });

  it("passes other providers through to Better Auth", async () => {
    const res = await app.request("/api/auth/sign-in/social", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({ provider: "google", callbackURL: "/" }),
    });

    // Google isn't configured under the test runner, so Better Auth answers
    // with its own error — the point is the guard didn't intercept it.
    const body = (await res.json()) as { code?: string };
    expect(body.code).not.toBe("PROVIDER_NOT_ALLOWED");
  });
});
