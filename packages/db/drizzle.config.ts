import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Migrations must use the direct (non-pooled) connection: Neon's pooled
    // endpoint (-pooler) runs PgBouncer in transaction mode, which breaks
    // drizzle-kit's session-level operations.
    url:
      process.env.DATABASE_URL_UNPOOLED ||
      process.env.DATABASE_URL ||
      "postgresql://localhost:5432/sponsee",
  },
});
