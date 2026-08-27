import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { defaultChaseTemplates, defaultChaseOffsets } from "@sponsee/shared";
import nodemailer from "nodemailer";

const isProd = process.env.NODE_ENV === "production";
const baseURL = process.env.BETTER_AUTH_URL || "http://localhost:3001";
const webURL = process.env.WEB_URL || "http://localhost:3000";

// Trusted origins: the web app origin must be explicitly allowed by Better Auth.
const trustedOrigins = [webURL];
if (!isProd && webURL !== "http://localhost:3000") {
  trustedOrigins.push("http://localhost:3000");
}

// Mailpit in dev/CI; configure real SMTP via env in staging/prod
const smtpHost = process.env.SMTP_HOST || "localhost";
const smtpPort = parseInt(process.env.SMTP_PORT || "1025", 10);
const smtpUser = process.env.SMTP_USER || "";
const smtpPass = process.env.SMTP_PASS || "";
const smtpFrom = process.env.SMTP_FROM || "noreply@sponsee.app";

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpPort === 465,
  auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
  tls: { rejectUnauthorized: false },
});

// Google OAuth only when credentials are present
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const googleEnabled = !!(googleClientId && googleClientSecret);

/**
 * Create a creator workspace + owner membership + default chase templates
 * for a newly-registered user.
 */
async function provisionWorkspace(userId: string, email: string, name: string) {
  // Check if user already has an owner membership
  const existing = await db.query.memberships.findFirst({
    where: (m, { eq }) => eq(m.userId, userId),
  });
  if (existing) return; // already provisioned

  const displayName = name || email.split("@")[0];

  const [creator] = await db
    .insert(schema.creators)
    .values({
      displayName,
      timezone: "America/New_York",
      defaultCurrency: "USD",
      plan: "starter",
    })
    .returning();

  await db.insert(schema.memberships).values({
    userId,
    creatorId: creator.id,
    role: "owner",
  });

  // Seed default chase templates
  await db.insert(schema.chaseTemplates).values(
    defaultChaseTemplates.map((t) => ({
      creatorId: creator.id,
      step: t.step,
      name: t.name,
      offsetDays: defaultChaseOffsets[t.step],
      subject: t.subject,
      body: t.body,
      enabled: true,
    }))
  );
}

interface AuthInstance {
  handler: (request: Request) => Promise<Response>;
  api: {
    getSession: (opts: { headers: Headers }) => Promise<{
      user: { id: string; name?: string | null; email: string };
      session: { id: string };
    } | null>;
  };
}

// Narrow interface avoids TS2742 declaration-emit issue with pnpm+zod internals
export const auth: AuthInstance = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL,
  trustedOrigins,
  emailAndPassword: {
    enabled: false, // magic link only in v1
  },
  socialProviders: googleEnabled
    ? {
        google: {
          clientId: googleClientId,
          clientSecret: googleClientSecret,
        },
      }
    : undefined,
  advanced: {
    cookiePrefix: "sponsee",
    useSecureCookies: isProd,
    disableOriginCheck: false, // enforce even in test mode; trustedOrigins drives allow-list
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await provisionWorkspace(user.id, user.email, user.name || "");
        },
      },
    },
  },
  plugins: [
    magicLink({
      expiresIn: 60 * 10, // 10 minutes
      sendMagicLink: async ({ email, url }) => {
        await transporter.sendMail({
          from: smtpFrom,
          to: email,
          subject: "Sign in to Sponsee",
          text: `Click the link to sign in to Sponsee:\n\n${url}\n\nThis link expires in 10 minutes.`,
          html: `<p>Click the link below to sign in to Sponsee:</p><p><a href="${url}">Sign in to Sponsee</a></p><p>This link expires in 10 minutes.</p>`,
        });
      },
    }),
  ],
});
