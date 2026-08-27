import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MailpitProvider } from "./mailpit.js";
import { PostmarkProvider } from "./postmark.js";
import { ResendProvider } from "./resend.js";
import type { SendEmailPayload } from "./types.js";

const samplePayload: SendEmailPayload = {
  to: "brand@example.com",
  from: "chase@sponsee.app",
  replyTo: "creator@example.com",
  subject: "Reminder: invoice due",
  text: "Hi there, your invoice is due.",
  html: "<p>Hi there, your invoice is due.</p>",
  metadata: {
    idempotencyKey: "test-key-123",
    tags: ["chase"],
  },
};

describe("MailpitProvider", () => {
  const provider = new MailpitProvider("http://localhost:8025");

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a synthetic id on API failure (fallback)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, text: () => Promise.resolve("bad") })));
    const result = await provider.send(samplePayload);
    expect(result.providerMessageId).toMatch(/^mailpit-fallback-/);
  });

  it("returns Mailpit message ID on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ID: "abc123" }),
        })
      )
    );
    const result = await provider.send(samplePayload);
    expect(result.providerMessageId).toBe("abc123");
  });

  it("ingestWebhook returns null", () => {
    expect(provider.ingestWebhook({})).toBeNull();
  });
});

describe("PostmarkProvider", () => {
  const provider = new PostmarkProvider("test-token");

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws when constructed without token", () => {
    expect(() => new PostmarkProvider("")).toThrow("POSTMARK_SERVER_TOKEN");
  });

  it("sends email via Postmark API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ MessageID: "msg-123" }),
        })
      )
    );

    const result = await provider.send(samplePayload);
    expect(result.providerMessageId).toBe("msg-123");

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    expect(fetchCall[0]).toBe("https://api.postmarkapp.com/email");
    const body = JSON.parse(fetchCall[1]!.body as string);
    expect(body.From).toBe(samplePayload.from);
    expect(body.Tag).toBe("chase");
  });

  it("throws on send failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 422, text: () => Promise.resolve("bad request") }))
    );

    await expect(provider.send(samplePayload)).rejects.toThrow("Postmark send failed");
  });

  it("ingests Delivery webhook", () => {
    const event = provider.ingestWebhook({
      Type: "Delivery",
      MessageID: "msg-123",
      Recipient: "brand@example.com",
    });
    expect(event).not.toBeNull();
    expect(event!.type).toBe("delivered");
    expect(event!.providerMessageId).toBe("msg-123");
  });

  it("ingests Bounce webhook", () => {
    const event = provider.ingestWebhook({
      Type: "Bounce",
      MessageID: "msg-123",
      BounceType: "HardBounce",
      Description: "Mailbox full",
    });
    expect(event).not.toBeNull();
    expect(event!.type).toBe("bounced");
    expect(event!.detail).toBe("Mailbox full");
  });

  it("returns null for unsupported webhook type", () => {
    expect(provider.ingestWebhook({ Type: "Click", MessageID: "msg-123" })).toBeNull();
  });

  it("returns null for non-object payload", () => {
    expect(provider.ingestWebhook("string")).toBeNull();
  });
});

describe("ResendProvider", () => {
  const provider = new ResendProvider("test-key");

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws when constructed without api key", () => {
    expect(() => new ResendProvider("")).toThrow("RESEND_API_KEY");
  });

  it("sends email via Resend API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: "res-123" }),
        })
      )
    );

    const result = await provider.send(samplePayload);
    expect(result.providerMessageId).toBe("res-123");

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    expect(fetchCall[0]).toBe("https://api.resend.com/emails");
    const body = JSON.parse(fetchCall[1]!.body as string);
    expect(body.from).toBe(samplePayload.from);
  });

  it("throws on send failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 400, text: () => Promise.resolve("invalid") }))
    );

    await expect(provider.send(samplePayload)).rejects.toThrow("Resend send failed");
  });

  it("ingests email.delivered webhook", () => {
    const event = provider.ingestWebhook({
      type: "email.delivered",
      email_id: "res-123",
      to: "brand@example.com",
    });
    expect(event).not.toBeNull();
    expect(event!.type).toBe("delivered");
  });

  it("ingests email.bounced webhook (hard)", () => {
    const event = provider.ingestWebhook({
      type: "email.bounced",
      email_id: "res-123",
      data: { type: "hard" },
    });
    expect(event).not.toBeNull();
    expect(event!.type).toBe("bounced");
  });

  it("ingests email.bounced webhook (soft) as failed", () => {
    const event = provider.ingestWebhook({
      type: "email.bounced",
      email_id: "res-123",
      data: { type: "soft" },
    });
    expect(event).not.toBeNull();
    expect(event!.type).toBe("failed");
  });

  it("returns null for unsupported webhook type", () => {
    expect(provider.ingestWebhook({ type: "email.sent", email_id: "res-123" })).toBeNull();
  });
});
