// Shared PGlite schema initialization guard for DB-backed tests.
// PGlite WASM can crash when exec() is called concurrently on the same
// instance with large SQL, so we ensure the schema is only applied once
// per test process and serialise access with a global promise.

import { pgliteClient } from "@sponsee/db";

const globalLock = globalThis as unknown as {
  __sponsee_pglite_schema_applied?: boolean;
  __sponsee_pglite_schema_promise?: Promise<void> | null;
};

// Every PGlite-backed suite shares this one promise (see the module comment
// above). Without a bound of our own, a schema init that genuinely never
// settles leaves that shared promise pending forever — and because
// fileParallelism/maxWorkers force suites to run one at a time, every
// dependent suite after the first would independently burn its own full
// vitest hookTimeout awaiting the same promise before reporting a skip,
// turning one stuck exec into N slow, misleadingly-labelled failures. Firing
// this first settles the promise once with a clear, attributable message, so
// every later suite fails fast on the same rejection instead of queueing its
// own timeout. See SPO-242.
//
// Set below the 60s hookTimeout in scripts/vitest-api.config.ts and
// apps/api/vitest.config.ts so our message — not vitest's generic "Hook
// timed out" — is what actually fires.
const SCHEMA_INIT_TIMEOUT_MS = 55_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function initPgliteSchema(schemaSql: string, timeoutMs = SCHEMA_INIT_TIMEOUT_MS) {
  if (!pgliteClient) {
    throw new Error("PGlite client not available");
  }

  if (globalLock.__sponsee_pglite_schema_applied) {
    return;
  }

  if (globalLock.__sponsee_pglite_schema_promise) {
    await globalLock.__sponsee_pglite_schema_promise;
    return;
  }

  globalLock.__sponsee_pglite_schema_promise = (async () => {
    await withTimeout(
      pgliteClient!.exec(schemaSql),
      timeoutMs,
      `PGlite schema init exceeded ${timeoutMs}ms`,
    );
    globalLock.__sponsee_pglite_schema_applied = true;
  })();

  await globalLock.__sponsee_pglite_schema_promise;
}
