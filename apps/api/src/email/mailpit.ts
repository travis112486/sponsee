import type { EmailProvider, SendEmailPayload, SentMessageInfo, WebhookEvent } from "./types.js";
import nodemailer from "nodemailer";

/**
 * Mailpit adapter — captures emails in local Mailpit instance for dev/CI.
 * Never sends real mail. Uses nodemailer over SMTP to Mailpit's relay port.
 *
 * In dev, Mailpit runs at SMTP 1025 / Web UI 8025.
 * https://mailpit.axllent.org/docs/
 */
export class MailpitProvider implements EmailProvider {
  readonly name = "mailpit";
  private readonly transporter: nodemailer.Transporter;

  constructor(
    host = process.env.MAILPIT_SMTP_HOST || "localhost",
    port = parseInt(process.env.MAILPIT_SMTP_PORT || "1025", 10)
  ) {
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      tls: { rejectUnauthorized: false },
    });
  }

  async send(payload: SendEmailPayload): Promise<SentMessageInfo> {
    const info = await this.transporter.sendMail({
      from: payload.from,
      to: payload.to,
      replyTo: payload.replyTo,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    });

    const messageId = info.messageId;
    if (!messageId) {
      throw new Error("Mailpit SMTP send succeeded but no messageId returned");
    }

    return { providerMessageId: messageId };
  }

  ingestWebhook(_payload: unknown): WebhookEvent | null {
    void _payload;
    // Mailpit doesn't emit webhooks in the standard sense.
    // In tests we simulate webhook ingestion by calling provider methods directly.
    return null;
  }
}
