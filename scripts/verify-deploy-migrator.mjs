#!/usr/bin/env node
/**
 * Integration check for the Render pre-deploy migrator (SPO-74).
 *
 * The unit tests in packages/db/src/migrate.test.ts cover the pure helpers.
 * This exercises the real thing against a real Postgres, because the two
 * properties that matter are both about process exit codes:
 *
 *   1. a clean database ends up fully migrated, and re-running is a no-op
 *   2. a database drizzle would silently skip fails LOUDLY (exit 1)
 *
 * (2) is the SPO-72 failure mode. drizzle decides what to apply from
 * `max(created_at)` in its ledger alone, so a single row dated ahead of the
 * remaining journal entries makes every one of them a no-op while the CLI
 * still prints "migrations applied successfully!". Render only aborts a deploy
 * on a non-zero exit, so "prints a warning" would not be enough here.
 *
 * Usage: DATABASE_URL=postgres://... node scripts/verify-deploy-migrator.mjs
 * Requires `pnpm --filter @sponsee/db build` first.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import pg from "pg";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrator = resolve(repoRoot, "packages/db/dist/migrate.js");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required (a throwaway Postgres this script may wipe).");
  process.exit(1);
}

// This script drops and recreates every schema in the target database. That is
// fine for the CI service container and a local throwaway, and catastrophic
// anywhere else, so refuse non-local hosts unless the caller is explicit.
const targetHost = new URL(databaseUrl).hostname;
const isLocal = ["localhost", "127.0.0.1", "::1"].includes(targetHost);
if (!isLocal && process.env.ALLOW_DESTRUCTIVE_MIGRATOR_CHECK !== "1") {
  console.error(
    `Refusing to run against '${targetHost}': this script wipes the target database.\n` +
      `Point DATABASE_URL at a throwaway Postgres, or set ALLOW_DESTRUCTIVE_MIGRATOR_CHECK=1 ` +
      `if you are certain the target is disposable.`,
  );
  process.exit(1);
}

/** Far enough ahead that no real journal entry can exceed it. */
const FUTURE_MILLIS = 4_102_444_800_000; // 2100-01-01

let failures = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`);
  }
}

function runMigrator() {
  const result = spawnSync(process.execPath, [migrator], {
    env: { ...process.env, DATABASE_URL_UNPOOLED: databaseUrl, DATABASE_URL: databaseUrl },
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/**
 * Reset by dropping schemas rather than the database, so this runs against
 * anything that speaks the wire protocol — the CI Postgres service, a local
 * throwaway, or a PGlite socket — without needing createdb rights.
 */
async function resetDatabase() {
  await withClient(async (client) => {
    await client.query('drop schema if exists "drizzle" cascade');
    await client.query('drop schema if exists "public" cascade');
    await client.query('create schema "public"');
  });
}

async function withClient(fn) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function queryOne(sql) {
  return withClient(async (client) => (await client.query(sql)).rows[0]);
}

const journalCount = JSON.parse(
  readFileSync(resolve(repoRoot, "packages/db/drizzle/meta/_journal.json"), "utf8"),
).entries.length;

console.log("1. clean database migrates to completion");
await resetDatabase();
{
  const first = runMigrator();
  check("exits 0", first.status === 0, first.output);

  const ledger = await queryOne(
    'select count(*)::int as n from drizzle."__drizzle_migrations"',
  );
  check(
    `ledger holds all ${journalCount} journal entries`,
    ledger?.n === journalCount,
    `ledger has ${ledger?.n}`,
  );

  const deals = await queryOne("select to_regclass('public.deals') is not null as present");
  check("schema is actually there (public.deals exists)", deals?.present === true);
}

console.log("2. re-running is a no-op");
{
  const second = runMigrator();
  check("exits 0", second.status === 0, second.output);
  check(
    "reports the database is already up to date",
    second.output.includes("already up to date"),
    second.output,
  );
}

console.log("3. a silently-skipped migration fails the deploy (SPO-72 regression)");
await resetDatabase();
{
  // Reproduce the shape of the SPO-72 database: a ledger whose newest
  // created_at is ahead of every journal entry, so drizzle applies nothing and
  // still reports success.
  await withClient(async (client) => {
    await client.query('create schema if not exists "drizzle"');
    await client.query(
      'create table if not exists drizzle."__drizzle_migrations" (id serial primary key, hash text not null, created_at bigint)',
    );
    await client.query(
      'insert into drizzle."__drizzle_migrations" ("hash", "created_at") values ($1, $2)',
      ["not-a-real-migration-hash", FUTURE_MILLIS],
    );
  });

  const result = runMigrator();
  check("exits non-zero", result.status !== 0, `exit=${result.status}\n${result.output}`);
  check("names the unapplied migrations", result.output.includes("still unapplied"), result.output);
  check(
    "blames the journal ordering rather than something generic",
    result.output.includes("meta/_journal.json"),
    result.output,
  );

  await resetDatabase();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll deploy-migrator checks passed.");
