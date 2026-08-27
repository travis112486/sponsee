import { MailpitProvider } from "./mailpit.js";
import { PostmarkProvider } from "./postmark.js";
import { ResendProvider } from "./resend.js";
import type { EmailProvider } from "./types.js";

export * from "./types.js";
export { MailpitProvider, PostmarkProvider, ResendProvider };

/**
 * Factory: returns the configured EmailProvider based on environment.
 * Defaults to Mailpit in dev/test so real emails are never sent accidentally.
 */
export function createEmailProvider(name?: string): EmailProvider {
  const env = name || process.env.EMAIL_PROVIDER || "mailpit";

  switch (env) {
    case "postmark":
      return new PostmarkProvider();
    case "resend":
      return new ResendProvider();
    case "mailpit":
    default:
      return new MailpitProvider();
  }
}
