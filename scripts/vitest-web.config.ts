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
    exclude: ["**/node_modules/**", "**/dist/**", "**/.turbo/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../apps/web/src"),
    },
  },
});
