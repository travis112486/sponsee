import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // `pnpm test` does not use this config, but `pnpm test:watch` (bare
    // `vitest`) does, and the include glob below picks up packages/db — whose
    // createDb() prefers DATABASE_URL over the PGlite fallback. Without this
    // setup file a developer with .env sourced runs watch mode against a real
    // network Postgres; before SPO-382 that was production. The other node
    // configs already load it; this one was the gap.
    setupFiles: ["scripts/vitest-setup.ts"],
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
