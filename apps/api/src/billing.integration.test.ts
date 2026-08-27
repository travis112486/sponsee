import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { db, pgliteClient } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { eq } from "drizzle-orm";

// Set required env vars BEFORE billing modules load.
process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_dummy";
process.env.STRIPE_PRICE_STARTER = "price_test_starter";
process.env.STRIPE_PRICE_CREATOR = "price_test_creator";
process.env.STRIPE_PRICE_PRO = "price_test_pro";
process.env.WEB_URL = "http://localhost:3000";

// Capture magic-link URLs sent during tests
const sentEmails: Array<{ email: string; url: string }> = [];

// Mock nodemailer BEFORE auth.ts evaluates.
vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn(async ({ to, text }: { to: string; text: string }) => {
        const match = text.match(/(http[^\s]+)/);
        if (match) {
          sentEmails.push({ email: to, url: match[1] });
        }
      }),
    })),
  },
}));

// Mock Stripe BEFORE any billing modules import it.
const mockStripeCustomers = {
  create: vi.fn(),
};
const mockStripeCheckoutSessions = {
  create: vi.fn(),
};
const mockStripeBillingPortalSessions = {
  create: vi.fn(),
};
const mockStripeSubscriptions = {
  retrieve: vi.fn(),
};
const mockStripeWebhooks = {
  constructEvent: vi.fn(),
};

vi.mock("stripe", () => ({
  default: class MockStripe {
    customers = mockStripeCustomers;
    checkout = { sessions: mockStripeCheckoutSessions };
    billingPortal = { sessions: mockStripeBillingPortalSessions };
    subscriptions = mockStripeSubscriptions;
    webhooks = mockStripeWebhooks;
  },
}));

// Import app AFTER mocks are registered.
const { default: app } = await import("./app.js");
import { initPgliteSchema } from "./test-utils/pglite-setup.js";
import { planDealSlots } from "@sponsee/shared";
import { isPaidSubscription, getDealSlotLimit, canCreateDeal } from "./billing/entitlements.js";

const SCHEMA_SQL = `
DROP TABLE IF EXISTS activity_events CASCADE;
DROP TABLE IF EXISTS chase_events CASCADE;
DROP TABLE IF EXISTS invoice_chase_state CASCADE;
DROP TABLE IF EXISTS chase_templates CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS contracts CASCADE;
DROP TABLE IF EXISTS proofs CASCADE;
DROP TABLE IF EXISTS deliverables CASCADE;
DROP TABLE IF EXISTS deals CASCADE;
DROP TABLE IF EXISTS contacts CASCADE;
DROP TABLE IF EXISTS brands CASCADE;
DROP TABLE IF EXISTS creator_platforms CASCADE;
DROP TABLE IF EXISTS memberships CASCADE;
DROP TABLE IF EXISTS creators CASCADE;
DROP TABLE IF EXISTS calculator_profiles CASCADE;
DROP TABLE IF EXISTS benchmark_configs CASCADE;
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

CREATE TABLE session (
  id TEXT PRIMARY KEY NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE INDEX session_user_idx ON session(user_id);

CREATE TABLE account (
  id TEXT PRIMARY KEY NOT NULL,
  issuer TEXT NOT NULL,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at TIMESTAMPTZ,
  refresh_token_expires_at TIMESTAMPTZ,
  scope TEXT,
  password TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX account_issuer_account_id_idx ON account(issuer, account_id);

CREATE TABLE verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX verification_identifier_idx ON verification(identifier);

CREATE TABLE creators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name VARCHAR(255) NOT NULL,
  pronouns VARCHAR(64),
  category VARCHAR(128),
  avatar_url TEXT,
  timezone VARCHAR(64) NOT NULL DEFAULT 'America/New_York',
  default_currency CHAR(3) NOT NULL DEFAULT 'USD',
  plan VARCHAR(32) NOT NULL DEFAULT 'starter',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  subscription_status VARCHAR(32),
  current_period_end TIMESTAMPTZ,
  paypal_link TEXT,
  wise_text TEXT,
  bank_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX creators_plan_idx ON creators(plan);

CREATE TABLE memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  creator_id UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  role VARCHAR(32) NOT NULL DEFAULT 'owner',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, creator_id)
);

CREATE INDEX memberships_creator_idx ON memberships(creator_id);

CREATE TABLE deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL,
  primary_contact_id UUID,
  title VARCHAR(512) NOT NULL,
  type VARCHAR(32) NOT NULL DEFAULT 'flat',
  value_cents INTEGER NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  value_note TEXT,
  stage VARCHAR(32) NOT NULL DEFAULT 'inbound',
  platforms VARCHAR(32)[],
  payment_terms VARCHAR(32) NOT NULL DEFAULT 'net_30',
  source VARCHAR(255),
  notes TEXT,
  bounty_rate_note TEXT,
  bounty_count INTEGER,
  bounty_payout_cents INTEGER,
  stage_entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE chase_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  step INTEGER NOT NULL,
  name VARCHAR(128) NOT NULL,
  offset_days INTEGER NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(creator_id, step)
);
`;

async function cleanTables() {
  await db.execute(`
    TRUNCATE TABLE
      chase_templates, deals, memberships, creators, verification, session, account, "user"
    CASCADE
  `);
}

async function createUserAndCreator(email: string, plan: schema.PlanTier = "starter") {
  // Sign in via magic link to get a real session cookie
  const signInRes = await app.request("/api/auth/sign-in/magic-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, callbackURL: "/" }),
  });
  expect(signInRes.status).toBe(200);

  const lastEmail = sentEmails[sentEmails.length - 1];
  expect(lastEmail?.email).toBe(email);

  const magicUrl = new URL(lastEmail.url);
  const verifyRes = await app.request(lastEmail.url.replace(magicUrl.origin, ""), {
    method: "GET",
  });
  expect(verifyRes.status).toBe(302);

  const setCookie = verifyRes.headers.get("set-cookie") || "";
  expect(setCookie).toContain("sponsee.session_token");

  // Resolve user + creator from DB
  const [user] = await db.select().from(schema.user).where(eq(schema.user.email, email));
  const [membership] = await db
    .select()
    .from(schema.memberships)
    .where(eq(schema.memberships.userId, user.id));
  const [creator] = await db
    .select()
    .from(schema.creators)
    .where(eq(schema.creators.id, membership.creatorId));

  // Apply requested plan (provisioning always sets starter)
  if (plan !== "starter") {
    await db.update(schema.creators).set({ plan }).where(eq(schema.creators.id, creator.id));
  }

  return { user, creator, cookie: setCookie };
}

beforeAll(async () => {
  if (!pgliteClient) throw new Error("PGlite client not available");
  await initPgliteSchema(SCHEMA_SQL);
});

beforeEach(async () => {
  await cleanTables();
  sentEmails.length = 0;
  vi.clearAllMocks();
});

// ── Entitlements ─────────────────────────────────────────────────────────────

describe("entitlements", () => {
  it("recognizes active and trialing as paid", () => {
    expect(isPaidSubscription("active")).toBe(true);
    expect(isPaidSubscription("trialing")).toBe(true);
    expect(isPaidSubscription("past_due")).toBe(false);
    expect(isPaidSubscription("canceled")).toBe(false);
    expect(isPaidSubscription(null)).toBe(false);
  });

  it("returns starter limits when subscription is not paid", () => {
    expect(getDealSlotLimit("pro", null)).toBe(planDealSlots.starter);
    expect(getDealSlotLimit("pro", "past_due")).toBe(planDealSlots.starter);
  });

  it("returns plan limits when subscription is paid", () => {
    expect(getDealSlotLimit("starter", "active")).toBe(planDealSlots.starter);
    expect(getDealSlotLimit("creator", "active")).toBe(planDealSlots.creator);
    expect(getDealSlotLimit("pro", "active")).toBe(planDealSlots.pro);
  });

  it("allows deal creation within limit", () => {
    expect(canCreateDeal("starter", "active", 4)).toBe(true);
    expect(canCreateDeal("starter", "active", 5)).toBe(false);
  });
});

// ── Billing router ───────────────────────────────────────────────────────────

describe("billing.getSubscription", () => {
  it("returns subscription state for authenticated creator", async () => {
    const { creator, cookie } = await createUserAndCreator("test@example.com", "creator");
    await db
      .update(schema.creators)
      .set({
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        subscriptionStatus: "active",
      })
      .where(eq(schema.creators.id, creator.id));

    const res = await app.request("/api/trpc/billing.getSubscription", {
      method: "GET",
      headers: { cookie, Origin: "http://localhost:3000" },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { data?: { json?: { plan: string; status: string | null } } };
    };
    expect(body.result?.data?.json?.plan).toBe("creator");
    expect(body.result?.data?.json?.status).toBe("active");
  });
});

describe("billing.createCheckoutSession", () => {
  it("creates a Stripe customer and checkout session", async () => {
    const { creator, cookie } = await createUserAndCreator("test@example.com");

    mockStripeCustomers.create.mockResolvedValue({ id: "cus_new" });
    mockStripeCheckoutSessions.create.mockResolvedValue({
      url: "https://checkout.stripe.com/test",
    });

    const res = await app.request("/api/trpc/billing.createCheckoutSession", {
      method: "POST",
      headers: {
        cookie,
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ json: { tier: "pro" } }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { data?: { json?: { url: string } } };
    };
    expect(body.result?.data?.json?.url).toBe("https://checkout.stripe.com/test");

    // Verify creator got a stripeCustomerId
    const [updated] = await db
      .select({ stripeCustomerId: schema.creators.stripeCustomerId })
      .from(schema.creators)
      .where(eq(schema.creators.id, creator.id));
    expect(updated?.stripeCustomerId).toBe("cus_new");

    expect(mockStripeCheckoutSessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        line_items: [{ price: "price_test_pro", quantity: 1 }],
        metadata: expect.objectContaining({ creatorId: creator.id, tier: "pro" }),
      })
    );
  });

  it("reuses existing Stripe customer", async () => {
    const { creator, cookie } = await createUserAndCreator("test@example.com");
    await db
      .update(schema.creators)
      .set({ stripeCustomerId: "cus_existing" })
      .where(eq(schema.creators.id, creator.id));

    mockStripeCheckoutSessions.create.mockResolvedValue({
      url: "https://checkout.stripe.com/test",
    });

    const res = await app.request("/api/trpc/billing.createCheckoutSession", {
      method: "POST",
      headers: {
        cookie,
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ json: { tier: "creator" } }),
    });

    expect(res.status).toBe(200);
    expect(mockStripeCustomers.create).not.toHaveBeenCalled();
    expect(mockStripeCheckoutSessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_existing" })
    );
  });
});

describe("billing.createPortalSession", () => {
  it("returns portal URL for creator with Stripe customer", async () => {
    const { creator, cookie } = await createUserAndCreator("test@example.com");
    await db
      .update(schema.creators)
      .set({ stripeCustomerId: "cus_portal" })
      .where(eq(schema.creators.id, creator.id));

    mockStripeBillingPortalSessions.create.mockResolvedValue({
      url: "https://billing.stripe.com/test",
    });

    const res = await app.request("/api/trpc/billing.createPortalSession", {
      method: "POST",
      headers: {
        cookie,
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ json: {} }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { data?: { json?: { url: string } } };
    };
    expect(body.result?.data?.json?.url).toBe("https://billing.stripe.com/test");
  });

  it("returns 412 when creator has no Stripe customer", async () => {
    const { cookie } = await createUserAndCreator("test@example.com");

    const res = await app.request("/api/trpc/billing.createPortalSession", {
      method: "POST",
      headers: {
        cookie,
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ json: {} }),
    });

    expect(res.status).toBe(412);
  });
});

// ── Stripe webhook ───────────────────────────────────────────────────────────

describe("stripe webhook", () => {
  it("rejects when webhook secret is missing", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = await app.request("/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: "payload",
    });
    expect(res.status).toBe(500);
  });

  it("rejects invalid signature", async () => {
    mockStripeWebhooks.constructEvent.mockImplementation(() => {
      throw new Error("Invalid signature");
    });

    const res = await app.request("/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "bad_sig" },
      body: "payload",
    });
    expect(res.status).toBe(400);
  });

  it("updates creator on checkout.session.completed", async () => {
    const { creator } = await createUserAndCreator("test@example.com");

    mockStripeWebhooks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_123",
          mode: "subscription",
          metadata: { creatorId: creator.id, tier: "pro" },
          subscription: "sub_123",
        },
      },
    });

    mockStripeSubscriptions.retrieve.mockResolvedValue({
      id: "sub_123",
      status: "active",
      metadata: { creatorId: creator.id, tier: "pro" },
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    });

    const res = await app.request("/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: "payload",
    });

    expect(res.status).toBe(200);

    const [updated] = await db
      .select()
      .from(schema.creators)
      .where(eq(schema.creators.id, creator.id));

    expect(updated?.stripeSubscriptionId).toBe("sub_123");
    expect(updated?.subscriptionStatus).toBe("active");
    expect(updated?.plan).toBe("pro");
    expect(updated?.currentPeriodEnd).toBeInstanceOf(Date);
  });

  it("updates creator on customer.subscription.updated", async () => {
    const { creator } = await createUserAndCreator("test@example.com");
    await db
      .update(schema.creators)
      .set({ stripeSubscriptionId: "sub_456" })
      .where(eq(schema.creators.id, creator.id));

    mockStripeWebhooks.constructEvent.mockReturnValue({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_456",
          status: "past_due",
          metadata: { creatorId: creator.id },
          current_period_end: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
        },
      },
    });

    const res = await app.request("/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: "payload",
    });

    expect(res.status).toBe(200);

    const [updated] = await db
      .select()
      .from(schema.creators)
      .where(eq(schema.creators.id, creator.id));

    expect(updated?.subscriptionStatus).toBe("past_due");
  });

  it("silently accepts unhandled event types", async () => {
    mockStripeWebhooks.constructEvent.mockReturnValue({
      type: "invoice.payment_succeeded",
      data: { object: {} },
    });

    const res = await app.request("/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: "payload",
    });

    expect(res.status).toBe(200);
  });
});
