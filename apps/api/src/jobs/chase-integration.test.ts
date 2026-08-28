import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { runChaseTick, sendChaseEmail } from "./chase-tick.js";
import { chaseRouter } from "../routers/chase.js";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";

// ── Mock pg-boss (no DATABASE_URL in test env) ───────────────────────────────

const mockBossSend = vi.fn(() => Promise.resolve());
vi.mock("./boss.js", () => ({
  getBoss: vi.fn(() => Promise.resolve({ send: mockBossSend })),
  stopBoss: vi.fn(() => Promise.resolve()),
}));

// ── Schema SQL (PGlite-compatible, same as tenant-isolation.test.ts) ──────────

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

CREATE TABLE creators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name VARCHAR(255) NOT NULL,
  pronouns VARCHAR(64),
  category VARCHAR(128),
  avatar_url TEXT,
  timezone VARCHAR(64) NOT NULL DEFAULT 'America/New_York',
  default_currency CHAR(3) NOT NULL DEFAULT 'USD',
  plan VARCHAR(32) NOT NULL DEFAULT 'starter',
  paypal_link TEXT,
  wise_text TEXT,
  bank_text TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  subscription_status VARCHAR(32),
  current_period_end TIMESTAMPTZ,
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

CREATE TABLE creator_platforms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  platform VARCHAR(32) NOT NULL,
  ccv INTEGER,
  followers INTEGER,
  schedule_label VARCHAR(255),
  connected_account_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(creator_id, platform)
);

CREATE INDEX creator_platforms_creator_idx ON creator_platforms(creator_id);

CREATE TABLE brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(128),
  domain VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX brands_creator_idx ON brands(creator_id);
CREATE INDEX brands_name_idx ON brands(name);

CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX contacts_brand_idx ON contacts(brand_id);

CREATE TABLE deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,
  primary_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
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

CREATE INDEX deals_creator_idx ON deals(creator_id);
CREATE INDEX deals_brand_idx ON deals(brand_id);
CREATE INDEX deals_stage_idx ON deals(stage);
CREATE INDEX deals_deleted_at_idx ON deals(deleted_at);

CREATE TABLE deliverables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  title VARCHAR(512) NOT NULL,
  platform VARCHAR(32),
  status VARCHAR(32) NOT NULL DEFAULT 'not_started',
  due_at TIMESTAMPTZ,
  due_label VARCHAR(128),
  progress_done INTEGER,
  progress_total INTEGER,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX deliverables_deal_idx ON deliverables(deal_id);
CREATE INDEX deliverables_status_idx ON deliverables(status);

CREATE TABLE proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  deliverable_id UUID REFERENCES deliverables(id) ON DELETE SET NULL,
  kind VARCHAR(32) NOT NULL,
  url TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX proofs_deal_idx ON proofs(deal_id);

CREATE TABLE contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  body_text TEXT,
  file_url TEXT,
  signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX contracts_deal_idx ON contracts(deal_id);

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  number INTEGER NOT NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  title VARCHAR(512),
  milestone_note TEXT,
  amount_cents INTEGER NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  terms VARCHAR(32) NOT NULL DEFAULT 'net_30',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at TIMESTAMPTZ,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  paid_at TIMESTAMPTZ,
  paid_note TEXT,
  rails_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(creator_id, number)
);

CREATE INDEX invoices_creator_idx ON invoices(creator_id);
CREATE INDEX invoices_deal_idx ON invoices(deal_id);
CREATE INDEX invoices_status_idx ON invoices(status);
CREATE INDEX invoices_due_at_idx ON invoices(due_at);

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

CREATE TABLE invoice_chase_state (
  invoice_id UUID PRIMARY KEY REFERENCES invoices(id) ON DELETE CASCADE,
  mode VARCHAR(32) NOT NULL DEFAULT 'armed',
  next_step INTEGER NOT NULL DEFAULT 1,
  next_action_at TIMESTAMPTZ,
  paused_reason VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE chase_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  step INTEGER NOT NULL,
  subject_snapshot TEXT,
  body_snapshot TEXT,
  to_email VARCHAR(255),
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  provider_message_id TEXT,
  idempotency_key VARCHAR(255) UNIQUE,
  queued_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  bounced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX chase_events_invoice_idx ON chase_events(invoice_id);
CREATE INDEX chase_events_status_idx ON chase_events(status);

CREATE TABLE activity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  actor VARCHAR(32) NOT NULL DEFAULT 'creator',
  entity_type VARCHAR(64) NOT NULL,
  entity_id UUID NOT NULL,
  kind VARCHAR(32) NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX activity_events_creator_idx ON activity_events(creator_id);
CREATE INDEX activity_events_entity_idx ON activity_events(entity_type, entity_id);
CREATE INDEX activity_events_created_at_idx ON activity_events(created_at);

CREATE TABLE benchmark_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INTEGER NOT NULL,
  effective_date TIMESTAMPTZ NOT NULL,
  cpvh_bands JSONB NOT NULL,
  adjustments JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX benchmark_configs_effective_idx ON benchmark_configs(effective_date);

CREATE TABLE calculator_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  inputs JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(creator_id)
);
`;

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockCtx(creatorId: string) {
  return {
    session: { user: { id: `user-${creatorId}`, email: "creator@example.com", name: "Test Creator" } },
    creatorId,
    db,
  };
}

async function cleanTables() {
  await db.delete(schema.activityEvents);
  await db.delete(schema.chaseEvents);
  await db.delete(schema.invoiceChaseState);
  await db.delete(schema.chaseTemplates);
  await db.delete(schema.invoices);
  await db.delete(schema.contracts);
  await db.delete(schema.proofs);
  await db.delete(schema.deliverables);
  await db.delete(schema.deals);
  await db.delete(schema.contacts);
  await db.delete(schema.brands);
  await db.delete(schema.creatorPlatforms);
  await db.delete(schema.memberships);
  await db.delete(schema.creators);
}

async function seedFullFlow() {
  const [creator] = await db.insert(schema.creators).values({ displayName: "Streamer One" }).returning();

  const [brand] = await db
    .insert(schema.brands)
    .values({ creatorId: creator.id, name: "Acme Brand" })
    .returning();

  const [contact] = await db
    .insert(schema.contacts)
    .values({ brandId: brand.id, name: "Brand Contact", email: "brand@example.com" })
    .returning();

  const [deal] = await db
    .insert(schema.deals)
    .values({ creatorId: creator.id, brandId: brand.id, title: "Sponsorship Deal", primaryContactId: contact.id })
    .returning();

  // Invoice 3 days past due
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const [invoice] = await db
    .insert(schema.invoices)
    .values({
      creatorId: creator.id,
      dealId: deal.id,
      contactId: contact.id,
      number: 1,
      amountCents: 50000,
      currency: "USD",
      terms: "net_30",
      status: "open",
      title: "Invoice #0001",
      dueAt: threeDaysAgo,
      issuedAt: new Date(Date.now() - 33 * 24 * 60 * 60 * 1000),
    })
    .returning();

  // Template step 1: due date + 1 day (so it's already past due)
  await db.insert(schema.chaseTemplates).values({
    creatorId: creator.id,
    step: 1,
    name: "Friendly reminder",
    offsetDays: 1,
    subject: "Payment reminder for {invoice_id}",
    body: "Hi {brand_contact}, please pay {amount} for {deal_title}.",
    enabled: true,
  });

  // Template step 2
  await db.insert(schema.chaseTemplates).values({
    creatorId: creator.id,
    step: 2,
    name: "Second notice",
    offsetDays: 5,
    subject: "Second notice: {invoice_id}",
    body: "Hi {brand_contact}, this is a follow-up.",
    enabled: true,
  });

  // Armed chase state with nextActionAt in the past (so runChaseTick picks it up)
  await db.insert(schema.invoiceChaseState).values({
    invoiceId: invoice.id,
    mode: "armed",
    nextStep: 1,
    nextActionAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
  });

  return { creator, brand, contact, deal, invoice };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await initPgliteSchema(SCHEMA_SQL);
});

beforeEach(async () => {
  await cleanTables();
  mockBossSend.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Integration tests ────────────────────────────────────────────────────────

describe("chase integration: past-due invoice -> review -> send -> timeline", () => {
  it("runChaseTick creates awaiting_review event for a past-due invoice", async () => {
    const { invoice } = await seedFullFlow();

    const created = await runChaseTick();
    expect(created).toBe(1);

    const events = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("awaiting_review");
    expect(events[0].step).toBe(1);
    expect(events[0].toEmail).toBe("brand@example.com");
    expect(events[0].subjectSnapshot).toContain("INV-0001");
    expect(events[0].bodySnapshot).toContain("please pay $500");
  });

  it("runChaseTick does not treat null nextActionAt as due", async () => {
    const { invoice } = await seedFullFlow();

    // Set nextActionAt to null (unarmed)
    await db
      .update(schema.invoiceChaseState)
      .set({ nextActionAt: null })
      .where(eq(schema.invoiceChaseState.invoiceId, invoice.id));

    const created = await runChaseTick();
    expect(created).toBe(0);

    const events = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));
    expect(events).toHaveLength(0);
  });

  it("approve claims awaiting_review -> approved and enqueues pg-boss job", async () => {
    const { creator, invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    const caller = chaseRouter.createCaller(mockCtx(creator.id));
    const result = await caller.approve({ chaseEventId: event.id });

    expect(result.success).toBe(true);
    expect(result.queued).toBe(true);

    // Event is now approved
    const [updated] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.id, event.id));
    expect(updated.status).toBe("approved");

    // pg-boss job was enqueued with singletonKey
    expect(mockBossSend).toHaveBeenCalledTimes(1);
    const jobName = mockBossSend.mock.calls[0][0];
    const jobArgs = mockBossSend.mock.calls[0][1];
    const jobOpts = mockBossSend.mock.calls[0][2];
    expect(jobName).toBe("chase-send");
    expect(jobArgs.chaseEventId).toBe(event.id);
    expect(jobArgs.invoiceId).toBe(invoice.id);
    expect(jobOpts.singletonKey).toBeDefined();
    expect(jobOpts.retryLimit).toBe(3);

    // Activity event recorded
    const activities = await db
      .select()
      .from(schema.activityEvents)
      .where(
        and(
          eq(schema.activityEvents.entityId, invoice.id),
          eq(schema.activityEvents.kind, "chase_sent")
        )
      )
      .orderBy(desc(schema.activityEvents.createdAt));

    expect(activities.length).toBeGreaterThanOrEqual(1);
    expect(activities[0].payload).toMatchObject({ action: "approve", status: "approved" });
  });

  it("double-approve returns CONFLICT", async () => {
    const { creator, invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    const caller = chaseRouter.createCaller(mockCtx(creator.id));
    await caller.approve({ chaseEventId: event.id });

    // Second approve should fail with BAD_REQUEST because status is already approved
    await expect(caller.approve({ chaseEventId: event.id })).rejects.toSatisfy(
      (err: any) => err.code === "BAD_REQUEST"
    );
  });

  it("sendChaseEmail sends via provider and records sent status + timeline", async () => {
    const { creator, invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    // Approve to move to approved state
    const caller = chaseRouter.createCaller(mockCtx(creator.id));
    await caller.approve({ chaseEventId: event.id });

    // Use PostmarkProvider so fetch stub works
    const prevProvider = process.env.EMAIL_PROVIDER;
    process.env.EMAIL_PROVIDER = "postmark";
    process.env.POSTMARK_SERVER_TOKEN = "test-token";

    // Stub fetch so PostmarkProvider doesn't hit real network
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ MessageID: "msg-sent-1" }) }))
    );

    // Simulate pg-boss worker calling sendChaseEmail
    const result = await sendChaseEmail({
      chaseEventId: event.id,
      invoiceId: invoice.id,
      step: 1,
      toEmail: "brand@example.com",
      fromEmail: "chase@sponsee.app",
      replyToEmail: "creator@example.com",
      subject: event.subjectSnapshot || "Reminder",
      body: event.bodySnapshot || "Please pay",
      idempotencyKey: event.idempotencyKey || `invoice:${invoice.id}:step:1`,
    });

    // Restore env
    if (prevProvider) process.env.EMAIL_PROVIDER = prevProvider;
    else delete process.env.EMAIL_PROVIDER;

    expect(result.providerMessageId).toBeDefined();

    // Event is now sent
    const [updated] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.id, event.id));
    expect(updated.status).toBe("sent");
    expect(updated.providerMessageId).toBe(result.providerMessageId);
    expect(updated.sentAt).not.toBeNull();

    // Timeline activity event
    const activities = await db
      .select()
      .from(schema.activityEvents)
      .where(
        and(
          eq(schema.activityEvents.entityId, invoice.id),
          eq(schema.activityEvents.kind, "chase_sent"),
          eq(schema.activityEvents.actor, "system")
        )
      )
      .orderBy(desc(schema.activityEvents.createdAt));

    const sentActivity = activities.find((a) => (a.payload as any).status === "sent");
    expect(sentActivity).toBeDefined();
    expect((sentActivity!.payload as any).providerMessageId).toBe(result.providerMessageId);
  });

  it("sendChaseEmail fails -> records failed status, then retry succeeds", async () => {
    const { creator, invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    // Approve
    const caller = chaseRouter.createCaller(mockCtx(creator.id));
    await caller.approve({ chaseEventId: event.id });

    // Use PostmarkProvider so fetch stub works
    const prevProvider = process.env.EMAIL_PROVIDER;
    process.env.EMAIL_PROVIDER = "postmark";
    process.env.POSTMARK_SERVER_TOKEN = "test-token";

    // Stub fetch to simulate Postmark failure
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 422, text: () => Promise.resolve("SMTP down") }))
    );

    // First send should fail and record failed status
    await expect(
      sendChaseEmail({
        chaseEventId: event.id,
        invoiceId: invoice.id,
        step: 1,
        toEmail: "brand@example.com",
        fromEmail: "chase@sponsee.app",
        replyToEmail: "creator@example.com",
        subject: event.subjectSnapshot || "Reminder",
        body: event.bodySnapshot || "Please pay",
        idempotencyKey: event.idempotencyKey || `invoice:${invoice.id}:step:1`,
      })
    ).rejects.toThrow("SMTP down");

    const [afterFail] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.id, event.id));
    expect(afterFail.status).toBe("failed");

    // Now make fetch succeed (simulating pg-boss retry)
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ MessageID: "retry-msg-123" }) }))
    );

    const result = await sendChaseEmail({
      chaseEventId: event.id,
      invoiceId: invoice.id,
      step: 1,
      toEmail: "brand@example.com",
      fromEmail: "chase@sponsee.app",
      replyToEmail: "creator@example.com",
      subject: event.subjectSnapshot || "Reminder",
      body: event.bodySnapshot || "Please pay",
      idempotencyKey: event.idempotencyKey || `invoice:${invoice.id}:step:1`,
    });

    if (prevProvider) process.env.EMAIL_PROVIDER = prevProvider;
    else delete process.env.EMAIL_PROVIDER;

    expect(result.providerMessageId).toBe("retry-msg-123");

    const [afterRetry] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.id, event.id));
    expect(afterRetry.status).toBe("sent");
  });

  it("sendChaseEmail is idempotent: second call on already-sent returns existing message id", async () => {
    const { creator, invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    // Approve
    const caller = chaseRouter.createCaller(mockCtx(creator.id));
    await caller.approve({ chaseEventId: event.id });

    // Use PostmarkProvider so fetch stub works
    const prevProvider = process.env.EMAIL_PROVIDER;
    process.env.EMAIL_PROVIDER = "postmark";
    process.env.POSTMARK_SERVER_TOKEN = "test-token";

    // First send succeeds
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ MessageID: "msg-abc" }) }))
    );

    const result1 = await sendChaseEmail({
      chaseEventId: event.id,
      invoiceId: invoice.id,
      step: 1,
      toEmail: "brand@example.com",
      fromEmail: "chase@sponsee.app",
      replyToEmail: "creator@example.com",
      subject: event.subjectSnapshot || "Reminder",
      body: event.bodySnapshot || "Please pay",
      idempotencyKey: event.idempotencyKey || `invoice:${invoice.id}:step:1`,
    });

    // Second concurrent send should return the existing message id (atomic claim skips)
    const result2 = await sendChaseEmail({
      chaseEventId: event.id,
      invoiceId: invoice.id,
      step: 1,
      toEmail: "brand@example.com",
      fromEmail: "chase@sponsee.app",
      replyToEmail: "creator@example.com",
      subject: event.subjectSnapshot || "Reminder",
      body: event.bodySnapshot || "Please pay",
      idempotencyKey: event.idempotencyKey || `invoice:${invoice.id}:step:1`,
    });

    if (prevProvider) process.env.EMAIL_PROVIDER = prevProvider;
    else delete process.env.EMAIL_PROVIDER;

    expect(result2.providerMessageId).toBe(result1.providerMessageId);

    // Only one fetch call should have been made (the second was skipped by atomic claim)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("runChaseTick schedules next action from template offsetDays, not hard-coded +1 day", async () => {
    const { invoice } = await seedFullFlow();
    await runChaseTick();

    const [state] = await db
      .select()
      .from(schema.invoiceChaseState)
      .where(eq(schema.invoiceChaseState.invoiceId, invoice.id));

    expect(state.nextStep).toBe(2);
    expect(state.nextActionAt).not.toBeNull();

    // Template step 2 has offsetDays: 5, so nextActionAt should be
    // dueAt + 5 days (not dueAt + 1 day)
    const expectedNext = new Date(invoice.dueAt!.getTime() + 5 * 24 * 60 * 60 * 1000);
    const actualNext = new Date(state.nextActionAt!);

    // Allow 1-second tolerance for test execution time
    expect(Math.abs(actualNext.getTime() - expectedNext.getTime())).toBeLessThan(1000);
  });

  it("events timeline returns chase events in reverse chronological order", async () => {
    const { creator, invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    // Approve and send
    const caller = chaseRouter.createCaller(mockCtx(creator.id));
    await caller.approve({ chaseEventId: event.id });

    // Use PostmarkProvider so fetch stub works
    const prevProvider = process.env.EMAIL_PROVIDER;
    process.env.EMAIL_PROVIDER = "postmark";
    process.env.POSTMARK_SERVER_TOKEN = "test-token";

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ MessageID: "msg-tl" }) }))
    );

    await sendChaseEmail({
      chaseEventId: event.id,
      invoiceId: invoice.id,
      step: 1,
      toEmail: "brand@example.com",
      fromEmail: "chase@sponsee.app",
      replyToEmail: "creator@example.com",
      subject: event.subjectSnapshot || "Reminder",
      body: event.bodySnapshot || "Please pay",
      idempotencyKey: event.idempotencyKey || `invoice:${invoice.id}:step:1`,
    });

    if (prevProvider) process.env.EMAIL_PROVIDER = prevProvider;
    else delete process.env.EMAIL_PROVIDER;

    // Query timeline via router
    const timeline = await caller.events({ invoiceId: invoice.id });
    expect(timeline).toHaveLength(1);
    expect(timeline[0].status).toBe("sent");
    expect(timeline[0].providerMessageId).toBe("msg-tl");
  });

  it("approve reverts to awaiting_review when boss.send fails", async () => {
    const { creator, invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    mockBossSend.mockRejectedValueOnce(new Error("pg-boss unavailable"));

    const caller = chaseRouter.createCaller(mockCtx(creator.id));
    await expect(caller.approve({ chaseEventId: event.id })).rejects.toSatisfy(
      (err: any) => err.code === "INTERNAL_SERVER_ERROR"
    );

    // Status must be reverted so creator can retry
    const [reverted] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.id, event.id));
    expect(reverted.status).toBe("awaiting_review");
  });

  it("editAndSend reverts to awaiting_review when boss.send fails", async () => {
    const { creator, invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    mockBossSend.mockRejectedValueOnce(new Error("pg-boss unavailable"));

    const caller = chaseRouter.createCaller(mockCtx(creator.id));
    await expect(
      caller.editAndSend({ chaseEventId: event.id, subject: "Edited", body: "Edited body" })
    ).rejects.toSatisfy((err: any) => err.code === "INTERNAL_SERVER_ERROR");

    // Status reverted; snapshots are preserved because the atomic update won
    const [reverted] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.id, event.id));
    expect(reverted.status).toBe("awaiting_review");
  });

  it("editAndSend atomic update prevents losing request from overwriting snapshots", async () => {
    const { creator, invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    // First request wins the claim
    const caller = chaseRouter.createCaller(mockCtx(creator.id));
    await caller.editAndSend({ chaseEventId: event.id, subject: "Winner", body: "Winner body" });

    // Second request should fail because status is no longer awaiting_review
    await expect(
      caller.editAndSend({ chaseEventId: event.id, subject: "Loser", body: "Loser body" })
    ).rejects.toSatisfy((err: any) => err.code === "BAD_REQUEST");

    // Snapshots must retain the winner's values
    const [final] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.id, event.id));
    expect(final.subjectSnapshot).toBe("Winner");
    expect(final.bodySnapshot).toBe("Winner body");
  });

  it("runChaseTick rescues stranded approved events by enqueueing them", async () => {
    const { invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    // Manually strand the event: set approved with an old updatedAt
    await db
      .update(schema.chaseEvents)
      .set({
        status: "approved",
        updatedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
      })
      .where(eq(schema.chaseEvents.id, event.id));

    // runChaseTick should rescue the stranded event
    const created = await runChaseTick();
    // The rescue doesn't count toward created, so it should be 0
    expect(created).toBe(0);

    // A pg-boss job should have been enqueued for the stranded event
    expect(mockBossSend).toHaveBeenCalledTimes(1);
    const jobName = mockBossSend.mock.calls[0][0];
    const jobArgs = mockBossSend.mock.calls[0][1];
    expect(jobName).toBe("chase-send");
    expect(jobArgs.chaseEventId).toBe(event.id);
    expect(jobArgs.invoiceId).toBe(invoice.id);
  });

  it("sendChaseEmail delivery truth: retry promotes sending+providerMessageId to sent without resending", async () => {
    const { creator, invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    // Approve
    const caller = chaseRouter.createCaller(mockCtx(creator.id));
    await caller.approve({ chaseEventId: event.id });

    // Use PostmarkProvider so fetch stub works
    const prevProvider = process.env.EMAIL_PROVIDER;
    process.env.EMAIL_PROVIDER = "postmark";
    process.env.POSTMARK_SERVER_TOKEN = "test-token";

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ MessageID: "msg-dt-1" }) }))
    );

    // First send succeeds
    const result1 = await sendChaseEmail({
      chaseEventId: event.id,
      invoiceId: invoice.id,
      step: 1,
      toEmail: "brand@example.com",
      fromEmail: "chase@sponsee.app",
      replyToEmail: "creator@example.com",
      subject: event.subjectSnapshot || "Reminder",
      body: event.bodySnapshot || "Please pay",
      idempotencyKey: event.idempotencyKey || `invoice:${invoice.id}:step:1`,
    });
    expect(result1.providerMessageId).toBe("msg-dt-1");

    // Simulate a failed status update: the providerMessageId is recorded but status is still "sending"
    await db
      .update(schema.chaseEvents)
      .set({ status: "sending", sentAt: null })
      .where(eq(schema.chaseEvents.id, event.id));

    // Reset fetch mock to verify no second network call
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ MessageID: "msg-dt-2" }) }))
    );

    // Retry should promote to sent without calling provider.send() again
    const result2 = await sendChaseEmail({
      chaseEventId: event.id,
      invoiceId: invoice.id,
      step: 1,
      toEmail: "brand@example.com",
      fromEmail: "chase@sponsee.app",
      replyToEmail: "creator@example.com",
      subject: event.subjectSnapshot || "Reminder",
      body: event.bodySnapshot || "Please pay",
      idempotencyKey: event.idempotencyKey || `invoice:${invoice.id}:step:1`,
    });

    if (prevProvider) process.env.EMAIL_PROVIDER = prevProvider;
    else delete process.env.EMAIL_PROVIDER;

    // Must return the original providerMessageId
    expect(result2.providerMessageId).toBe("msg-dt-1");

    // No second fetch call (no double-send)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(0);

    // Status is now sent
    const [final] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.id, event.id));
    expect(final.status).toBe("sent");
    expect(final.providerMessageId).toBe("msg-dt-1");
  });

  it("real Mailpit acceptance: end-to-end invoice -> review -> approve -> message in inbox -> timeline", async () => {
    // Probe whether Mailpit is running locally
    let mailpitAvailable = false;
    try {
      const probe = await fetch("http://localhost:8025/api/v1/messages", { method: "GET" });
      mailpitAvailable = probe.ok;
    } catch {
      mailpitAvailable = false;
    }

    if (!mailpitAvailable) {
      console.log("Skipping real Mailpit acceptance test: no Mailpit at localhost:8025");
      return;
    }

    const { creator, invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    // Approve (uses real MailpitProvider since we don't stub fetch)
    const caller = chaseRouter.createCaller(mockCtx(creator.id));
    const approveResult = await caller.approve({ chaseEventId: event.id });
    expect(approveResult.queued).toBe(true);

    // Simulate pg-boss worker calling sendChaseEmail with real Mailpit
    const result = await sendChaseEmail({
      chaseEventId: event.id,
      invoiceId: invoice.id,
      step: 1,
      toEmail: "brand@example.com",
      fromEmail: "chase@sponsee.app",
      replyToEmail: "creator@example.com",
      subject: event.subjectSnapshot || "Reminder",
      body: event.bodySnapshot || "Please pay",
      idempotencyKey: event.idempotencyKey || `invoice:${invoice.id}:step:1`,
    });

    expect(result.providerMessageId).toBeTruthy();

    // Verify message landed in Mailpit inbox
    const inboxRes = await fetch("http://localhost:8025/api/v1/messages?limit=20");
    const inboxData = (await inboxRes.json()) as {
      messages?: Array<{ Subject: string; ID: string; To: Array<{ Address: string }> }>;
    };
    const match = inboxData.messages?.find(
      (m) => m.To?.some((t) => t.Address === "brand@example.com")
    );
    expect(match).toBeDefined();

    // Timeline shows sent event
    const timeline = await caller.events({ invoiceId: invoice.id });
    expect(timeline).toHaveLength(1);
    expect(timeline[0].status).toBe("sent");
    expect(timeline[0].providerMessageId).toBe(result.providerMessageId);
  });

  it("fresh database: chase_events has updated_at and it is auto-populated", async () => {
    const { invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    expect(event).toBeDefined();
    expect(event.updatedAt).not.toBeNull();
    expect(new Date(event.updatedAt!).getTime()).toBeGreaterThan(0);
  });
});
