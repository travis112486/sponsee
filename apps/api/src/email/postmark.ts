import type { EmailProvider, SendEmailPayload, SentMessageInfo, WebhookEvent } from "./types.js";

/**
 * Postmark adapter — recommended provider for production.
 * https://postmarkapp.com/developer
 */
export class PostmarkProvider implements EmailProvider {
  readonly name = "postmark";
  private readonly serverToken: string;

  constructor(serverToken = process.env.POSTMARK_SERVER_TOKEN || "") {
    if (!serverToken) {
      throw new Error("PostmarkProvider requires POSTMARK_SERVER_TOKEN");
    }
    this.serverToken = serverToken;
  }

  async send(payload: SendEmailPayload): Promise<SentMessageInfo> {
    const body = {
      From: payload.from,
      To: payload.to,
      ReplyTo: payload.replyTo,
      Subject: payload.subject,
      TextBody: payload.text,
      HtmlBody: payload.html,
      Tag: payload.metadata?.tags?.[0] || "chase",
      Metadata: payload.metadata?.idempotencyKey
        ? { idempotencyKey: payload.metadata.idempotencyKey }
        : undefined,
    };

    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": this.serverToken,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "unknown");
      throw new Error(`Postmark send failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as { MessageID: string };
    return { providerMessageId: String(data.MessageID) };
  }

  async verifyDomain(domain: string) {
    const res = await fetch(`https://api.postmarkapp.com/domains/${encodeURIComponent(domain)}`, {
      headers: { "X-Postmark-Server-Token": this.serverToken },
    });
    if (!res.ok) {
      return { verified: false };
    }
    const data = (await res.json()) as {
      DKIMVerified?: boolean;
      SPFVerified?: boolean;
    };
    return { verified: Boolean(data.DKIMVerified && data.SPFVerified) };
  }

  ingestWebhook(payload: unknown): WebhookEvent | null {
    if (!payload || typeof payload !== "object") return null;
    const p = payload as Record<string, unknown>;

    const type = p.Type as string | undefined;
    const messageId = p.MessageID as string | undefined;
    if (!type || !messageId) return null;

    const base: Omit<WebhookEvent, "type"> = {
      providerMessageId: String(messageId),
      to: typeof p.Recipient === "string" ? p.Recipient : undefined,
      detail: typeof p.Description === "string" ? p.Description : undefined,
      timestamp: p.Date ? new Date(String(p.Date)) : new Date(),
    };

    switch (type) {
      case "Delivery":
        return { ...base, type: "delivered" };
      case "Open":
        return { ...base, type: "opened" };
      case "Bounce": {
        const bounceType = (p.BounceType as string) || "";
        const isHard = bounceType === "HardBounce" || bounceType === "Transient" === false;
        return { ...base, type: isHard ? "bounced" : "failed", detail: String(p.Description || bounceType) };
      }
      case "SpamComplaint":
        return { ...base, type: "complained" };
      default:
        return null;
    }
  }
}
