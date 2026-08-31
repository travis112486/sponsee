import { defineConfig } from "vitest/config";

// Separate from scripts/vitest-api.config.ts on purpose: storage.e2e.test.ts
// needs a real S3-compatible server (MinIO) and must never silently join the
// default `pnpm test` run — see that file's header comment and the
// `storage-e2e` CI job. Run with `pnpm test:storage-e2e`.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["apps/api/src/storage/*.e2e.test.ts"],
    setupFiles: ["scripts/vitest-setup.ts"],
    fileParallelism: false,
    maxWorkers: 1,
  },
});
