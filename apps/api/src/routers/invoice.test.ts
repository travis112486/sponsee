import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { sql } from "drizzle-orm";
import { invoiceRouter } from "./invoice.js";
import { dashboardRouter } from "./dashboard.js";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "../test-utils/schema-sql.js";

function mockCtx(creatorId: string) {
  return {
    session: { user: { id: `user-${creatorId}`, email: "test@example.com", name: "Test User" } },
    creatorId,
    db,
  };
}

let creatorId = "";
let dealId = "";

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

async function seedBase() {
  const [creator] = await db.insert(schema.creators).values({ displayName: "Creator A" }).returning();
  creatorId = creator.id;

  const [brand] = await db.insert(schema.brands).values({ creatorId, name: "Brand A" }).returning();

  const [deal] = await db
    .insert(schema.deals)
    .values({ creatorId, brandId: brand.id, title: "Flat deal", type: "flat", stage: "inbound", valueCents: 1000 })
    .returning();
  dealId = deal.id;
}

async function insertInvoice(opts: { status?: string; paidAt?: Date | null; number?: number }) {
  const [row] = await db
    .insert(schema.invoices)
    .values({
      creatorId,
      dealId,
      number: opts.number ?? 1,
      amountCents: 500000,
      status: (opts.status as "draft" | "open" | "paid" | "void") ?? "open",
      paidAt: opts.paidAt ?? null,
    })
    .returning();
  return row;
}

beforeAll(async () => {
  await initPgliteSchema(SCHEMA_SQL);
});

beforeEach(async () => {
  await cleanTables();
  await seedBase();
});

describe("invoice.update paid/paidAt invariant", () => {
  it("defaults paidAt when status moves to paid without one supplied", async () => {
    const invoice = await insertInvoice({ status: "open" });
    const caller = invoiceRouter.createCaller(mockCtx(creatorId));

    const updated = await caller.update({ id: invoice.id, status: "paid" });

    expect(updated.status).toBe("paid");
    expect(updated.paidAt).not.toBeNull();
  });

  it("clears paidAt when status moves away from paid", async () => {
    const invoice = await insertInvoice({ status: "paid", paidAt: new Date("2026-02-01T00:00:00Z") });
    const caller = invoiceRouter.createCaller(mockCtx(creatorId));

    const updated = await caller.update({ id: invoice.id, status: "open" });

    expect(updated.status).toBe("open");
    expect(updated.paidAt).toBeNull();
  });

  it("respects an explicitly supplied paidAt when marking paid", async () => {
    const invoice = await insertInvoice({ status: "open" });
    const explicit = new Date("2026-01-15T00:00:00Z");
    const caller = invoiceRouter.createCaller(mockCtx(creatorId));

    const updated = await caller.update({ id: invoice.id, status: "paid", paidAt: explicit });

    expect(updated.paidAt).toEqual(explicit);
  });

  it("leaves paidAt untouched when status is not part of the update", async () => {
    const invoice = await insertInvoice({ status: "paid", paidAt: new Date("2026-02-01T00:00:00Z") });
    const caller = invoiceRouter.createCaller(mockCtx(creatorId));

    const updated = await caller.update({ id: invoice.id, title: "Renamed" });

    expect(updated.status).toBe("paid");
    expect(updated.paidAt).toEqual(new Date("2026-02-01T00:00:00Z"));
  });

  it("rejects a direct write that violates the invariant at the storage layer", async () => {
    const invoice = await insertInvoice({ status: "open" });

    // The top-level DrizzleQueryError message is just "Failed query: ...";
    // the postgres constraint name is on `.cause.constraint`.
    await expect(
      db.update(schema.invoices).set({ status: "paid", paidAt: null }).where(sql`id = ${invoice.id}`)
    ).rejects.toMatchObject({ cause: { constraint: "invoices_paid_requires_paid_at" } });
  });

  it("makes the paid invoice visible in dashboard.overview revenue after the fix", async () => {
    const invoice = await insertInvoice({ status: "open" });
    const invoiceCaller = invoiceRouter.createCaller(mockCtx(creatorId));
    await invoiceCaller.update({ id: invoice.id, status: "paid" });

    const dashboardCaller = dashboardRouter.createCaller(mockCtx(creatorId));
    const result = await dashboardCaller.overview();

    expect(result.revenue.totalCents).toBe(500000);
  });
});
