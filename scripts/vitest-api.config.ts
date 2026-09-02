import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Glob every workspace package instead of naming them one at a time.
    // packages/shared's calculator and merge-token tests sat unrun for weeks
    // because neither config's `include` matched them, and the next package
    // would have landed in the same hole.
    include: [
      "apps/api/src/**/*.{test,spec}.{ts,tsx}",
      "packages/*/src/**/*.{test,spec}.{ts,tsx}",
      // Marketing's Vercel functions and its blog build scripts are server-side
      // too, and the marketing app has no runner of its own — without this line
      // they go untested. Deliberately the whole app, not `api/` alone: the
      // narrow glob this replaced would have silently skipped SPO-199's blog
      // generator tests.
      "apps/marketing/**/*.{test,spec}.{ts,tsx}",
      // Repo-level tooling that belongs to no package: the SPO-225 test for the
      // root vercel.json ignoreCommand lives here. Same trap as the two globs
      // above — a test outside apps/ and packages/ matches nothing otherwise
      // and would sit silently unrun.
      "scripts/**/*.{test,spec}.{ts,tsx}",
    ],
    // storage.e2e.test.ts needs a real S3-compatible server (MinIO) and is
    // deliberately not part of the default suite — see scripts/vitest-storage-e2e.config.ts
    // and the `storage-e2e` CI job. Keep this exclude in step with
    // apps/api/vitest.config.ts's own copy (see SPO-86 / that file's comment).
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/*.e2e.test.ts",
      // ...except apps/marketing/src, which is the React app. Its tests render
      // and hydrate components and need a DOM, so vitest-web.config.ts owns
      // that directory (SPO-209). Nothing goes unrun: the two `include` globs
      // between them still cover the whole marketing app.
      "apps/marketing/src/**",
    ],
    setupFiles: ["scripts/vitest-setup.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    // Every PGlite-backed suite pays a real WASM Postgres boot cost via
    // initPgliteSchema (see apps/api/src/test-utils/pglite-setup.ts). Measured
    // unloaded on this repo: ~4-5.4s consistently across 3 runs. Vitest's 10s
    // default hookTimeout only carries ~2x margin over that, and SPO-242 was
    // filed after one CI run's schema init blew past 10s under concurrent
    // build/install load and silently turned proof.test.ts's 9 tests into
    // skips instead of a legible failure. 60s matches the budget SPO-86
    // already measured and shipped for this exact operation (a cold PGlite
    // boot on a loaded runner) in migration.smoke.test.ts — reusing that
    // number instead of picking a fresh multiple. Keep in step with
    // apps/api/vitest.config.ts and pglite-setup.ts's own internal
    // SCHEMA_INIT_TIMEOUT_MS (55s, deliberately below this).
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../apps/web/src"),
    },
  },
});
