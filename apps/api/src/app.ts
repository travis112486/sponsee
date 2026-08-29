import { Hono } from "hono";
import { cors } from "hono/cors";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./routers/index.js";
import { createContext } from "./context.js";
import { auth } from "./auth.js";
import waitlistApp from "./routers/waitlist.js";
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

// Better Auth routes
app.on(["POST", "GET"], "/api/auth/**", (c) => auth.handler(c.req.raw));

// tRPC routes
app.use(
  "/api/trpc/*",
  (c) =>
    fetchRequestHandler({
      endpoint: "/api/trpc",
      req: c.req.raw,
      router: appRouter,
      createContext,
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
