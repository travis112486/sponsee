import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { db, pgliteClient } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { eq } from "drizzle-orm";

// Capture magic-link URLs sent during tests
const sentEmails: Array<{ email: string; url: string }> = [];

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

import { initPgliteSchema } from "./test-utils/pglite-setup.js";

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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
