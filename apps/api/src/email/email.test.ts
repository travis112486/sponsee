import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";
import { MailpitProvider } from "./mailpit.js";
import { PostmarkProvider } from "./postmark.js";
import { ResendProvider } from "./resend.js";
import { createEmailProvider } from "./index.js";
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

// Mock nodemailer for MailpitProvider tests
const mockSendMail = vi.fn();
vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: mockSendMail,
    })),
  },
}));

describe("MailpitProvider", () => {
  const provider = new MailpitProvider("localhost", 1025);

  beforeEach(() => {
    vi.restoreAllMocks();
    mockSendMail.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws on SMTP failure", async () => {
    mockSendMail.mockRejectedValue(new Error("Connection refused"));
    await expect(provider.send(samplePayload)).rejects.toThrow("Connection refused");
  });

  it("sends via nodemailer SMTP and returns messageId", async () => {
    mockSendMail.mockResolvedValue({ messageId: "<msg-abc@mailpit>" });
    const result = await provider.send(samplePayload);
    expect(result.providerMessageId).toBe("<msg-abc@mailpit>");

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const call = mockSendMail.mock.calls[0][0];
    expect(call.from).toBe(samplePayload.from);
    expect(call.to).toBe(samplePayload.to);
    expect(call.replyTo).toBe(samplePayload.replyTo);
    expect(call.subject).toBe(samplePayload.subject);
    expect(call.text).toBe(samplePayload.text);
    expect(call.html).toBe(samplePayload.html);
  });

  it("throws on missing messageId", async () => {
    mockSendMail.mockResolvedValue({ messageId: undefined });
    await expect(provider.send(samplePayload)).rejects.toThrow("no messageId returned");
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

  describe("webhook verification", () => {
    const originalSecret = process.env.POSTMARK_WEBHOOK_SECRET;

    afterEach(() => {
      if (originalSecret === undefined) {
        delete process.env.POSTMARK_WEBHOOK_SECRET;
      } else {
        process.env.POSTMARK_WEBHOOK_SECRET = originalSecret;
      }
    });

    it("rejects when no secret is configured", () => {
      delete process.env.POSTMARK_WEBHOOK_SECRET;
      const ok = provider.verifyWebhookSignature!("body", { authorization: "Basic abc" });
      expect(ok).toBe(false);
    });

    it("rejects missing authorization header", () => {
      process.env.POSTMARK_WEBHOOK_SECRET = "user:pass";
      const ok = provider.verifyWebhookSignature!("body", {});
      expect(ok).toBe(false);
    });

    it("accepts valid Basic auth", () => {
      process.env.POSTMARK_WEBHOOK_SECRET = "user:pass";
      const encoded = Buffer.from("user:pass", "utf-8").toString("base64");
      const ok = provider.verifyWebhookSignature!("body", { authorization: `Basic ${encoded}` });
      expect(ok).toBe(true);
    });

    it("rejects invalid Basic auth", () => {
      process.env.POSTMARK_WEBHOOK_SECRET = "user:pass";
      const encoded = Buffer.from("wrong:creds", "utf-8").toString("base64");
      const ok = provider.verifyWebhookSignature!("body", { authorization: `Basic ${encoded}` });
      expect(ok).toBe(false);
    });
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

  it("ingests email.delivered webhook from nested data field", () => {
    const event = provider.ingestWebhook({
      type: "email.delivered",
      data: { email_id: "res-123", to: "brand@example.com", created_at: "2024-01-01T00:00:00Z" },
    });
    expect(event).not.toBeNull();
    expect(event!.type).toBe("delivered");
    expect(event!.providerMessageId).toBe("res-123");
    expect(event!.to).toBe("brand@example.com");
  });

  it("ingests email.bounced webhook (hard) from nested data field", () => {
    const event = provider.ingestWebhook({
      type: "email.bounced",
      data: { email_id: "res-123", type: "hard" },
    });
    expect(event).not.toBeNull();
    expect(event!.type).toBe("bounced");
  });

  it("ingests email.bounced webhook (soft) from nested data field as failed", () => {
    const event = provider.ingestWebhook({
      type: "email.bounced",
      data: { email_id: "res-123", type: "soft" },
    });
    expect(event).not.toBeNull();
    expect(event!.type).toBe("failed");
  });

  it("returns null for unsupported webhook type", () => {
    expect(provider.ingestWebhook({ type: "email.sent", email_id: "res-123" })).toBeNull();
  });

  describe("webhook verification", () => {
    const originalSecret = process.env.RESEND_WEBHOOK_SECRET;

    afterEach(() => {
      if (originalSecret === undefined) {
        delete process.env.RESEND_WEBHOOK_SECRET;
      } else {
        process.env.RESEND_WEBHOOK_SECRET = originalSecret;
      }
    });

    it("rejects when no secret is configured", () => {
      delete process.env.RESEND_WEBHOOK_SECRET;
      const ok = provider.verifyWebhookSignature!("body", { "svix-id": "id", "svix-timestamp": String(Math.floor(Date.now() / 1000)), "svix-signature": "v1,sig" });
      expect(ok).toBe(false);
    });

    it("rejects missing svix headers", () => {
      process.env.RESEND_WEBHOOK_SECRET = "secret";
      const ok = provider.verifyWebhookSignature!("body", {});
      expect(ok).toBe(false);
    });

    it("rejects stale timestamp (>5 min old)", () => {
      process.env.RESEND_WEBHOOK_SECRET = "secret";
      const oldTs = String(Math.floor(Date.now() / 1000) - 400);
      const ok = provider.verifyWebhookSignature!("body", { "svix-id": "id", "svix-timestamp": oldTs, "svix-signature": "v1,sig" });
      expect(ok).toBe(false);
    });

    it("rejects future timestamp (>1 min ahead)", () => {
      process.env.RESEND_WEBHOOK_SECRET = "secret";
      const futureTs = String(Math.floor(Date.now() / 1000) + 400);
      const ok = provider.verifyWebhookSignature!("body", { "svix-id": "id", "svix-timestamp": futureTs, "svix-signature": "v1,sig" });
      expect(ok).toBe(false);
    });

    it("accepts valid svix signature with whsec_ prefix (base64-decoded key)", () => {
      // Svix secrets are "whsec_<base64-encoded-key>"
      const rawKey = "my-svix-signing-key";
      const secret = `whsec_${Buffer.from(rawKey, "utf-8").toString("base64")}`;
      process.env.RESEND_WEBHOOK_SECRET = secret;
      const id = "msg_123";
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = "{}";
      const expected = createHmac("sha256", rawKey).update(`${id}.${timestamp}.${body}`).digest("base64");
      const ok = provider.verifyWebhookSignature!(body, { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${expected}` });
      expect(ok).toBe(true);
    });

    it("accepts valid svix signature without whsec_ prefix", () => {
      const secret = "plain-secret-key";
      process.env.RESEND_WEBHOOK_SECRET = secret;
      const id = "msg_456";
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = "{}";
      const expected = createHmac("sha256", secret).update(`${id}.${timestamp}.${body}`).digest("base64");
      const ok = provider.verifyWebhookSignature!(body, { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${expected}` });
      expect(ok).toBe(true);
    });

    it("rejects invalid svix signature", () => {
      process.env.RESEND_WEBHOOK_SECRET = "secret";
      const timestamp = String(Math.floor(Date.now() / 1000));
      const ok = provider.verifyWebhookSignature!("{}", { "svix-id": "id", "svix-timestamp": timestamp, "svix-signature": "v1,invalidsig" });
      expect(ok).toBe(false);
    });

    it("rejects malformed whsec_ secret (invalid base64)", () => {
      process.env.RESEND_WEBHOOK_SECRET = "whsec_!!!not-valid-base64!!!";
      const timestamp = String(Math.floor(Date.now() / 1000));
      const ok = provider.verifyWebhookSignature!("body", { "svix-id": "id", "svix-timestamp": timestamp, "svix-signature": "v1,sig" });
      expect(ok).toBe(false);
    });
  });
});

describe("createEmailProvider", () => {
  const prodEnv = { NODE_ENV: "production" };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to Mailpit outside production (dev/test unchanged)", () => {
    const provider = createEmailProvider(undefined, {});
    expect(provider.name).toBe("mailpit");
    expect(provider).toBeInstanceOf(MailpitProvider);
  });

  it("throws naming EMAIL_PROVIDER when production and unset", () => {
    expect(() => createEmailProvider(undefined, { ...prodEnv })).toThrow(/EMAIL_PROVIDER/);
  });

  it("throws naming EMAIL_PROVIDER when production and mailpit", () => {
    expect(() => createEmailProvider(undefined, { ...prodEnv, EMAIL_PROVIDER: "mailpit" })).toThrow(/EMAIL_PROVIDER/);
  });

  it("throws naming EMAIL_PROVIDER when production and unknown provider", () => {
    expect(() => createEmailProvider(undefined, { ...prodEnv, EMAIL_PROVIDER: "sendgrid" })).toThrow(/EMAIL_PROVIDER/);
  });

  it("throws naming POSTMARK_SERVER_TOKEN when production postmark without token", () => {
    expect(() => createEmailProvider(undefined, { ...prodEnv, EMAIL_PROVIDER: "postmark" })).toThrow(
      /POSTMARK_SERVER_TOKEN/,
    );
  });

  it("returns a PostmarkProvider when production postmark with token", () => {
    const provider = createEmailProvider(undefined, {
      ...prodEnv,
      EMAIL_PROVIDER: "postmark",
      POSTMARK_SERVER_TOKEN: "tok",
    });
    expect(provider.name).toBe("postmark");
    expect(provider).toBeInstanceOf(PostmarkProvider);
  });

  it("throws naming RESEND_API_KEY when production resend without key", () => {
    expect(() => createEmailProvider(undefined, { ...prodEnv, EMAIL_PROVIDER: "resend" })).toThrow(/RESEND_API_KEY/);
  });

  it("returns a ResendProvider when production resend with key", () => {
    const provider = createEmailProvider(undefined, {
      ...prodEnv,
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "key",
    });
    expect(provider.name).toBe("resend");
    expect(provider).toBeInstanceOf(ResendProvider);
  });

  it("bypasses the production guard for an explicit provider name (webhook path)", () => {
    expect(() => createEmailProvider("mailpit", { ...prodEnv })).not.toThrow();
    expect(createEmailProvider("mailpit", { ...prodEnv }).name).toBe("mailpit");
  });
});
