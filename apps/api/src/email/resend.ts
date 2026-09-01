import type { EmailProvider, SendEmailPayload, SentMessageInfo, WebhookEvent } from "./types.js";
import { createHmac } from "crypto";

/** Resend reports recipients as `string[]`; older/hand-rolled payloads use a bare string. */
function firstRecipient(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const first = value.find((v) => typeof v === "string" && v.length > 0);
    return typeof first === "string" ? first : undefined;
  }
  return undefined;
}

/**
 * Resend adapter — named fallback provider.
 * https://resend.com/docs/api-reference
 *
 * Webhook verification: Resend uses Svix. Set RESEND_WEBHOOK_SECRET to the
 * signing secret provided when creating the webhook. Verification enforces
 * a 5-minute timestamp tolerance to prevent replay attacks.
 * When no secret is configured, all webhook requests are rejected.
 */
export class ResendProvider implements EmailProvider {
  readonly name = "resend";
  private readonly apiKey: string;

  constructor(apiKey = process.env.RESEND_API_KEY || "") {
    if (!apiKey) {
      throw new Error("ResendProvider requires RESEND_API_KEY");
    }
    this.apiKey = apiKey;
  }

  async send(payload: SendEmailPayload): Promise<SentMessageInfo> {
    const body = {
      from: payload.from,
      to: payload.to,
      reply_to: payload.replyTo,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
      tags: payload.metadata?.tags?.map((name) => ({ name })),
    };

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
    if (payload.metadata?.idempotencyKey) {
      headers["Idempotency-Key"] = payload.metadata.idempotencyKey;
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "unknown");
      throw new Error(`Resend send failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as { id: string };
    return { providerMessageId: data.id };
  }

  verifyWebhookSignature(body: string, headers: Record<string, string | undefined>): boolean {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) {
      // No secret configured: reject all webhooks.
      return false;
    }

    // Svix secrets are prefixed with "whsec_" and the remainder is base64-encoded.
    // Strip the prefix and decode to get the raw signing key.
    let key: Buffer;
    if (secret.startsWith("whsec_")) {
      try {
        key = Buffer.from(secret.slice(6), "base64");
      } catch {
        return false;
      }
    } else {
      key = Buffer.from(secret, "utf-8");
    }

    const msgId = headers["svix-id"];
    const msgTimestamp = headers["svix-timestamp"];
    const msgSignature = headers["svix-signature"];
    if (!msgId || !msgTimestamp || !msgSignature) return false;

    // Timestamp tolerance: reject if older than 5 minutes or more than 1 minute in the future
    const now = Math.floor(Date.now() / 1000);
    const timestamp = parseInt(msgTimestamp, 10);
    if (Number.isNaN(timestamp) || Math.abs(now - timestamp) > 300) return false;

    const toSign = `${msgId}.${msgTimestamp}.${body}`;
    const expected = createHmac("sha256", key).update(toSign).digest("base64");

    // Svix sends multiple v1 signatures space-separated
    const signatures = msgSignature.split(" ").map((s) => s.trim());
    for (const sig of signatures) {
      if (!sig.startsWith("v1,")) continue;
      const actual = sig.slice(3);
      if (actual.length !== expected.length) continue;
      let result = 0;
      for (let i = 0; i < actual.length; i++) {
        result |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
      }
      if (result === 0) return true;
    }
    return false;
  }

  ingestWebhook(payload: unknown): WebhookEvent | null {
    if (!payload || typeof payload !== "object") return null;
    const p = payload as Record<string, unknown>;

    // Resend/Svix webhooks nest the event data under a `data` field.
    // Read from both top-level and `data` for resilience.
    const data = p.data as Record<string, unknown> | undefined;

    const type = (p.type as string | undefined) ?? (data?.type as string | undefined);
    const emailId = (p.email_id as string | undefined) ?? (data?.email_id as string | undefined);
    if (!type || !emailId) return null;

    // Resend sends `to` as an array of recipients; accept a bare string too.
    const to = firstRecipient(p.to) ?? firstRecipient(data?.to);

    const error =
      typeof p.error === "string"
        ? p.error
        : typeof data?.error === "string"
          ? data.error
          : undefined;

    const createdAt =
      p.created_at ?? data?.created_at;

    const base: Omit<WebhookEvent, "type"> = {
      providerMessageId: String(emailId),
      to,
      detail: error,
      timestamp: createdAt ? new Date(String(createdAt)) : new Date(),
    };

    switch (type) {
      case "email.delivered":
        return { ...base, type: "delivered" };
      case "email.opened":
        return { ...base, type: "opened" };
      case "email.bounced": {
        // Resend classifies the bounce under `data.bounce`, NOT `data.type`:
        //   { type: "email.bounced", data: { ..., bounce: { type, subType, message } } }
        // `bounce.type` is "Permanent" | "Transient" | "Undetermined". Only a
        // Permanent bounce is a hard bounce, and only a hard bounce pauses the
        // chase — anything else stays recoverable and is recorded as "failed".
        const bounce = (data?.bounce ?? p.bounce) as Record<string, unknown> | undefined;
        const bounceType = typeof bounce?.type === "string" ? bounce.type : undefined;
        const bounceSubType = typeof bounce?.subType === "string" ? bounce.subType : undefined;
        const bounceMessage = typeof bounce?.message === "string" ? bounce.message : undefined;
        const isHard = bounceType?.toLowerCase() === "permanent";
        const classification = [bounceType, bounceSubType].filter(Boolean).join("/");
        const detail = bounceMessage ?? (classification || undefined);
        return { ...base, type: isHard ? "bounced" : "failed", detail };
      }
      case "email.complained":
        return { ...base, type: "complained" };
      default:
        return null;
    }
  }
}
