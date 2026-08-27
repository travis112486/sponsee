import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      // PGlite WASM crashes when multiple integration test files initialise
      // concurrently. These are run explicitly via the API package vitest config.
      "apps/api/**/*.test.ts",
    ],
    environmentMatchGlobs: [
      ["apps/web/**/*.test.tsx", "jsdom"],
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "apps/web/src"),
    },
  },
});
