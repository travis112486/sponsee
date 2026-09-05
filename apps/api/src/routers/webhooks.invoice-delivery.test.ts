import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { sql, eq } from "drizzle-orm";
import { handleEmailWebhook } from "./webhooks.js";
import { ResendProvider } from "../email/resend.js";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "../test-utils/schema-sql.js";

// SPO-364 — webhook correlation must now cover invoice_deliveries, not just
// chase_events. These tests replay stored Resend payloads through the real
// handler against the real (PGlite) db — zero outbound provider calls.

const h = vi.hoisted(() => ({ ingest: null as null | ((payload: unknown) => unknown) }));

vi.mock("../email/index.js", () => ({
  createEmailProvider: vi.fn(() => ({
    name: "resend",
    verifyWebhookSignature: () => true,
    ingestWebhook: (payload: unknown) => h.ingest!(payload),
  })),
}));

// Stored Resend payloads — the exact shapes Resend posts (see email.test.ts
// for the mapping these pass through).
const deliveredPayload = {
  type: "email.delivered",
  data: { email_id: "res-123", to: ["ap@acme.example"], created_at: "2026-09-02T00:00:00Z" },
};

const bouncedPayload = {
  type: "email.bounced",
  data: {
    email_id: "res-123",
    to: ["ap@acme.example"],
    bounce: {
      message: "The recipient's email address is on the suppression list.",
      subType: "Suppressed",
      type: "Permanent",
    },
  },
};

function mockContext(body: unknown) {
  return {
    req: {
      param: () => "resend",
      text: () => Promise.resolve(JSON.stringify(body)),
      json: () => Promise.resolve(body),
      raw: { headers: new Headers() },
    },
    json: (data: unknown, status = 200) => ({ data, status }),
  } as any;
}

let invoiceId = "";

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

async function seedInvoiceDelivery(providerMessageId: string) {
  const [creator] = await db.insert(schema.creators).values({ displayName: "Creator A" }).returning();

  const [invoice] = await db
    .insert(schema.invoices)
    .values({ creatorId: creator.id, number: 1, amountCents: 500000, status: "open" })
    .returning();
  invoiceId = invoice.id;

  const [delivery] = await db
    .insert(schema.invoiceDeliveries)
    .values({
      invoiceId: invoice.id,
      attempt: 1,
      toEmail: "ap@acme.example",
      fromEmail: "invoices@sponsee.app",
      replyToEmail: "owner@example.com",
      subjectSnapshot: "Invoice INV-0001",
      textSnapshot: "Amount due: $5,000",
      publicToken: "public-token-1",
      idempotencyKey: `invoice:${invoice.id}:delivery:1`,
      status: "sent",
      providerMessageId,
    })
    .returning();

  return { creator, invoice, delivery };
}

beforeAll(async () => {
  h.ingest = (payload) => new ResendProvider("dummy-key").ingestWebhook(payload);
  await initPgliteSchema(SCHEMA_SQL);
});

beforeEach(async () => {
  await cleanTables();
});

describe("invoice delivery webhook correlation (SPO-364)", () => {
  it("sets delivered_at on the delivery row for a replayed Resend delivered payload", async () => {
    await seedInvoiceDelivery("res-123");

    const result = await handleEmailWebhook(mockContext(deliveredPayload));

    expect(result.data).toMatchObject({ ok: true, handled: true, type: "delivered" });

    const [row] = await db
      .select()
      .from(schema.invoiceDeliveries)
      .where(eq(schema.invoiceDeliveries.providerMessageId, "res-123"));
    expect(row.status).toBe("delivered");
    expect(row.deliveredAt).not.toBeNull();
    expect(row.bouncedAt).toBeNull();
  });

  it("sets bounced_at and writes a loud activity event for a replayed Resend bounced payload", async () => {
    await seedInvoiceDelivery("res-123");

    const result = await handleEmailWebhook(mockContext(bouncedPayload));

    expect(result.data).toMatchObject({ ok: true, handled: true, type: "bounced" });

    const [row] = await db
      .select()
      .from(schema.invoiceDeliveries)
      .where(eq(schema.invoiceDeliveries.providerMessageId, "res-123"));
    expect(row.status).toBe("bounced");
    expect(row.bouncedAt).not.toBeNull();

    // Loud: a bounced invoice is the same failure as no delivery, so the
    // activity event carries an alert the timeline can surface (SPO-365).
    const [event] = await db
      .select()
      .from(schema.activityEvents)
      .where(eq(schema.activityEvents.entityId, invoiceId));
    expect(event).toBeDefined();
    expect(event.kind).toBe("invoice_sent");
    expect(event.payload).toMatchObject({ status: "bounced" });
    expect(event.payload.alert).toBeTruthy();
  });

  it("still correlates a chase event by provider message ID unchanged", async () => {
    await seedInvoiceDelivery("res-invoice-1");

    // A chase event on a different provider message ID must still be matched
    // and updated through the original chase branch, not the invoice branch.
    await db.insert(schema.chaseEvents).values({
      invoiceId,
      step: 1,
      providerMessageId: "res-chase-1",
      status: "sent",
      sentAt: new Date(),
    });

    const chaseDelivered = {
      type: "email.delivered",
      data: { email_id: "res-chase-1", to: ["ap@acme.example"], created_at: "2026-09-02T00:00:00Z" },
    };

    const result = await handleEmailWebhook(mockContext(chaseDelivered));
    expect(result.data).toMatchObject({ ok: true, handled: true, type: "delivered" });

    const [chaseRow] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.providerMessageId, "res-chase-1"));
    expect(chaseRow.status).toBe("delivered");
    expect(chaseRow.deliveredAt).not.toBeNull();

    // And the invoice delivery row was not touched by the chase event.
    const [invoiceRow] = await db
      .select()
      .from(schema.invoiceDeliveries)
      .where(eq(schema.invoiceDeliveries.providerMessageId, "res-invoice-1"));
    expect(invoiceRow.status).toBe("sent");
    expect(invoiceRow.deliveredAt).toBeNull();
  });

  it("returns matched:false when the message ID matches neither a chase nor a delivery", async () => {
    const result = await handleEmailWebhook(
      mockContext({ type: "email.delivered", data: { email_id: "unknown-id", to: ["x@example.com"] } })
    );
    expect(result.data).toMatchObject({ ok: true, matched: false });
  });
});
