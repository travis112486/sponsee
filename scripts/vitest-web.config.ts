import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    // Marketing's browser-side tests need a DOM too — its pre-render/hydration
    // suite (SPO-209) has nowhere else to run, since vitest-api is node-env.
    include: [
      "apps/web/src/**/*.{test,spec}.{ts,tsx}",
      "apps/marketing/src/**/*.{test,spec}.{ts,tsx}",
    ],
    // *.viewport.test.{ts,tsx} runs in real Chromium via
    // apps/web/vitest.viewport.config.ts (SPO-379). The include glob above
    // matches them too, and without this exclude the jsdom pool imports them
    // and the whole `test` job dies on "vitest/browser can be imported only
    // inside the Browser Mode". The browser suite is additive, not a
    // replacement.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/*.viewport.test.{ts,tsx}",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../apps/web/src"),
    },
  },
});
