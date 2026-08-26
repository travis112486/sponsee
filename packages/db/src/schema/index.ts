import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  boolean,
  jsonb,
  pgEnum,
  char,
  index,
  uniqueIndex,
  serial,
} from "drizzle-orm/pg-core";

// Enums
export const platformEnum = pgEnum("platform", ["twitch", "youtube", "kick", "tiktok"]);
export const dealStageEnum = pgEnum("deal_stage", [
  "inbound",
  "negotiating",
  "contract_sent",
  "live",
  "delivered",
  "paid",
]);
export const dealTypeEnum = pgEnum("deal_type", ["flat", "bounty", "hybrid"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["draft", "open", "paid", "void"]);
export const deliverableStatusEnum = pgEnum("deliverable_status", [
  "not_started",
  "scheduled",
  "in_progress",
  "done",
  "missed",
  "rescheduled",
]);
export const paymentTermsEnum = pgEnum("payment_terms", ["net_15", "net_30", "net_45"]);
export const chaseEventStatusEnum = pgEnum("chase_event_status", [
  "queued",
  "awaiting_review",
  "approved",
  "sent",
  "delivered",
  "opened",
  "bounced",
  "failed",
]);
export const chaseModeEnum = pgEnum("chase_mode", ["armed", "paused", "completed"]);
export const activityKindEnum = pgEnum("activity_kind", [
  "invoice",
  "contract",
  "deliverable",
  "payment",
  "inquiry",
  "stage_change",
  "chase_sent",
  "note",
]);
export const planTierEnum = pgEnum("plan_tier", ["starter", "creator", "pro"]);
export const proofKindEnum = pgEnum("proof_kind", ["vod", "clip", "chat", "overlay", "link", "file"]);
export const contractStatusEnum = pgEnum("contract_status", ["draft", "sent", "viewed", "signed"]);

// Creators (tenants)
export const creators = pgTable(
  "creators",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    displayName: varchar("display_name", { length: 255 }).notNull(),
    pronouns: varchar("pronouns", { length: 64 }),
    category: varchar("category", { length: 128 }),
    avatarUrl: text("avatar_url"),
    timezone: varchar("timezone", { length: 64 }).notNull().default("America/New_York"),
    defaultCurrency: char("default_currency", { length: 3 }).notNull().default("USD"),
    plan: planTierEnum("plan").notNull().default("starter"),
    // Payout rails (template fields only — never credentials)
    paypalLink: text("paypal_link"),
    wiseText: text("wise_text"),
    bankText: text("bank_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("creators_plan_idx").on(t.plan)]
);

// Memberships (users ↔ creators)
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: varchar("user_id", { length: 255 }).notNull(), // Better Auth user id
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 32 }).notNull().default("owner"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_user_creator_idx").on(t.userId, t.creatorId),
    index("memberships_creator_idx").on(t.creatorId),
  ]
);

// Creator platforms
export const creatorPlatforms = pgTable(
  "creator_platforms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull(),
    ccv: integer("ccv"),
    followers: integer("followers"),
    scheduleLabel: varchar("schedule_label", { length: 255 }),
    connectedAccountId: text("connected_account_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("creator_platforms_creator_idx").on(t.creatorId),
    uniqueIndex("creator_platforms_creator_platform_idx").on(t.creatorId, t.platform),
  ]
);

// Brands
export const brands = pgTable(
  "brands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    category: varchar("category", { length: 128 }),
    domain: varchar("domain", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("brands_creator_idx").on(t.creatorId), index("brands_name_idx").on(t.name)]
);

// Contacts
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    role: varchar("role", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("contacts_brand_idx").on(t.brandId)]
);

// Deals
export const deals = pgTable(
  "deals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "restrict" }),
    primaryContactId: uuid("primary_contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    title: varchar("title", { length: 512 }).notNull(),
    type: dealTypeEnum("type").notNull().default("flat"),
    valueCents: integer("value_cents").notNull().default(0),
    currency: char("currency", { length: 3 }).notNull().default("USD"),
    valueNote: text("value_note"),
    stage: dealStageEnum("stage").notNull().default("inbound"),
    platforms: platformEnum("platforms").array(),
    paymentTerms: paymentTermsEnum("payment_terms").notNull().default("net_30"),
    source: varchar("source", { length: 255 }),
    notes: text("notes"),
    // Bounty tracker
    bountyRateNote: text("bounty_rate_note"),
    bountyCount: integer("bounty_count"),
    bountyPayoutCents: integer("bounty_payout_cents"),
    stageEnteredAt: timestamp("stage_entered_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("deals_creator_idx").on(t.creatorId),
    index("deals_brand_idx").on(t.brandId),
    index("deals_stage_idx").on(t.stage),
    index("deals_deleted_at_idx").on(t.deletedAt),
  ]
);

// Deliverables
export const deliverables = pgTable(
  "deliverables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 512 }).notNull(),
    platform: platformEnum("platform"),
    status: deliverableStatusEnum("status").notNull().default("not_started"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    dueLabel: varchar("due_label", { length: 128 }),
    progressDone: integer("progress_done"),
    progressTotal: integer("progress_total"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("deliverables_deal_idx").on(t.dealId), index("deliverables_status_idx").on(t.status)]
);

// Proofs
export const proofs = pgTable(
  "proofs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    deliverableId: uuid("deliverable_id").references(() => deliverables.id, {
      onDelete: "set null",
    }),
    kind: proofKindEnum("kind").notNull(),
    url: text("url"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("proofs_deal_idx").on(t.dealId)]
);

// Contracts
export const contracts = pgTable(
  "contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    status: contractStatusEnum("status").notNull().default("draft"),
    bodyText: text("body_text"),
    fileUrl: text("file_url"),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("contracts_deal_idx").on(t.dealId)]
);

// Invoices
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
    number: integer("number").notNull(), // per-creator sequence
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    title: varchar("title", { length: 512 }),
    milestoneNote: text("milestone_note"),
    amountCents: integer("amount_cents").notNull(),
    currency: char("currency", { length: 3 }).notNull().default("USD"),
    terms: paymentTermsEnum("terms").notNull().default("net_30"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    status: invoiceStatusEnum("status").notNull().default("draft"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paidNote: text("paid_note"),
    railsSnapshot: jsonb("rails_snapshot"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("invoices_creator_idx").on(t.creatorId),
    index("invoices_deal_idx").on(t.dealId),
    index("invoices_status_idx").on(t.status),
    index("invoices_due_at_idx").on(t.dueAt),
    uniqueIndex("invoices_creator_number_idx").on(t.creatorId, t.number),
  ]
);

// Chase templates
export const chaseTemplates = pgTable(
  "chase_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    step: integer("step").notNull(), // 1, 2, 3
    name: varchar("name", { length: 128 }).notNull(),
    offsetDays: integer("offset_days").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("chase_templates_creator_step_idx").on(t.creatorId, t.step),
  ]
);

// Invoice chase state
export const invoiceChaseState = pgTable(
  "invoice_chase_state",
  {
    invoiceId: uuid("invoice_id")
      .primaryKey()
      .references(() => invoices.id, { onDelete: "cascade" }),
    mode: chaseModeEnum("mode").notNull().default("armed"),
    nextStep: integer("next_step").notNull().default(1),
    nextActionAt: timestamp("next_action_at", { withTimezone: true }),
    pausedReason: varchar("paused_reason", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  }
);

// Chase events (audit log + timeline)
export const chaseEvents = pgTable(
  "chase_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    step: integer("step").notNull(),
    subjectSnapshot: text("subject_snapshot"),
    bodySnapshot: text("body_snapshot"),
    toEmail: varchar("to_email", { length: 255 }),
    status: chaseEventStatusEnum("status").notNull().default("queued"),
    providerMessageId: text("provider_message_id"),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).unique(),
    queuedAt: timestamp("queued_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    bouncedAt: timestamp("bounced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chase_events_invoice_idx").on(t.invoiceId), index("chase_events_status_idx").on(t.status)]
);

// Activity events (append-only)
export const activityEvents = pgTable(
  "activity_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    actor: varchar("actor", { length: 32 }).notNull().default("creator"), // 'creator' | 'system'
    entityType: varchar("entity_type", { length: 64 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    kind: activityKindEnum("kind").notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activity_events_creator_idx").on(t.creatorId),
    index("activity_events_entity_idx").on(t.entityType, t.entityId),
    index("activity_events_created_at_idx").on(t.createdAt),
  ]
);

// Benchmark configs
export const benchmarkConfigs = pgTable(
  "benchmark_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    version: integer("version").notNull(),
    effectiveDate: timestamp("effective_date", { withTimezone: true }).notNull(),
    cpvhBands: jsonb("cpvh_bands").notNull(),
    adjustments: jsonb("adjustments"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("benchmark_configs_effective_idx").on(t.effectiveDate)]
);

// Calculator profiles
export const calculatorProfiles = pgTable(
  "calculator_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    inputs: jsonb("inputs").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("calculator_profiles_creator_idx").on(t.creatorId)]
);

// Waitlist emails
export const waitlistEmails = pgTable(
  "waitlist_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    source: varchar("source", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }
);
