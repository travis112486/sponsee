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
    // Keep in step with scripts/vitest-api.config.ts's hookTimeout — see that
    // file's comment (SPO-242). Same PGlite boot cost applies here.
    hookTimeout: 60_000,
    // The repo-root setup file, not a local copy. This used to be
    // ./src/test-utils/vitest-setup.ts, a hand-maintained duplicate of
    // scripts/vitest-setup.ts — so anything added to one config's setup (the
    // SPO-382 DATABASE_URL strip, for instance) silently did not apply to
    // `pnpm -C apps/api test`. Sharing the file removes the drift instead of
    // asking a comment to prevent it. It cannot live under src/: apps/api's
    // tsconfig sets rootDir to src, so importing across that boundary breaks
    // `tsc` (TS6059).
    setupFiles: ["../../scripts/vitest-setup.ts"],
    // Keep this exclude in step with scripts/vitest-api.config.ts — see that
    // file's comment on storage.e2e.test.ts (needs a real MinIO, SPO-171).
    exclude: ["node_modules/**", "dist/**", "**/*.e2e.test.ts"],
  },
});
