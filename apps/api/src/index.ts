import dotenv from "dotenv";
import { serve } from "@hono/node-server";
import app from "./app.js";
import { registerJobs } from "./jobs/index.js";

dotenv.config();

const port = parseInt(process.env.PORT || "3001");

// Start pg-boss background jobs
registerJobs().catch((err) => {
  console.error("[jobs] Failed to register:", err);
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API server running on http://localhost:${info.port}`);
});
