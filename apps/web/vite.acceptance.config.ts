import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Test-only vite server for the invoice-delivery acceptance proof (SPO-367
// gate, step 4). The acceptance test spawns `vite --config vite.acceptance.config.ts`
// with cwd = apps/web so the production source tree is served un-transpiled, the
// same way a developer's `pnpm dev` serves it. The listen port and the `/api`
// proxy target arrive via env (set by the spawner to free ports) so the page's
// same-origin tRPC calls reach the in-process Hono API server instead of the
// hard-coded localhost:3001 in vite.config.ts.
//
// This file exists separately from vite.config.ts because the production proxy
// target is fixed and the acceptance test needs a dynamic API origin; wiring a
// test-only env override into the shipped config would widen its blast radius
// for a test convenience.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: Number(process.env.SPONSEE_ACCEPT_WEB_PORT ?? 4173),
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.SPONSEE_ACCEPT_API_ORIGIN ?? "http://127.0.0.1:3001",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "src"),
    },
  },
});
