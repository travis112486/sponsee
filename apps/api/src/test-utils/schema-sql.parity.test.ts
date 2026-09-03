import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

import { SCHEMA_SQL } from "./schema-sql.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const drizzleDir = path.resolve(__dirname, "../../../../packages/db/drizzle");

/**
 * Same rationale as migration.smoke.test.ts: this boots two fresh WASM
 * Postgres instances (one replaying the whole migration journal), which is an
 * order of magnitude slower than a unit test.
 */
const COLD_PGLITE_BOOT_TIMEOUT_MS = 60_000;

type JournalEntry = { idx: number; when: number; tag: string };

/**
 * Replays the real migration journal into `client` — the same path the
 * Render pre-deploy migrator (packages/db/src/migrate.ts) and
 * migration.smoke.test.ts exercise. This is deliberately independent of
 * SCHEMA_SQL: the whole point is comparing what the journal produces against
 * what the hand-maintained fixture claims to produce.
 */
async function applyRealMigrations(client: PGlite): Promise<void> {
  const journal = JSON.parse(
    readFileSync(path.join(drizzleDir, "meta/_journal.json"), "utf8"),
  ) as { entries: JournalEntry[] };

  for (const entry of journal.entries) {
    const migrationSql = readFileSync(
      path.join(drizzleDir, `${entry.tag}.sql`),
      "utf-8",
    );
    const statements = migrationSql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      await client.exec(stmt);
    }
  }
}

type ColumnRow = {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
};

async function readColumns(client: PGlite): Promise<ColumnRow[]> {
  const res = await client.query<ColumnRow>(`
    SELECT table_name, column_name, data_type, udt_name, is_nullable
      FROM information_schema.columns
     WHERE table_schema = 'public'
     ORDER BY table_name, column_name
  `);
  return res.rows;
}

async function readEnumTypeNames(client: PGlite): Promise<Set<string>> {
  const res = await client.query<{ typname: string }>(`
    SELECT DISTINCT t.typname
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
  `);
  return new Set(res.rows.map((r) => r.typname));
}

/** Arrays report udt_name with a leading underscore, e.g. "_platform" for platform[]. */
function isEnumColumn(row: ColumnRow, enumTypeNames: Set<string>): boolean {
  const baseType =
    row.data_type === "ARRAY" ? row.udt_name.replace(/^_/, "") : row.udt_name;
  return enumTypeNames.has(baseType);
}

async function readTables(client: PGlite): Promise<string[]> {
  const res = await client.query<{ table_name: string }>(`
    SELECT table_name
      FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name
  `);
  return res.rows.map((r) => r.table_name);
}

type IndexRow = { table_name: string; columns: string; is_unique: boolean };

/**
 * Grouped by (table, ordered column list, uniqueness) rather than by index
 * name. Names diverge harmlessly — a table-level UNIQUE(...) constraint gets
 * an auto-generated Postgres name where the Drizzle schema declares a named
 * uniqueIndex() for the same columns — and comparing names would flag that
 * noise as drift. Uniqueness on a given column set is the thing that actually
 * matters: it is exactly what SPO-115 changed on contracts_deal_idx and what
 * SPO-150 (this test) exists to guard.
 */
async function readIndexes(client: PGlite): Promise<IndexRow[]> {
  const res = await client.query<{
    table_name: string;
    columns: string[];
    is_unique: boolean;
  }>(`
    SELECT
      t.relname AS table_name,
      array_agg(a.attname ORDER BY k.ord) AS columns,
      ix.indisunique AS is_unique
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
    WHERE n.nspname = 'public'
    GROUP BY t.relname, i.relname, ix.indisunique
    ORDER BY t.relname, columns
  `);
  return res.rows.map((r) => ({
    table_name: r.table_name,
    columns: r.columns.join(","),
    is_unique: r.is_unique,
  }));
}

/**
 * schema-sql.ts mirrors packages/db/src/schema/index.ts by hand, and enum
 * columns are the one deliberate, known divergence: PGlite fixtures across
 * this repo declare enum columns as VARCHAR instead of creating the pg_enum
 * type (see migration.smoke.test.ts's comments on `subscription_status` /
 * `sync_status`). Every entry here must be a real enum column in the Drizzle
 * schema — the "only allowlists real enum columns" test below enforces that,
 * so this list can't silently grow into a way to hide an unrelated type bug.
 */
const ENUM_COLUMN_ALLOWLIST = new Set([
  "activity_events.kind",
  "brand_icon_cache.outcome",
  "chase_events.status",
  "contracts.status",
  "creator_files.scope",
  "creator_platforms.platform",
  "creator_platforms.sync_status",
  "creators.plan",
  "creators.subscription_status",
  "deals.payment_terms",
  "deals.platforms",
  "deals.stage",
  "deals.type",
  "deliverables.platform",
  "deliverables.status",
  "invoice_chase_state.mode",
  "invoice_deliveries.status",
  "invoices.status",
  "invoices.terms",
  "proofs.kind",
]);

function columnKey(row: ColumnRow): string {
  return `${row.table_name}.${row.column_name}`;
}

function diffTables(real: string[], fixture: string[]): string[] {
  const realSet = new Set(real);
  const fixtureSet = new Set(fixture);
  const problems: string[] = [];

  for (const table of realSet) {
    if (!fixtureSet.has(table)) {
      problems.push(`table "${table}": in the real schema, missing from schema-sql.ts`);
    }
  }
  for (const table of fixtureSet) {
    if (!realSet.has(table)) {
      problems.push(`table "${table}": in schema-sql.ts, missing from the real schema`);
    }
  }
  return problems;
}

function diffColumns(
  real: ColumnRow[],
  fixture: ColumnRow[],
  enumAllowlist: Set<string>,
): string[] {
  const realByKey = new Map(real.map((row) => [columnKey(row), row]));
  const fixtureByKey = new Map(fixture.map((row) => [columnKey(row), row]));
  const problems: string[] = [];

  for (const [key, realRow] of realByKey) {
    const fixtureRow = fixtureByKey.get(key);
    if (!fixtureRow) {
      problems.push(`column "${key}": in the real schema, missing from schema-sql.ts`);
      continue;
    }

    if (realRow.is_nullable !== fixtureRow.is_nullable) {
      problems.push(
        `column "${key}": nullability mismatch (real=${realRow.is_nullable}, schema-sql.ts=${fixtureRow.is_nullable})`,
      );
    }

    if (!enumAllowlist.has(key)) {
      const realType = `${realRow.data_type}/${realRow.udt_name}`;
      const fixtureType = `${fixtureRow.data_type}/${fixtureRow.udt_name}`;
      if (realType !== fixtureType) {
        problems.push(
          `column "${key}": type mismatch (real=${realType}, schema-sql.ts=${fixtureType})`,
        );
      }
    }
  }

  for (const key of fixtureByKey.keys()) {
    if (!realByKey.has(key)) {
      problems.push(`column "${key}": in schema-sql.ts, missing from the real schema`);
    }
  }

  return problems;
}

function indexKey(row: IndexRow): string {
  return `${row.table_name}(${row.columns}) unique=${row.is_unique}`;
}

function diffIndexes(real: IndexRow[], fixture: IndexRow[]): string[] {
  const realSet = new Set(real.map(indexKey));
  const fixtureSet = new Set(fixture.map(indexKey));
  const problems: string[] = [];

  for (const key of realSet) {
    if (!fixtureSet.has(key)) {
      problems.push(`index ${key}: in the real schema, missing from schema-sql.ts`);
    }
  }
  for (const key of fixtureSet) {
    if (!realSet.has(key)) {
      problems.push(`index ${key}: in schema-sql.ts, missing from the real schema`);
    }
  }
  return problems;
}

/**
 * Parity guard for the shared PGlite fixture (SPO-150).
 *
 * SPO-116 centralized every API suite's PGlite schema into one hand-copied
 * SQL string, but nothing failed when that copy drifted from
 * packages/db/src/schema/index.ts. The near-miss that prompted this test:
 * SPO-115 changed contracts_deal_idx from a plain index to a UNIQUE index and
 * made contract.upsert's onConflictDoUpdate target it; the schema-sql.ts
 * extraction almost shipped with the old plain index, which would have made
 * every upsert test in contract.test.ts pass for the wrong reason (no
 * constraint to conflict on) while every real onConflictDoUpdate that reached
 * a real database silently inserted duplicates instead of updating.
 *
 * This compares two independently-built PGlite catalogs — one from the real
 * migration journal, one from SCHEMA_SQL — so a divergence in tables,
 * columns, types, nullability, or index uniqueness fails loudly instead of
 * both the fixture and the tests being wrong together.
 */
describe("schema-sql.ts parity with the real Drizzle schema", () => {
  let real: PGlite;
  let fixture: PGlite;

  beforeAll(async () => {
    real = new PGlite();
    await applyRealMigrations(real);

    fixture = new PGlite();
    await fixture.exec(SCHEMA_SQL);
  }, COLD_PGLITE_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await real?.close();
    await fixture?.close();
  });

  it("declares the same tables", async () => {
    const problems = diffTables(await readTables(real), await readTables(fixture));
    expect(problems).toEqual([]);
  });

  it("declares the same columns, types, and nullability (enum-as-varchar allowed)", async () => {
    const problems = diffColumns(
      await readColumns(real),
      await readColumns(fixture),
      ENUM_COLUMN_ALLOWLIST,
    );
    expect(problems).toEqual([]);
  });

  it("declares the same indexes, including uniqueness", async () => {
    const problems = diffIndexes(await readIndexes(real), await readIndexes(fixture));
    expect(problems).toEqual([]);
  });

  it("only allowlists columns that are actually enums in the real schema", async () => {
    const columns = await readColumns(real);
    const enumTypeNames = await readEnumTypeNames(real);
    const byKey = new Map(columns.map((row) => [columnKey(row), row]));

    for (const key of ENUM_COLUMN_ALLOWLIST) {
      const row = byKey.get(key);
      expect(row, `"${key}" is allowlisted but does not exist in the real schema`).toBeDefined();
      expect(
        isEnumColumn(row!, enumTypeNames),
        `"${key}" is allowlisted as an enum-vs-varchar divergence, but its real type is ` +
          `${row!.data_type}/${row!.udt_name}, not an enum (or enum array) — the allowlist entry is stale`,
      ).toBe(true);
    }
  });
});
