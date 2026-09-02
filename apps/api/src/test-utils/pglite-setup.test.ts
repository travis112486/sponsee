import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { pgliteClient } from "@sponsee/db";
import { initPgliteSchema } from "./pglite-setup.js";

// initPgliteSchema guards a global promise shared by every PGlite-backed
// suite (see pglite-setup.ts). By the time this file runs, an earlier real
// suite has almost certainly already applied the schema for real, so these
// tests reach into that same global state to force a fresh init per test —
// and restore whatever was there before, so the real suites that run after
// this file are unaffected.
const globalLock = globalThis as unknown as {
  __sponsee_pglite_schema_applied?: boolean;
  __sponsee_pglite_schema_promise?: Promise<void> | null;
};

describe("initPgliteSchema", () => {
  let savedApplied: boolean | undefined;
  let savedPromise: Promise<void> | null | undefined;

  beforeEach(() => {
    if (!pgliteClient) throw new Error("PGlite client not available");
    savedApplied = globalLock.__sponsee_pglite_schema_applied;
    savedPromise = globalLock.__sponsee_pglite_schema_promise;
    globalLock.__sponsee_pglite_schema_applied = false;
    globalLock.__sponsee_pglite_schema_promise = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalLock.__sponsee_pglite_schema_applied = savedApplied;
    globalLock.__sponsee_pglite_schema_promise = savedPromise;
  });

  it("rejects with a clear, attributable error instead of hanging forever when exec never settles", async () => {
    vi.spyOn(pgliteClient!, "exec").mockImplementation(() => new Promise(() => {}));

    await expect(initPgliteSchema("SELECT 1;", 50)).rejects.toThrow(/exceeded 50ms/);
  });

  it("settles the shared promise once, so a second concurrent caller fails fast instead of queueing its own timeout", async () => {
    vi.spyOn(pgliteClient!, "exec").mockImplementation(() => new Promise(() => {}));

    const start = performance.now();
    const [first, second] = await Promise.allSettled([
      initPgliteSchema("SELECT 1;", 50),
      initPgliteSchema("SELECT 1;", 50),
    ]);
    const elapsed = performance.now() - start;

    expect(first.status).toBe("rejected");
    expect(second.status).toBe("rejected");
    // Both callers share one promise. If the second caller paid its own
    // separate 50ms timeout on top of the first's, this would still pass at
    // ~100ms — the real failure mode (an unbounded exec cascading a full
    // hookTimeout onto every dependent suite) only shows up at real scale,
    // but a wide margin here still catches a regression back to "await a
    // fresh promise per caller".
    expect(elapsed).toBeLessThan(200);
  });

  it("resolves normally and marks the schema applied when exec succeeds within budget", async () => {
    const execSpy = vi.spyOn(pgliteClient!, "exec").mockResolvedValue(undefined as never);

    await expect(initPgliteSchema("SELECT 1;", 5_000)).resolves.toBeUndefined();
    expect(execSpy).toHaveBeenCalledTimes(1);
    expect(globalLock.__sponsee_pglite_schema_applied).toBe(true);
  });
});
