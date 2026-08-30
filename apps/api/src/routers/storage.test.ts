import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { eq, sql } from "drizzle-orm";
import { storageRouter } from "./storage.js";
import { proofRouter } from "./proof.js";
import { contractRouter } from "./contract.js";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";

// Same full schema as the other integration test files (single-fork shares one
// PGlite instance, so every suite must be able to stand up the whole schema).
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

function mockCtx(creatorId: string) {
  return {
    session: { user: { id: `user-${creatorId}`, email: "test@example.com", name: "Test User" } },
    creatorId,
    db,
  };
}

let creatorAId = "";
let creatorBId = "";
let dealAId = "";
let dealBId = "";

async function seed() {
  const [creatorA] = await db.insert(schema.creators).values({ displayName: "Creator A" }).returning();
  const [creatorB] = await db.insert(schema.creators).values({ displayName: "Creator B" }).returning();
  creatorAId = creatorA.id;
  creatorBId = creatorB.id;

  const [brandA] = await db.insert(schema.brands).values({ creatorId: creatorAId, name: "Brand A" }).returning();
  const [brandB] = await db.insert(schema.brands).values({ creatorId: creatorBId, name: "Brand B" }).returning();

  const [dealA] = await db.insert(schema.deals).values({ creatorId: creatorAId, brandId: brandA.id, title: "Deal A", stage: "negotiating" }).returning();
  const [dealB] = await db.insert(schema.deals).values({ creatorId: creatorBId, brandId: brandB.id, title: "Deal B" }).returning();
  dealAId = dealA.id;
  dealBId = dealB.id;
}

async function cleanTables() {
  await db.execute(sql`
    TRUNCATE TABLE
      activity_events,
      proofs,
      contracts,
      deliverables,
      deals,
      brands,
      creators
    CASCADE
  `);
}

beforeAll(async () => {
  await initPgliteSchema(SCHEMA_SQL);
});

beforeEach(async () => {
  await cleanTables();
  await seed();
});

describe("storage.requestUpload", () => {
  it("issues a creator-scoped presigned PUT for a valid proof upload", async () => {
    const caller = storageRouter.createCaller(mockCtx(creatorAId));
    const result = await caller.requestUpload({
      purpose: "proof",
      dealId: dealAId,
      mimeType: "image/png",
      sizeBytes: 1234,
    });

    expect(result.key).toMatch(new RegExp(`^${creatorAId}/proofs/${dealAId}/`));
    expect(result.uploadUrl).toBe(`memory://upload/${result.key}`);
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  it("routes contract uploads under /contracts/", async () => {
    const caller = storageRouter.createCaller(mockCtx(creatorAId));
    const result = await caller.requestUpload({
      purpose: "contract",
      dealId: dealAId,
      mimeType: "application/pdf",
      sizeBytes: 500,
    });
    expect(result.key).toContain(`${creatorAId}/contracts/${dealAId}/`);
  });

  it("rejects a deal owned by another creator", async () => {
    const caller = storageRouter.createCaller(mockCtx(creatorAId));
    await expect(
      caller.requestUpload({ purpose: "proof", dealId: dealBId, mimeType: "image/png", sizeBytes: 1 })
    ).rejects.toThrowError(TRPCError);
  });

  it("rejects a non-allowlisted mime type", async () => {
    const caller = storageRouter.createCaller(mockCtx(creatorAId));
    await expect(
      caller.requestUpload({ purpose: "proof", dealId: dealAId, mimeType: "text/html", sizeBytes: 1 })
    ).rejects.toThrowError(TRPCError);
  });

  it("rejects a non-PDF contract upload", async () => {
    const caller = storageRouter.createCaller(mockCtx(creatorAId));
    await expect(
      caller.requestUpload({ purpose: "contract", dealId: dealAId, mimeType: "image/png", sizeBytes: 1 })
    ).rejects.toThrowError(TRPCError);
  });

  it("rejects an oversized file", async () => {
    const caller = storageRouter.createCaller(mockCtx(creatorAId));
    await expect(
      caller.requestUpload({ purpose: "proof", dealId: dealAId, mimeType: "image/png", sizeBytes: 101 * 1024 * 1024 })
    ).rejects.toThrowError(TRPCError);
  });

  it("enforces the per-plan storage quota", async () => {
    // Seed exactly the starter quota (1 GB) of used storage, then request more.
    await db.insert(schema.proofs).values({
      dealId: dealAId,
      kind: "file",
      storageKey: `${creatorAId}/proofs/seed.png`,
      sizeBytes: 1024 * 1024 * 1024,
      uploadedAt: new Date(),
    });

    const caller = storageRouter.createCaller(mockCtx(creatorAId));
    await expect(
      caller.requestUpload({ purpose: "proof", dealId: dealAId, mimeType: "image/png", sizeBytes: 1 })
    ).rejects.toThrowError(TRPCError);
  });
});

describe("storage.getUrl", () => {
  it("serves a key under the caller's own tenant", async () => {
    const caller = storageRouter.createCaller(mockCtx(creatorAId));
    const { url } = await caller.getUrl({ key: `${creatorAId}/proofs/x.png` });
    expect(url).toBe(`memory://object/${creatorAId}/proofs/x.png`);
  });

  it("rejects a foreign tenant key", async () => {
    const caller = storageRouter.createCaller(mockCtx(creatorAId));
    await expect(caller.getUrl({ key: `${creatorBId}/proofs/x.png` })).rejects.toThrowError(TRPCError);
  });
});

describe("proof.confirmUpload", () => {
  it("persists an uploaded file proof and logs activity", async () => {
    const caller = proofRouter.createCaller(mockCtx(creatorAId));
    const key = `${creatorAId}/proofs/${dealAId}/abc.png`;
    const proof = await caller.confirmUpload({
      dealId: dealAId,
      key,
      mimeType: "image/png",
      sizeBytes: 1234,
      note: "screenshot",
    });

    expect(proof.kind).toBe("file");
    expect(proof.storageKey).toBe(key);
    expect(proof.mimeType).toBe("image/png");
    expect(proof.sizeBytes).toBe(1234);
    expect(proof.uploadedAt).toBeInstanceOf(Date);

    const events = await db
      .select()
      .from(schema.activityEvents)
      .where(eq(schema.activityEvents.entityId, proof.id));
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ action: "proof_added", proofKind: "file" });
  });

  it("rejects a foreign tenant key", async () => {
    const caller = proofRouter.createCaller(mockCtx(creatorAId));
    await expect(
      caller.confirmUpload({ dealId: dealAId, key: `${creatorBId}/proofs/x.png`, mimeType: "image/png", sizeBytes: 1 })
    ).rejects.toThrowError(TRPCError);
  });

  it("rejects a disallowed mime type", async () => {
    const caller = proofRouter.createCaller(mockCtx(creatorAId));
    await expect(
      caller.confirmUpload({ dealId: dealAId, key: `${creatorAId}/proofs/x.png`, mimeType: "text/html", sizeBytes: 1 })
    ).rejects.toThrowError(TRPCError);
  });
});

describe("contract.confirmUpload", () => {
  it("attaches an uploaded PDF and clears pasted text/link", async () => {
    const caller = contractRouter.createCaller(mockCtx(creatorAId));
    await caller.upsert({ dealId: dealAId, bodyText: "old text" });

    const key = `${creatorAId}/contracts/${dealAId}/contract.pdf`;
    const contract = await caller.confirmUpload({
      dealId: dealAId,
      key,
      mimeType: "application/pdf",
      sizeBytes: 500,
    });

    expect(contract.storageKey).toBe(key);
    expect(contract.mimeType).toBe("application/pdf");
    expect(contract.bodyText).toBeNull();
    expect(contract.fileUrl).toBeNull();
  });

  it("rejects a non-PDF upload", async () => {
    const caller = contractRouter.createCaller(mockCtx(creatorAId));
    await expect(
      caller.confirmUpload({ dealId: dealAId, key: `${creatorAId}/contracts/x.png`, mimeType: "image/png", sizeBytes: 1 })
    ).rejects.toThrowError(TRPCError);
  });
});
