import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { db, pgliteClient } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { and, count, eq } from "drizzle-orm";

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
import { SCHEMA_SQL } from "./test-utils/schema-sql.js";
import { planDealSlots } from "@sponsee/shared";
import {
  isPaidSubscription,
  hasLiveSubscription,
  toSubscriptionStatus,
  getDealSlotLimit,
  canCreateDeal,
} from "./billing/entitlements.js";

async function cleanTables() {
  await db.execute(`
    TRUNCATE TABLE
      chase_templates, deals, brands, memberships, creators, verification, session, account, "user"
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
  // The handler reads STRIPE_WEBHOOK_SECRET per request now (SPO-87 HIGH-2), so
  // the "missing secret" test's `delete` is no longer invisible to the tests
  // that follow it — restore it here rather than leaving the suite order-dependent.
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_dummy";
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

  // SPO-97. `pause_collection` stops invoicing without detaching the
  // subscription from the customer, so it has to answer the two questions
  // differently: no entitlements, but a second Checkout would still double-bill.
  it("treats paused as live but unpaid", () => {
    expect(isPaidSubscription("paused")).toBe(false);
    expect(hasLiveSubscription("paused")).toBe(true);
    expect(getDealSlotLimit("pro", "paused")).toBe(planDealSlots.starter);
    expect(canCreateDeal("pro", "paused", planDealSlots.starter)).toBe(false);
  });

  // The gap this issue closed was upstream of the guard, not in it: `paused`
  // was absent from the enum, so it never survived the coercion to *reach*
  // `hasLiveSubscription` as anything but null. Pin the enum membership itself,
  // since a guard fed null is a guard that says "no subscription".
  it("carries every live Stripe status through the enum coercion", () => {
    for (const status of ["active", "trialing", "past_due", "unpaid", "paused"] as const) {
      expect(toSubscriptionStatus(status)).toBe(status);
      expect(hasLiveSubscription(toSubscriptionStatus(status))).toBe(true);
    }
  });

  it("does not treat dead subscriptions as live", () => {
    for (const status of ["canceled", "incomplete", "incomplete_expired"] as const) {
      expect(hasLiveSubscription(status)).toBe(false);
    }
    expect(hasLiveSubscription(null)).toBe(false);
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

  it("computes active deal count and slot limit from canonical deal data (SPO-42 D-004)", async () => {
    const { creator, cookie } = await createUserAndCreator("test@example.com", "creator");
    await db
      .update(schema.creators)
      .set({ subscriptionStatus: "active" })
      .where(eq(schema.creators.id, creator.id));

    const [brand] = await db.insert(schema.brands).values({ creatorId: creator.id, name: "Acme" }).returning();

    // 2 active deals (inbound, live), 1 paid (terminal, excluded), 1 soft-deleted (excluded)
    await db.insert(schema.deals).values([
      { creatorId: creator.id, brandId: brand.id, title: "Deal A", stage: "inbound" },
      { creatorId: creator.id, brandId: brand.id, title: "Deal B", stage: "live" },
      { creatorId: creator.id, brandId: brand.id, title: "Deal C", stage: "paid" },
      {
        creatorId: creator.id,
        brandId: brand.id,
        title: "Deal D",
        stage: "negotiating",
        deletedAt: new Date(),
      },
    ]);

    const res = await app.request("/api/trpc/billing.getSubscription", {
      method: "GET",
      headers: { cookie, Origin: "http://localhost:3000" },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { data?: { json?: { dealSlotLimit: number; activeDealCount: number } } };
    };
    expect(body.result?.data?.json?.activeDealCount).toBe(2);
    expect(body.result?.data?.json?.dealSlotLimit).toBe(planDealSlots.creator);
  });

  it("does not count another creator's deals toward the caller's usage", async () => {
    const { creator: creatorA, cookie: cookieA } = await createUserAndCreator("a@example.com");
    const { creator: creatorB } = await createUserAndCreator("b@example.com");

    const [brandA] = await db.insert(schema.brands).values({ creatorId: creatorA.id, name: "Acme" }).returning();
    const [brandB] = await db.insert(schema.brands).values({ creatorId: creatorB.id, name: "Acme" }).returning();

    await db.insert(schema.deals).values([
      { creatorId: creatorA.id, brandId: brandA.id, title: "A deal", stage: "inbound" },
      { creatorId: creatorB.id, brandId: brandB.id, title: "B deal 1", stage: "inbound" },
      { creatorId: creatorB.id, brandId: brandB.id, title: "B deal 2", stage: "live" },
    ]);

    const res = await app.request("/api/trpc/billing.getSubscription", {
      method: "GET",
      headers: { cookie: cookieA, Origin: "http://localhost:3000" },
    });

    const body = (await res.json()) as {
      result?: { data?: { json?: { activeDealCount: number } } };
    };
    expect(body.result?.data?.json?.activeDealCount).toBe(1);
  });

  // Stripe identifiers are server-side plumbing. The panel never reads them —
  // plan changes go through `createPortalSession`, which resolves the customer
  // itself — so shipping them to the browser only widens what a stolen session
  // or an XSS payload can walk off with (SPO-87 LOW).
  it("does not expose Stripe customer or subscription ids to the browser", async () => {
    const { creator, cookie } = await createUserAndCreator("test@example.com", "pro");
    await db
      .update(schema.creators)
      .set({
        stripeCustomerId: "cus_secret",
        stripeSubscriptionId: "sub_secret",
        subscriptionStatus: "active",
      })
      .where(eq(schema.creators.id, creator.id));

    const res = await app.request("/api/trpc/billing.getSubscription", {
      method: "GET",
      headers: { cookie, Origin: "http://localhost:3000" },
    });

    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain("cus_secret");
    expect(raw).not.toContain("sub_secret");

    // Everything the panel actually renders is still there.
    const body = JSON.parse(raw) as {
      result?: { data?: { json?: Record<string, unknown> } };
    };
    const payload = body.result?.data?.json ?? {};
    expect(payload).toMatchObject({ plan: "pro", status: "active" });
    expect(payload).toHaveProperty("dealSlotLimit");
    expect(payload).toHaveProperty("activeDealCount");
    expect(payload).not.toHaveProperty("stripeCustomerId");
    expect(payload).not.toHaveProperty("stripeSubscriptionId");
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

  // Webhooks carry the subscription, not the session — the tier has to be on
  // both or the first entitlement write after checkout silently keeps starter.
  it("stamps creatorId and tier onto the subscription metadata", async () => {
    const { creator, cookie } = await createUserAndCreator("test@example.com");

    mockStripeCustomers.create.mockResolvedValue({ id: "cus_new" });
    mockStripeCheckoutSessions.create.mockResolvedValue({
      url: "https://checkout.stripe.com/test",
    });

    await app.request("/api/trpc/billing.createCheckoutSession", {
      method: "POST",
      headers: { cookie, Origin: "http://localhost:3000", "Content-Type": "application/json" },
      body: JSON.stringify({ json: { tier: "creator" } }),
    });

    expect(mockStripeCheckoutSessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        subscription_data: {
          metadata: { creatorId: creator.id, tier: "creator" },
        },
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

  // ── Double-billing guard (SPO-87 HIGH-1) ───────────────────────────────────
  //
  // `mode: "subscription"` Checkout creates an *additional* subscription on the
  // customer; Stripe never cancels the one already there. Without this guard a
  // Pro creator who clicked "Switch to Creator" was billed $39 and $29 every
  // month, and `plan` settled on whichever webhook happened to land last.

  async function attemptCheckout(cookie: string, tier: string) {
    return app.request("/api/trpc/billing.createCheckoutSession", {
      method: "POST",
      headers: { cookie, Origin: "http://localhost:3000", "Content-Type": "application/json" },
      body: JSON.stringify({ json: { tier } }),
    });
  }

  for (const status of ["active", "trialing", "past_due", "unpaid", "paused"] as const) {
    it(`refuses a second checkout while a subscription is ${status}`, async () => {
      const { creator, cookie } = await createUserAndCreator("test@example.com", "pro");
      await db
        .update(schema.creators)
        .set({
          stripeCustomerId: "cus_live",
          stripeSubscriptionId: "sub_live",
          subscriptionStatus: status,
        })
        .where(eq(schema.creators.id, creator.id));

      mockStripeCheckoutSessions.create.mockResolvedValue({
        url: "https://checkout.stripe.com/test",
      });

      const res = await attemptCheckout(cookie, "creator");

      expect(res.status).toBe(409);
      // The assertion that matters: no second subscription was ever opened.
      expect(mockStripeCheckoutSessions.create).not.toHaveBeenCalled();

      // And the creator's billing state is untouched by the rejected attempt.
      const [after] = await db
        .select()
        .from(schema.creators)
        .where(eq(schema.creators.id, creator.id));
      expect(after?.stripeSubscriptionId).toBe("sub_live");
      expect(after?.plan).toBe("pro");
    });
  }

  it("refuses even a checkout for the tier the creator is already on", async () => {
    const { creator, cookie } = await createUserAndCreator("test@example.com", "creator");
    await db
      .update(schema.creators)
      .set({ stripeCustomerId: "cus_live", subscriptionStatus: "active" })
      .where(eq(schema.creators.id, creator.id));

    const res = await attemptCheckout(cookie, "creator");

    expect(res.status).toBe(409);
    expect(mockStripeCheckoutSessions.create).not.toHaveBeenCalled();
  });

  // The mirror image: a subscription that is genuinely dead must not strand the
  // creator outside the funnel. These are the statuses where a fresh Checkout is
  // the correct — and only — way back to paying us.
  for (const status of ["canceled", "incomplete_expired", "incomplete"] as const) {
    it(`still allows checkout after a ${status} subscription`, async () => {
      const { creator, cookie } = await createUserAndCreator("test@example.com");
      await db
        .update(schema.creators)
        .set({ stripeCustomerId: "cus_dead", subscriptionStatus: status })
        .where(eq(schema.creators.id, creator.id));

      mockStripeCheckoutSessions.create.mockResolvedValue({
        url: "https://checkout.stripe.com/test",
      });

      const res = await attemptCheckout(cookie, "pro");

      expect(res.status).toBe(200);
      expect(mockStripeCheckoutSessions.create).toHaveBeenCalledTimes(1);
    });
  }

  it("allows a first checkout when no subscription has ever existed", async () => {
    const { cookie } = await createUserAndCreator("test@example.com");

    mockStripeCustomers.create.mockResolvedValue({ id: "cus_first" });
    mockStripeCheckoutSessions.create.mockResolvedValue({
      url: "https://checkout.stripe.com/test",
    });

    const res = await attemptCheckout(cookie, "pro");

    expect(res.status).toBe(200);
    expect(mockStripeCheckoutSessions.create).toHaveBeenCalledTimes(1);
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

/**
 * Deliver a `customer.subscription.*` webhook.
 *
 * The handler re-fetches the subscription from Stripe instead of trusting the
 * delivered payload (SPO-87 MEDIUM-1), so the fake has to answer `retrieve` as
 * well. By default it echoes the event's own object — the ordinary case where
 * the delivery and Stripe's current state agree. Pass `currentState` to make
 * them disagree, which is exactly what a delayed or replayed delivery looks
 * like on the wire.
 */
function mockSubscriptionEvent(
  type: string,
  object: Record<string, unknown>,
  currentState?: Record<string, unknown>
) {
  mockStripeWebhooks.constructEvent.mockReturnValue({ type, data: { object } });
  mockStripeSubscriptions.retrieve.mockResolvedValue(currentState ?? object);
}

async function postWebhook() {
  return app.request("/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "sig" },
    body: "payload",
  });
}

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

    mockSubscriptionEvent("customer.subscription.updated", {
      id: "sub_456",
      status: "past_due",
      metadata: { creatorId: creator.id },
      current_period_end: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
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
      type: "customer.discount.created",
      data: { object: {} },
    });

    const res = await app.request("/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: "payload",
    });

    expect(res.status).toBe(200);
  });

  // The subscription's price is the only field that tracks a plan change made
  // in the Stripe customer portal — metadata written at checkout never moves.
  it("derives the plan tier from the subscription price, not metadata", async () => {
    const { creator } = await createUserAndCreator("test@example.com");
    await db
      .update(schema.creators)
      .set({ stripeSubscriptionId: "sub_portal", subscriptionStatus: "active", plan: "starter" })
      .where(eq(schema.creators.id, creator.id));

    mockSubscriptionEvent("customer.subscription.updated", {
      id: "sub_portal",
      status: "active",
      // No `tier` in metadata — exactly what a portal-initiated upgrade sends.
      metadata: { creatorId: creator.id },
      items: { data: [{ price: { id: "price_test_pro" } }] },
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
    expect(updated?.plan).toBe("pro");
  });

  it("prefers the subscription price over a stale metadata tier", async () => {
    const { creator } = await createUserAndCreator("test@example.com");
    await db
      .update(schema.creators)
      .set({ stripeSubscriptionId: "sub_stale", subscriptionStatus: "active" })
      .where(eq(schema.creators.id, creator.id));

    mockSubscriptionEvent("customer.subscription.updated", {
      id: "sub_stale",
      status: "active",
      // Creator signed up on pro, then downgraded to creator in the portal.
      metadata: { creatorId: creator.id, tier: "pro" },
      items: { data: [{ price: { id: "price_test_creator" } }] },
    });

    await app.request("/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: "payload",
    });

    const [updated] = await db
      .select()
      .from(schema.creators)
      .where(eq(schema.creators.id, creator.id));
    expect(updated?.plan).toBe("creator");
  });

  it("resolves the creator by stored subscription id when metadata is absent", async () => {
    const { creator } = await createUserAndCreator("test@example.com");
    await db
      .update(schema.creators)
      .set({ stripeSubscriptionId: "sub_nometa" })
      .where(eq(schema.creators.id, creator.id));

    mockSubscriptionEvent("customer.subscription.updated", {
      id: "sub_nometa",
      status: "past_due",
      metadata: {},
      items: { data: [] },
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

  it("resolves the creator by customer id when subscription id is unknown", async () => {
    const { creator } = await createUserAndCreator("test@example.com");
    await db
      .update(schema.creators)
      .set({ stripeCustomerId: "cus_only" })
      .where(eq(schema.creators.id, creator.id));

    mockSubscriptionEvent("customer.subscription.created", {
      id: "sub_brand_new",
      status: "active",
      customer: "cus_only",
      metadata: {},
      items: { data: [{ price: { id: "price_test_creator" } }] },
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
    expect(updated?.stripeSubscriptionId).toBe("sub_brand_new");
    expect(updated?.plan).toBe("creator");
  });

  // A status outside our enum must not reach the UPDATE — a DB error here would
  // 500 and park the event in Stripe's retry loop indefinitely.
  it("stores an unknown Stripe status as null instead of failing", async () => {
    const { creator } = await createUserAndCreator("test@example.com");
    await db
      .update(schema.creators)
      .set({ stripeSubscriptionId: "sub_odd", subscriptionStatus: "active", plan: "pro" })
      .where(eq(schema.creators.id, creator.id));

    mockSubscriptionEvent("customer.subscription.updated", {
      id: "sub_odd",
      // Deliberately not a status Stripe sends today. This test used to use
      // `paused`, which is the one that made the null-collapse a live
      // double-bill (SPO-97) — it is a real enum member now, so proving the
      // fallback needs a value the enum genuinely does not carry.
      status: "some_future_stripe_status",
      metadata: { creatorId: creator.id },
      items: { data: [{ price: { id: "price_test_pro" } }] },
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
    expect(updated?.subscriptionStatus).toBeNull();
    // Unpaid status ⇒ starter limits, even though the plan column still says pro.
    expect(getDealSlotLimit(updated!.plan, updated!.subscriptionStatus)).toBe(planDealSlots.starter);
  });

  // SPO-97, end to end over the production path: Stripe delivers `paused`, the
  // webhook persists it, and the checkout guard reads it back. Before the fix
  // the coercion dropped it to null here, which the guard reads as "no
  // subscription" — so this creator got a *second* subscription billed on top of
  // the paused one, the exact HIGH-1 SPO-87 closed for the other four statuses.
  it("persists a paused subscription and still refuses a second checkout", async () => {
    const { creator, cookie } = await createUserAndCreator("test@example.com", "pro");
    await db
      .update(schema.creators)
      .set({
        stripeCustomerId: "cus_paused",
        stripeSubscriptionId: "sub_paused",
        subscriptionStatus: "active",
      })
      .where(eq(schema.creators.id, creator.id));

    mockSubscriptionEvent("customer.subscription.updated", {
      id: "sub_paused",
      status: "paused",
      metadata: { creatorId: creator.id },
      items: { data: [{ price: { id: "price_test_pro" } }] },
    });

    const hookRes = await app.request("/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: "payload",
    });
    expect(hookRes.status).toBe(200);

    const [updated] = await db
      .select()
      .from(schema.creators)
      .where(eq(schema.creators.id, creator.id));
    // Stored as itself, not collapsed to null.
    expect(updated?.subscriptionStatus).toBe("paused");
    // Live, but paying for nothing: the plan column still says pro and the
    // limits still say starter.
    expect(updated?.plan).toBe("pro");
    expect(getDealSlotLimit(updated!.plan, updated!.subscriptionStatus)).toBe(planDealSlots.starter);

    mockStripeCheckoutSessions.create.mockResolvedValue({
      url: "https://checkout.stripe.com/test",
    });

    const checkoutRes = await app.request("/api/trpc/billing.createCheckoutSession", {
      method: "POST",
      headers: { cookie, Origin: "http://localhost:3000", "Content-Type": "application/json" },
      body: JSON.stringify({ json: { tier: "creator" } }),
    });

    expect(checkoutRes.status).toBe(409);
    expect(mockStripeCheckoutSessions.create).not.toHaveBeenCalled();
  });

  it("ignores a subscription whose creator cannot be resolved", async () => {
    const { creator } = await createUserAndCreator("test@example.com");

    mockSubscriptionEvent("customer.subscription.updated", {
      id: "sub_orphan",
      status: "active",
      metadata: { creatorId: crypto.randomUUID() },
      customer: "cus_unknown",
      items: { data: [{ price: { id: "price_test_pro" } }] },
    });

    const res = await app.request("/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: "payload",
    });
    expect(res.status).toBe(200);

    const [untouched] = await db
      .select()
      .from(schema.creators)
      .where(eq(schema.creators.id, creator.id));
    expect(untouched?.subscriptionStatus).toBeNull();
    expect(untouched?.plan).toBe("starter");
  });

  // ── Signing secret is read per request (SPO-87 HIGH-2) ─────────────────────

  it("reads the signing secret per request, not once at module load", async () => {
    // `apps/api/src/index.ts` imports the app statically and ESM hoists that
    // above the `dotenv.config()` below it, so under `pnpm dev` the secret only
    // exists in the environment *after* this module was evaluated. A secret that
    // appears late still has to be honoured, or every webhook 500s and the
    // Stripe CLI loop documented in .env.example never works.
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect((await postWebhook()).status).toBe(500);

    process.env.STRIPE_WEBHOOK_SECRET = "whsec_loaded_after_import";
    mockStripeWebhooks.constructEvent.mockReturnValue({
      type: "customer.discount.created",
      data: { object: {} },
    });

    expect((await postWebhook()).status).toBe(200);
    expect(mockStripeWebhooks.constructEvent).toHaveBeenLastCalledWith(
      "payload",
      "sig",
      "whsec_loaded_after_import"
    );
  });

  // ── Cancellation and dunning (SPO-24 coverage gap) ─────────────────────────

  it("drops entitlements to starter on customer.subscription.deleted", async () => {
    const { creator } = await createUserAndCreator("test@example.com", "pro");
    await db
      .update(schema.creators)
      .set({ stripeSubscriptionId: "sub_gone", subscriptionStatus: "active" })
      .where(eq(schema.creators.id, creator.id));

    mockSubscriptionEvent("customer.subscription.deleted", {
      id: "sub_gone",
      status: "canceled",
      metadata: { creatorId: creator.id },
      items: { data: [{ price: { id: "price_test_pro" } }] },
    });

    expect((await postWebhook()).status).toBe(200);

    const [updated] = await db
      .select()
      .from(schema.creators)
      .where(eq(schema.creators.id, creator.id));

    expect(updated?.subscriptionStatus).toBe("canceled");
    // The `plan` column deliberately still reads pro — it records what they
    // bought. What they may *do* is decided by status, and that is now starter.
    expect(getDealSlotLimit(updated!.plan, updated!.subscriptionStatus)).toBe(planDealSlots.starter);
  });

  it("marks the subscription past_due on invoice.payment_failed", async () => {
    const { creator } = await createUserAndCreator("test@example.com", "pro");
    await db
      .update(schema.creators)
      .set({ stripeSubscriptionId: "sub_dunning", subscriptionStatus: "active" })
      .where(eq(schema.creators.id, creator.id));

    mockStripeWebhooks.constructEvent.mockReturnValue({
      type: "invoice.payment_failed",
      data: { object: { id: "in_1", subscription: "sub_dunning" } },
    });
    mockStripeSubscriptions.retrieve.mockResolvedValue({
      id: "sub_dunning",
      status: "past_due",
      metadata: { creatorId: creator.id },
      items: { data: [{ price: { id: "price_test_pro" } }] },
    });

    expect((await postWebhook()).status).toBe(200);

    const [updated] = await db
      .select()
      .from(schema.creators)
      .where(eq(schema.creators.id, creator.id));

    expect(updated?.subscriptionStatus).toBe("past_due");
    expect(getDealSlotLimit(updated!.plan, updated!.subscriptionStatus)).toBe(planDealSlots.starter);
  });

  it("restores entitlements on invoice.payment_succeeded after dunning", async () => {
    const { creator } = await createUserAndCreator("test@example.com", "pro");
    await db
      .update(schema.creators)
      .set({ stripeSubscriptionId: "sub_recovered", subscriptionStatus: "past_due" })
      .where(eq(schema.creators.id, creator.id));

    mockStripeWebhooks.constructEvent.mockReturnValue({
      type: "invoice.payment_succeeded",
      data: { object: { id: "in_2", subscription: "sub_recovered" } },
    });
    mockStripeSubscriptions.retrieve.mockResolvedValue({
      id: "sub_recovered",
      status: "active",
      metadata: { creatorId: creator.id },
      items: { data: [{ price: { id: "price_test_pro" } }] },
    });

    expect((await postWebhook()).status).toBe(200);

    const [updated] = await db
      .select()
      .from(schema.creators)
      .where(eq(schema.creators.id, creator.id));

    expect(updated?.subscriptionStatus).toBe("active");
    expect(getDealSlotLimit(updated!.plan, updated!.subscriptionStatus)).toBe(planDealSlots.pro);
  });

  // ── Out-of-order / replayed delivery (SPO-87 MEDIUM-1) ─────────────────────

  it("does not resurrect a canceled subscription when a stale active update lands late", async () => {
    const { creator } = await createUserAndCreator("test@example.com", "pro");
    await db
      .update(schema.creators)
      .set({ stripeSubscriptionId: "sub_zombie", subscriptionStatus: "canceled" })
      .where(eq(schema.creators.id, creator.id));

    // Stripe retries failed deliveries for days and does not order them. This is
    // a `subscription.updated (active)` arriving *after* the cancellation it
    // predates — written straight through it would hand back Pro limits to a
    // creator who is no longer paying, permanently and silently.
    mockSubscriptionEvent(
      "customer.subscription.updated",
      {
        id: "sub_zombie",
        status: "active",
        metadata: { creatorId: creator.id },
        items: { data: [{ price: { id: "price_test_pro" } }] },
      },
      {
        id: "sub_zombie",
        status: "canceled",
        metadata: { creatorId: creator.id },
        items: { data: [{ price: { id: "price_test_pro" } }] },
      }
    );

    expect((await postWebhook()).status).toBe(200);

    const [updated] = await db
      .select()
      .from(schema.creators)
      .where(eq(schema.creators.id, creator.id));

    expect(updated?.subscriptionStatus).toBe("canceled");
    expect(getDealSlotLimit(updated!.plan, updated!.subscriptionStatus)).toBe(planDealSlots.starter);
  });

  it("re-reads the subscription rather than trusting a replayed payload's tier", async () => {
    const { creator } = await createUserAndCreator("test@example.com", "pro");
    await db
      .update(schema.creators)
      .set({ stripeSubscriptionId: "sub_replay", subscriptionStatus: "active" })
      .where(eq(schema.creators.id, creator.id));

    // A duplicate of the original pro-tier delivery, replayed after the creator
    // downgraded to creator in the portal.
    mockSubscriptionEvent(
      "customer.subscription.updated",
      {
        id: "sub_replay",
        status: "active",
        metadata: { creatorId: creator.id },
        items: { data: [{ price: { id: "price_test_pro" } }] },
      },
      {
        id: "sub_replay",
        status: "active",
        metadata: { creatorId: creator.id },
        items: { data: [{ price: { id: "price_test_creator" } }] },
      }
    );

    expect((await postWebhook()).status).toBe(200);

    const [updated] = await db
      .select()
      .from(schema.creators)
      .where(eq(schema.creators.id, creator.id));
    expect(updated?.plan).toBe("creator");
    expect(mockStripeSubscriptions.retrieve).toHaveBeenCalledWith("sub_replay");
  });

  it("retries (500) rather than trust an unverified active update", async () => {
    const { creator } = await createUserAndCreator("test@example.com");
    await db
      .update(schema.creators)
      .set({ stripeSubscriptionId: "sub_unverifiable", subscriptionStatus: "canceled" })
      .where(eq(schema.creators.id, creator.id));

    mockStripeWebhooks.constructEvent.mockReturnValue({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_unverifiable",
          status: "active",
          metadata: { creatorId: creator.id },
          items: { data: [{ price: { id: "price_test_pro" } }] },
        },
      },
    });
    mockStripeSubscriptions.retrieve.mockRejectedValue(new Error("Stripe API unavailable"));

    // 500 puts the event back in Stripe's retry queue, which is the right
    // outcome: better a delayed upgrade than an upgrade granted on the strength
    // of a payload we could not confirm.
    expect((await postWebhook()).status).toBe(500);

    const [updated] = await db
      .select()
      .from(schema.creators)
      .where(eq(schema.creators.id, creator.id));
    expect(updated?.subscriptionStatus).toBe("canceled");
  });

  it("still records a cancellation when the subscription cannot be re-fetched", async () => {
    const { creator } = await createUserAndCreator("test@example.com", "pro");
    await db
      .update(schema.creators)
      .set({ stripeSubscriptionId: "sub_vanished", subscriptionStatus: "active" })
      .where(eq(schema.creators.id, creator.id));

    mockStripeWebhooks.constructEvent.mockReturnValue({
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_vanished",
          status: "canceled",
          metadata: { creatorId: creator.id },
          items: { data: [{ price: { id: "price_test_pro" } }] },
        },
      },
    });
    mockStripeSubscriptions.retrieve.mockRejectedValue(new Error("No such subscription"));

    // The payload can only move a creator *down* to canceled here, so falling
    // back to it is the safe direction — unlike the updated case above.
    expect((await postWebhook()).status).toBe(200);

    const [updated] = await db
      .select()
      .from(schema.creators)
      .where(eq(schema.creators.id, creator.id));
    expect(updated?.subscriptionStatus).toBe("canceled");
  });
});

// ── Plan gating (deal slots) ─────────────────────────────────────────────────

describe("plan gate on deals.create", () => {
  async function createBrand(creatorId: string) {
    const [brand] = await db
      .insert(schema.brands)
      .values({ creatorId, name: "Acme" })
      .returning();
    return brand;
  }

  async function fillDeals(creatorId: string, brandId: string, n: number) {
    if (n === 0) return;
    await db.insert(schema.deals).values(
      Array.from({ length: n }, (_, i) => ({
        creatorId,
        brandId,
        title: `Existing ${i}`,
        stage: "inbound" as const,
      }))
    );
  }

  async function attemptCreate(cookie: string, brandId: string, title: string) {
    return app.request("/api/trpc/deals.create", {
      method: "POST",
      headers: { cookie, Origin: "http://localhost:3000", "Content-Type": "application/json" },
      body: JSON.stringify({ json: { brandId, title, type: "flat" } }),
    });
  }

  it("allows creation below the starter limit", async () => {
    const { creator, cookie } = await createUserAndCreator("test@example.com");
    const brand = await createBrand(creator.id);
    await fillDeals(creator.id, brand.id, planDealSlots.starter - 1);

    const res = await attemptCreate(cookie, brand.id, "One more");
    expect(res.status).toBe(200);
  });

  it("blocks creation at the starter limit", async () => {
    const { creator, cookie } = await createUserAndCreator("test@example.com");
    const brand = await createBrand(creator.id);
    await fillDeals(creator.id, brand.id, planDealSlots.starter);

    const res = await attemptCreate(cookie, brand.id, "Over the line");
    expect(res.status).toBe(403);

    const [{ total }] = await db
      .select({ total: count() })
      .from(schema.deals)
      .where(eq(schema.deals.creatorId, creator.id));
    expect(total).toBe(planDealSlots.starter);
  });

  it("honours the higher limit for an active paid plan", async () => {
    const { creator, cookie } = await createUserAndCreator("test@example.com", "pro");
    await db
      .update(schema.creators)
      .set({ subscriptionStatus: "active" })
      .where(eq(schema.creators.id, creator.id));

    const brand = await createBrand(creator.id);
    await fillDeals(creator.id, brand.id, planDealSlots.starter);

    // Would be blocked on starter; allowed because pro is active.
    const res = await attemptCreate(cookie, brand.id, "Pro deal");
    expect(res.status).toBe(200);
  });

  // Dunning: a lapsed Pro creator keeps their data but can't open new deals.
  it("falls back to starter limits when a paid plan is past due", async () => {
    const { creator, cookie } = await createUserAndCreator("test@example.com", "pro");
    await db
      .update(schema.creators)
      .set({ subscriptionStatus: "past_due" })
      .where(eq(schema.creators.id, creator.id));

    const brand = await createBrand(creator.id);
    await fillDeals(creator.id, brand.id, planDealSlots.starter);

    const res = await attemptCreate(cookie, brand.id, "Should be blocked");
    expect(res.status).toBe(403);
  });

  it("does not count another creator's deals against the caller's limit", async () => {
    const { creator: creatorA, cookie: cookieA } = await createUserAndCreator("a@example.com");
    const { creator: creatorB } = await createUserAndCreator("b@example.com");

    const brandA = await createBrand(creatorA.id);
    const brandB = await createBrand(creatorB.id);

    await fillDeals(creatorB.id, brandB.id, planDealSlots.starter);
    await fillDeals(creatorA.id, brandA.id, planDealSlots.starter - 1);

    const res = await attemptCreate(cookieA, brandA.id, "A's last slot");
    expect(res.status).toBe(200);
  });

  it("frees a slot when a deal reaches the paid stage", async () => {
    const { creator, cookie } = await createUserAndCreator("test@example.com");
    const brand = await createBrand(creator.id);
    await fillDeals(creator.id, brand.id, planDealSlots.starter);

    expect((await attemptCreate(cookie, brand.id, "Blocked")).status).toBe(403);

    const [oldest] = await db
      .select()
      .from(schema.deals)
      .where(eq(schema.deals.creatorId, creator.id));
    await db
      .update(schema.deals)
      .set({ stage: "paid" })
      .where(eq(schema.deals.id, oldest.id));

    expect((await attemptCreate(cookie, brand.id, "Now allowed")).status).toBe(200);
  });
});

// ── Reopening a paid deal (SPO-87 MEDIUM-2) ──────────────────────────────────
//
// `countActiveDeals` excludes `paid`, so marking a deal paid releases its slot.
// Moving it back takes one again — and every write path that can do that has to
// be gated, or a creator sitting at their limit parks deals in `paid` and
// reopens them for free, which is the tier limit bypassed just as surely as an
// ungated create would.

describe("plan gate on reopening a paid deal", () => {
  async function seedAtLimit(email: string) {
    const { creator, cookie } = await createUserAndCreator(email);
    const [brand] = await db
      .insert(schema.brands)
      .values({ creatorId: creator.id, name: "Acme" })
      .returning();

    // One paid deal (holding no slot) plus a full complement of active ones.
    const [paidDeal] = await db
      .insert(schema.deals)
      .values({ creatorId: creator.id, brandId: brand.id, title: "Settled", stage: "paid" })
      .returning();
    await db.insert(schema.deals).values(
      Array.from({ length: planDealSlots.starter }, (_, i) => ({
        creatorId: creator.id,
        brandId: brand.id,
        title: `Active ${i}`,
        stage: "inbound" as const,
      }))
    );

    return { creator, cookie, brand, paidDeal };
  }

  async function callDeals(cookie: string, procedure: string, input: Record<string, unknown>) {
    return app.request(`/api/trpc/deals.${procedure}`, {
      method: "POST",
      headers: { cookie, Origin: "http://localhost:3000", "Content-Type": "application/json" },
      body: JSON.stringify({ json: input }),
    });
  }

  async function stageOf(dealId: string) {
    const [deal] = await db.select().from(schema.deals).where(eq(schema.deals.id, dealId));
    return deal?.stage;
  }

  it("blocks deals.update from moving a paid deal back to an active stage at the limit", async () => {
    const { cookie, paidDeal } = await seedAtLimit("test@example.com");

    const res = await callDeals(cookie, "update", { id: paidDeal.id, stage: "negotiating" });

    expect(res.status).toBe(403);
    expect(await stageOf(paidDeal.id)).toBe("paid");
  });

  it("blocks deals.updateStage from moving a paid deal back to an active stage at the limit", async () => {
    const { cookie, paidDeal } = await seedAtLimit("test@example.com");

    const res = await callDeals(cookie, "updateStage", { id: paidDeal.id, stage: "inbound" });

    expect(res.status).toBe(403);
    expect(await stageOf(paidDeal.id)).toBe("paid");
  });

  it("allows the reopen once a slot is free", async () => {
    const { creator, cookie, paidDeal } = await seedAtLimit("test@example.com");

    // Settle one of the active deals, freeing exactly one slot.
    const [active] = await db
      .select()
      .from(schema.deals)
      .where(and(eq(schema.deals.creatorId, creator.id), eq(schema.deals.stage, "inbound")));
    await db.update(schema.deals).set({ stage: "paid" }).where(eq(schema.deals.id, active.id));

    const res = await callDeals(cookie, "updateStage", { id: paidDeal.id, stage: "negotiating" });

    expect(res.status).toBe(200);
    expect(await stageOf(paidDeal.id)).toBe("negotiating");
  });

  it("never blocks the paid direction — settling a deal always frees its slot", async () => {
    const { creator, cookie } = await seedAtLimit("test@example.com");

    const [active] = await db
      .select()
      .from(schema.deals)
      .where(and(eq(schema.deals.creatorId, creator.id), eq(schema.deals.stage, "inbound")));

    const res = await callDeals(cookie, "updateStage", { id: active.id, stage: "paid" });

    expect(res.status).toBe(200);
    expect(await stageOf(active.id)).toBe("paid");
  });

  it("leaves non-stage edits to a paid deal ungated", async () => {
    const { cookie, paidDeal } = await seedAtLimit("test@example.com");

    const res = await callDeals(cookie, "update", { id: paidDeal.id, title: "Settled (renamed)" });

    expect(res.status).toBe(200);
    expect(await stageOf(paidDeal.id)).toBe("paid");
  });

  it("does not let one creator reopen another creator's paid deal", async () => {
    const { paidDeal } = await seedAtLimit("a@example.com");
    const { cookie: cookieB } = await createUserAndCreator("b@example.com");

    const res = await callDeals(cookieB, "updateStage", { id: paidDeal.id, stage: "inbound" });

    expect(res.status).toBe(404);
    expect(await stageOf(paidDeal.id)).toBe("paid");
  });
});
