import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendChaseEmail } from "./chase-tick.js";

// Capture every `db.update(...).set(payload)` so tests can assert the state
// machine transitions (claim → sending, failure → failed).
const dbState = vi.hoisted(() => ({ updateSetPayloads: [] as Array<Record<string, unknown>> }));

// Mock @sponsee/db
vi.mock("@sponsee/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([{ status: "approved", providerMessageId: null }])),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((payload: Record<string, unknown>) => {
        dbState.updateSetPayloads.push(payload);
        return {
          where: vi.fn(() => ({
            returning: vi.fn(() => Promise.resolve([{ status: "sending" }])),
          })),
        };
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => Promise.resolve()),
    })),
    query: {
      invoices: {
        findFirst: vi.fn(() => Promise.resolve({ id: "inv-1", creatorId: "cr-1" })),
      },
    },
  },
}));

// Mock email provider factory
vi.mock("../email/index.js", () => ({
  createEmailProvider: vi.fn(() => ({
    name: "mailpit",
    send: vi.fn(() => Promise.resolve({ providerMessageId: "msg-abc" })),
  })),
}));

describe("sendChaseEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.updateSetPayloads.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends email via provider and updates chase event to sent", async () => {
    const { createEmailProvider } = await import("../email/index.js");
    const mockSend = vi.fn().mockResolvedValue({ providerMessageId: "msg-123" });
    vi.mocked(createEmailProvider).mockReturnValue({
      name: "mailpit",
      send: mockSend,
      ingestWebhook: vi.fn(),
    } as any);

    const result = await sendChaseEmail({
      chaseEventId: "evt-1",
      invoiceId: "inv-1",
      step: 1,
      toEmail: "brand@example.com",
      fromEmail: "chase@sponsee.app",
      replyToEmail: "creator@example.com",
      subject: "Reminder",
      body: "Please pay",
      idempotencyKey: "key-1",
    });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "brand@example.com",
        from: "chase@sponsee.app",
        replyTo: "creator@example.com",
        subject: "Reminder",
        text: "Please pay",
        metadata: { idempotencyKey: "key-1", tags: ["chase", "step-1"] },
      })
    );
    expect(result.providerMessageId).toBe("msg-123");
  });

  it("marks the event failed (not stranded in sending) when the provider factory throws", async () => {
    const { createEmailProvider } = await import("../email/index.js");
    vi.mocked(createEmailProvider).mockImplementation(() => {
      throw new Error("Missing POSTMARK_SERVER_TOKEN environment variable");
    });

    await expect(
      sendChaseEmail({
        chaseEventId: "evt-1",
        invoiceId: "inv-1",
        step: 1,
        toEmail: "brand@example.com",
        fromEmail: "chase@sponsee.app",
        replyToEmail: "creator@example.com",
        subject: "Reminder",
        body: "Please pay",
        idempotencyKey: "key-1",
      })
    ).rejects.toThrow("Missing POSTMARK_SERVER_TOKEN");

    // Claim wrote `sending`, then the catch must write `failed`.
    expect(dbState.updateSetPayloads).toContainEqual(expect.objectContaining({ status: "sending" }));
    expect(dbState.updateSetPayloads).toContainEqual(expect.objectContaining({ status: "failed" }));
  });
});
