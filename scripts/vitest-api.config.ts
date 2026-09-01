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
    ],
    // storage.e2e.test.ts needs a real S3-compatible server (MinIO) and is
    // deliberately not part of the default suite — see scripts/vitest-storage-e2e.config.ts
    // and the `storage-e2e` CI job. Keep this exclude in step with
    // apps/api/vitest.config.ts's own copy (see SPO-86 / that file's comment).
    exclude: ["**/node_modules/**", "**/dist/**", "**/.turbo/**", "**/*.e2e.test.ts"],
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
