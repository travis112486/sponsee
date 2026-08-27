import { PGlite } from "@electric-sql/pglite";

async function init() {
  console.log("Initializing PGlite schema...");
  const client = new PGlite("./.pglite-data");

  // Drop existing tables (for clean init)
  await client.exec(`
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
    DROP TABLE IF EXISTS waitlist_emails CASCADE;
    DROP TABLE IF EXISTS calculator_profiles CASCADE;
    DROP TABLE IF EXISTS benchmark_configs CASCADE;
  `);

  // Create enums as check constraints (PGlite compatible)
  await client.exec(`
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

    CREATE TABLE waitlist_emails (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) NOT NULL UNIQUE,
      source VARCHAR(128),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  console.log("Schema initialized successfully!");
  await client.close();
  process.exit(0);
}

init().catch((err) => {
  console.error("Init failed:", err);
  process.exit(1);
});
