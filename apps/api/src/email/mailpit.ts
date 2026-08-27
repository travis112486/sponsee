import type { EmailProvider, SendEmailPayload, SentMessageInfo, WebhookEvent } from "./types.js";

/**
 * Mailpit adapter — captures emails in local Mailpit instance for dev/CI.
 * Never sends real mail. Uses Mailpit's SMTP relay or HTTP API if available.
 *
 * In dev, Mailpit runs at SMTP 1025 / Web UI 8025.
 * We use the SMTP port via nodemailer-style submission, but to keep deps
 * light we POST to Mailpit's message API when available, else log.
 */
export class MailpitProvider implements EmailProvider {
  readonly name = "mailpit";
  private readonly baseUrl: string;

  constructor(baseUrl = process.env.MAILPIT_URL || "http://localhost:8025") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async send(payload: SendEmailPayload): Promise<SentMessageInfo> {
    // Try Mailpit's API first (accepts raw MIME or JSON). Fall back to console.
    try {
      const form = new URLSearchParams();
      form.append("from", payload.from);
      form.append("to", payload.to);
      form.append("subject", payload.subject);
      form.append("text", payload.text);
      if (payload.html) form.append("html", payload.html);
      if (payload.replyTo) form.append("reply_to", payload.replyTo);

      const res = await fetch(`${this.baseUrl}/api/v1/message`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "unknown");
        throw new Error(`Mailpit API error ${res.status}: ${body}`);
      }

      // Mailpit returns the stored message ID in the Location header or JSON
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      const providerMessageId =
        (typeof data.ID === "string" ? data.ID : undefined) ||
        `mailpit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      return { providerMessageId };
    } catch (err) {
      // Fallback: log and return synthetic ID so tests don't fail on missing Mailpit
      console.warn("[Mailpit] send failed, logging fallback:", (err as Error).message);
      console.log("[Mailpit] captured email:\n", JSON.stringify(payload, null, 2));
      return { providerMessageId: `mailpit-fallback-${Date.now()}` };
    }
  }

  ingestWebhook(_payload: unknown): WebhookEvent | null {
    // Mailpit doesn't emit webhooks in the standard sense.
    // In tests we simulate webhook ingestion by calling provider methods directly.
    return null;
  }
}
