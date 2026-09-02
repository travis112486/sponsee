import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { eq, sql } from "drizzle-orm";
import { dashboardRouter } from "./dashboard.js";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "../test-utils/schema-sql.js";

// Fixed "now" for deterministic boundaries: 2026-03-18T12:00Z is Wed Mar 18,
// 8:00am in America/New_York — the same calendar day and ISO week in both
// zones, so it is a neutral anchor for the non-boundary assertions below.
const NOW_ISO = "2026-03-18T12:00:00Z";

// Creators A/B carry the `creators.timezone` default, America/New_York, so all
// period boundaries here are *local* instants: March starts at 05:00Z (EST,
// UTC-5) and ends at 04:00Z on Apr 1 (EDT, UTC-4, after the Mar 8 transition).
const MAR_START_ET = new Date("2026-03-01T05:00:00Z");
const APR_START_ET = new Date("2026-04-01T04:00:00Z");
const JAN_START_ET = new Date("2026-01-01T05:00:00Z");

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
  // Nullable: an orphaned invoice (deal hard-deleted) keeps its creator but
  // loses its deal, and the revenue split has to cope with that.
  dealId: string | null;
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

async function mkDeliverableA(
  dueAt: Date | null,
  status: "not_started" | "scheduled" | "in_progress" | "done" | "missed" | "rescheduled",
  title: string
) {
  await db.insert(schema.deliverables).values({
    dealId: dealAFlatId,
    title,
    status,
    dueAt,
    position: 0,
  });
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
    // Creator B has a paid invoice, an overdue open invoice, and a deliverable
    // due inside the same week; creator A must not see any of it.
    //
    // The deliverable matters: without it the `deliverablesDue` assertion below
    // is vacuous — an empty `deliverables` table makes `[]` true no matter how
    // the query is scoped. See the positive control at the end of this test.
    await db.insert(schema.deliverables).values({
      dealId: dealBId,
      title: "Creator B deliverable",
      status: "scheduled",
      // Wed Mar 18, 8:00pm ET — inside creator B's local Mar 16–22 week.
      dueAt: new Date("2026-03-19T00:00:00Z"),
      position: 0,
    });
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
    expect(result.outstanding.count).toBe(0);
    expect(result.outstanding.totalCents).toBe(0);

    // Positive control: the row really is there and really is in-week, so the
    // empty result above is the scoping working, not an empty table.
    const bResult = await dashboardRouter
      .createCaller(mockCtx(creatorBId))
      .overview({ now: NOW_ISO });
    expect(bResult.deliverablesDue.map((d) => d.title)).toEqual(["Creator B deliverable"]);
    expect(bResult.overdue.count).toBe(1);
    expect(bResult.outstanding.count).toBe(1);
    expect(bResult.outstanding.totalCents).toBe(5555);
    expect(bResult.revenue.totalCents).toBe(9999);
  });

  it("splits period revenue by deal type (flat/bounty/hybrid)", async () => {
    await insertInvoice({ creatorId: creatorAId, dealId: dealAFlatId, number: 1, amountCents: 10000, status: "paid", paidAt: new Date("2026-03-05T00:00:00Z") });
    await insertInvoice({ creatorId: creatorAId, dealId: dealABountyId, number: 2, amountCents: 20000, status: "paid", paidAt: new Date("2026-03-10T00:00:00Z") });
    await insertInvoice({ creatorId: creatorAId, dealId: dealAHybridId, number: 3, amountCents: 30000, status: "paid", paidAt: new Date("2026-03-12T00:00:00Z") });

    const caller = dashboardRouter.createCaller(mockCtx(creatorAId));
    const result = await caller.overview({ period: "month", now: NOW_ISO });

    expect(result.revenue.totalCents).toBe(60000);
    expect(result.revenue.byType).toEqual({ flat: 10000, bounty: 20000, hybrid: 30000 });
    expect(result.revenue.periodStart).toEqual(MAR_START_ET);
    expect(result.revenue.periodEnd).toEqual(APR_START_ET);
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
    expect(month.revenue.periodStart).toEqual(MAR_START_ET);

    const quarter = await caller.overview({ period: "quarter", now: NOW_ISO });
    expect(quarter.revenue.totalCents).toBe(18000);
    expect(quarter.revenue.periodStart).toEqual(JAN_START_ET);
    expect(quarter.revenue.periodEnd).toEqual(APR_START_ET);

    const ytd = await caller.overview({ period: "ytd", now: NOW_ISO });
    expect(ytd.revenue.totalCents).toBe(18000);
    expect(ytd.revenue.periodStart).toEqual(JAN_START_ET);
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

  it("splits the trailing-12-month series by deal type too", async () => {
    await insertInvoice({ creatorId: creatorAId, dealId: dealAFlatId, number: 1, amountCents: 10000, status: "paid", paidAt: new Date("2026-03-05T00:00:00Z") });
    await insertInvoice({ creatorId: creatorAId, dealId: dealABountyId, number: 2, amountCents: 20000, status: "paid", paidAt: new Date("2026-03-10T00:00:00Z") });
    await insertInvoice({ creatorId: creatorAId, dealId: dealAHybridId, number: 3, amountCents: 30000, status: "paid", paidAt: new Date("2026-03-12T00:00:00Z") });
    // A February hybrid payment, to prove the split is bucketed per month and
    // not just summed across the whole series.
    await insertInvoice({ creatorId: creatorAId, dealId: dealAHybridId, number: 4, amountCents: 4000, status: "paid", paidAt: new Date("2026-02-02T00:00:00Z") });

    const caller = dashboardRouter.createCaller(mockCtx(creatorAId));
    const result = await caller.overview({ period: "month", now: NOW_ISO });

    const mar = result.revenue.monthly.find((m) => m.month === "2026-03");
    expect(mar).toMatchObject({
      valueCents: 60000,
      flatCents: 10000,
      bountyCents: 20000,
      hybridCents: 30000,
    });

    const feb = result.revenue.monthly.find((m) => m.month === "2026-02");
    expect(feb).toMatchObject({
      valueCents: 4000,
      flatCents: 0,
      bountyCents: 0,
      hybridCents: 4000,
    });

    // Every other bucket is fully zeroed, split included.
    for (const m of result.revenue.monthly) {
      if (m.month === "2026-03" || m.month === "2026-02") continue;
      expect(m).toMatchObject({ valueCents: 0, flatCents: 0, bountyCents: 0, hybridCents: 0 });
    }
  });

  it("counts an orphaned invoice (dealId null) in totalCents but not in the byType split", async () => {
    // Ratified semantic: an orphaned invoice is still the creator's money, but
    // it cannot be typed, so `totalCents != flat + bounty + hybrid` by design.
    // Currently unreachable in production — `invoice.create` requires a dealId
    // and deals are only soft-deleted — so this pins the defensive handling.
    await insertInvoice({ creatorId: creatorAId, dealId: dealAFlatId, number: 1, amountCents: 10000, status: "paid", paidAt: new Date("2026-03-05T00:00:00Z") });
    await insertInvoice({ creatorId: creatorAId, dealId: null, number: 2, amountCents: 25000, status: "paid", paidAt: new Date("2026-03-06T00:00:00Z") });

    const caller = dashboardRouter.createCaller(mockCtx(creatorAId));
    const result = await caller.overview({ period: "month", now: NOW_ISO });

    expect(result.revenue.totalCents).toBe(35000);
    expect(result.revenue.byType).toEqual({ flat: 10000, bounty: 0, hybrid: 0 });
    const splitSum =
      result.revenue.byType.flat + result.revenue.byType.bounty + result.revenue.byType.hybrid;
    expect(result.revenue.totalCents - splitSum).toBe(25000);

    // The T12M series carries the same documented gap.
    const mar = result.revenue.monthly.find((m) => m.month === "2026-03");
    expect(mar?.valueCents).toBe(35000);
    expect((mar?.flatCents ?? 0) + (mar?.bountyCents ?? 0) + (mar?.hybridCents ?? 0)).toBe(10000);
  });

  it("excludes soft-deleted deals from the pipeline", async () => {
    await db
      .update(schema.deals)
      .set({ deletedAt: new Date("2026-03-01T00:00:00Z") })
      .where(eq(schema.deals.id, dealABountyId));

    const caller = dashboardRouter.createCaller(mockCtx(creatorAId));
    const result = await caller.overview({ now: NOW_ISO });

    expect(result.pipeline.reduce((s, p) => s + p.count, 0)).toBe(2);
    // The bounty deal was the "live" stage's 2000-cent half.
    expect(result.pipeline.find((p) => p.stage === "live")).toMatchObject({
      count: 1,
      valueCents: 3000,
    });
    expect(result.pipeline.find((p) => p.stage === "inbound")).toMatchObject({
      count: 1,
      valueCents: 1000,
    });
  });

  it("bounds due-this-week deliverables to the creator-local ISO week and excludes done", async () => {
    // Creator A is America/New_York, so "this week" is Mon 2026-03-16 00:00 ET
    // (2026-03-16T04:00Z) through Mon 2026-03-23 00:00 ET (2026-03-23T04:00Z).
    // Two fixtures below straddle that window in the direction UTC gets wrong.
    await mkDeliverableA(new Date("2026-03-16T04:00:00Z"), "scheduled", "Mon 00:00 ET (in, week start)");
    await mkDeliverableA(new Date("2026-03-20T22:00:00Z"), "scheduled", "Fri 18:00 ET (in)");
    // Sunday evening local. UTC calls this Mon Mar 23 and files it next week.
    await mkDeliverableA(new Date("2026-03-23T00:00:00Z"), "scheduled", "Sun 20:00 ET (in, last local day)");
    // Sunday night local, before the week starts. UTC calls this Mon Mar 16.
    await mkDeliverableA(new Date("2026-03-16T03:59:00Z"), "scheduled", "prior Sun 23:59 ET (out)");
    await mkDeliverableA(new Date("2026-03-23T04:00:00Z"), "scheduled", "next Mon 00:00 ET (out)");
    await mkDeliverableA(new Date("2026-03-19T20:00:00Z"), "done", "in-week but done");

    const caller = dashboardRouter.createCaller(mockCtx(creatorAId));
    const result = await caller.overview({ now: NOW_ISO });

    expect(result.deliverablesDue.map((d) => d.title)).toEqual([
      "Mon 00:00 ET (in, week start)",
      "Fri 18:00 ET (in)",
      "Sun 20:00 ET (in, last local day)",
    ]);
    expect(result.deliverablesDue[0].dealTitle).toBe("Flat deal");
    expect(result.deliverablesDue[0].brandName).toBe("Brand A");
  });

  it("keeps the due-this-week window 7 calendar days wide across a DST transition", async () => {
    // US DST starts Sun 2026-03-08 at 02:00 ET, so the week of Mon Mar 2 is 167
    // hours long: Mon 2026-03-02 00:00 EST (05:00Z) → Mon 2026-03-09 00:00 EDT
    // (04:00Z). A `weekStart + 7 * 24h` implementation ends at 05:00Z instead
    // and swallows the first hour of the next week.
    await mkDeliverableA(new Date("2026-03-09T03:00:00Z"), "scheduled", "Sun 23:00 EDT (in, last hour)");
    await mkDeliverableA(new Date("2026-03-09T04:30:00Z"), "scheduled", "next Mon 00:30 EDT (out)");
    await mkDeliverableA(new Date("2026-03-02T04:59:00Z"), "scheduled", "prior Sun 23:59 EST (out)");

    const caller = dashboardRouter.createCaller(mockCtx(creatorAId));
    const result = await caller.overview({ now: "2026-03-04T12:00:00Z" });

    expect(result.deliverablesDue.map((d) => d.title)).toEqual([
      "Sun 23:00 EDT (in, last hour)",
    ]);
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

  it("outstanding totals every open invoice regardless of dueAt", async () => {
    // Open and overdue.
    await insertInvoice({ creatorId: creatorAId, dealId: dealAFlatId, number: 1, amountCents: 1000, status: "open", dueAt: new Date("2026-01-01T00:00:00Z") });
    // Open but not yet due.
    await insertInvoice({ creatorId: creatorAId, dealId: dealABountyId, number: 2, amountCents: 2000, status: "open", dueAt: new Date("2026-04-01T00:00:00Z") });
    // Open with no due date.
    await insertInvoice({ creatorId: creatorAId, dealId: dealAHybridId, number: 3, amountCents: 3000, status: "open", dueAt: null });
    // Paid (must be excluded).
    await insertInvoice({ creatorId: creatorAId, dealId: dealAFlatId, number: 4, amountCents: 9000, status: "paid", paidAt: new Date("2026-02-01T00:00:00Z") });

    const caller = dashboardRouter.createCaller(mockCtx(creatorAId));
    const result = await caller.overview({ now: NOW_ISO });

    expect(result.outstanding.count).toBe(3);
    expect(result.outstanding.totalCents).toBe(6000);
    // Overdue stays a strict subset of outstanding.
    expect(result.overdue.count).toBe(1);
    expect(result.overdue.totalCents).toBe(1000);
  });

  it("computes previousTotalCents over the same elapsed window of the preceding month", async () => {
    // Current month (Mar 2026).
    await insertInvoice({ creatorId: creatorAId, dealId: dealAFlatId, number: 1, amountCents: 10000, status: "paid", paidAt: new Date("2026-03-05T00:00:00Z") });
    // Previous month, inside the same-elapsed window (Feb 1 – Feb 18).
    await insertInvoice({ creatorId: creatorAId, dealId: dealABountyId, number: 2, amountCents: 20000, status: "paid", paidAt: new Date("2026-02-10T00:00:00Z") });
    // Previous month but after the Feb 18 cutoff — must not count (proves the
    // window is truncated to the same elapsed offset, not the full month).
    await insertInvoice({ creatorId: creatorAId, dealId: dealAHybridId, number: 3, amountCents: 70000, status: "paid", paidAt: new Date("2026-02-25T00:00:00Z") });
    // January — distinct value so an off-by-one window (Jan 1 – Feb 1) would
    // read 40000, not 20000, and fail.
    await insertInvoice({ creatorId: creatorAId, dealId: dealAFlatId, number: 4, amountCents: 40000, status: "paid", paidAt: new Date("2026-01-15T00:00:00Z") });

    const caller = dashboardRouter.createCaller(mockCtx(creatorAId));
    const result = await caller.overview({ period: "month", now: NOW_ISO });

    expect(result.revenue.totalCents).toBe(10000);
    expect(result.revenue.previousTotalCents).toBe(20000);
  });

  it("returns null previousTotalCents when the prior window has no paid invoice", async () => {
    await insertInvoice({ creatorId: creatorAId, dealId: dealAFlatId, number: 1, amountCents: 10000, status: "paid", paidAt: new Date("2026-03-05T00:00:00Z") });

    const caller = dashboardRouter.createCaller(mockCtx(creatorAId));
    const result = await caller.overview({ period: "month", now: NOW_ISO });

    expect(result.revenue.totalCents).toBe(10000);
    expect(result.revenue.previousTotalCents).toBeNull();
  });

  it("computes previousTotalCents for quarter and YTD windows", async () => {
    // Q1 2026.
    await insertInvoice({ creatorId: creatorAId, dealId: dealAFlatId, number: 1, amountCents: 3000, status: "paid", paidAt: new Date("2026-01-20T00:00:00Z") });
    await insertInvoice({ creatorId: creatorAId, dealId: dealAFlatId, number: 2, amountCents: 5000, status: "paid", paidAt: new Date("2026-02-15T00:00:00Z") });
    await insertInvoice({ creatorId: creatorAId, dealId: dealAFlatId, number: 3, amountCents: 10000, status: "paid", paidAt: new Date("2026-03-05T00:00:00Z") });
    // Previous quarter, inside the same-elapsed window (Oct 1 – Dec 18).
    await insertInvoice({ creatorId: creatorAId, dealId: dealAFlatId, number: 4, amountCents: 7000, status: "paid", paidAt: new Date("2025-11-15T00:00:00Z") });
    // Previous quarter but after the Dec 18 cutoff — must not count.
    await insertInvoice({ creatorId: creatorAId, dealId: dealAFlatId, number: 5, amountCents: 40000, status: "paid", paidAt: new Date("2025-12-20T00:00:00Z") });

    const caller = dashboardRouter.createCaller(mockCtx(creatorAId));

    const quarter = await caller.overview({ period: "quarter", now: NOW_ISO });
    expect(quarter.revenue.totalCents).toBe(18000);
    expect(quarter.revenue.previousTotalCents).toBe(7000);

    // YTD compares against Jan 1 – Mar 18 2025, which has no paid invoices here.
    const ytd = await caller.overview({ period: "ytd", now: NOW_ISO });
    expect(ytd.revenue.totalCents).toBe(18000);
    expect(ytd.revenue.previousTotalCents).toBeNull();
  });

  it("computes YTD previousTotalCents as the same window last year", async () => {
    // 2026 YTD.
    await insertInvoice({ creatorId: creatorAId, dealId: dealAFlatId, number: 1, amountCents: 10000, status: "paid", paidAt: new Date("2026-03-05T00:00:00Z") });
    // Last year, inside the comparable window (before Mar 18 2025).
    await insertInvoice({ creatorId: creatorAId, dealId: dealABountyId, number: 2, amountCents: 20000, status: "paid", paidAt: new Date("2025-02-10T00:00:00Z") });
    // Last year, but after the comparable cutoff (after Mar 18 2025).
    await insertInvoice({ creatorId: creatorAId, dealId: dealAHybridId, number: 3, amountCents: 30000, status: "paid", paidAt: new Date("2025-04-01T00:00:00Z") });

    const caller = dashboardRouter.createCaller(mockCtx(creatorAId));
    const result = await caller.overview({ period: "ytd", now: NOW_ISO });

    expect(result.revenue.totalCents).toBe(10000);
    expect(result.revenue.previousTotalCents).toBe(20000);
  });

  it("clamps the prior-month end so it never spills into the current month (Mar 31)", async () => {
    // now = Mar 31. `addZonedMonths(Mar 31, -1)` rolls Feb 31 → Mar 3, so an
    // unclamped prior window overlaps March and double-counts Mar 1–2 revenue.
    await insertInvoice({ creatorId: creatorAId, dealId: dealAFlatId, number: 1, amountCents: 5000, status: "paid", paidAt: new Date("2026-03-02T00:00:00Z") });
    await insertInvoice({ creatorId: creatorAId, dealId: dealABountyId, number: 2, amountCents: 20000, status: "paid", paidAt: new Date("2026-02-15T00:00:00Z") });

    const caller = dashboardRouter.createCaller(mockCtx(creatorAId));
    const result = await caller.overview({ period: "month", now: "2026-03-31T12:00:00Z" });

    expect(result.revenue.totalCents).toBe(5000);
    expect(result.revenue.previousTotalCents).toBe(20000);
  });

  it("clamps the prior-quarter end so it never spills into the current quarter (Dec 31)", async () => {
    // now = Dec 31. `addZonedMonths(Dec 31, -3)` rolls Sep 31 → Oct 1, so an
    // unclamped prior window overlaps Q4 and double-counts Oct 1 revenue.
    await insertInvoice({ creatorId: creatorAId, dealId: dealAFlatId, number: 1, amountCents: 3000, status: "paid", paidAt: new Date("2026-10-01T06:00:00Z") });
    await insertInvoice({ creatorId: creatorAId, dealId: dealABountyId, number: 2, amountCents: 7000, status: "paid", paidAt: new Date("2026-09-10T00:00:00Z") });

    const caller = dashboardRouter.createCaller(mockCtx(creatorAId));
    const result = await caller.overview({ period: "quarter", now: "2026-12-31T12:00:00Z" });

    expect(result.revenue.totalCents).toBe(3000);
    expect(result.revenue.previousTotalCents).toBe(7000);
  });
});

describe("dashboard.overview period math is creator-local", () => {
  async function seedCreator(timezone?: string) {
    const [creator] = await db
      .insert(schema.creators)
      .values({ displayName: `Creator ${timezone ?? "default"}`, ...(timezone ? { timezone } : {}) })
      .returning();
    const [brand] = await db
      .insert(schema.brands)
      .values({ creatorId: creator.id, name: "Brand" })
      .returning();
    const [deal] = await db
      .insert(schema.deals)
      .values({
        creatorId: creator.id,
        brandId: brand.id,
        title: "Deal",
        type: "flat",
        stage: "live",
        valueCents: 1000,
      })
      .returning();
    return { creatorId: creator.id, dealId: deal.id };
  }

  async function paidInvoice(creatorId: string, dealId: string, number: number, amountCents: number, paidAt: string) {
    await insertInvoice({
      creatorId,
      dealId,
      number,
      amountCents,
      status: "paid",
      paidAt: new Date(paidAt),
    });
  }

  it("files a month-boundary payment in the creator's month, not UTC's", async () => {
    // The exact probe from the QA review of PR #79: 2026-03-01T01:30:00Z is
    // Feb 28, 8:30pm for a New York creator, so it is February revenue.
    const { creatorId, dealId } = await seedCreator("America/New_York");
    await paidInvoice(creatorId, dealId, 1, 44400, "2026-03-01T01:30:00Z");

    const caller = dashboardRouter.createCaller(mockCtx(creatorId));

    const feb = await caller.overview({ period: "month", now: "2026-02-20T12:00:00Z" });
    expect(feb.timeZone).toBe("America/New_York");
    expect(feb.revenue.totalCents).toBe(44400);
    expect(feb.revenue.periodStart).toEqual(new Date("2026-02-01T05:00:00Z"));
    expect(feb.revenue.periodEnd).toEqual(MAR_START_ET);

    const mar = await caller.overview({ period: "month", now: NOW_ISO });
    expect(mar.revenue.totalCents).toBe(0);

    // ...and the trailing-12 series agrees with the period total.
    expect(mar.revenue.monthly.find((m) => m.month === "2026-02")?.valueCents).toBe(44400);
    expect(mar.revenue.monthly.find((m) => m.month === "2026-03")?.valueCents).toBe(0);
  });

  it("keeps the same instant in UTC's month for a UTC creator", async () => {
    // Same payment, different creator: the old UTC behaviour is still correct
    // for someone actually on UTC, which is what makes this a timezone bug and
    // not an off-by-one.
    const { creatorId, dealId } = await seedCreator("UTC");
    await paidInvoice(creatorId, dealId, 1, 44400, "2026-03-01T01:30:00Z");

    const caller = dashboardRouter.createCaller(mockCtx(creatorId));
    const mar = await caller.overview({ period: "month", now: NOW_ISO });

    expect(mar.timeZone).toBe("UTC");
    expect(mar.revenue.totalCents).toBe(44400);
    expect(mar.revenue.periodStart).toEqual(new Date("2026-03-01T00:00:00Z"));
    expect(mar.revenue.monthly.find((m) => m.month === "2026-03")?.valueCents).toBe(44400);
    expect(mar.revenue.monthly.find((m) => m.month === "2026-02")?.valueCents).toBe(0);
  });

  it("uses the offset in force at each boundary, not the offset at `now` (DST)", async () => {
    // US DST starts 2026-03-08. March 2026 opens at 05:00Z (EST) and closes at
    // 04:00Z on Apr 1 (EDT). Anything that caches one offset — say the EDT
    // offset in force at `now` — puts the March boundary at 04:00Z and pulls
    // this 04:30Z payment (Feb 28, 11:30pm EST) into March.
    const { creatorId, dealId } = await seedCreator("America/New_York");
    await paidInvoice(creatorId, dealId, 1, 7700, "2026-03-01T04:30:00Z");

    const caller = dashboardRouter.createCaller(mockCtx(creatorId));
    const mar = await caller.overview({ period: "month", now: NOW_ISO });

    expect(mar.revenue.periodStart).toEqual(MAR_START_ET);
    expect(mar.revenue.periodEnd).toEqual(APR_START_ET);
    expect(mar.revenue.totalCents).toBe(0);
    expect(mar.revenue.monthly.find((m) => m.month === "2026-02")?.valueCents).toBe(7700);
  });

  it("handles a southern-hemisphere zone whose DST runs the other way", async () => {
    // Australia/Sydney is UTC+11 in March (AEDT) and UTC+10 in July (AEST), so
    // its year and quarter boundaries move in the opposite direction to the US.
    const { creatorId, dealId } = await seedCreator("Australia/Sydney");
    // 2025-12-31T14:30:00Z is Jan 1 2026, 1:30am in Sydney — 2026 revenue.
    await paidInvoice(creatorId, dealId, 1, 5000, "2025-12-31T14:30:00Z");
    // 2026-06-30T15:30:00Z is Jul 1, 1:30am AEST — Q3, outside a Q2 window.
    await paidInvoice(creatorId, dealId, 2, 6000, "2026-06-30T15:30:00Z");

    const caller = dashboardRouter.createCaller(mockCtx(creatorId));

    const ytd = await caller.overview({ period: "ytd", now: "2026-03-18T12:00:00Z" });
    expect(ytd.revenue.periodStart).toEqual(new Date("2025-12-31T13:00:00Z"));
    expect(ytd.revenue.totalCents).toBe(5000);

    const q2 = await caller.overview({ period: "quarter", now: "2026-05-15T12:00:00Z" });
    expect(q2.revenue.periodStart).toEqual(new Date("2026-03-31T13:00:00Z"));
    expect(q2.revenue.periodEnd).toEqual(new Date("2026-06-30T14:00:00Z"));
    expect(q2.revenue.totalCents).toBe(0);
  });

  it("falls back to UTC rather than throwing when the stored timezone is unusable", async () => {
    // `creators.timezone` is free text at the DB level; a bad value must not
    // 500 the dashboard.
    const { creatorId, dealId } = await seedCreator("Not/AZone");
    await paidInvoice(creatorId, dealId, 1, 1234, "2026-03-01T01:30:00Z");

    const caller = dashboardRouter.createCaller(mockCtx(creatorId));
    const mar = await caller.overview({ period: "month", now: NOW_ISO });

    expect(mar.timeZone).toBe("UTC");
    expect(mar.revenue.periodStart).toEqual(new Date("2026-03-01T00:00:00Z"));
    expect(mar.revenue.totalCents).toBe(1234);
  });

  // ── Period seams: end(P) must be exactly start(P+1) (SPO-251) ──
  //
  // Deriving the end by shifting the resolved start forward inherited the
  // start's local time of day, which is 01:00 rather than 00:00 when a
  // spring-forward opens at midnight. The half-open windows then overlapped by
  // the gap width and the same payment landed in two consecutive periods.

  it("does not count a payment in both Q4 and Q1 when the year opens in a DST gap", async () => {
    // Paraguay sprang forward at midnight on 2023-10-01, so Q4-2023 STARTS at
    // 01:00 local (04:00Z) — correct. Shifting that start by 3 months put
    // Q4's END at 2024-01-01 01:00 local (04:00Z), an hour past where Q1-2024
    // opens (03:00Z). This payment is 2024-01-01 00:30 local, inside that hour.
    const { creatorId, dealId } = await seedCreator("America/Asuncion");
    await paidInvoice(creatorId, dealId, 1, 90000, "2024-01-01T03:30:00Z");

    const caller = dashboardRouter.createCaller(mockCtx(creatorId));
    const q4 = await caller.overview({ period: "quarter", now: "2023-11-15T12:00:00Z" });
    const q1 = await caller.overview({ period: "quarter", now: "2024-02-15T12:00:00Z" });

    expect(q4.revenue.periodStart).toEqual(new Date("2023-10-01T04:00:00Z"));
    expect(q4.revenue.periodEnd).toEqual(new Date("2024-01-01T03:00:00Z"));
    expect(q1.revenue.periodStart).toEqual(new Date("2024-01-01T03:00:00Z"));
    // The seam itself: no overlap, no gap.
    expect(q4.revenue.periodEnd).toEqual(q1.revenue.periodStart);

    // Counted once, in Q1 — and the trailing-12 series, which keys off
    // zonedMonthKey rather than the period bounds, agrees with it. Those two
    // disagreeing for one invoice is the failure SPO-239 exists to prevent.
    expect(q4.revenue.totalCents).toBe(0);
    expect(q1.revenue.totalCents).toBe(90000);
    expect(q1.revenue.monthly.find((m) => m.month === "2024-01")?.valueCents).toBe(90000);
    expect(q1.revenue.monthly.find((m) => m.month === "2023-12")?.valueCents).toBe(0);
  });

  it("does not pull next week's deliverable into this week when the week opens in a DST gap", async () => {
    // Same defect on the `addZonedDays(weekStart, 7)` path. Iran sprang forward
    // at midnight on Monday 2016-03-21, so that week starts at 01:00 local
    // (20:30Z Sunday) and the shifted end was 2016-03-28 01:00 local (20:30Z)
    // — half an hour past the next week's 19:30Z start. This deliverable is due
    // 2016-03-28 00:30 local, i.e. next week.
    const { creatorId, dealId } = await seedCreator("Asia/Tehran");
    await db.insert(schema.deliverables).values({
      dealId,
      title: "Next week's clip",
      status: "not_started",
      dueAt: new Date("2016-03-27T20:00:00Z"),
      position: 0,
    });

    const caller = dashboardRouter.createCaller(mockCtx(creatorId));
    const thisWeek = await caller.overview({ now: "2016-03-23T12:00:00Z" });
    const nextWeek = await caller.overview({ now: "2016-03-30T12:00:00Z" });

    expect(thisWeek.deliverablesDue).toEqual([]);
    expect(nextWeek.deliverablesDue.map((d) => d.title)).toEqual(["Next week's clip"]);
  });
});
