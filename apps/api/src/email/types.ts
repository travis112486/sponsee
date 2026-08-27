/**
 * EmailProvider interface — abstraction over transactional email services.
 * All adapters implement this so the chase engine is provider-agnostic.
 */

export interface SendEmailPayload {
  /** Recipient email address */
  to: string;
  /** Sender email address (must be verified with provider) */
  from: string;
  /** Reply-to address (creator's email so brand replies go to them) */
  replyTo: string;
  subject: string;
  /** Plain text body */
  text: string;
  /** Optional HTML body */
  html?: string;
  /** Provider-agnostic metadata for idempotency and tracing */
  metadata?: {
    idempotencyKey?: string;
    tags?: string[];
  };
}

export interface SentMessageInfo {
  /** Provider-specific message ID used for webhook correlation */
  providerMessageId: string;
}

export interface EmailProvider {
  readonly name: string;

  /** Send an email. Returns provider message ID for webhook correlation. */
  send(payload: SendEmailPayload): Promise<SentMessageInfo>;

  /** Verify a sending domain (DNS checks). Optional — not all providers support it. */
  verifyDomain?(domain: string): Promise<{ verified: boolean; records?: Array<{ type: string; host: string; value: string }> }>;

  /**
   * Verify a webhook payload signature before ingestion.
   * Returns true only if the signature is cryptographically valid.
   * When no secret is configured, returns false (never accept unsigned webhooks).
   */
  verifyWebhookSignature?(body: string, headers: Record<string, string | undefined>): boolean;

  /**
   * Ingest a provider webhook payload and normalize to our internal event shape.
   * Returns null if the payload isn't relevant (e.g. unsupported event type).
   */
  ingestWebhook(payload: unknown): WebhookEvent | null;
}

export type WebhookEventType = "delivered" | "opened" | "bounced" | "failed" | "complained";

export interface WebhookEvent {
  type: WebhookEventType;
  /** Provider message ID from send() */
  providerMessageId: string;
  /** Original recipient email */
  to?: string;
  /** Bounce/complaint detail */
  detail?: string;
  timestamp?: Date;
}
