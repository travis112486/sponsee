import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { sql, eq } from "drizzle-orm";
import {
  invoiceRouter,
  invoiceViewLimiter,
  INVOICE_VIEW_MAX_PER_WINDOW,
} from "./invoice.js";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "../test-utils/schema-sql.js";

// SPO-364 — invoice.publicView is the only unauthenticated read of tenant data.
// These tests pin the response shape (a security boundary), the identical-404
// behaviour, and the dedicated per-IP rate limit that must not share the auth
// bucket.

const OWNER_EMAIL = "owner@secret.example";
const CONTACT_EMAIL = "ap@acme.example";
const BRAND_NAME = "Acme Corp";
const DEAL_TITLE = "Q2 sponsorship package";

function mockCtx(overrides: Record<string, unknown> = {}) {
  return {
    session: null,
    creatorId: null,
    db,
    headers: new Headers({ "x-forwarded-for": "203.0.113.5" }),
    ...overrides,
  };
}

async function cleanTables() {
  await db.execute(sql`
    TRUNCATE TABLE
      activity_events,
      invoice_deliveries,
      chase_events,
      invoice_chase_state,
      chase_templates,
      invoices,
      deals,
      contacts,
      brands,
      memberships,
      "user",
      creators
    CASCADE
  `);
}

async function seedTenant(opts: { withOwnerEmail?: boolean; snapshotReplyToEmail?: string | null } = {}) {
  const withOwnerEmail = opts.withOwnerEmail ?? true;

  const [creator] = await db
    .insert(schema.creators)
    .values({
      displayName: "Nightshade Media",
      paypalLink: "paypal.me/nightshade",
      wiseText: "Wise: nightshade@wise.example",
      bankText: "Acme Bank / 000-1234",
    })
    .returning();

  if (withOwnerEmail) {
    await db.insert(schema.user).values({ id: `user-${creator.id}`, name: "Owner", email: OWNER_EMAIL });
    await db.insert(schema.memberships).values({ userId: `user-${creator.id}`, creatorId: creator.id, role: "owner" });
  }

  const [brand] = await db.insert(schema.brands).values({ creatorId: creator.id, name: BRAND_NAME }).returning();
  await db.insert(schema.contacts).values({ brandId: brand.id, name: "AP Team", email: CONTACT_EMAIL });

  const [deal] = await db
    .insert(schema.deals)
    .values({ creatorId: creator.id, brandId: brand.id, title: DEAL_TITLE, type: "flat", stage: "live", valueCents: 500000 })
    .returning();

  // `snapshotReplyToEmail` undefined means the key is absent entirely — the
  // pre-SPO-428 snapshot shape that the fallback rule must handle.
  const railsSnapshot: Record<string, unknown> = {
    displayName: "Nightshade Media",
    paypalLink: "paypal.me/nightshade",
    wiseText: "Wise: nightshade@wise.example",
    bankText: "Acme Bank / 000-1234",
  };
  if (opts.snapshotReplyToEmail !== undefined) {
    railsSnapshot.replyToEmail = opts.snapshotReplyToEmail;
  }

  const [invoice] = await db
    .insert(schema.invoices)
    .values({
      creatorId: creator.id,
      dealId: deal.id,
      number: 12,
      title: "Sponsorship invoice",
      milestoneNote: "Two sponsored streams delivered in March.",
      amountCents: 450000,
      currency: "USD",
      terms: "net_30",
      issuedAt: new Date("2026-09-02T00:00:00Z"),
      dueAt: new Date("2026-10-02T00:00:00Z"),
      status: "open",
      railsSnapshot,
    })
    .returning();

  const [delivery] = await db
    .insert(schema.invoiceDeliveries)
    .values({
      invoiceId: invoice.id,
      attempt: 1,
      toEmail: CONTACT_EMAIL,
      fromEmail: "invoices@sponsee.app",
      replyToEmail: OWNER_EMAIL,
      subjectSnapshot: "Invoice INV-0012 from Nightshade Media",
      textSnapshot: "Amount due: $4,500",
      publicToken: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
      idempotencyKey: `invoice:${invoice.id}:delivery:1`,
      status: "sent",
      providerMessageId: "res-123",
    })
    .returning();

  return { creator, invoice, delivery };
}

beforeAll(async () => {
  await initPgliteSchema(SCHEMA_SQL);
});

beforeEach(async () => {
  invoiceViewLimiter.reset();
  await cleanTables();
});

describe("invoice.publicView — response shape (security boundary)", () => {
  it("returns exactly the allowed fields, and none of the tenant's other data", async () => {
    const { delivery } = await seedTenant();
    const caller = invoiceRouter.createCaller(mockCtx());

    const result = await caller.publicView({ token: delivery.publicToken });

    // The allowed keys — nothing else. Assert on the actual keys, not on what
    // a UI happens to render.
    expect(Object.keys(result).sort()).toEqual(
      [
        "invoiceNumber",
        "title",
        "milestoneNote",
        "amountCents",
        "currency",
        "terms",
        "issuedAt",
        "dueAt",
        "railsSnapshot",
        "creatorDisplayName",
        "creatorEmail",
        "paid",
      ].sort()
    );

    // The serialized JSON must not carry the brand contact email, the brand
    // name, the deal title, or any id linking back to the tenant's other
    // records. The creator's OWNER_EMAIL now appears as `creatorEmail` — that
    // is the SPO-366/385 contact line (rails_snapshot.replyToEmail ??
    // current account email), the same address the invoice email's Reply-To
    // already handed the brand. It is a deliberate design change, not a leak:
    // the token-gated viewer already holds that address from the email they
    // received.
    const serialized = JSON.stringify(result);
    expect(serialized).toContain(OWNER_EMAIL);
    expect(serialized).not.toContain(CONTACT_EMAIL);
    expect(serialized).not.toContain(BRAND_NAME);
    expect(serialized).not.toContain(DEAL_TITLE);
    expect(serialized).not.toContain("creatorId");
    expect(serialized).not.toContain("dealId");
    expect(serialized).not.toContain("contactId");
  });

  it("renders the frozen rails_snapshot and derived paid state", async () => {
    const { delivery } = await seedTenant();
    const caller = invoiceRouter.createCaller(mockCtx());

    const result = await caller.publicView({ token: delivery.publicToken });

    expect(result.invoiceNumber).toBe(12);
    expect(result.title).toBe("Sponsorship invoice");
    expect(result.amountCents).toBe(450000);
    expect(result.currency).toBe("USD");
    expect(result.terms).toBe("net_30");
    expect(result.creatorDisplayName).toBe("Nightshade Media");
    expect(result.railsSnapshot).toEqual({
      displayName: "Nightshade Media",
      paypalLink: "paypal.me/nightshade",
      wiseText: "Wise: nightshade@wise.example",
      bankText: "Acme Bank / 000-1234",
      replyToEmail: null,
    });
    expect(result.paid).toBe(false);
  });

  it("marks a paid invoice paid", async () => {
    const { invoice, delivery } = await seedTenant();
    await db
      .update(schema.invoices)
      .set({ status: "paid", paidAt: new Date("2026-09-10T00:00:00Z") })
      .where(eq(schema.invoices.id, invoice.id));

    const caller = invoiceRouter.createCaller(mockCtx());
    const result = await caller.publicView({ token: delivery.publicToken });

    expect(result.paid).toBe(true);
    // paidAt is deliberately NOT returned — the response shape is the allowed
    // list, and "paid date" is not on it.
    expect(Object.keys(result)).not.toContain("paidAt");
  });
});

describe("invoice.publicView — creator contact line (SPO-428)", () => {
  it("renders the fallback account email when a pre-existing snapshot lacks replyToEmail", async () => {
    // The seed snapshot carries no replyToEmail key — the exact shape every
    // snapshot frozen before this field shipped has. The fallback must resolve
    // the creator's current account email, and this test fails if the
    // `?? resolveCreatorReplyToEmail(...)` fallback is removed.
    const { delivery } = await seedTenant();
    const caller = invoiceRouter.createCaller(mockCtx());

    const result = await caller.publicView({ token: delivery.publicToken });

    expect(result.railsSnapshot.replyToEmail).toBeNull();
    expect(result.creatorEmail).toBe(OWNER_EMAIL);
  });

  it("prefers the snapshot's replyToEmail over the live account email", async () => {
    const { delivery } = await seedTenant({ snapshotReplyToEmail: "kaya@nightshade.example" });
    const caller = invoiceRouter.createCaller(mockCtx());

    const result = await caller.publicView({ token: delivery.publicToken });

    expect(result.railsSnapshot.replyToEmail).toBe("kaya@nightshade.example");
    expect(result.creatorEmail).toBe("kaya@nightshade.example");
  });

  it("drops the contact line (null) when neither the snapshot nor the account email resolves", async () => {
    const { delivery } = await seedTenant({ withOwnerEmail: false });
    const caller = invoiceRouter.createCaller(mockCtx());

    const result = await caller.publicView({ token: delivery.publicToken });

    expect(result.railsSnapshot.replyToEmail).toBeNull();
    expect(result.creatorEmail).toBeNull();
  });
});

describe("invoice.publicView — 404 semantics", () => {
  it("returns NOT_FOUND for an unknown token", async () => {
    const caller = invoiceRouter.createCaller(mockCtx());
    await expect(caller.publicView({ token: "00000000000000000000000000000000" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("returns the identical NOT_FOUND for a deleted invoice's token", async () => {
    const { invoice, delivery } = await seedTenant();
    await db.delete(schema.invoices).where(eq(schema.invoices.id, invoice.id));

    const caller = invoiceRouter.createCaller(mockCtx());

    const unknown = await caller.publicView({ token: "00000000000000000000000000000000" }).catch((e) => e);
    const deleted = await caller.publicView({ token: delivery.publicToken }).catch((e) => e);

    // Byte-identical: same code and message, so the wire body cannot tell a
    // once-real token from a never-real one.
    expect(unknown).toMatchObject({ code: "NOT_FOUND" });
    expect(deleted).toMatchObject({ code: "NOT_FOUND" });
    expect((deleted as Error).message).toBe((unknown as Error).message);
  });
});

describe("invoice.publicView — rate limit", () => {
  it("engages a dedicated limiter (not the auth bucket) after the per-IP cap", async () => {
    const caller = invoiceRouter.createCaller(
      mockCtx({ headers: new Headers({ "x-forwarded-for": "203.0.113.9" }) })
    );

    for (let i = 0; i < INVOICE_VIEW_MAX_PER_WINDOW; i++) {
      await caller.publicView({ token: "00000000000000000000000000000000" }).catch(() => {});
    }

    await expect(caller.publicView({ token: "00000000000000000000000000000000" })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });

    // Hammering the public view must not consume the auth rate-limit bucket:
    // Better Auth's database-backed `rate_limit` table stays empty, so a
    // brand's reload of their invoice cannot lock creators out of login.
    const authRows = await db.select().from(schema.rateLimit);
    expect(authRows).toHaveLength(0);
  });

  it("limits invalid and valid tokens alike (the enumeration oracle)", async () => {
    const { delivery } = await seedTenant();
    const headers = new Headers({ "x-forwarded-for": "203.0.113.8" });

    for (let i = 0; i < INVOICE_VIEW_MAX_PER_WINDOW; i++) {
      const caller = invoiceRouter.createCaller(mockCtx({ headers }));
      await caller.publicView({ token: "00000000000000000000000000000000" }).catch(() => {});
    }

    const caller = invoiceRouter.createCaller(mockCtx({ headers }));
    await expect(caller.publicView({ token: delivery.publicToken })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
  });

  it("scopes the limit per client IP so one brand's reloads can't starve another", async () => {
    const ipA = "203.0.113.10";
    const ipB = "203.0.113.11";

    for (let i = 0; i < INVOICE_VIEW_MAX_PER_WINDOW; i++) {
      const caller = invoiceRouter.createCaller(mockCtx({ headers: new Headers({ "x-forwarded-for": ipA }) }));
      await caller.publicView({ token: "00000000000000000000000000000000" }).catch(() => {});
    }

    const a = invoiceRouter.createCaller(mockCtx({ headers: new Headers({ "x-forwarded-for": ipA }) }));
    await expect(a.publicView({ token: "00000000000000000000000000000000" })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });

    const b = invoiceRouter.createCaller(mockCtx({ headers: new Headers({ "x-forwarded-for": ipB }) }));
    await expect(b.publicView({ token: "00000000000000000000000000000000" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
