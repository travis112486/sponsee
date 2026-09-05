import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { sql, eq } from "drizzle-orm";
import { handleEmailWebhook } from "./webhooks.js";
import { runChaseTick } from "../jobs/chase-tick.js";
import { ResendProvider } from "../email/resend.js";
import { PostmarkProvider } from "../email/postmark.js";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "../test-utils/schema-sql.js";

// chase-tick's rescue pass reaches for pg-boss; there is no DATABASE_URL here.
vi.mock("../jobs/boss.js", () => ({
  getBoss: vi.fn(() => Promise.resolve({ send: vi.fn(() => Promise.resolve()) })),
  stopBoss: vi.fn(() => Promise.resolve()),
}));

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
  // Dispatch by payload shape so a suite can replay a real Postmark body too:
  // Postmark keys its envelope on `Type`/`MessageID`, Resend on `type`/`data`.
  // Only the mapping differs — the handler under test is the same either way.
  h.ingest = (payload) =>
    payload && typeof payload === "object" && "Type" in (payload as Record<string, unknown>)
      ? new PostmarkProvider("dummy-token").ingestWebhook(payload)
      : new ResendProvider("dummy-key").ingestWebhook(payload);
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

  // SPO-433 — the provider tells us *why* the send bounced, and the answer
  // changes what the creator should do next ("mailbox full" → resend later to
  // the same address; "no such user" → the contact is wrong and resending is a
  // trap). Before this it only reached activity_events.payload.detail, which
  // nothing reads, so the Payments row rendered all bounces identically.
  describe("bounce_detail (SPO-433)", () => {
    it("persists the provider's bounce reason on the delivery row", async () => {
      await seedInvoiceDelivery("res-123");

      await handleEmailWebhook(mockContext(bouncedPayload));

      const [row] = await db
        .select()
        .from(schema.invoiceDeliveries)
        .where(eq(schema.invoiceDeliveries.providerMessageId, "res-123"));
      // Read back off the row, not off the update call — the point of the
      // ticket is that the column exists and the write lands in it.
      expect(row.bounceDetail).toBe("The recipient's email address is on the suppression list.");
      expect(row.status).toBe("bounced");
      expect(row.bouncedAt).not.toBeNull();
    });

    it("falls back to Resend's bounce classification when there is no message", async () => {
      await seedInvoiceDelivery("res-123");

      await handleEmailWebhook(
        mockContext({
          type: "email.bounced",
          data: {
            email_id: "res-123",
            to: ["ap@acme.example"],
            bounce: { subType: "General", type: "Permanent" },
          },
        })
      );

      const [row] = await db
        .select()
        .from(schema.invoiceDeliveries)
        .where(eq(schema.invoiceDeliveries.providerMessageId, "res-123"));
      expect(row.bounceDetail).toBe("Permanent/General");
      expect(row.status).toBe("bounced");
    });

    // A real provider body that carries no reason at all. Postmark's Bounce
    // with no Description maps to detail "" (postmark.ts:124 stringifies
    // `Description || BounceType`), which must land as NULL — not "" — so the
    // Payments line falls back to the address-only copy instead of rendering
    // an empty reason.
    it("leaves bounce_detail null when the provider sends no reason, without crashing", async () => {
      await seedInvoiceDelivery("pm-1");

      const result = await handleEmailWebhook(
        mockContext({ Type: "Bounce", MessageID: "pm-1", Recipient: "ap@acme.example" })
      );
      expect(result.data).toMatchObject({ ok: true, handled: true, type: "bounced" });

      const [row] = await db
        .select()
        .from(schema.invoiceDeliveries)
        .where(eq(schema.invoiceDeliveries.providerMessageId, "pm-1"));
      expect(row.bounceDetail).toBeNull();
      expect(row.status).toBe("bounced");
      expect(row.bouncedAt).not.toBeNull();
    });

    // Guards the `?? null` in webhooks.ts: Drizzle drops undefined keys from
    // the UPDATE, so a detail-less bounce arriving after a detailed one would
    // otherwise leave the earlier, now-wrong reason on the row.
    it("clears a stale reason when a later bounce carries none", async () => {
      await seedInvoiceDelivery("pm-1");

      await handleEmailWebhook(
        mockContext({
          Type: "Bounce",
          MessageID: "pm-1",
          Recipient: "ap@acme.example",
          Description: "The server was unable to deliver your message (ex: mailbox full).",
        })
      );

      const [first] = await db
        .select()
        .from(schema.invoiceDeliveries)
        .where(eq(schema.invoiceDeliveries.providerMessageId, "pm-1"));
      expect(first.bounceDetail).toBe(
        "The server was unable to deliver your message (ex: mailbox full)."
      );

      await handleEmailWebhook(
        mockContext({ Type: "Bounce", MessageID: "pm-1", Recipient: "ap@acme.example" })
      );

      const [second] = await db
        .select()
        .from(schema.invoiceDeliveries)
        .where(eq(schema.invoiceDeliveries.providerMessageId, "pm-1"));
      expect(second.bounceDetail).toBeNull();
    });
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

// SPO-365 — the Payments panel tells a creator "chase is locked" once an
// invoice email bounces. That sentence was false: the invoice-delivery bounce
// branch wrote the delivery row and an activity event but left
// invoice_chase_state.mode = "armed", and chase-tick selects on exactly that
// with no delivery gate. So a reminder for an undelivered invoice landed in
// Awaiting review on the same page that claimed reminders had stopped.
//
// These run the real tick against the real (PGlite) db rather than asserting
// the write in isolation: the claim under test is about what the chase job
// does, so only the job can falsify it.
describe("an invoice-delivery bounce stops the chase (SPO-365)", () => {
  /** Arms a chase whose step 1 is already due, so a tick must act on it. */
  async function armDueChase(creatorId: string, invoiceId: string) {
    await db.insert(schema.chaseTemplates).values({
      creatorId,
      step: 1,
      name: "Friendly reminder",
      offsetDays: 1,
      subject: "Payment reminder for {invoice_id}",
      body: "Hi {brand_contact}, please pay {amount}.",
      enabled: true,
    });

    await db.insert(schema.invoiceChaseState).values({
      invoiceId,
      mode: "armed",
      nextStep: 1,
      nextActionAt: new Date(Date.now() - 60 * 60 * 1000), // due an hour ago
    });
  }

  async function chaseEventCount(id: string) {
    const rows = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, id));
    return rows.length;
  }

  it("CONTROL: without a bounce, the same armed state does queue a reminder", async () => {
    const { creator, invoice } = await seedInvoiceDelivery("res-123");
    await armDueChase(creator.id, invoice.id);

    // No webhook replayed. If this were 0, the assertion below would pass for
    // the wrong reason — a tick that never fires proves nothing about gating.
    expect(await runChaseTick()).toBe(1);
    expect(await chaseEventCount(invoice.id)).toBe(1);

    const [state] = await db
      .select()
      .from(schema.invoiceChaseState)
      .where(eq(schema.invoiceChaseState.invoiceId, invoice.id));
    expect(state.mode).toBe("armed");
  });

  it("pauses the chase and queues nothing after the invoice email bounces", async () => {
    const { creator, invoice } = await seedInvoiceDelivery("res-123");
    await armDueChase(creator.id, invoice.id);

    const result = await handleEmailWebhook(mockContext(bouncedPayload));
    expect(result.data).toMatchObject({ ok: true, handled: true, type: "bounced" });

    const [state] = await db
      .select()
      .from(schema.invoiceChaseState)
      .where(eq(schema.invoiceChaseState.invoiceId, invoice.id));
    expect(state.mode).toBe("paused");
    expect(state.pausedReason).toBe("invoice_hard_bounce");

    // Same due state, same tick as the control — now it must produce nothing.
    expect(await runChaseTick()).toBe(0);
    expect(await chaseEventCount(invoice.id)).toBe(0);
  });

  it("leaves a manual pause reason and a completed sequence alone", async () => {
    const { creator, invoice } = await seedInvoiceDelivery("res-123");
    await armDueChase(creator.id, invoice.id);
    await db
      .update(schema.invoiceChaseState)
      .set({ mode: "paused", pausedReason: "Brand asked us to hold" })
      .where(eq(schema.invoiceChaseState.invoiceId, invoice.id));

    await handleEmailWebhook(mockContext(bouncedPayload));

    // Already stopped, so the bounce has nothing to stop — overwriting the
    // reason would only destroy the creator's own note.
    const [paused] = await db
      .select()
      .from(schema.invoiceChaseState)
      .where(eq(schema.invoiceChaseState.invoiceId, invoice.id));
    expect(paused.mode).toBe("paused");
    expect(paused.pausedReason).toBe("Brand asked us to hold");

    // And a finished sequence is not reopened as paused.
    await db
      .update(schema.invoiceChaseState)
      .set({ mode: "completed", pausedReason: null })
      .where(eq(schema.invoiceChaseState.invoiceId, invoice.id));
    await db
      .update(schema.invoiceDeliveries)
      .set({ status: "sent", bouncedAt: null })
      .where(eq(schema.invoiceDeliveries.providerMessageId, "res-123"));

    await handleEmailWebhook(mockContext(bouncedPayload));

    const [completed] = await db
      .select()
      .from(schema.invoiceChaseState)
      .where(eq(schema.invoiceChaseState.invoiceId, invoice.id));
    expect(completed.mode).toBe("completed");
  });

  it("does not touch a different invoice's armed chase", async () => {
    const { creator, invoice } = await seedInvoiceDelivery("res-123");
    await armDueChase(creator.id, invoice.id);

    const [other] = await db
      .insert(schema.invoices)
      .values({ creatorId: creator.id, number: 2, amountCents: 250000, status: "open" })
      .returning();
    await db.insert(schema.invoiceChaseState).values({
      invoiceId: other.id,
      mode: "armed",
      nextStep: 1,
      nextActionAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    await handleEmailWebhook(mockContext(bouncedPayload));

    const [otherState] = await db
      .select()
      .from(schema.invoiceChaseState)
      .where(eq(schema.invoiceChaseState.invoiceId, other.id));
    expect(otherState.mode).toBe("armed");
  });
});
