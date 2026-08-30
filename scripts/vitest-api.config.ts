import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "apps/api/src/**/*.{test,spec}.{ts,tsx}",
      "packages/db/src/**/*.{test,spec}.{ts,tsx}",
      // Marketing's Vercel functions are server-side too, and the marketing app
      // has no runner of its own — without this line they go untested.
      "apps/marketing/api/**/*.{test,spec}.{ts,tsx}",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.turbo/**"],
    setupFiles: ["scripts/vitest-setup.ts"],
    fileParallelism: false,
    maxWorkers: 1,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../apps/web/src"),
    },
  },
});
