import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // PGlite WASM crashes when multiple processes initialise concurrently.
    // Run all API tests in one worker so they share one PGlite instance.
    //
    // This used to say `singleFork: true`, which vitest 4 does not have — the
    // option was dropped in the v4 pool rework and unknown keys are ignored in
    // silence, so the suite ran fully parallel and the comment above was a
    // lie. That contention is what made migration.smoke.test.ts blow its
    // timeout here while passing under the root config, which serialises
    // correctly. Keep these two lines in step with scripts/vitest-api.config.ts
    // — that is the config CI actually runs. See SPO-86.
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
    setupFiles: ["./src/test-utils/vitest-setup.ts"],
    exclude: ["node_modules/**", "dist/**"],
  },
});
