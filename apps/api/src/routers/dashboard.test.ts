import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { sql } from "drizzle-orm";
import { dashboardRouter } from "./dashboard.js";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "../test-utils/schema-sql.js";

// Fixed "now" for deterministic boundaries: 2026-03-18 is a Wednesday.
const NOW_ISO = "2026-03-18T12:00:00Z";

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
let dealAFlatId = "";
let dealABountyId = "";
let dealAHybridId = "";
let dealBId = "";

async function seedBase() {
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

  const [dealAFlat] = await db
    .insert(schema.deals)
    .values({ creatorId: creatorAId, brandId: brandAId, title: "Flat deal", type: "flat", stage: "inbound", valueCents: 1000 })
    .returning();
  const [dealABounty] = await db
    .insert(schema.deals)
    .values({ creatorId: creatorAId, brandId: brandAId, title: "Bounty deal", type: "bounty", stage: "live", valueCents: 2000 })
    .returning();
  const [dealAHybrid] = await db
    .insert(schema.deals)
    .values({ creatorId: creatorAId, brandId: brandAId, title: "Hybrid deal", type: "hybrid", stage: "live", valueCents: 3000 })
    .returning();
  const [dealB] = await db
    .insert(schema.deals)
    .values({ creatorId: creatorBId, brandId: brandBId, title: "Creator B deal", type: "flat", stage: "inbound", valueCents: 5000 })
    .returning();
  dealAFlatId = dealAFlat.id;
  dealABountyId = dealABounty.id;
  dealAHybridId = dealAHybrid.id;
  dealBId = dealB.id;
}

async function insertInvoice(opts: {
  creatorId: string;
  dealId: string;
  number: number;
  amountCents: number;
  status?: string;
  paidAt?: Date | null;
  dueAt?: Date | null;
  title?: string;
}) {
  const [row] = await db
    .insert(schema.invoices)
    .values({
      creatorId: opts.creatorId,
      dealId: opts.dealId,
      number: opts.number,
      amountCents: opts.amountCents,
      status: (opts.status as "draft" | "open" | "paid" | "void") ?? "open",
      paidAt: opts.paidAt ?? null,
      dueAt: opts.dueAt ?? null,
      title: opts.title ?? null,
    })
    .returning();
  return row;
}

async function cleanTables() {
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

beforeAll(async () => {
  await initPgliteSchema(SCHEMA_SQL);
});

beforeEach(async () => {
  await cleanTables();
  await seedBase();
});

describe("dashboard.overview", () => {
  it("rejects requests without a creator workspace", async () => {
    const caller = dashboardRouter.createCaller({
      session: { user: { id: "u1", email: "a@b.com", name: "A" } },
      creatorId: null,
      db,
    });
    await expect(caller.overview()).rejects.toSatisfy(
      (err: any) => err.code === "FORBIDDEN"
    );
  });

  it("returns zero/empty output for a creator with no deals or invoices", async () => {
    const [creatorC] = await db.insert(schema.creators).values({ displayName: "Creator C" }).returning();
    const caller = dashboardRouter.createCaller(mockCtx(creatorC.id));

    const result = await caller.overview({ now: NOW_ISO });

    expect(result.revenue.totalCents).toBe(0);
    expect(result.revenue.byType).toEqual({ flat: 0, bounty: 0, hybrid: 0 });
    expect(result.revenue.monthly).toHaveLength(12);
    expect(result.revenue.monthly.reduce((s, m) => s + m.valueCents, 0)).toBe(0);
    expect(result.pipeline.every((p) => p.count === 0 && p.valueCents === 0)).toBe(true);
    expect(result.deliverablesDue).toEqual([]);
    expect(result.overdue.count).toBe(0);
    expect(result.overdue.totalCents).toBe(0);
    expect(result.overdue.mostUrgent).toBeNull();
  });

  it("scopes every surface to the caller's creator (tenant isolation)", async () => {
    // Creator B has a paid invoice and an overdue open invoice; creator A must
    // not see any of it.
    await insertInvoice({
      creatorId: creatorBId,
      dealId: dealBId,
      number: 1,
      amountCents: 9999,
      status: "paid",
      paidAt: new Date("2026-03-10T00:00:00Z"),
    });
    await insertInvoice({
      creatorId: creatorBId,
      dealId: dealBId,
      number: 2,
      amountCents: 5555,
      status: "open",
      dueAt: new Date("2026-01-01T00:00:00Z"),
    });

    const caller = dashboardRouter.createCaller(mockCtx(creatorAId));
    const result = await caller.overview({ now: NOW_ISO });

    expect(result.revenue.totalCents).toBe(0);
    expect(result.pipeline).toHaveLength(6);
    expect(result.pipeline.find((p) => p.stage === "inbound")?.count).toBe(1);
    expect(result.pipeline.find((p) => p.stage === "live")?.count).toBe(2);
    expect(result.pipeline.reduce((s, p) => s + p.count, 0)).toBe(3); // only A's 3 deals
    expect(result.deliverablesDue).toEqual([]);
    expect(result.overdue.count).toBe(0);
    expect(result.overdue.mostUrgent).toBeNull();
  });

  it("splits period revenue by deal type (flat/bounty/hybrid)", async () => {
    await insertInvoice({ creatorId: creatorAId, dealId: dealAFlatId, number: 1, amountCents: 10000, status: "paid", paidAt: new Date("2026-03-05T00:00:00Z") });
    await insertInvoice({ creatorId: creatorAId, dealId: dealABountyId, number: 2, amountCents: 20000, status: "paid", paidAt: new Date("2026-03-10T00:00:00Z") });
    await insertInvoice({ creatorId: creatorAId, dealId: dealAHybridId, number: 3, amountCents: 30000, status: "paid", paidAt: new Date("2026-03-12T00:00:00Z") });

    const caller = dashboardRouter.createCaller(mockCtx(creatorAId));
    const result = await caller.overview({ period: "month", now: NOW_ISO });

    expect(result.revenue.totalCents).toBe(60000);
    expect(result.revenue.byType).toEqual({ flat: 10000, bounty: 20000, hybrid: 30000 });
    expect(result.revenue.periodStart).toEqual(new Date("2026-03-01T00:00:00Z"));
    expect(result.revenue.periodEnd).toEqual(new Date("2026-04-01T00:00:00Z"));
  });

  it("bounds month/quarter revenue totals correctly", async () => {
    // Jan, Feb, Mar (all Q1) plus a Dec-2025 (Q4) invoice.
    await insertInvoice({ creatorId: creatorAId, dealId: dealAFlatId, number: 1, amountCents: 3000, status: "paid", paidAt: new Date("2026-01-20T00:00:00Z") });
    await insertInvoice({ creatorId: creatorAId, dealId: dealAFlatId, number: 2, amountCents: 5000, status: "paid", paidAt: new Date("2026-02-15T00:00:00Z") });
    await insertInvoice({ creatorId: creatorAId, dealId: dealAFlatId, number: 3, amountCents: 10000, status: "paid", paidAt: new Date("2026-03-05T00:00:00Z") });
    await insertInvoice({ creatorId: creatorAId, dealId: dealAFlatId, number: 4, amountCents: 7000, status: "paid", paidAt: new Date("2025-12-20T00:00:00Z") });

    const caller = dashboardRouter.createCaller(mockCtx(creatorAId));

    const month = await caller.overview({ period: "month", now: NOW_ISO });
    expect(month.revenue.totalCents).toBe(10000);
    expect(month.revenue.periodStart).toEqual(new Date("2026-03-01T00:00:00Z"));

    const quarter = await caller.overview({ period: "quarter", now: NOW_ISO });
    expect(quarter.revenue.totalCents).toBe(18000);
    expect(quarter.revenue.periodStart).toEqual(new Date("2026-01-01T00:00:00Z"));
    expect(quarter.revenue.periodEnd).toEqual(new Date("2026-04-01T00:00:00Z"));

    const ytd = await caller.overview({ period: "ytd", now: NOW_ISO });
    expect(ytd.revenue.totalCents).toBe(18000);
    expect(ytd.revenue.periodStart).toEqual(new Date("2026-01-01T00:00:00Z"));
  });

  it("attributes revenue to paidAt, not issuedAt", async () => {
    // Issued in January, paid in February — must land in the Feb series bucket.
    const [inv] = await db
      .insert(schema.invoices)
      .values({
        creatorId: creatorAId,
        dealId: dealAFlatId,
        number: 1,
        amountCents: 9000,
        status: "paid",
        issuedAt: new Date("2026-01-05T00:00:00Z"),
        paidAt: new Date("2026-02-10T00:00:00Z"),
      })
      .returning();
    expect(inv.id).toBeTruthy();

    const caller = dashboardRouter.createCaller(mockCtx(creatorAId));
    const result = await caller.overview({ period: "ytd", now: NOW_ISO });

    const jan = result.revenue.monthly.find((m) => m.month === "2026-01");
    const feb = result.revenue.monthly.find((m) => m.month === "2026-02");
    expect(jan?.valueCents).toBe(0);
    expect(feb?.valueCents).toBe(9000);
  });

  it("bounds due-this-week deliverables and excludes done", async () => {
    const mkDeliverable = async (
      dueAt: Date | null,
      status: "not_started" | "scheduled" | "in_progress" | "done" | "missed" | "rescheduled",
      title: string
    ) => {
      await db.insert(schema.deliverables).values({
        dealId: dealAFlatId,
        title,
        status,
        dueAt,
        position: 0,
      });
    };

    await mkDeliverable(new Date("2026-03-16T00:00:00Z"), "scheduled", "Mon in-week");
    await mkDeliverable(new Date("2026-03-20T00:00:00Z"), "scheduled", "Fri in-week");
    await mkDeliverable(new Date("2026-03-23T00:00:00Z"), "scheduled", "next Mon (out)");
    await mkDeliverable(new Date("2026-03-15T00:00:00Z"), "scheduled", "prior Sun (out)");
    await mkDeliverable(new Date("2026-03-19T00:00:00Z"), "done", "in-week but done");

    const caller = dashboardRouter.createCaller(mockCtx(creatorAId));
    const result = await caller.overview({ now: NOW_ISO });

    expect(result.deliverablesDue.map((d) => d.title)).toEqual([
      "Mon in-week",
      "Fri in-week",
    ]);
    expect(result.deliverablesDue[0].dealTitle).toBe("Flat deal");
    expect(result.deliverablesDue[0].brandName).toBe("Brand A");
  });

  it("orders overdue invoices by most urgent (oldest due date) and surfaces chase state", async () => {
    const newer = await insertInvoice({
      creatorId: creatorAId,
      dealId: dealAFlatId,
      number: 1,
      amountCents: 1000,
      status: "open",
      dueAt: new Date("2026-02-01T00:00:00Z"),
      title: "Newer overdue",
    });
    const older = await insertInvoice({
      creatorId: creatorAId,
      dealId: dealAFlatId,
      number: 2,
      amountCents: 2000,
      status: "open",
      dueAt: new Date("2026-01-15T00:00:00Z"),
      title: "Older overdue",
    });
    await db.insert(schema.invoiceChaseState).values({
      invoiceId: older.id,
      mode: "armed",
      nextStep: 2,
      nextActionAt: new Date("2026-01-16T00:00:00Z"),
    });
    await db.insert(schema.invoiceChaseState).values({
      invoiceId: newer.id,
      mode: "paused",
      nextStep: 1,
    });

    const caller = dashboardRouter.createCaller(mockCtx(creatorAId));
    const result = await caller.overview({ now: NOW_ISO });

    expect(result.overdue.count).toBe(2);
    expect(result.overdue.totalCents).toBe(3000);
    expect(result.overdue.mostUrgent?.id).toBe(older.id);
    expect(result.overdue.mostUrgent?.title).toBe("Older overdue");
    expect(result.overdue.mostUrgent?.dueAgeDays).toBe(62);
    expect(result.overdue.mostUrgent?.chase).toMatchObject({
      mode: "armed",
      nextStep: 2,
    });
    expect(result.overdue.mostUrgent?.brandName).toBe("Brand A");
    expect(result.overdue.mostUrgent?.dealTitle).toBe("Flat deal");
  });

  it("excludes paid/void invoices from overdue and ignores null dueAt", async () => {
    // Paid invoice and an open invoice with no due date must not count as overdue.
    await insertInvoice({ creatorId: creatorAId, dealId: dealAFlatId, number: 1, amountCents: 1000, status: "paid", paidAt: new Date("2026-02-01T00:00:00Z") });
    await insertInvoice({ creatorId: creatorAId, dealId: dealAFlatId, number: 2, amountCents: 2000, status: "open", dueAt: null });

    const caller = dashboardRouter.createCaller(mockCtx(creatorAId));
    const result = await caller.overview({ now: NOW_ISO });

    expect(result.overdue.count).toBe(0);
    expect(result.overdue.mostUrgent).toBeNull();
  });
});
