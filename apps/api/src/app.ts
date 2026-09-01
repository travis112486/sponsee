import { Hono } from "hono";
import { cors } from "hono/cors";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./routers/index.js";
import { createContext } from "./context.js";
import { logTRPCError } from "./error-formatter.js";
import { auth, LINK_ONLY_PROVIDERS } from "./auth.js";
import waitlistApp, { waitlistAdminApp } from "./routers/waitlist.js";
import { handleEmailWebhook } from "./routers/webhooks.js";
import { registerStripeWebhook } from "./billing/webhook.js";

const app = new Hono();

// Public waitlist endpoint — wide CORS for marketing site
app.use(
  "/api/waitlist/*",
  cors({
    origin: ["http://localhost:5173", "http://localhost:4173", "https://sponsee.app", "https://www.sponsee.app"],
    allowMethods: ["POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 86400,
  })
);

app.route("/api/waitlist", waitlistApp);

// Admin export lives outside /api/waitlist/* on purpose: the CORS middleware
// above must never attach browser-readable headers to a PII dump.
app.route("/api/admin/waitlist", waitlistAdminApp);

app.use(
  "/api/trpc/*",
  cors({
    origin: process.env.WEB_URL || "http://localhost:3000",
    credentials: true,
  })
);

app.use(
  "/api/auth/*",
  cors({
    origin: process.env.WEB_URL || "http://localhost:3000",
    credentials: true,
  })
);

// Better Auth routes. Guarded inline (not as a separate route — an extra
// registration under /api/auth flips Hono to a router where the `**` pattern
// stops matching nested paths): Twitch/Kick are trusted for account *linking*
// (see LINK_ONLY_PROVIDERS in auth.ts), and that same trust would let a social
// sign-in implicitly attach itself to an existing user matched by email, so
// the sign-in door is closed before Better Auth sees the request. The clone
// keeps the raw body readable on the pass-through path.
app.on(["POST", "GET"], "/api/auth/**", async (c) => {
  if (c.req.method === "POST" && c.req.path === "/api/auth/sign-in/social") {
    const body = (await c.req.raw
      .clone()
      .json()
      .catch(() => null)) as { provider?: string } | null;
    if (body?.provider && LINK_ONLY_PROVIDERS.includes(body.provider)) {
      return c.json(
        {
          code: "PROVIDER_NOT_ALLOWED",
          message: "This provider can only be connected from Settings → Platforms, not used to sign in",
        },
        403,
      );
    }
  }
  return auth.handler(c.req.raw);
});

// tRPC routes
app.use(
  "/api/trpc/*",
  (c) =>
    fetchRequestHandler({
      endpoint: "/api/trpc",
      req: c.req.raw,
      router: appRouter,
      createContext,
      // 500 bodies are scrubbed before they leave (see error-formatter.ts), so
      // this is the only place the real failure is recorded.
      onError: logTRPCError,
    })
);

// Provider webhooks (no auth — validated by provider signature in production)
app.post("/api/webhooks/email/:provider", handleEmailWebhook);

// Stripe webhooks (signature-verified inside handler)
registerStripeWebhook(app);

// Health check (raw). `commit` identifies which build is live — Render injects
// RENDER_GIT_COMMIT automatically; GIT_COMMIT is the fallback for other hosts.
// Without it there is no way to tell a deployed host apart from a stale one.
app.get("/health", (c) =>
  c.json({
    status: "ok",
    version: "0.1.0",
    commit: process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "unknown",
  }),
);

export default app;
