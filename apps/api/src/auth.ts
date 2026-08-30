import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { defaultChaseTemplates, defaultChaseOffsets } from "@sponsee/shared";
import nodemailer from "nodemailer";
import { ipAddressOptions, resolvesAuthClientIp } from "./client-ip.js";
import { SlidingWindowLimiter } from "./rate-limit.js";

const isProd = process.env.NODE_ENV === "production";

/**
 * Whether Better Auth's rate limiter runs.
 *
 * Better Auth only self-enables it when `NODE_ENV === "production"`, so a
 * staging box or a misconfigured deploy would accept unlimited magic-link
 * requests — i.e. unbounded sign-in email to arbitrary addresses from our
 * domain. It is therefore enabled explicitly here, off only under the test
 * runner (where every request shares one localhost bucket and the built-in
 * 3-per-10s sign-in rule would fail unrelated suites).
 * `AUTH_RATE_LIMIT_ENABLED` overrides in both directions.
 */
export function rateLimitEnabled(env: Record<string, string | undefined> = process.env) {
  const override = env.AUTH_RATE_LIMIT_ENABLED;
  if (override !== undefined && override !== "") return override === "true";
  return !(env.NODE_ENV === "test" || !!env.VITEST);
}
/**
 * Sign-in limits to apply when the client address could not be resolved.
 *
 * Better Auth does not skip rate limiting when it cannot identify the caller —
 * it puts every caller into one `no-trusted-ip` bucket and applies the
 * per-caller rule to it. On the entry paths those rules are 5 per 60s
 * (magic-link plugin) and 3 per 10s (built-in sign-in rule), which as a global
 * cap is a site-wide sign-in outage, not a limit.
 *
 * So the degraded case gets its own ceiling: still bounded, because the point
 * of the limit is to stop our domain being used to bomb an arbitrary inbox, but
 * high enough that it is not itself the outage. One per second is far above
 * anything beta traffic produces and far below a useful mail flood.
 */
const SHARED_BUCKET_RULE = { window: 60, max: 60 };

/**
 * Paths where a shared bucket would be user-visible: `/sign-in/*` covers
 * magic-link requests and the Google redirect, `/magic-link/*` covers the
 * verify hop the user's browser makes when they click the emailed link — which
 * carries the same 5-per-60s plugin rule and so fails the same way.
 */
const AUTH_ENTRY_PATHS = ["/sign-in/*", "/magic-link/*"];

/**
 * Keeps a per-caller rule per-caller: pass it through untouched when Better
 * Auth can key on a client address, and swap in the shared ceiling when it
 * cannot.
 */
function perCallerOrSharedCeiling(
  request: Request,
  currentRule: { window: number; max: number },
) {
  return resolvesAuthClientIp(request) ? currentRule : SHARED_BUCKET_RULE;
}

/**
 * Per-destination cap on magic-link mail.
 *
 * Every rule above is keyed on the *caller*, which is the wrong end of this
 * particular abuse. Reaching a caller-keyed limit takes a resolvable client
 * address, and a request sent straight to the Render origin — publicly
 * reachable, tracked as SPO-102 — has none, so it lands in the shared bucket
 * and gets `SHARED_BUCKET_RULE`'s 60 per 60s. That is a deliberately survivable
 * ceiling for sign-in availability, but as a mail bound it means 60 sign-in
 * emails a minute into one inbox, chosen by the attacker, sent from our domain
 * and our relay's reputation. Rotating source addresses raises it further.
 *
 * So the send path gets its own limit keyed on the destination instead, where
 * the harm actually accrues. Three per 15 minutes is above any real sign-in
 * retry (request, mistype, request again) and far below a useful flood.
 *
 * Deliberately not Better Auth's `rate_limit` table: it prunes rows older than
 * its own longest configured window (60s), which would silently reset a
 * 15-minute counter stored beside them. `SlidingWindowLimiter` is per instance,
 * so a scaled-out deploy multiplies the allowance by the instance count — still
 * a bound, and the same trade-off already accepted for the waitlist limiter.
 */
const MAGIC_LINK_SENDS_MAX = 3;
const MAGIC_LINK_SENDS_WINDOW_MS = 15 * 60_000;

export const magicLinkSendLimiter = new SlidingWindowLimiter(
  MAGIC_LINK_SENDS_MAX,
  MAGIC_LINK_SENDS_WINDOW_MS,
);

/**
 * Whether a magic link may be mailed to `email` right now.
 *
 * Shares `rateLimitEnabled` with the Better Auth limiter so the whole
 * rate-limiting surface is on or off together — in particular off under the
 * test runner, where suites legitimately sign the same fixture address in
 * repeatedly.
 */
export function allowMagicLinkSend(
  email: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!rateLimitEnabled(env)) return true;
  return magicLinkSendLimiter.check(email.trim().toLowerCase()).allowed;
}

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

/**
 * Nodemailer options for the magic-link transport.
 *
 * Mailpit's dev listener presents a self-signed certificate, so certificate
 * verification is relaxed for local/CI only. It must stay on everywhere else: a
 * magic link is a full account-takeover primitive (10-minute single-use token,
 * stored in plain text), so anyone with network position toward the SMTP relay
 * could otherwise MITM the connection and read sign-in links off the wire.
 */
export function smtpTransportOptions(prod: boolean) {
  return {
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
    ...(prod ? {} : { tls: { rejectUnauthorized: false } }),
  };
}

const transporter = nodemailer.createTransport(smtpTransportOptions(isProd));

// Google OAuth only when credentials are present
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const googleEnabled = !!(googleClientId && googleClientSecret);

// Twitch/Kick reuse the SPO-107 stats-sync app credentials. They exist for
// account *linking* (Settings → Platforms → Connect), which unlocks
// broadcaster-gated data — true Twitch subscriber counts need the streamer's
// own token with channel:read:subscriptions; Kick's channel:read is the
// fallback if app-token sub counts prove gated. `disableSignUp` keeps them
// from becoming a sign-up path: magic link (+ Google) stays the only way in.
const twitchClientId = process.env.TWITCH_CLIENT_ID;
const twitchClientSecret = process.env.TWITCH_CLIENT_SECRET;
const twitchEnabled = !!(twitchClientId && twitchClientSecret);
const kickClientId = process.env.KICK_CLIENT_ID;
const kickClientSecret = process.env.KICK_CLIENT_SECRET;
const kickEnabled = !!(kickClientId && kickClientSecret);

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
    /**
     * Returns a valid access token for a linked OAuth account, refreshing via
     * the stored refresh token when expired. Called headerless from the sync
     * job, where `userId` (not a session) selects the account owner.
     */
    getAccessToken: (opts: {
      body: { accountId: string; userId?: string };
    }) => Promise<{ accessToken?: string; accessTokenExpiresAt?: Date }>;
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
      // Required by `rateLimit.storage: "database"` below — the Drizzle adapter
      // throws on any model missing from this map.
      rateLimit: schema.rateLimit,
    },
  }),
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL,
  trustedOrigins,
  emailAndPassword: {
    enabled: false, // magic link only in v1
  },
  socialProviders: {
    ...(googleEnabled
      ? {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
          },
        }
      : {}),
    ...(twitchEnabled
      ? {
          twitch: {
            clientId: twitchClientId,
            clientSecret: twitchClientSecret,
            scope: ["channel:read:subscriptions"],
            disableSignUp: true,
          },
        }
      : {}),
    ...(kickEnabled
      ? {
          kick: {
            clientId: kickClientId,
            clientSecret: kickClientSecret,
            scope: ["channel:read"],
            disableSignUp: true,
          },
        }
      : {}),
  },
  account: {
    accountLinking: {
      enabled: true,
      // A streamer's Twitch/Kick email routinely differs from the email they
      // sign in to Sponsee with. Linking is only reachable from an
      // authenticated session (linkSocial), and disableSignUp above keeps
      // these providers out of the sign-up path, so the takeover vector this
      // flag warns about (implicit linking on sign-IN) stays closed.
      allowDifferentEmails: true,
    },
  },
  // Storage is the database, not per-instance memory: the serverless adapter in
  // apps/api/api/index.ts gives every cold start a fresh empty limiter, which
  // makes an in-memory counter no limit at all.
  rateLimit: {
    enabled: rateLimitEnabled(),
    storage: "database",
    customRules: Object.fromEntries(
      AUTH_ENTRY_PATHS.map((path) => [path, perCallerOrSharedCeiling]),
    ),
  },
  advanced: {
    cookiePrefix: "sponsee",
    useSecureCookies: isProd,
    disableOriginCheck: false, // enforce even in test mode; trustedOrigins drives allow-list
    // Same object `resolvesAuthClientIp` resolves against, so the guard cannot
    // drift from the configuration it is guarding.
    ipAddress: ipAddressOptions(),
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
        // Return normally rather than throwing: the caller's response must not
        // differ between "sent" and "suppressed", or it becomes an oracle for
        // whether an address has been targeted recently. The log line carries
        // no address for the same reason.
        if (!allowMagicLinkSend(email)) {
          console.warn("[auth] magic-link send suppressed: per-destination rate limit");
          return;
        }
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
