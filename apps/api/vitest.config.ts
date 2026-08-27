import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // PGlite WASM crashes when multiple processes initialise concurrently.
    // Run all API tests in a single fork so they share one PGlite instance.
    pool: "forks",
    singleFork: true,
    setupFiles: ["./src/test-utils/vitest-setup.ts"],
    exclude: ["node_modules/**", "dist/**"],
  },
});
