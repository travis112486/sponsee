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

  it("defaults paidAt when status moves to paid with an explicit paidAt: null", async () => {
    const invoice = await insertInvoice({ status: "open" });
    const caller = invoiceRouter.createCaller(mockCtx(creatorId));

    const updated = await caller.update({ id: invoice.id, status: "paid", paidAt: null });

    expect(updated.status).toBe("paid");
    expect(updated.paidAt).not.toBeNull();
  });

  it("rejects paidAt: null with no status against a paid invoice, without leaking the query", async () => {
    const invoice = await insertInvoice({ status: "paid", paidAt: new Date("2026-02-01T00:00:00Z") });
    const caller = invoiceRouter.createCaller(mockCtx(creatorId));

    const error: unknown = await caller.update({ id: invoice.id, paidAt: null }).catch((e) => e);

    expect(error).toMatchObject({ code: "BAD_REQUEST" });
    expect((error as Error).message).not.toMatch(/select|update|invoices|paid_at/i);
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

// SPO-265: the inverse of SPO-260's `paidAt: null` gap — `paidAt: <date>`
// with no `status` used to fall through both branches of the paid guard and
// write an orphan paid_at onto a non-paid row.
describe("invoice.update — paidAt orphan guard (SPO-265)", () => {
  it.each(["draft", "open", "void"] as const)(
    "rejects paidAt:<date> with no status against a %s invoice",
    async (status) => {
      const invoice = await insertInvoice({ status });
      const caller = invoiceRouter.createCaller(mockCtx(creatorId));

      await expect(caller.update({ id: invoice.id, paidAt: new Date() })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });

      const [row] = await db.select().from(schema.invoices).where(sql`id = ${invoice.id}`);
      expect(row.paidAt).toBeNull();
      expect(row.status).toBe(status);
    }
  );

  it("still allows paidAt to be set together with status: paid", async () => {
    const invoice = await insertInvoice({ status: "open" });
    const caller = invoiceRouter.createCaller(mockCtx(creatorId));
    const paidAt = new Date("2026-03-01T00:00:00Z");

    const result = await caller.update({ id: invoice.id, status: "paid", paidAt });

    expect(result.status).toBe("paid");
    expect(result.paidAt).toEqual(paidAt);
  });

  // Deliberate behaviour change, pinned so it is not "fixed" back later:
  // re-dating an already-paid invoice used to work via a bare `paidAt`, and now
  // requires the redundant-looking `status: "paid"` alongside it. The router
  // cannot tell that shape apart from the orphan-writing one without reading the
  // row, and the round trip is not worth it for a caller apps/web never makes.
  it("rejects a bare paidAt re-date on an already-paid invoice, and takes it with status", async () => {
    const invoice = await insertInvoice({ status: "paid", paidAt: new Date("2026-02-01T00:00:00Z") });
    const caller = invoiceRouter.createCaller(mockCtx(creatorId));
    const corrected = new Date("2026-02-14T00:00:00Z");

    await expect(caller.update({ id: invoice.id, paidAt: corrected })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });

    const updated = await caller.update({ id: invoice.id, status: "paid", paidAt: corrected });
    expect(updated.paidAt).toEqual(corrected);
  });

  // The 0013 CHECK was one-directional, so this same write used to succeed and
  // leave an orphan paid_at representable in the DB even though no router path
  // wrote one — see the SPO-265 git history for that version of this test. The
  // 0014 CHECK (SPO-273) makes the constraint a biconditional, so the storage
  // layer itself now rejects it: the router guards above are belt-and-braces,
  // not the only thing enforcing the invariant.
  it("rejects a direct write that orphans paid_at on a non-paid row at the storage layer", async () => {
    const invoice = await insertInvoice({ status: "open" });

    await expect(
      db
        .update(schema.invoices)
        .set({ paidAt: new Date("2026-04-01T00:00:00Z") })
        .where(sql`id = ${invoice.id}`)
    ).rejects.toMatchObject({ cause: { constraint: "invoices_paid_requires_paid_at" } });
  });
});

// SPO-347: `invoice.update` used to have no `contactId` in its input, so zod
// silently stripped a repair attempt and returned 200 with nothing written.
describe("invoice.update — contactId repair (SPO-347)", () => {
  it("accepts contactId and writes it, closing the silent-strip footgun", async () => {
    const invoice = await insertInvoice({ status: "open" });

    const [brand] = await db
      .select()
      .from(schema.brands)
      .where(sql`creator_id = ${creatorId}`)
      .limit(1);
    const [contact] = await db
      .insert(schema.contacts)
      .values({ brandId: brand.id, name: "Late Contact", email: "late@example.com" })
      .returning();

    const caller = invoiceRouter.createCaller(mockCtx(creatorId));
    const updated = await caller.update({ id: invoice.id, contactId: contact.id });

    expect(updated.contactId).toBe(contact.id);

    const [row] = await db.select().from(schema.invoices).where(sql`id = ${invoice.id}`);
    expect(row.contactId).toBe(contact.id);
  });

  it("rejects a cross-tenant contact loudly instead of silently dropping it", async () => {
    const invoice = await insertInvoice({ status: "open" });

    const [other] = await db.insert(schema.creators).values({ displayName: "Other" }).returning();
    const [otherBrand] = await db
      .insert(schema.brands)
      .values({ creatorId: other.id, name: "Other Brand" })
      .returning();
    const [otherContact] = await db
      .insert(schema.contacts)
      .values({ brandId: otherBrand.id, name: "Other Contact", email: "other@example.com" })
      .returning();

    const caller = invoiceRouter.createCaller(mockCtx(creatorId));
    await expect(
      caller.update({ id: invoice.id, contactId: otherContact.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const [row] = await db.select().from(schema.invoices).where(sql`id = ${invoice.id}`);
    expect(row.contactId).toBeNull();
  });
});
