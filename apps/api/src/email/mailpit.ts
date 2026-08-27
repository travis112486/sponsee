import type { EmailProvider, SendEmailPayload, SentMessageInfo, WebhookEvent } from "./types.js";

/**
 * Mailpit adapter — captures emails in local Mailpit instance for dev/CI.
 * Never sends real mail. Uses Mailpit's HTTP JSON API.
 *
 * In dev, Mailpit runs at SMTP 1025 / Web UI 8025.
 * API docs: https://mailpit.axllent.org/docs/usage/sending-messages/
 */
export class MailpitProvider implements EmailProvider {
  readonly name = "mailpit";
  private readonly baseUrl: string;

  constructor(baseUrl = process.env.MAILPIT_URL || "http://localhost:8025") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async send(payload: SendEmailPayload): Promise<SentMessageInfo> {
    const body = {
      From: payload.from,
      To: [payload.to],
      Subject: payload.subject,
      Text: payload.text,
      HTML: payload.html,
      ReplyTo: payload.replyTo,
    };

    const res = await fetch(`${this.baseUrl}/api/v1/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "unknown");
      throw new Error(`Mailpit API error ${res.status}: ${text}`);
    }

    // Mailpit returns { ID: "..." } on success
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof data.ID !== "string" || !data.ID) {
      throw new Error("Mailpit API success but no message ID returned");
    }
    const providerMessageId = data.ID;

    return { providerMessageId };
  }

  ingestWebhook(_payload: unknown): WebhookEvent | null {
    void _payload;
    // Mailpit doesn't emit webhooks in the standard sense.
    // In tests we simulate webhook ingestion by calling provider methods directly.
    return null;
  }
}
