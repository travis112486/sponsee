import { drizzle } from "drizzle-orm/node-postgres";
import { drizzle as pgliteDrizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import * as schema from "./schema/index.js";

export let pgliteClient: PGlite | null = null;

function createDb() {
  if (process.env.DATABASE_URL) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
    return drizzle(pool, { schema });
  }

  // PGlite fallback for local development and staging without Postgres.
  // On Vercel (and other read-only filesystems), the data dir path is
  // unusable — fall back to in-memory mode. Data will not persist across
  // cold starts; this is acceptable for staging smoke tests.
  const isReadOnlyFs =
    process.env.VERCEL === "1" || process.env.AWS_LAMBDA_FUNCTION_NAME;

  if (isReadOnlyFs) {
    pgliteClient = new PGlite();
    return pgliteDrizzle(pgliteClient, { schema });
  }

  // Use absolute path so it works regardless of cwd
  const dataDir = new URL("../.pglite-data", import.meta.url).pathname;
  pgliteClient = new PGlite(dataDir);
  return pgliteDrizzle(pgliteClient, { schema });
}

export const db = createDb();
export type DB = typeof db;
export { schema };
