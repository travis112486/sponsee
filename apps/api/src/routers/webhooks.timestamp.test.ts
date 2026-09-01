import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { eq } from "drizzle-orm";
import { handleEmailWebhook } from "./webhooks.js";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "../test-utils/schema-sql.js";

// SPO-229 — `updated_at` is bookkeeping ("when WE processed the webhook") and
// must never trail `created_at`. The provider timestamp is the semantic event
// time and belongs on deliveredAt/openedAt/bouncedAt only. This suite runs
// against the real PGlite db (not the mock) so `created_at` is genuinely
// populated by the schema default and the assertion is `updated_at >=
// created_at`, not just "bouncedAt matched the payload".

// A bounce that happened long before the row we're ingesting it into existed.
// On the buggy path `updated_at` was stamped with this, landing before
// `created_at`; after the fix `updated_at` is wall clock.
const PAST_EVENT_ISO = "2020-01-01T00:00:00.000Z";

vi.mock("../email/index.js", () => ({
  createEmailProvider: vi.fn(() => ({
    name: "resend",
    verifyWebhookSignature: vi.fn(() => true),
    ingestWebhook: vi.fn(() => ({
      type: "bounced" as const,
      providerMessageId: "msg-past-bounce",
      detail: "Mailbox does not exist",
      timestamp: new Date(PAST_EVENT_ISO),
    })),
  })),
}));

function mockContext(body: unknown, provider = "resend") {
  return {
    req: {
      param: () => provider,
      text: () => Promise.resolve(JSON.stringify(body)),
      json: () => Promise.resolve(body),
      raw: { headers: new Headers() },
    },
    json: (data: unknown, status = 200) => ({ data, status }),
  } as any;
}

async function cleanTables() {
  await db.delete(schema.activityEvents);
  await db.delete(schema.chaseEvents);
  await db.delete(schema.invoiceChaseState);
  await db.delete(schema.invoices);
  await db.delete(schema.creators);
}

beforeAll(async () => {
  await initPgliteSchema(SCHEMA_SQL);
});

beforeEach(async () => {
  await cleanTables();
});

describe("handleEmailWebhook timestamp bookkeeping (SPO-229)", () => {
  it("stamps updated_at with wall clock, not the provider event time, on a late bounce", async () => {
    const [creator] = await db
      .insert(schema.creators)
      .values({ displayName: "Timestamp Streamer" })
      .returning();

    const [invoice] = await db
      .insert(schema.invoices)
      .values({ creatorId: creator.id, number: 1, amountCents: 50000 })
      .returning();

    const [chaseEvent] = await db
      .insert(schema.chaseEvents)
      .values({ invoiceId: invoice.id, step: 1, providerMessageId: "msg-past-bounce" })
      .returning();

    await db
      .insert(schema.invoiceChaseState)
      .values({ invoiceId: invoice.id, mode: "armed" });

    const c = mockContext({
      type: "email.bounced",
      data: { email_id: "msg-past-bounce", created_at: PAST_EVENT_ISO },
    });
    const result = await handleEmailWebhook(c);
    expect(result.data).toMatchObject({ ok: true, handled: true, type: "bounced" });

    // Semantic event time is preserved from the payload.
    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.id, chaseEvent.id));
    expect(event.bouncedAt).toEqual(new Date(PAST_EVENT_ISO));

    // Bookkeeping time is wall clock, so it can never precede the row's
    // creation time — even though the provider timestamp is 6+ years stale.
    expect(event.createdAt).toBeInstanceOf(Date);
    expect(event.updatedAt).toBeInstanceOf(Date);
    expect(event.updatedAt!.getTime()).toBeGreaterThanOrEqual(event.createdAt!.getTime());

    // The paused chase state row obeys the same invariant.
    const [state] = await db
      .select()
      .from(schema.invoiceChaseState)
      .where(eq(schema.invoiceChaseState.invoiceId, invoice.id));
    expect(state.mode).toBe("paused");
    expect(state.pausedReason).toBe("hard_bounce");
    expect(state.updatedAt!.getTime()).toBeGreaterThanOrEqual(state.createdAt!.getTime());
  });
});
