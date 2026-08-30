import { MailpitProvider } from "./mailpit.js";
import { PostmarkProvider } from "./postmark.js";
import { ResendProvider } from "./resend.js";
import type { EmailProvider } from "./types.js";

export * from "./types.js";
export { MailpitProvider, PostmarkProvider, ResendProvider };

/**
 * Factory: returns the configured EmailProvider based on environment.
 *
 * Dev/test: defaults to Mailpit (the local capture SMTP) so real emails are
 * never sent accidentally.
 *
 * Production: a silent Mailpit fallback is a beta blocker — a chase that never
 * leaves the box, with no startup error to reveal it. When `NODE_ENV` is
 * exactly `"production"`, an unset or `mailpit` `EMAIL_PROVIDER` is therefore a
 * hard error, and a real provider additionally requires its credential. The
 * `NODE_ENV` comparison is exact by design — see SPO-118, where `data.stack`
 * ships or is withheld on that precise check.
 *
 * `name` is set only by the webhook ingestion path (a provider named in the
 * URL); it bypasses the production default guard because it never resolves an
 * implicit provider and never needs a send credential.
 */
export function createEmailProvider(
  name?: string,
  env: Record<string, string | undefined> = process.env,
): EmailProvider {
  const provider = name || env.EMAIL_PROVIDER;

  if (env.NODE_ENV === "production" && !name) {
    if (provider === "postmark") {
      const token = env.POSTMARK_SERVER_TOKEN;
      if (!token) {
        throw new Error("Missing POSTMARK_SERVER_TOKEN environment variable");
      }
      return new PostmarkProvider(token);
    }
    if (provider === "resend") {
      const apiKey = env.RESEND_API_KEY;
      if (!apiKey) {
        throw new Error("Missing RESEND_API_KEY environment variable");
      }
      return new ResendProvider(apiKey);
    }
    throw new Error(
      `EMAIL_PROVIDER is ${provider ? `"${provider}"` : "unset"} in production; ` +
        `set EMAIL_PROVIDER to "postmark" or "resend" so chase emails actually send.`,
    );
  }

  switch (provider || "mailpit") {
    case "postmark":
      return new PostmarkProvider();
    case "resend":
      return new ResendProvider();
    case "mailpit":
    default:
      return new MailpitProvider();
  }
}
