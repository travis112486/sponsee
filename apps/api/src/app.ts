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
import { evaluateFrontDoor, FRONT_DOOR_HEADER } from "./front-door.js";
import brandIconApp from "./brand-icon/route.js";

const app = new Hono();

// Front-door gate (SPO-200). Registered first so it runs before every route and
// CORS handler below. The Render origin is publicly reachable, so a request that
// did not arrive through the Vercel rewrite (which injects x-sponsee-front-door)
// must not reach the authenticated API surface. Exempt: health (Render's own
// checker) and provider webhooks (signature-verified in-handler, direct-to-origin
// by design).
let warnedUnsetSecret = false;
app.use("*", async (c, next) => {
  const decision = evaluateFrontDoor(c.req.method, c.req.path, c.req.raw.headers);

  switch (decision.kind) {
    case "exempt":
      return next();

    case "secret-unset":
      // Fail open. An unset secret must not take the API down — enforcement is
      // the FRONT_DOOR_ENFORCE flag, not the presence of the secret.
      if (!warnedUnsetSecret) {
        warnedUnsetSecret = true;
        console.warn(
          "[front-door] FRONT_DOOR_SECRET is unset — front-door verification is DISABLED (fail open). Set it before enabling FRONT_DOOR_ENFORCE.",
        );
      }
      return next();

    case "observe":
      console.info(
        `[front-door] observe ${c.req.method} ${c.req.path} ${FRONT_DOOR_HEADER}=${decision.valid ? "valid" : decision.present ? "invalid" : "absent"}`,
      );
      return next();

    case "pass":
      return next();

    case "reject":
      console.warn(
        `[front-door] rejected ${c.req.method} ${c.req.path}: missing or invalid ${FRONT_DOOR_HEADER}`,
      );
      return c.json({ error: "Forbidden" }, 403);
  }
});

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

// Brand-logo proxy (SPO-374). No CORS block needed: BrandMark.tsx loads this
// as an <img src>, which browsers fetch cross-origin without a CORS handshake
// — CORS only gates script-readable responses (fetch/XHR), not image painting.
app.route("/api/brand-icon", brandIconApp);

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
