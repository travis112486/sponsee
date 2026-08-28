import dotenv from "dotenv";
import { serve } from "@hono/node-server";
import app from "./app.js";
import { registerJobs } from "./jobs/index.js";
import { stopBoss } from "./jobs/boss.js";

dotenv.config();

const port = parseInt(process.env.PORT || "3001");

// Start pg-boss background jobs
const jobsPromise = registerJobs().catch((err) => {
  console.error("[jobs] Failed to register:", err);
});

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API server running on http://localhost:${info.port}`);
});

// Graceful shutdown for production deploys (Railway, Render, Fly, etc.)
async function shutdown(signal: string) {
  console.log(`[server] Received ${signal}, shutting down gracefully...`);

  server.close(async () => {
    console.log("[server] HTTP server closed");
    await stopBoss();
    console.log("[jobs] pg-boss stopped");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
