import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    include: ["apps/web/src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.turbo/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../apps/web/src"),
    },
  },
});
