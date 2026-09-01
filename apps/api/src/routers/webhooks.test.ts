import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleEmailWebhook } from "./webhooks.js";
import { createEmailProvider } from "../email/index.js";

const mocks = vi.hoisted(() => ({
  // Every column set passed to db.update(...).set(...), so tests can assert on
  // the write itself rather than trusting the handler's response body.
  setCalls: [] as Record<string, unknown>[],
  update: vi.fn(() => ({
    set: vi.fn((values: Record<string, unknown>) => {
      mocks.setCalls.push(values);
      return { where: vi.fn(() => Promise.resolve()) };
    }),
  })),
  select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve([])) })) })) })),
  insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })),
  query: {
    invoices: {
      findFirst: vi.fn(() => Promise.resolve(null)),
    },
  },
}));

vi.mock("@sponsee/db", () => ({
  db: {
    update: mocks.update,
    select: mocks.select,
    insert: mocks.insert,
    query: mocks.query,
  },
}));

function makeDefaultProvider() {
  return {
    name: "postmark",
    verifyWebhookSignature: vi.fn(() => true),
    ingestWebhook: vi.fn((p: any) => {
      if (p.Type === "Delivery") {
        return {
          type: "delivered" as const,
          providerMessageId: String(p.MessageID),
          to: p.Recipient,
        };
      }
      if (p.Type === "Bounce") {
        return {
          type: "bounced" as const,
          providerMessageId: String(p.MessageID),
          detail: p.Description,
        };
      }
      if (p.Type === "SoftBounce") {
        return {
          type: "failed" as const,
          providerMessageId: String(p.MessageID),
          detail: p.Description,
        };
      }
      return null;
    }),
  };
}

vi.mock("../email/index.js", () => ({
  createEmailProvider: vi.fn(() => makeDefaultProvider()),
}));

function mockContext(body: unknown, provider = "postmark", headers = new Headers()) {
  return {
    req: {
      param: () => provider,
      text: () => Promise.resolve(JSON.stringify(body)),
      json: () => Promise.resolve(body),
      raw: { headers },
    },
    json: (data: unknown, status = 200) => ({ data, status }),
  } as any;
}

describe("handleEmailWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setCalls.length = 0;
    (createEmailProvider as any).mockReturnValue(makeDefaultProvider());
  });

  it("returns 401 when provider does not support webhook verification", async () => {
    const { createEmailProvider } = await import("../email/index.js");
    vi.mocked(createEmailProvider).mockReturnValue({
      name: "mailpit",
      ingestWebhook: vi.fn(),
      // verifyWebhookSignature is intentionally absent
    } as any);

    const c = mockContext({ Type: "Delivery", MessageID: "msg-1" });
    const result = await handleEmailWebhook(c);
    expect(result.status).toBe(401);
    expect(result.data).toMatchObject({ error: "Provider does not support webhook verification" });
  });

  it("returns 401 for invalid webhook signature", async () => {
    const { createEmailProvider } = await import("../email/index.js");
    vi.mocked(createEmailProvider).mockReturnValue({
      name: "postmark",
      verifyWebhookSignature: vi.fn(() => false),
      ingestWebhook: vi.fn(),
    } as any);

    const c = mockContext({ Type: "Delivery", MessageID: "msg-1" });
    const result = await handleEmailWebhook(c);
    expect(result.status).toBe(401);
  });

  it("returns 400 for empty payload", async () => {
    const c = mockContext("");
    const result = await handleEmailWebhook(c);
    expect(result.status).toBe(400);
  });

  it("handles unhandled event type gracefully", async () => {
    const c = mockContext({ Type: "Click", MessageID: "msg-1" });
    const result = await handleEmailWebhook(c);
    expect(result.data).toMatchObject({ ok: true, handled: false });
  });

  it("matches chase event by provider message ID and updates status", async () => {
    const chaseEvent = { id: "ce-1", invoiceId: "inv-1", step: 1 };
    mocks.select.mockImplementation(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([chaseEvent])),
        })),
      })),
    }));

    const c = mockContext({ Type: "Delivery", MessageID: "msg-1", Recipient: "brand@example.com" });
    const result = await handleEmailWebhook(c);
    expect(result.data).toMatchObject({ ok: true, handled: true, type: "delivered" });
  });

  it("pauses chase state on hard bounce", async () => {
    const chaseEvent = { id: "ce-1", invoiceId: "inv-1", step: 1 };
    const invoice = { id: "inv-1", creatorId: "cr-1" };

    mocks.select.mockImplementation(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([chaseEvent])),
        })),
      })),
    }));
    mocks.query.invoices.findFirst.mockResolvedValue(invoice);

    const c = mockContext({
      Type: "Bounce",
      MessageID: "msg-1",
      BounceType: "HardBounce",
      Description: "Mailbox does not exist",
    });

    const result = await handleEmailWebhook(c);
    expect(result.data).toMatchObject({ ok: true, handled: true, type: "bounced" });

    // The response body alone does not prove the interlock fired — assert the
    // chase state was actually paused.
    const pausedWrite = mocks.setCalls.find((c) => c.mode === "paused");
    expect(pausedWrite).toBeDefined();
    expect(pausedWrite!.pausedReason).toBe("hard_bounce");
  });

  it("does not pause chase state on a soft bounce", async () => {
    const chaseEvent = { id: "ce-1", invoiceId: "inv-1", step: 1 };
    mocks.select.mockImplementation(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([chaseEvent])),
        })),
      })),
    }));
    mocks.query.invoices.findFirst.mockResolvedValue({ id: "inv-1", creatorId: "cr-1" });

    const c = mockContext({ Type: "SoftBounce", MessageID: "msg-1" });
    const result = await handleEmailWebhook(c);

    expect(result.data).toMatchObject({ ok: true, handled: true, type: "failed" });
    expect(mocks.setCalls.find((c) => c.mode === "paused")).toBeUndefined();
  });

  // SPO-229 — the provider timestamp is the semantic event time; `updatedAt`
  // must be wall clock (when we processed the webhook), never the provider's
  // stale event time. A delayed webhook makes the two drift arbitrarily.
  it.each([
    ["delivered", "deliveredAt"],
    ["opened", "openedAt"],
    ["bounced", "bouncedAt"],
    ["failed", null],
  ] as const)("stamps updatedAt with wall clock, not the provider event time (%s)", async (type, semanticColumn) => {
    const chaseEvent = { id: "ce-1", invoiceId: "inv-1", step: 1 };
    mocks.select.mockImplementation(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([chaseEvent])),
        })),
      })),
    }));
    mocks.query.invoices.findFirst.mockResolvedValue({ id: "inv-1", creatorId: "cr-1" });

    const stale = new Date(Date.now() - 60 * 60 * 1000); // one hour ago
    (createEmailProvider as any).mockReturnValue({
      name: "resend",
      verifyWebhookSignature: vi.fn(() => true),
      ingestWebhook: vi.fn(() => ({
        type,
        providerMessageId: "msg-1",
        detail: "detail",
        timestamp: stale,
      })),
    });

    const before = Date.now();
    const c = mockContext({ type: "email.bounced", data: { email_id: "msg-1" } }, "resend");
    const result = await handleEmailWebhook(c);
    const after = Date.now();
    expect(result.data).toMatchObject({ ok: true, handled: true, type });

    const write = mocks.setCalls.find((s) => s.status === type);
    expect(write).toBeDefined();

    // Bookkeeping time is wall clock (within the call window), never the
    // hour-old provider timestamp.
    const updatedAt = write!.updatedAt as Date;
    expect(updatedAt).toBeInstanceOf(Date);
    expect(updatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(updatedAt.getTime()).toBeLessThanOrEqual(after);

    // The semantic column still carries the provider's event time.
    if (semanticColumn) {
      expect(write![semanticColumn]).toEqual(stale);
    }
  });
});
