import type { EmailProvider, SendEmailPayload, SentMessageInfo, WebhookEvent } from "./types.js";

/**
 * Resend adapter — named fallback provider.
 * https://resend.com/docs/api-reference
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

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "unknown");
      throw new Error(`Resend send failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as { id: string };
    return { providerMessageId: data.id };
  }

  ingestWebhook(payload: unknown): WebhookEvent | null {
    if (!payload || typeof payload !== "object") return null;
    const p = payload as Record<string, unknown>;

    const type = p.type as string | undefined;
    const emailId = p.email_id as string | undefined;
    if (!type || !emailId) return null;

    const base: Omit<WebhookEvent, "type"> = {
      providerMessageId: String(emailId),
      to: typeof p.to === "string" ? p.to : undefined,
      detail: typeof p.error === "string" ? p.error : undefined,
      timestamp: p.created_at ? new Date(String(p.created_at)) : new Date(),
    };

    switch (type) {
      case "email.delivered":
        return { ...base, type: "delivered" };
      case "email.opened":
        return { ...base, type: "opened" };
      case "email.bounced": {
        const bounceType = (p.data as Record<string, unknown> | undefined)?.type as string | undefined;
        const isHard = bounceType === "hard";
        return { ...base, type: isHard ? "bounced" : "failed", detail: bounceType };
      }
      case "email.complained":
        return { ...base, type: "complained" };
      default:
        return null;
    }
  }
}
