// Shared PGlite schema initialization guard for DB-backed tests.
// PGlite WASM can crash when exec() is called concurrently on the same
// instance with large SQL, so we ensure the schema is only applied once
// per test process and serialise access with a global promise.

import { pgliteClient } from "@sponsee/db";

const globalLock = globalThis as unknown as {
  __sponsee_pglite_schema_applied?: boolean;
  __sponsee_pglite_schema_promise?: Promise<void> | null;
};

export async function initPgliteSchema(schemaSql: string) {
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
    await pgliteClient!.exec(schemaSql);
    globalLock.__sponsee_pglite_schema_applied = true;
  })();

  await globalLock.__sponsee_pglite_schema_promise;
}
