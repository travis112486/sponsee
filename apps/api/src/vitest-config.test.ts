import { describe, it, expect } from "vitest";
import apiConfig from "../vitest.config.js";
import rootApiConfig from "../../../scripts/vitest-api.config.js";

/**
 * The API tests stand up PGlite, which crashes when several instances
 * initialise at once and is slow enough under contention to blow test
 * timeouts. Both facts mean the suite has to run serially.
 *
 * There are two configs that run these tests: apps/api/vitest.config.ts (what
 * a developer gets from `pnpm --filter @sponsee/api exec vitest run`) and
 * scripts/vitest-api.config.ts (what `pnpm test` and therefore CI runs). They
 * drifted: the API one asked for serial execution with `singleFork: true`,
 * an option vitest 4 removed. Unknown keys are ignored without a warning, so
 * the config read as correct while the suite ran fully parallel — and
 * migration.smoke.test.ts timed out on one entrypoint but not the other.
 *
 * These assertions fail loudly if either config stops actually serialising,
 * which is the part a typo can silently take away.
 */
describe("vitest config", () => {
  const configs = [
    ["apps/api/vitest.config.ts", apiConfig],
    ["scripts/vitest-api.config.ts", rootApiConfig],
  ] as const;

  for (const [name, config] of configs) {
    it(`${name} runs the PGlite suites serially`, () => {
      const test = (config as { test?: Record<string, unknown> }).test;
      expect(test, `${name} has no test block`).toBeDefined();
      expect(test?.fileParallelism).toBe(false);
      expect(test?.maxWorkers).toBe(1);
    });

    it(`${name} uses no vitest option that vitest 4 removed`, () => {
      const test = (config as { test?: Record<string, unknown> }).test ?? {};
      // Dropped in the v4 pool rework. Vitest ignores them in silence, so a
      // config carrying one is not doing what it claims to do.
      for (const removed of ["singleFork", "singleThread", "poolOptions"]) {
        expect(test, `${name} still sets removed option \`${removed}\``).not.toHaveProperty(removed);
      }
    });
  }
});
