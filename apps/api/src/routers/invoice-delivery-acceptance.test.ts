import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { sql, eq } from "drizzle-orm";
import { invoiceRouter, invoiceViewLimiter } from "./invoice.js";
import { chaseRouter } from "./chase.js";
import { handleEmailWebhook } from "./webhooks.js";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "../test-utils/schema-sql.js";
import {
  getFreePort,
  waitForMailpit,
  waitForMailpitMatches,
  getMailpitMessage,
  startMailpit,
  stopMailpit,
  type MailpitSummary,
} from "../test-utils/mailpit.js";

// ─────────────────────────────────────────────────────────────────────────────
// SPO-367 gate — the missing unified Invoice Delivery acceptance proof.
//
// This is the ONE test the gate asked for: it runs the creator's actual chain
// in a single pass, with nothing stubbed between `invoice.send` and the
// captured message. `invoice.send` goes through the REAL MailpitProvider (real
// nodemailer -> a real Mailpit SMTP capture instance), not a mocked provider,
// and the webhook replay correlates against the delivery row that send created
// — never a direct-inserted row. The only stub is the Resend webhook
// *signature* verification (a separately unit-tested concern), so the stored
// Resend payloads reach the real correlation + bounce-pause logic in
// webhooks.ts.
//
// Two earlier "half-proofs" (mocked enqueue in invoice-send.test.ts, and
// direct-insert delivery in webhooks.invoice-delivery.test.ts) were each called
// end-to-end and weren't. This file is the one-pass proof.

const OWNER_EMAIL = "owner@example.com";
const CONTACT_EMAIL = "brand-contact@example.com";

// `createEmailProvider()` (no arg) must stay REAL (Mailpit) for the send path.
// Only the "resend" branch — reached by the webhook handler — is stubbed with a
// real ResendProvider ingest and a pass-through signature check.
vi.mock("../email/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../email/index.js")>();
  const resendIngest = new actual.ResendProvider("test-resend-key");
  return {
    ...actual,
    createEmailProvider: (name?: string) => {
      if (name === "resend") {
        return {
          name: "resend",
          verifyWebhookSignature: () => true,
          ingestWebhook: (payload: unknown) => resendIngest.ingestWebhook(payload),
        };
      }
      return actual.createEmailProvider(name);
    },
  };
});

function mockCtx(creatorId: string) {
  return {
    session: { user: { id: `user-${creatorId}`, email: OWNER_EMAIL, name: "Test Owner" } },
    creatorId,
    db,
  };
}

function publicCtx(ip = "203.0.113.50") {
  return {
    session: null,
    creatorId: null,
    db,
    headers: new Headers({ "x-forwarded-for": ip }),
  };
}

function webhookCtx(body: unknown) {
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

async function seedTenant(opts: { withOwnerEmail?: boolean } = {}) {
  const withOwnerEmail = opts.withOwnerEmail ?? true;

  const [creator] = await db
    .insert(schema.creators)
    .values({
      displayName: "Creator A",
      paypalLink: "paypal.me/creatora",
      wiseText: "Wise: creator@wise.example",
    })
    .returning();
  creatorId = creator.id;

  if (withOwnerEmail) {
    await db.insert(schema.user).values({
      id: `user-${creatorId}`,
      name: "Owner",
      email: OWNER_EMAIL,
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
    .values({ brandId, name: "Brand Contact", email: CONTACT_EMAIL })
    .returning();
  contactId = contact.id;

  const [deal] = await db
    .insert(schema.deals)
    .values({
      creatorId,
      brandId,
      primaryContactId: contact.id,
      title: "Flat deal",
      type: "flat",
      stage: "inbound",
      valueCents: 1000,
    })
    .returning();
  dealId = deal.id;

  // An enabled step 1 so invoice.send genuinely arms the chase (SPO-477: with
  // no schedulable template, send writes `completed`, not `armed`).
  await db.insert(schema.chaseTemplates).values({
    creatorId,
    step: 1,
    name: "Friendly reminder",
    offsetDays: 1,
    subject: "Payment reminder for {invoice_id}",
    body: "Hi {brand_contact}, please pay {amount}.",
    enabled: true,
  });

  return { creator, contact, deal };
}

/** Start a real Mailpit and set the env so the real MailpitProvider targets it. */
async function withMailpit<T>(fn: (apiUrl: string) => Promise<T>): Promise<T> {
  const smtpPort = await getFreePort();
  const httpPort = await getFreePort();
  const apiUrl = `http://127.0.0.1:${httpPort}`;

  const prevHost = process.env.MAILPIT_SMTP_HOST;
  const prevPort = process.env.MAILPIT_SMTP_PORT;
  const prevProvider = process.env.EMAIL_PROVIDER;
  process.env.MAILPIT_SMTP_HOST = "127.0.0.1";
  process.env.MAILPIT_SMTP_PORT = String(smtpPort);
  delete process.env.EMAIL_PROVIDER;

  const mailpit = startMailpit(smtpPort, httpPort);
  try {
    await waitForMailpit(apiUrl, 5000);
    return await fn(apiUrl);
  } finally {
    await stopMailpit(mailpit);
    if (prevHost === undefined) delete process.env.MAILPIT_SMTP_HOST;
    else process.env.MAILPIT_SMTP_HOST = prevHost;
    if (prevPort === undefined) delete process.env.MAILPIT_SMTP_PORT;
    else process.env.MAILPIT_SMTP_PORT = prevPort;
    if (prevProvider === undefined) delete process.env.EMAIL_PROVIDER;
    else process.env.EMAIL_PROVIDER = prevProvider;
  }
}

beforeAll(async () => {
  await initPgliteSchema(SCHEMA_SQL);
});

beforeEach(async () => {
  invoiceViewLimiter.reset();
  await cleanTables();
});

describe("invoice delivery acceptance — one-pass creator chain (SPO-367 gate)", () => {
  it(
    "create → send (real Mailpit) → hosted view → armed → webhook delivered/bounced → Payments surface",
    async () => {
      const { creator } = await seedTenant();
      const caller = invoiceRouter.createCaller(mockCtx(creator.id));

      // Step 1 — create, and no chase is armed.
      const invoice = await caller.create({
        dealId,
        contactId,
        title: "Sponsorship invoice",
        amountCents: 500000,
        dueAt: new Date("2026-03-01T00:00:00Z"),
      });
      const [stateAfterCreate] = await db
        .select()
        .from(schema.invoiceChaseState)
        .where(eq(schema.invoiceChaseState.invoiceId, invoice.id));
      expect(stateAfterCreate).toBeUndefined();

      await withMailpit(async (apiUrl) => {
        // Steps 2 & 3 — send through the real Mailpit capture path.
        const sendResult = await caller.send({ id: invoice.id });
        expect(sendResult.success).toBe(true);

        const matches = await waitForMailpitMatches<MailpitSummary>(
          apiUrl,
          (m) => m.To?.some((t) => t.Address === CONTACT_EMAIL) ?? false
        );
        const summary = matches[0];

        // From == platform address; Reply-To == the creator owner (never the
        // platform address).
        expect(summary.From?.Address).toBe("invoices@sponsee.app");
        expect(summary.ReplyTo?.[0]?.Address).toBe(OWNER_EMAIL);

        // The plain-text part alone carries the invoice. Read Text literally;
        // do not fall back to the HTML part.
        const full = await getMailpitMessage(apiUrl, summary.ID);
        const text = full.Text ?? "";
        expect(text).toContain("Amount due: $5,000");
        expect(text).toContain("Due date: Mar 1, 2026");
        expect(text).toContain("PayPal: paypal.me/creatora");
        expect(text).toContain("Wise: Wise: creator@wise.example");
        expect(text).toContain(`/i/${sendResult.publicToken}`);

        // Step 4 — fetch the hosted route unauthenticated; allowlisted JSON,
        // no creator email or tenant data.
        const publicCaller = invoiceRouter.createCaller(publicCtx());
        const view = await publicCaller.publicView({ token: sendResult.publicToken });
        expect(Object.keys(view).sort()).toEqual(
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
            "paid",
          ].sort()
        );
        const serialized = JSON.stringify(view);
        expect(serialized).not.toContain(OWNER_EMAIL);
        expect(serialized).not.toContain(CONTACT_EMAIL);
        expect(serialized).not.toContain("creatorId");
        expect(serialized).not.toContain("dealId");
        expect(serialized).not.toContain("contactId");
        expect(serialized).not.toContain("Brand A");

        // Step 5 — same invoice is now armed and rails_snapshot frozen.
        const [chaseState] = await db
          .select()
          .from(schema.invoiceChaseState)
          .where(eq(schema.invoiceChaseState.invoiceId, invoice.id));
        expect(chaseState.mode).toBe("armed");
        expect(chaseState.nextStep).toBe(1);

        const [afterSend] = await db
          .select()
          .from(schema.invoices)
          .where(eq(schema.invoices.id, invoice.id));
        expect(afterSend.railsSnapshot).toMatchObject({
          displayName: "Creator A",
          paypalLink: "paypal.me/creatora",
          wiseText: "Wise: creator@wise.example",
        });

        // Step 6 — replay stored Resend payloads against the delivery row this
        // same send created (never a direct-inserted one), and prove timestamps.
        const [delivery] = await db
          .select()
          .from(schema.invoiceDeliveries)
          .where(eq(schema.invoiceDeliveries.invoiceId, invoice.id));
        expect(delivery.providerMessageId).toBeTruthy();
        const providerMessageId = delivery.providerMessageId!;

        const deliveredPayload = {
          type: "email.delivered",
          data: {
            email_id: providerMessageId,
            to: [CONTACT_EMAIL],
            created_at: "2026-09-02T10:00:00Z",
          },
        };
        const deliveredResult = await handleEmailWebhook(webhookCtx(deliveredPayload));
        expect(deliveredResult.data).toMatchObject({ ok: true, handled: true, type: "delivered" });

        const [afterDelivered] = await db
          .select()
          .from(schema.invoiceDeliveries)
          .where(eq(schema.invoiceDeliveries.id, delivery.id));
        expect(afterDelivered.status).toBe("delivered");
        expect(afterDelivered.deliveredAt).not.toBeNull();
        expect(afterDelivered.deliveredAt!.toISOString()).toBe("2026-09-02T10:00:00.000Z");
        expect(afterDelivered.bouncedAt).toBeNull();

        const bouncedPayload = {
          type: "email.bounced",
          data: {
            email_id: providerMessageId,
            to: [CONTACT_EMAIL],
            created_at: "2026-09-02T11:00:00Z",
            bounce: {
              message: "The recipient's email address is on the suppression list.",
              subType: "Suppressed",
              type: "Permanent",
            },
          },
        };
        const bouncedResult = await handleEmailWebhook(webhookCtx(bouncedPayload));
        expect(bouncedResult.data).toMatchObject({ ok: true, handled: true, type: "bounced" });

        const [afterBounced] = await db
          .select()
          .from(schema.invoiceDeliveries)
          .where(eq(schema.invoiceDeliveries.id, delivery.id));
        expect(afterBounced.status).toBe("bounced");
        expect(afterBounced.bouncedAt!.toISOString()).toBe("2026-09-02T11:00:00.000Z");

        // The bounce stops the chase (SPO-365): armed -> paused with the loud
        // invoice-hard-bounce reason.
        const [pausedState] = await db
          .select()
          .from(schema.invoiceChaseState)
          .where(eq(schema.invoiceChaseState.invoiceId, invoice.id));
        expect(pausedState.mode).toBe("paused");
        expect(pausedState.pausedReason).toBe("invoice_hard_bounce");

        // Step 6 (UI surface) — the exact data Payments reads now shows the
        // bounce: latestDeliveries returns a "bounced" row with a timestamp and
        // the recipient, and chase.state returns the paused lock. The web suite
        // pins the rendering of both (Payments.test.tsx).
        const deliveries = await caller.latestDeliveries();
        const forInvoice = deliveries.find((r) => r.invoiceId === invoice.id);
        expect(forInvoice).toBeDefined();
        expect(forInvoice!.status).toBe("bounced");
        expect(forInvoice!.bouncedAt).not.toBeNull();
        expect(forInvoice!.toEmail).toBe(CONTACT_EMAIL);

        const chaseCaller = chaseRouter.createCaller(mockCtx(creator.id));
        const surfacedState = await chaseCaller.state({ invoiceId: invoice.id });
        expect(surfacedState.mode).toBe("paused");
        expect(surfacedState.pausedReason).toBe("invoice_hard_bounce");
      });
    },
    30_000
  );

  it("refuses a send with no owner email, with zero provider calls (negative)", async () => {
    await seedTenant({ withOwnerEmail: false });
    const caller = invoiceRouter.createCaller(mockCtx(creatorId));
    const invoice = await caller.create({
      dealId,
      contactId,
      title: "Sponsorship invoice",
      amountCents: 500000,
      dueAt: new Date("2026-03-01T00:00:00Z"),
    });

    await withMailpit(async (apiUrl) => {
      await expect(caller.send({ id: invoice.id })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });

      // Zero provider calls means zero captured messages — the refusal happens
      // before createEmailProvider().send() is ever reached, so nothing may
      // land in the real inbox.
      const res = await fetch(`${apiUrl}/api/v1/messages?limit=100`);
      const data = (await res.json()) as { messages?: unknown[] };
      expect(data.messages ?? []).toHaveLength(0);

      // And no delivery row was claimed (the refusal precedes the claim).
      const rows = await db
        .select()
        .from(schema.invoiceDeliveries)
        .where(eq(schema.invoiceDeliveries.invoiceId, invoice.id));
      expect(rows).toHaveLength(0);
    });
  });

  it("returns 404 for a tampered token (negative)", async () => {
    await seedTenant();
    const caller = invoiceRouter.createCaller(mockCtx(creatorId));

    let realToken = "";
    await withMailpit(async () => {
      const invoice = await caller.create({
        dealId,
        contactId,
        title: "Sponsorship invoice",
        amountCents: 500000,
        dueAt: new Date("2026-03-01T00:00:00Z"),
      });
      const sendResult = await caller.send({ id: invoice.id });
      expect(sendResult.success).toBe(true);
      realToken = sendResult.publicToken;
    });

    // Flip a single hex character of the real token: it must miss the lookup
    // and 404 identically to a never-issued token (the single-resolve path in
    // invoice.ts leaks nothing about which tokens once existed).
    const flip = (c: string) => (c === "0" ? "1" : "0");
    const tampered = flip(realToken[0]) + realToken.slice(1);
    expect(tampered).not.toBe(realToken);

    const publicCaller = invoiceRouter.createCaller(publicCtx("203.0.113.51"));
    await expect(publicCaller.publicView({ token: tampered })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
