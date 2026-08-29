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
