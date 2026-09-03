import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { sql, eq } from "drizzle-orm";
import { invoiceRouter } from "./invoice.js";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "../test-utils/schema-sql.js";

// Mock the email provider factory so these tests never touch a real SMTP
// server; sendMock is asserted directly for call count/args (SPO-363 AC:
// "zero provider calls" on refusal).
const sendMock = vi.fn(() => Promise.resolve({ providerMessageId: "msg-abc" }));
vi.mock("../email/index.js", () => ({
  createEmailProvider: vi.fn(() => ({
    name: "mailpit",
    send: sendMock,
    ingestWebhook: vi.fn(),
  })),
}));

function mockCtx(creatorId: string) {
  return {
    session: { user: { id: `user-${creatorId}`, email: "test@example.com", name: "Test User" } },
    creatorId,
    db,
  };
}

let creatorId = "";
let brandId = "";
let dealId = "";
let contactId = "";

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

async function seedBase(opts: { withOwnerEmail?: boolean } = {}) {
  const withOwnerEmail = opts.withOwnerEmail ?? true;

  const [creator] = await db
    .insert(schema.creators)
    .values({ displayName: "Creator A", paypalLink: "paypal.me/creatora", wiseText: "Wise: creator@wise.example" })
    .returning();
  creatorId = creator.id;

  if (withOwnerEmail) {
    await db.insert(schema.user).values({
      id: `user-${creatorId}`,
      name: "Owner",
      email: "owner@example.com",
    });
    await db.insert(schema.memberships).values({
      userId: `user-${creatorId}`,
      creatorId,
      role: "owner",
    });
  }

  const [brand] = await db.insert(schema.brands).values({ creatorId, name: "Brand A" }).returning();
  brandId = brand.id;

  const [contact] = await db
    .insert(schema.contacts)
    .values({ brandId, name: "Brand Contact", email: "brand-contact@example.com" })
    .returning();
  contactId = contact.id;

  const [deal] = await db
    .insert(schema.deals)
    .values({ creatorId, brandId, primaryContactId: contact.id, title: "Flat deal", type: "flat", stage: "inbound", valueCents: 1000 })
    .returning();
  dealId = deal.id;
}

async function insertInvoice(opts: {
  status?: "draft" | "open" | "paid" | "void";
  contactId?: string | null;
  dealId?: string | null;
  number?: number;
  paidAt?: Date | null;
}) {
  const [row] = await db
    .insert(schema.invoices)
    .values({
      creatorId,
      dealId: opts.dealId === undefined ? dealId : opts.dealId,
      contactId: opts.contactId === undefined ? contactId : opts.contactId,
      number: opts.number ?? 1,
      amountCents: 500000,
      title: "Sponsorship invoice",
      dueAt: new Date("2026-03-01T00:00:00Z"),
      status: opts.status ?? "open",
      paidAt: opts.paidAt ?? null,
    })
    .returning();
  return row;
}

beforeAll(async () => {
  await initPgliteSchema(SCHEMA_SQL);
});

beforeEach(async () => {
  sendMock.mockClear();
  sendMock.mockResolvedValue({ providerMessageId: "msg-abc" });
  await cleanTables();
  await seedBase();
});

describe("invoice.create leaves chase unarmed (SPO-363)", () => {
  it("writes no invoiceChaseState row on create", async () => {
    const caller = invoiceRouter.createCaller(mockCtx(creatorId));
    const invoice = await caller.create({ dealId, contactId, amountCents: 10000, title: "New" });

    const [state] = await db
      .select()
      .from(schema.invoiceChaseState)
      .where(eq(schema.invoiceChaseState.invoiceId, invoice.id));
    expect(state).toBeUndefined();
  });
});

describe("invoice.send — happy path", () => {
  it("sends via the provider with replyTo == owner email and from == platform address", async () => {
    const invoice = await insertInvoice({});
    const caller = invoiceRouter.createCaller(mockCtx(creatorId));

    const prevFrom = process.env.INVOICE_FROM_EMAIL;
    delete process.env.INVOICE_FROM_EMAIL;
    try {
      await caller.send({ id: invoice.id });
    } finally {
      if (prevFrom === undefined) delete process.env.INVOICE_FROM_EMAIL;
      else process.env.INVOICE_FROM_EMAIL = prevFrom;
    }

    expect(sendMock).toHaveBeenCalledTimes(1);
    const payload = sendMock.mock.calls[0][0];
    expect(payload.to).toBe("brand-contact@example.com");
    expect(payload.replyTo).toBe("owner@example.com");
    expect(payload.from).toBe("invoices@sponsee.app");
    expect(payload.text).toContain("$5,000");
    expect(payload.text).toContain("Due date:");
    expect(payload.text).toContain("2026");
  });

  it("arms chase on send (was unarmed after create)", async () => {
    const invoice = await insertInvoice({});
    const caller = invoiceRouter.createCaller(mockCtx(creatorId));

    await caller.send({ id: invoice.id });

    const [state] = await db
      .select()
      .from(schema.invoiceChaseState)
      .where(eq(schema.invoiceChaseState.invoiceId, invoice.id));
    expect(state).toBeDefined();
    expect(state.mode).toBe("armed");
  });

  it("does not re-arm (or clobber) chase state on a resend", async () => {
    const invoice = await insertInvoice({});
    const caller = invoiceRouter.createCaller(mockCtx(creatorId));

    await caller.send({ id: invoice.id });
    await db
      .update(schema.invoiceChaseState)
      .set({ mode: "paused", pausedReason: "vacation" })
      .where(eq(schema.invoiceChaseState.invoiceId, invoice.id));

    await caller.send({ id: invoice.id });

    const [state] = await db
      .select()
      .from(schema.invoiceChaseState)
      .where(eq(schema.invoiceChaseState.invoiceId, invoice.id));
    expect(state.mode).toBe("paused");
  });

  it("populates rails_snapshot at send, frozen against a later settings edit", async () => {
    const invoice = await insertInvoice({});
    const caller = invoiceRouter.createCaller(mockCtx(creatorId));

    await caller.send({ id: invoice.id });

    const [afterSend] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoice.id));
    expect(afterSend.railsSnapshot).toMatchObject({
      displayName: "Creator A",
      paypalLink: "paypal.me/creatora",
      wiseText: "Wise: creator@wise.example",
    });

    // Creator changes their PayPal link after the invoice already shipped.
    await db.update(schema.creators).set({ paypalLink: "paypal.me/newlink" }).where(eq(schema.creators.id, creatorId));

    const [stillFrozen] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoice.id));
    expect(stillFrozen.railsSnapshot).toMatchObject({ paypalLink: "paypal.me/creatora" });
  });

  it("transitions a draft invoice to open on first send", async () => {
    const invoice = await insertInvoice({ status: "draft" });
    const caller = invoiceRouter.createCaller(mockCtx(creatorId));

    await caller.send({ id: invoice.id });

    const [row] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoice.id));
    expect(row.status).toBe("open");
  });

  it("writes an activity_events row of kind invoice_sent", async () => {
    const invoice = await insertInvoice({});
    const caller = invoiceRouter.createCaller(mockCtx(creatorId));

    await caller.send({ id: invoice.id });

    const [event] = await db
      .select()
      .from(schema.activityEvents)
      .where(eq(schema.activityEvents.entityId, invoice.id));
    expect(event.kind).toBe("invoice_sent");
  });

  it("sending twice creates two delivery rows with distinct attempt and public_token", async () => {
    const invoice = await insertInvoice({});
    const caller = invoiceRouter.createCaller(mockCtx(creatorId));

    const first = await caller.send({ id: invoice.id });
    const second = await caller.send({ id: invoice.id });

    expect(first.attempt).toBe(1);
    expect(second.attempt).toBe(2);
    expect(first.publicToken).not.toBe(second.publicToken);

    const rows = await db
      .select()
      .from(schema.invoiceDeliveries)
      .where(eq(schema.invoiceDeliveries.invoiceId, invoice.id));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.attempt)).size).toBe(2);
    expect(new Set(rows.map((r) => r.publicToken)).size).toBe(2);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("the idempotency key is unique per invoice+attempt at the storage layer", async () => {
    const invoice = await insertInvoice({});

    await db.insert(schema.invoiceDeliveries).values({
      invoiceId: invoice.id,
      attempt: 1,
      toEmail: "a@example.com",
      fromEmail: "invoices@sponsee.app",
      replyToEmail: "owner@example.com",
      subjectSnapshot: "s",
      textSnapshot: "t",
      publicToken: "token-1",
      idempotencyKey: `invoice:${invoice.id}:delivery:1`,
      status: "sent",
    });

    await expect(
      db.insert(schema.invoiceDeliveries).values({
        invoiceId: invoice.id,
        attempt: 1,
        toEmail: "a@example.com",
        fromEmail: "invoices@sponsee.app",
        replyToEmail: "owner@example.com",
        subjectSnapshot: "s",
        textSnapshot: "t",
        publicToken: "token-2",
        idempotencyKey: `invoice:${invoice.id}:delivery:1`,
        status: "queued",
      })
    ).rejects.toBeTruthy();
  });
});

describe("invoice.send — guards", () => {
  it("rejects sending a paid invoice", async () => {
    const invoice = await insertInvoice({ status: "paid", paidAt: new Date() });
    const caller = invoiceRouter.createCaller(mockCtx(creatorId));

    await expect(caller.send({ id: invoice.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("rejects sending a void invoice", async () => {
    const invoice = await insertInvoice({ status: "void" });
    const caller = invoiceRouter.createCaller(mockCtx(creatorId));

    await expect(caller.send({ id: invoice.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("refuses with PRECONDITION_FAILED and zero provider calls when no contact email resolves", async () => {
    const invoice = await insertInvoice({ contactId: null, dealId: null });
    const caller = invoiceRouter.createCaller(mockCtx(creatorId));

    await expect(caller.send({ id: invoice.id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(sendMock).not.toHaveBeenCalled();

    const [state] = await db
      .select()
      .from(schema.invoiceChaseState)
      .where(eq(schema.invoiceChaseState.invoiceId, invoice.id));
    expect(state).toBeUndefined();
  });

  it("falls back to the deal's primary contact when the invoice has no contact of its own", async () => {
    const invoice = await insertInvoice({ contactId: null });
    const caller = invoiceRouter.createCaller(mockCtx(creatorId));

    await caller.send({ id: invoice.id });

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].to).toBe("brand-contact@example.com");
  });

  it("refuses with PRECONDITION_FAILED and zero provider calls when no owner email resolves", async () => {
    await cleanTables();
    await seedBase({ withOwnerEmail: false });
    const invoice = await insertInvoice({});
    const caller = invoiceRouter.createCaller(mockCtx(creatorId));

    await expect(caller.send({ id: invoice.id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(sendMock).not.toHaveBeenCalled();

    const [state] = await db
      .select()
      .from(schema.invoiceChaseState)
      .where(eq(schema.invoiceChaseState.invoiceId, invoice.id));
    expect(state).toBeUndefined();
  });

  it("does not fall back to the platform from address as replyTo when the owner email is missing", async () => {
    // Distinguishes the deliberate invoice.send divergence from chase-tick:
    // chase logs a warning and falls back; invoice.send must refuse outright.
    await cleanTables();
    await seedBase({ withOwnerEmail: false });
    const invoice = await insertInvoice({});
    const caller = invoiceRouter.createCaller(mockCtx(creatorId));

    await expect(caller.send({ id: invoice.id })).rejects.toBeTruthy();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND for a cross-creator invoice", async () => {
    const [other] = await db.insert(schema.creators).values({ displayName: "Other" }).returning();
    const [otherBrand] = await db.insert(schema.brands).values({ creatorId: other.id, name: "Other Brand" }).returning();
    const [otherDeal] = await db
      .insert(schema.deals)
      .values({ creatorId: other.id, brandId: otherBrand.id, title: "Other deal", type: "flat" })
      .returning();
    const [otherInvoice] = await db
      .insert(schema.invoices)
      .values({ creatorId: other.id, dealId: otherDeal.id, number: 1, amountCents: 1000 })
      .returning();

    const caller = invoiceRouter.createCaller(mockCtx(creatorId));
    await expect(caller.send({ id: otherInvoice.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(sendMock).not.toHaveBeenCalled();
  });
});
