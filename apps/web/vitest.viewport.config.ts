import path from "path";
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

// SPO-379: real-browser viewport suite for the pipeline board.
//
// `root: __dirname` is load-bearing, not cosmetic. Tailwind resolves its
// `content` globs against `process.cwd()`, so a config living next to the
// other suites in `scripts/` compiles an EMPTY stylesheet — every `lg:` /
// `min-[1440px]:` variant disappears and every geometry assertion below then
// measures an unstyled DOM, which is exactly how a responsive test ships green
// while covering nothing. The file belongs in `apps/web/` so vite picks up this
// package's `postcss.config.js` + `tailwind.config.js` and the page has real CSS.
export default defineConfig({
  root: __dirname,
  test: {
    globals: true,
    include: ["src/**/*.viewport.test.{ts,tsx}"],
    browser: {
      enabled: true,
      // Vitest 4 changed the browser-mode API: `provider` takes a FACTORY
      // (the `playwright()` function), not the string `"playwright"`. The
      // string throws at startup.
      provider: playwright(),
      headless: true,
      screenshotFailures: false,
      instances: [{ browser: "chromium" }],
    },
  },
  optimizeDeps: {
    include: ["react/jsx-dev-runtime", "react/jsx-runtime", "@testing-library/react"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
