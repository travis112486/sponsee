import { Hono } from "hono";
import { cors } from "hono/cors";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./routers/index.js";
import { createContext } from "./context.js";
import { auth } from "./auth.js";
import dotenv from "dotenv";
import { serve } from "@hono/node-server";

dotenv.config();

const app = new Hono();

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

// Health check (raw)
app.get("/health", (c) => c.json({ status: "ok", version: "0.1.0" }));

const port = parseInt(process.env.PORT || "3001");

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API server running on http://localhost:${info.port}`);
});

export default app;
