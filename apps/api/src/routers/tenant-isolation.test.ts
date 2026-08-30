import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { settingsRouter } from "../routers/settings.js";
import { brandRouter } from "../routers/brand.js";
import { deliverableRouter } from "../routers/deliverable.js";
import { proofRouter } from "../routers/proof.js";
import { dealsRouter } from "../routers/deals.js";
import { invoiceRouter } from "../routers/invoice.js";
import { chaseRouter } from "../routers/chase.js";
import { activityRouter } from "../routers/activity.js";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";

// ── Schema SQL (PGlite-compatible, derived from packages/db/src/init.ts) ─────

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
  handle VARCHAR(255),
  channel_url TEXT,
  avatar_url TEXT,
  subscriber_count INTEGER,
  subscriber_count_is_estimate BOOLEAN NOT NULL DEFAULT FALSE,
  last_synced_at TIMESTAMPTZ,
  sync_status VARCHAR(32) NOT NULL DEFAULT 'never',
  sync_error TEXT,
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
  storage_key TEXT,
  mime_type VARCHAR(255),
  size_bytes INTEGER,
  uploaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX proofs_deal_idx ON proofs(deal_id);

CREATE TABLE contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  body_text TEXT,
  file_url TEXT,
  storage_key TEXT,
  mime_type VARCHAR(255),
  size_bytes INTEGER,
  uploaded_at TIMESTAMPTZ,
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
  enqueued_at TIMESTAMPTZ,
  send_job_id TEXT,
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
    session: { user: { id: `user-${creatorId}`, email: "test@example.com", name: "Test User" } },
    creatorId,
    db,
  };
}

let creatorAId = "";
let creatorBId = "";
let brandAId = "";
let brandBId = "";
let contactAId = "";
let contactBId = "";
let dealAId = "";
let dealBId = "";
let platformAId = "";
let platformBId = "";
let deliverableAId = "";
let deliverableBId = "";
let proofAId = "";
let proofBId = "";
let invoiceAId = "";
let invoiceBId = "";
let templateAId = "";
let templateBId = "";
let chaseEventAId = "";
let chaseEventBId = "";

async function seed() {
  const [creatorA] = await db.insert(schema.creators).values({ displayName: "Creator A" }).returning();
  const [creatorB] = await db.insert(schema.creators).values({ displayName: "Creator B" }).returning();
  creatorAId = creatorA.id;
  creatorBId = creatorB.id;

  const [brandA] = await db
    .insert(schema.brands)
    .values({ creatorId: creatorAId, name: "Brand A" })
    .returning();
  const [brandB] = await db
    .insert(schema.brands)
    .values({ creatorId: creatorBId, name: "Brand B" })
    .returning();
  brandAId = brandA.id;
  brandBId = brandB.id;

  const [contactA] = await db
    .insert(schema.contacts)
    .values({ brandId: brandAId, name: "Contact A", email: "a@example.com" })
    .returning();
  const [contactB] = await db
    .insert(schema.contacts)
    .values({ brandId: brandBId, name: "Contact B", email: "b@example.com" })
    .returning();
  contactAId = contactA.id;
  contactBId = contactB.id;

  const [dealA] = await db
    .insert(schema.deals)
    .values({ creatorId: creatorAId, brandId: brandAId, title: "Deal A" })
    .returning();
  const [dealB] = await db
    .insert(schema.deals)
    .values({ creatorId: creatorBId, brandId: brandBId, title: "Deal B" })
    .returning();
  dealAId = dealA.id;
  dealBId = dealB.id;

  const [platformA] = await db
    .insert(schema.creatorPlatforms)
    .values({ creatorId: creatorAId, platform: "twitch", ccv: 100 })
    .returning();
  const [platformB] = await db
    .insert(schema.creatorPlatforms)
    .values({ creatorId: creatorBId, platform: "youtube", ccv: 200 })
    .returning();
  platformAId = platformA.id;
  platformBId = platformB.id;

  const [delA] = await db
    .insert(schema.deliverables)
    .values({ dealId: dealAId, title: "Deliverable A", position: 0 })
    .returning();
  const [delB] = await db
    .insert(schema.deliverables)
    .values({ dealId: dealBId, title: "Deliverable B", position: 0 })
    .returning();
  deliverableAId = delA.id;
  deliverableBId = delB.id;

  const [proofA] = await db
    .insert(schema.proofs)
    .values({ dealId: dealAId, deliverableId: deliverableAId, kind: "clip", url: "https://clips.twitch.tv/a" })
    .returning();
  const [proofB] = await db
    .insert(schema.proofs)
    .values({ dealId: dealBId, deliverableId: deliverableBId, kind: "vod", url: "https://youtube.com/watch?v=b" })
    .returning();
  proofAId = proofA.id;
  proofBId = proofB.id;

  const [invoiceA] = await db
    .insert(schema.invoices)
    .values({
      creatorId: creatorAId,
      dealId: dealAId,
      contactId: contactAId,
      number: 1,
      amountCents: 10000,
      currency: "USD",
      terms: "net_30",
      status: "open",
      title: "Invoice A",
    })
    .returning();
  invoiceAId = invoiceA.id;

  const [invoiceB] = await db
    .insert(schema.invoices)
    .values({
      creatorId: creatorBId,
      dealId: dealBId,
      contactId: contactBId,
      number: 1,
      amountCents: 20000,
      currency: "USD",
      terms: "net_30",
      status: "open",
      title: "Invoice B",
    })
    .returning();
  invoiceBId = invoiceB.id;

  const [templateA] = await db
    .insert(schema.chaseTemplates)
    .values({
      creatorId: creatorAId,
      step: 1,
      name: "Day 1",
      offsetDays: 1,
      subject: "Payment due",
      body: "Please pay",
      enabled: true,
    })
    .returning();
  const [templateB] = await db
    .insert(schema.chaseTemplates)
    .values({
      creatorId: creatorBId,
      step: 1,
      name: "Day 1",
      offsetDays: 1,
      subject: "Payment due",
      body: "Please pay",
      enabled: true,
    })
    .returning();
  templateAId = templateA.id;
  templateBId = templateB.id;

  await db.insert(schema.invoiceChaseState).values({
    invoiceId: invoiceAId,
    mode: "armed",
    nextStep: 1,
  });
  await db.insert(schema.invoiceChaseState).values({
    invoiceId: invoiceBId,
    mode: "armed",
    nextStep: 1,
  });

  const [chaseEventA] = await db
    .insert(schema.chaseEvents)
    .values({
      invoiceId: invoiceAId,
      step: 1,
      subjectSnapshot: "Pay up",
      bodySnapshot: "Please pay",
      toEmail: "brand-a@example.com",
      status: "awaiting_review",
    })
    .returning();
  const [chaseEventB] = await db
    .insert(schema.chaseEvents)
    .values({
      invoiceId: invoiceBId,
      step: 1,
      subjectSnapshot: "Pay up",
      bodySnapshot: "Please pay",
      toEmail: "brand-b@example.com",
      status: "awaiting_review",
    })
    .returning();
  chaseEventAId = chaseEventA.id;
  chaseEventBId = chaseEventB.id;
}

async function cleanTables() {
  // TRUNCATE is more reliable than DELETE ALL in PGlite/Drizzle
  await db.execute(sql`
    TRUNCATE TABLE
      activity_events,
      chase_events,
      invoice_chase_state,
      chase_templates,
      invoices,
      contracts,
      proofs,
      deliverables,
      deals,
      contacts,
      brands,
      creator_platforms,
      memberships,
      creators
    CASCADE
  `);
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await initPgliteSchema(SCHEMA_SQL);
});

beforeEach(async () => {
  await cleanTables();
  await seed();
});

// ── Settings router ──────────────────────────────────────────────────────────

describe("settings router tenant isolation", () => {
  describe("upsertPlatform", () => {
    it("updates an owned platform", async () => {
      const caller = settingsRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.upsertPlatform({
        id: platformAId,
        platform: "twitch",
        ccv: 999,
      });
      expect(result).toBeDefined();
      expect(result?.ccv).toBe(999);
    });

    it("throws NOT_FOUND when updating a cross-creator platform", async () => {
      const caller = settingsRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.upsertPlatform({
          id: platformBId,
          platform: "youtube",
          ccv: 999,
        })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });

    it("does not mutate a cross-creator platform on rejection", async () => {
      const caller = settingsRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.upsertPlatform({
          id: platformBId,
          platform: "youtube",
          ccv: 999,
        });
      } catch {
        // expected
      }

      const [row] = await db
        .select()
        .from(schema.creatorPlatforms)
        .where(eq(schema.creatorPlatforms.id, platformBId));
      expect(row.ccv).toBe(200);
    });
  });

  describe("deletePlatform", () => {
    it("deletes an owned platform", async () => {
      const caller = settingsRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.deletePlatform({ id: platformAId });
      expect(result.success).toBe(true);

      const rows = await db
        .select()
        .from(schema.creatorPlatforms)
        .where(eq(schema.creatorPlatforms.id, platformAId));
      expect(rows).toHaveLength(0);
    });

    it("throws NOT_FOUND when deleting a cross-creator platform", async () => {
      const caller = settingsRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.deletePlatform({ id: platformBId })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });

    it("does not delete a cross-creator platform on rejection", async () => {
      const caller = settingsRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.deletePlatform({ id: platformBId });
      } catch {
        // expected
      }

      const rows = await db
        .select()
        .from(schema.creatorPlatforms)
        .where(eq(schema.creatorPlatforms.id, platformBId));
      expect(rows).toHaveLength(1);
    });
  });
});

// ── Brand router ─────────────────────────────────────────────────────────────

describe("brand router tenant isolation", () => {
  describe("contacts", () => {
    it("returns contacts for an owned brand", async () => {
      const caller = brandRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.contacts({ brandId: brandAId });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(contactAId);
    });

    it("throws NOT_FOUND for a cross-creator brand", async () => {
      const caller = brandRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.contacts({ brandId: brandBId })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });

    it("does not leak contacts for a cross-creator brand", async () => {
      const caller = brandRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.contacts({ brandId: brandBId });
      } catch {
        // expected
      }
    });
  });

  describe("addContact", () => {
    it("adds a contact to an owned brand", async () => {
      const caller = brandRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.addContact({
        brandId: brandAId,
        name: "New Contact",
        email: "new@example.com",
      });
      expect(result).toBeDefined();
      expect(result.brandId).toBe(brandAId);
    });

    it("throws NOT_FOUND for a cross-creator brand", async () => {
      const caller = brandRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.addContact({
          brandId: brandBId,
          name: "Evil",
          email: "evil@example.com",
        })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });

    it("does not insert a contact for a cross-creator brand on rejection", async () => {
      const caller = brandRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.addContact({
          brandId: brandBId,
          name: "Evil",
          email: "evil@example.com",
        });
      } catch {
        // expected
      }

      const rows = await db
        .select()
        .from(schema.contacts)
        .where(eq(schema.contacts.brandId, brandBId));
      expect(rows).toHaveLength(1); // still only contactB
    });
  });
});

// ── Deliverable router ───────────────────────────────────────────────────────

describe("deliverable router tenant isolation", () => {
  describe("listByDeal", () => {
    it("returns deliverables for an owned deal", async () => {
      const caller = deliverableRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.listByDeal({ dealId: dealAId });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(deliverableAId);
    });

    it("throws NOT_FOUND for a cross-creator deal", async () => {
      const caller = deliverableRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.listByDeal({ dealId: dealBId })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });
  });

  describe("update", () => {
    it("updates an owned deliverable", async () => {
      const caller = deliverableRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.update({ id: deliverableAId, title: "Updated A" });
      expect(result).toBeDefined();
      expect(result?.title).toBe("Updated A");
    });

    it("throws NOT_FOUND for a cross-creator deliverable", async () => {
      const caller = deliverableRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.update({ id: deliverableBId, title: "Hacked" })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });

    it("does not mutate a cross-creator deliverable on rejection", async () => {
      const caller = deliverableRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.update({ id: deliverableBId, title: "Hacked" });
      } catch {
        // expected
      }

      const [row] = await db
        .select()
        .from(schema.deliverables)
        .where(eq(schema.deliverables.id, deliverableBId));
      expect(row.title).toBe("Deliverable B");
    });
  });

  describe("delete", () => {
    it("deletes an owned deliverable", async () => {
      const caller = deliverableRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.delete({ id: deliverableAId });
      expect(result.success).toBe(true);

      const rows = await db
        .select()
        .from(schema.deliverables)
        .where(eq(schema.deliverables.id, deliverableAId));
      expect(rows).toHaveLength(0);
    });

    it("throws NOT_FOUND for a cross-creator deliverable", async () => {
      const caller = deliverableRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.delete({ id: deliverableBId })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });

    it("does not delete a cross-creator deliverable on rejection", async () => {
      const caller = deliverableRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.delete({ id: deliverableBId });
      } catch {
        // expected
      }

      const rows = await db
        .select()
        .from(schema.deliverables)
        .where(eq(schema.deliverables.id, deliverableBId));
      expect(rows).toHaveLength(1);
    });
  });
});

// ── Proof router ─────────────────────────────────────────────────────────────

describe("proof router tenant isolation", () => {
  describe("listByDeal", () => {
    it("returns proofs for an owned deal", async () => {
      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.listByDeal({ dealId: dealAId });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(proofAId);
    });

    it("throws NOT_FOUND for a cross-creator deal", async () => {
      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.listByDeal({ dealId: dealBId })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });
  });

  describe("create", () => {
    it("creates a proof on an owned deal and records an activity event", async () => {
      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      const proof = await caller.create({
        dealId: dealAId,
        deliverableId: deliverableAId,
        kind: "vod",
        url: "https://twitch.tv/videos/123",
        note: "Sponsor segment at 1:02:00",
      });
      expect(proof.dealId).toBe(dealAId);
      expect(proof.deliverableId).toBe(deliverableAId);
      expect(proof.kind).toBe("vod");

      const events = await db
        .select()
        .from(schema.activityEvents)
        .where(eq(schema.activityEvents.entityId, proof.id));
      expect(events).toHaveLength(1);
      expect(events[0].creatorId).toBe(creatorAId);
      expect(events[0].kind).toBe("deliverable");
      expect(events[0].payload).toMatchObject({ action: "proof_added", proofKind: "vod" });
    });

    it("accepts a note-only proof", async () => {
      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      const proof = await caller.create({
        dealId: dealAId,
        deliverableId: deliverableAId,
        kind: "chat",
        note: "Chat went wild during the ad read",
      });
      expect(proof.url).toBeNull();
      expect(proof.note).toBe("Chat went wild during the ad read");
    });

    it("rejects a proof with neither url nor note", async () => {
      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.create({ dealId: dealAId, deliverableId: deliverableAId, kind: "clip" })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "BAD_REQUEST");
    });

    it("rejects non-http(s) links", async () => {
      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      for (const url of [
        "javascript:alert(document.cookie)",
        "JaVaScRiPt:alert(1)",
        "data:text/html;base64,PHNjcmlwdD4=",
        "file:///etc/passwd",
      ]) {
        await expect(
          caller.create({ dealId: dealAId, deliverableId: deliverableAId, kind: "link", url })
        ).rejects.toSatisfy((err: TRPCError) => err.code === "BAD_REQUEST");
      }
    });

    it("throws NOT_FOUND for a cross-creator deal", async () => {
      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.create({ dealId: dealBId, kind: "clip", url: "https://example.com/x" })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });

    it("throws NOT_FOUND when the deliverable belongs to a different deal", async () => {
      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.create({
          dealId: dealAId,
          deliverableId: deliverableBId,
          kind: "clip",
          url: "https://example.com/x",
        })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });
  });

  describe("delete", () => {
    it("deletes an owned proof and records an activity event", async () => {
      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.delete({ id: proofAId });
      expect(result.success).toBe(true);

      const rows = await db.select().from(schema.proofs).where(eq(schema.proofs.id, proofAId));
      expect(rows).toHaveLength(0);

      const events = await db
        .select()
        .from(schema.activityEvents)
        .where(eq(schema.activityEvents.entityId, proofAId));
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({ action: "proof_removed", proofKind: "clip" });
    });

    it("throws NOT_FOUND for a cross-creator proof", async () => {
      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.delete({ id: proofBId })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });

    it("does not delete a cross-creator proof on rejection", async () => {
      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.delete({ id: proofBId });
      } catch {
        // expected
      }

      const rows = await db.select().from(schema.proofs).where(eq(schema.proofs.id, proofBId));
      expect(rows).toHaveLength(1);
    });
  });
});

// ── Deals router ─────────────────────────────────────────────────────────────

describe("deals router tenant isolation", () => {
  describe("getById", () => {
    it("returns an owned deal with brand and contact", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.getById({ id: dealAId });
      expect(result).toBeDefined();
      expect(result?.id).toBe(dealAId);
      expect(result?.brand?.id).toBe(brandAId);
    });

    it("returns null for a cross-creator deal", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.getById({ id: dealBId });
      expect(result).toBeNull();
    });
  });

  describe("create", () => {
    it("creates a deal with an owned brand", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.create({
        brandId: brandAId,
        title: "New Deal",
        type: "flat",
      });
      expect(result).toBeDefined();
      expect(result.brandId).toBe(brandAId);
    });

    it("throws NOT_FOUND when using a cross-creator brand", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.create({
          brandId: brandBId,
          title: "Evil Deal",
          type: "flat",
        })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });

    it("does not create a deal for a cross-creator brand on rejection", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.create({
          brandId: brandBId,
          title: "Evil Deal",
          type: "flat",
        });
      } catch {
        // expected
      }

      const rows = await db
        .select()
        .from(schema.deals)
        .where(eq(schema.deals.brandId, brandBId));
      expect(rows).toHaveLength(1); // still only Deal B
    });

    it("throws NOT_FOUND when using a cross-creator contact", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.create({
          brandId: brandAId,
          primaryContactId: contactBId,
          title: "Evil Deal",
          type: "flat",
        })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });
  });

  describe("update", () => {
    it("updates an owned deal", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.update({ id: dealAId, title: "Updated Deal" });
      expect(result).toBeDefined();
      expect(result?.title).toBe("Updated Deal");
    });

    it("throws NOT_FOUND for a cross-creator deal", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.update({ id: dealBId, title: "Hacked" })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });

    it("does not mutate a cross-creator deal on rejection", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.update({ id: dealBId, title: "Hacked" });
      } catch {
        // expected
      }

      const [row] = await db
        .select()
        .from(schema.deals)
        .where(eq(schema.deals.id, dealBId));
      expect(row.title).toBe("Deal B");
    });

    it("throws NOT_FOUND when updating with a cross-creator contact", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.update({ id: dealAId, primaryContactId: contactBId })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });
  });

  describe("updateStage", () => {
    it("updates stage for an owned deal", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.updateStage({ id: dealAId, stage: "negotiating" });
      expect(result).toBeDefined();
      expect(result?.stage).toBe("negotiating");
    });

    it("throws NOT_FOUND for a cross-creator deal", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.updateStage({ id: dealBId, stage: "negotiating" })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });
  });

  describe("delete", () => {
    it("soft-deletes an owned deal", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.delete({ id: dealAId });
      expect(result).toBeDefined();
      expect(result?.deletedAt).not.toBeNull();
    });

    it("throws NOT_FOUND for a cross-creator deal", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.delete({ id: dealBId })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });

    it("does not soft-delete a cross-creator deal on rejection", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.delete({ id: dealBId });
      } catch {
        // expected
      }

      const [row] = await db
        .select()
        .from(schema.deals)
        .where(eq(schema.deals.id, dealBId));
      expect(row.deletedAt).toBeNull();
    });
  });
});

// ── Invoice router ───────────────────────────────────────────────────────────

describe("invoice router tenant isolation", () => {
  describe("listByDeal", () => {
    it("returns invoices for an owned deal", async () => {
      const caller = invoiceRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.listByDeal({ dealId: dealAId });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(invoiceAId);
    });

    it("returns empty for a cross-creator deal", async () => {
      const caller = invoiceRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.listByDeal({ dealId: dealBId });
      expect(result).toHaveLength(0);
    });
  });

  describe("create", () => {
    it("creates an invoice for an owned deal", async () => {
      const caller = invoiceRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.create({
        dealId: dealAId,
        contactId: contactAId,
        amountCents: 50000,
        title: "New Invoice",
      });
      expect(result).toBeDefined();
      expect(result.dealId).toBe(dealAId);
      expect(result.creatorId).toBe(creatorAId);
    });

    it("throws NOT_FOUND when using a cross-creator deal", async () => {
      const caller = invoiceRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.create({
          dealId: dealBId,
          amountCents: 50000,
          title: "Evil Invoice",
        })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });

    it("does not create an invoice for a cross-creator deal on rejection", async () => {
      const caller = invoiceRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.create({
          dealId: dealBId,
          amountCents: 50000,
          title: "Evil Invoice",
        });
      } catch {
        // expected
      }

      const rows = await db
        .select()
        .from(schema.invoices)
        .where(eq(schema.invoices.dealId, dealBId));
      expect(rows).toHaveLength(1); // seeded invoice B only; evil invoice rejected
    });

    it("throws NOT_FOUND when using a cross-creator contact", async () => {
      const caller = invoiceRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.create({
          dealId: dealAId,
          contactId: contactBId,
          amountCents: 50000,
          title: "Evil Invoice",
        })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });
  });

  describe("update", () => {
    it("updates an owned invoice", async () => {
      const caller = invoiceRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.update({ id: invoiceAId, title: "Updated Invoice" });
      expect(result).toBeDefined();
      expect(result?.title).toBe("Updated Invoice");
    });

    it("throws NOT_FOUND for a cross-creator invoice", async () => {
      // Create an invoice for creator B
      const [invoiceB] = await db
        .insert(schema.invoices)
        .values({
          creatorId: creatorBId,
          dealId: dealBId,
          contactId: contactBId,
          number: 99,
          amountCents: 20000,
          title: "Invoice B",
        })
        .returning();

      const caller = invoiceRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.update({ id: invoiceB.id, title: "Hacked" })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });

    it("does not mutate a cross-creator invoice on rejection", async () => {
      const [invoiceB] = await db
        .insert(schema.invoices)
        .values({
          creatorId: creatorBId,
          dealId: dealBId,
          contactId: contactBId,
          number: 99,
          amountCents: 20000,
          title: "Invoice B",
        })
        .returning();

      const caller = invoiceRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.update({ id: invoiceB.id, title: "Hacked" });
      } catch {
        // expected
      }

      const [row] = await db
        .select()
        .from(schema.invoices)
        .where(eq(schema.invoices.id, invoiceB.id));
      expect(row.title).toBe("Invoice B");
    });
  });

  describe("markPaid", () => {
    it("marks an owned invoice as paid", async () => {
      const caller = invoiceRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.markPaid({ id: invoiceAId });
      expect(result).toBeDefined();
      expect(result?.status).toBe("paid");
    });

    it("throws NOT_FOUND for a cross-creator invoice", async () => {
      const [invoiceB] = await db
        .insert(schema.invoices)
        .values({
          creatorId: creatorBId,
          dealId: dealBId,
          contactId: contactBId,
          number: 99,
          amountCents: 20000,
          title: "Invoice B",
        })
        .returning();

      const caller = invoiceRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.markPaid({ id: invoiceB.id })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });

    it("does not mutate chase state for a cross-creator invoice on rejection", async () => {
      const [invoiceB] = await db
        .insert(schema.invoices)
        .values({
          creatorId: creatorBId,
          dealId: dealBId,
          contactId: contactBId,
          number: 99,
          amountCents: 20000,
          title: "Invoice B",
        })
        .returning();

      await db.insert(schema.invoiceChaseState).values({
        invoiceId: invoiceB.id,
        mode: "armed",
        nextStep: 1,
      });

      const caller = invoiceRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.markPaid({ id: invoiceB.id });
      } catch {
        // expected
      }

      const [state] = await db
        .select()
        .from(schema.invoiceChaseState)
        .where(eq(schema.invoiceChaseState.invoiceId, invoiceB.id));
      expect(state.mode).toBe("armed");
    });
  });
});

// ── Chase router ─────────────────────────────────────────────────────────────

describe("chase router tenant isolation", () => {
  describe("templates", () => {
    it("returns only owned templates", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.templates();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(templateAId);
    });
  });

  describe("updateTemplate", () => {
    it("updates an owned template", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.updateTemplate({
        id: templateAId,
        subject: "Updated subject",
      });
      expect(result).toBeDefined();
      expect(result?.subject).toBe("Updated subject");
    });

    it("throws NOT_FOUND for a cross-creator template", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.updateTemplate({
          id: templateBId,
          subject: "Hacked",
        })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });

    it("does not mutate a cross-creator template on rejection", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.updateTemplate({
          id: templateBId,
          subject: "Hacked",
        });
      } catch {
        // expected
      }

      const [row] = await db
        .select()
        .from(schema.chaseTemplates)
        .where(eq(schema.chaseTemplates.id, templateBId));
      expect(row.subject).toBe("Payment due");
    });
  });

  describe("state", () => {
    it("returns chase state for an owned invoice", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.state({ invoiceId: invoiceAId });
      expect(result).toBeDefined();
      expect(result?.invoiceId).toBe(invoiceAId);
    });

    it("throws NOT_FOUND for a cross-creator invoice", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.state({ invoiceId: invoiceBId })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });
  });

  describe("pause", () => {
    it("pauses chase for an owned invoice", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.pause({ invoiceId: invoiceAId, reason: "vacation" });
      expect(result.success).toBe(true);

      const [state] = await db
        .select()
        .from(schema.invoiceChaseState)
        .where(eq(schema.invoiceChaseState.invoiceId, invoiceAId));
      expect(state.mode).toBe("paused");
    });

    it("throws NOT_FOUND for a cross-creator invoice", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.pause({ invoiceId: invoiceBId })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });

    it("does not write an activity event for a cross-creator invoice", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.pause({ invoiceId: invoiceBId, reason: "vacation" });
      } catch {
        // expected
      }

      const afterEvents = await db
        .select()
        .from(schema.activityEvents)
        .where(
          and(
            eq(schema.activityEvents.creatorId, creatorAId),
            eq(schema.activityEvents.entityId, invoiceBId)
          )
        );
      expect(afterEvents).toHaveLength(0);
    });
  });

  describe("resume", () => {
    it("resumes chase for an owned invoice", async () => {
      // First pause
      await db
        .update(schema.invoiceChaseState)
        .set({ mode: "paused", pausedReason: "vacation" })
        .where(eq(schema.invoiceChaseState.invoiceId, invoiceAId));

      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.resume({ invoiceId: invoiceAId });
      expect(result.success).toBe(true);

      const [state] = await db
        .select()
        .from(schema.invoiceChaseState)
        .where(eq(schema.invoiceChaseState.invoiceId, invoiceAId));
      expect(state.mode).toBe("armed");
    });

    it("throws NOT_FOUND for a cross-creator invoice", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.resume({ invoiceId: invoiceBId })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });

    it("does not write an activity event for a cross-creator invoice", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.resume({ invoiceId: invoiceBId });
      } catch {
        // expected
      }

      const afterEvents = await db
        .select()
        .from(schema.activityEvents)
        .where(
          and(
            eq(schema.activityEvents.creatorId, creatorAId),
            eq(schema.activityEvents.entityId, invoiceBId)
          )
        );
      expect(afterEvents).toHaveLength(0);
    });
  });

  describe("events", () => {
    it("returns events for an owned invoice", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.events({ invoiceId: invoiceAId });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(chaseEventAId);
    });

    it("throws NOT_FOUND for a cross-creator invoice", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.events({ invoiceId: invoiceBId })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });
  });

  describe("approve", () => {
    it("throws NOT_FOUND for a cross-creator chase event", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.approve({ chaseEventId: chaseEventBId })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });

    it("does not mutate a cross-creator chase event on rejection", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.approve({ chaseEventId: chaseEventBId });
      } catch {
        // expected
      }

      const [row] = await db
        .select()
        .from(schema.chaseEvents)
        .where(eq(schema.chaseEvents.id, chaseEventBId));
      expect(row.status).toBe("awaiting_review");
    });
  });

  describe("editAndSend", () => {
    it("throws NOT_FOUND for a cross-creator chase event", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.editAndSend({ chaseEventId: chaseEventBId, subject: "Hey", body: "Pay" })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });

    it("does not mutate a cross-creator chase event on rejection", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.editAndSend({ chaseEventId: chaseEventBId, subject: "Hey", body: "Pay" });
      } catch {
        // expected
      }

      const [row] = await db
        .select()
        .from(schema.chaseEvents)
        .where(eq(schema.chaseEvents.id, chaseEventBId));
      expect(row.status).toBe("awaiting_review");
      expect(row.subjectSnapshot).toBe("Pay up");
    });
  });
});

// ── Activity router ──────────────────────────────────────────────────────────

describe("activity router tenant isolation", () => {
  describe("list", () => {
    it("returns only the caller's own activity events, newest first", async () => {
      const older = new Date("2026-08-19T12:00:00Z");
      const newer = new Date("2026-08-24T12:00:00Z");

      await db.insert(schema.activityEvents).values([
        {
          creatorId: creatorAId,
          actor: "system",
          entityType: "invoice",
          entityId: invoiceAId,
          kind: "chase_sent",
          payload: { status: "sent", step: 1 },
          createdAt: older,
        },
        {
          creatorId: creatorAId,
          actor: "creator",
          entityType: "invoice",
          entityId: invoiceAId,
          kind: "chase_sent",
          payload: { action: "approve" },
          createdAt: newer,
        },
        {
          creatorId: creatorBId,
          actor: "system",
          entityType: "invoice",
          entityId: invoiceBId,
          kind: "chase_sent",
          payload: { status: "sent", step: 1 },
          createdAt: newer,
        },
      ]);

      const caller = activityRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.list();

      expect(result).toHaveLength(2);
      expect(result.every((e) => e.creatorId === creatorAId)).toBe(true);
      expect(result[0].createdAt.getTime()).toBe(newer.getTime());
      expect(result[1].createdAt.getTime()).toBe(older.getTime());
    });

    it("respects the limit input", async () => {
      await db.insert(schema.activityEvents).values(
        Array.from({ length: 5 }, (_, i) => ({
          creatorId: creatorAId,
          actor: "system" as const,
          entityType: "invoice",
          entityId: invoiceAId,
          kind: "chase_sent" as const,
          payload: { step: i },
        }))
      );

      const caller = activityRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.list({ limit: 2 });
      expect(result).toHaveLength(2);
    });
  });
});
