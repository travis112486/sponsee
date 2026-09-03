import { defineConfig } from "drizzle-kit";

// Extensionless on purpose. drizzle-kit loads this file through esbuild-register
// in CJS mode, where the NodeNext-style `.js` specifier the rest of the package
// uses does not resolve ("Cannot find module './src/production-guard.js'").
// tsconfig.json only includes `src/**/*`, so this file is not typechecked and
// the inconsistency costs nothing.
import { assertNotProductionDatabase } from "./src/production-guard";

// Migrations must use the direct (non-pooled) connection: Neon's pooled
// endpoint (-pooler) runs PgBouncer in transaction mode, which breaks
// drizzle-kit's session-level operations.
const url =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.DATABASE_URL ||
  "postgresql://localhost:5432/sponsee";

// SPO-382. Every drizzle-kit subcommand loads this file, so one call here
// covers db:migrate, db:push, db:generate and db:studio. Production migrations
// do not come through drizzle-kit — Render runs `dist/migrate.js` as its
// pre-deploy command — so nothing production depends on can trip this.
assertNotProductionDatabase(url, "drizzle-kit");

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
});
