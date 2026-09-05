/**
 * Deployment migrator (SPO-74).
 *
 * Runs as the Render **Pre-Deploy Command** so a schema change reaches the
 * database before the new instance takes traffic. Render aborts the deploy on
 * a non-zero exit, so anything this file throws blocks the rollout and leaves
 * the previous version serving.
 *
 * Why programmatic instead of `drizzle-kit migrate`: `drizzle-kit` is a
 * devDependency and `apps/api/Dockerfile` ends with `pnpm deploy --prod`,
 * which prunes dev dependencies. `drizzle-orm` is a prod dependency, so the
 * programmatic migrator survives the prune and the pre-deploy command stays a
 * plain `node node_modules/@sponsee/db/dist/migrate.js`.
 *
 * This is deliberately noisier than the CLI. SPO-72 was a migration that was
 * silently skipped while the CLI printed "migrations applied successfully!",
 * so `assertJournalFullyApplied` re-reads the ledger afterwards and fails if
 * any journal entry is missing from it. Skipping is not a success here.
 */
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

import { readJournal, type PlannedMigration } from "./journal.js";

// Re-exported so this file stays the whole contract for the deploy entrypoint;
// `doctor.ts` imports the same function from `./journal.js` (SPO-81).
export { readJournal, type PlannedMigration };

/**
 * Serializes concurrent migrators (two deploys triggered close together).
 * Arbitrary constant; only needs to be stable and unique to this codebase.
 */
const ADVISORY_LOCK_KEY = 8_675_309_074n;
const LOCK_TIMEOUT_MS = 60_000;
const LOCK_POLL_MS = 2_000;

/** Mirrors drizzle's own defaults in `pg-core/dialect.ts`. */
const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";

type AppliedMigration = { hash: string; created_at: string | number | null };

/**
 * The compiled entrypoint lives at `dist/migrate.js`, so the sibling `drizzle/`
 * folder is one level up. `packages/db/package.json` lists `drizzle` in `files`
 * to keep it present after `pnpm deploy --prod`, and `apps/api/Dockerfile`
 * asserts it survived — but resolve defensively anyway, since a missing folder
 * here would otherwise surface as a confusing drizzle-internal error.
 */
export function resolveMigrationsFolder(fromDir: string): string {
  const candidates = [
    resolve(fromDir, "../drizzle"), // dist/migrate.js  -> packages/db/drizzle
    resolve(fromDir, "../../drizzle"), // src/migrate.ts (tsx) -> packages/db/drizzle
  ];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, "meta", "_journal.json"))) {
      return candidate;
    }
  }

  throw new Error(
    `Could not locate the drizzle migrations folder from ${fromDir}. ` +
      `Looked for meta/_journal.json in: ${candidates.join(", ")}. ` +
      `If this is a deployed image, the 'drizzle' directory was pruned out of @sponsee/db.`,
  );
}

/**
 * Migrations must run over the direct connection. Neon's pooled endpoint is
 * PgBouncer in transaction mode, which breaks the session-level operations a
 * migration performs (and drizzle wraps the whole run in one transaction).
 * Failing here is deliberate: a deploy blocked by a clear misconfiguration is
 * better than a half-applied schema.
 */
export function resolveConnectionString(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const unpooled = env.DATABASE_URL_UNPOOLED?.trim();
  const pooled = env.DATABASE_URL?.trim();
  const url = unpooled || pooled;

  if (!url) {
    throw new Error(
      "Neither DATABASE_URL_UNPOOLED nor DATABASE_URL is set. The migrator needs " +
        "the direct (non-pooled) connection string for the target database.",
    );
  }

  if (isPooledEndpoint(url)) {
    throw new Error(
      `Refusing to migrate over a pooled connection (host contains '-pooler'). ` +
        `Set DATABASE_URL_UNPOOLED on this service to Neon's direct endpoint — ` +
        `the pooled endpoint is PgBouncer in transaction mode and cannot run migrations reliably.`,
    );
  }

  return url;
}

/** `host/database`, never the credentials. */
export function describeTarget(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return "<unparseable connection string>";
  }
}

function isPooledEndpoint(url: string): boolean {
  try {
    return new URL(url).hostname.includes("-pooler");
  } catch {
    // Not a parseable URL — let pg produce the connection error instead.
    return false;
  }
}

/**
 * The post-condition that makes this worth building. drizzle decides what to
 * apply from `max(created_at)` alone, so one journal entry with a `when` ahead
 * of the others makes every later migration a silent no-op (SPO-72). Comparing
 * the ledger against the full journal catches that class of failure regardless
 * of why it happened.
 */
export function findUnappliedMigrations(
  planned: PlannedMigration[],
  applied: AppliedMigration[],
): PlannedMigration[] {
  const appliedHashes = new Set(applied.map((row) => row.hash));
  return planned.filter((migration) => !appliedHashes.has(migration.hash));
}

/**
 * Advisory locks are session-scoped, so this has to be the same connection that
 * runs the migration — which is why the whole migrator uses a single Client
 * rather than a Pool.
 */
async function acquireAdvisoryLock(client: Client): Promise<() => Promise<void>> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  for (;;) {
    const result = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1) as locked",
      [ADVISORY_LOCK_KEY.toString()],
    );

    if (result.rows[0]?.locked) {
      return async () => {
        await client.query("select pg_advisory_unlock($1)", [
          ADVISORY_LOCK_KEY.toString(),
        ]);
      };
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${LOCK_TIMEOUT_MS}ms waiting for the migration advisory lock. ` +
          `Another migrator is probably still running — check for a concurrent deploy.`,
      );
    }

    await new Promise((r) => setTimeout(r, LOCK_POLL_MS));
  }
}

async function readLedger(client: Client): Promise<AppliedMigration[]> {
  const exists = await client.query<{ present: boolean }>(
    "select to_regclass($1) is not null as present",
    [`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`],
  );

  if (!exists.rows[0]?.present) {
    return [];
  }

  const rows = await client.query<AppliedMigration>(
    `select hash, created_at from "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`,
  );
  return rows.rows;
}

export async function runMigrations(): Promise<void> {
  const migrationsFolder = resolveMigrationsFolder(
    dirname(fileURLToPath(import.meta.url)),
  );
  const planned = readJournal(migrationsFolder);
  const connectionString = resolveConnectionString();

  console.log(`[migrate] migrations folder: ${migrationsFolder}`);
  // Which database this ran against is the one fact the log was missing, and
  // it is the fact you need to reconstruct after the event whether a migration
  // reached prod through this deploy or through someone's laptop (SPO-382).
  // Host and database only — the connection string carries a password.
  console.log(`[migrate] target: ${describeTarget(connectionString)}`);
  console.log(`[migrate] ${planned.length} migration(s) in the journal`);

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const releaseLock = await acquireAdvisoryLock(client);
    try {
      const before = await readLedger(client);
      const pending = findUnappliedMigrations(planned, before);

      if (pending.length === 0) {
        console.log("[migrate] database is already up to date");
        return;
      }

      console.log(
        `[migrate] applying ${pending.length}: ${pending.map((m) => m.tag).join(", ")}`,
      );

      await migrate(drizzle(client), { migrationsFolder });

      const after = await readLedger(client);
      assertJournalFullyApplied(planned, after);

      console.log(`[migrate] applied ${after.length - before.length} migration(s)`);
    } finally {
      await releaseLock();
    }
  } finally {
    await client.end();
  }
}

function assertJournalFullyApplied(
  planned: PlannedMigration[],
  applied: AppliedMigration[],
): void {
  const missing = findUnappliedMigrations(planned, applied);
  if (missing.length === 0) {
    return;
  }

  const latest = applied.reduce(
    (max, row) => Math.max(max, Number(row.created_at ?? 0)),
    0,
  );

  throw new Error(
    `Migration run finished but ${missing.length} journal entr${missing.length === 1 ? "y is" : "ies are"} ` +
      `still unapplied: ${missing.map((m) => m.tag).join(", ")}.\n` +
      `drizzle only applies entries whose 'when' is greater than the newest 'created_at' in ` +
      `${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} (currently ${latest}), so an out-of-order 'when' in ` +
      `meta/_journal.json silently skips everything after it. Compare the journal against the ledger ` +
      `before retrying — see docs/staging-deploy.md §6.`,
  );
}

/**
 * Both sides must be realpath'd. In the deployed image `@sponsee/db` is a pnpm
 * symlink into `.pnpm/`, so `process.argv[1]` is the symlinked path while node
 * resolves `import.meta.url` to the real one — comparing them raw made this
 * whole file a silent no-op that still exited 0.
 */
export function isEntrypoint(argv1: string | undefined, moduleUrl: string): boolean {
  if (argv1 === undefined) return false;
  try {
    return realpathSync(resolve(argv1)) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (isEntrypoint(process.argv[1], import.meta.url)) {
  runMigrations()
    .then(() => {
      console.log("[migrate] ok");
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error("[migrate] FAILED — blocking this deploy");
      console.error(error);
      process.exit(1);
    });
}
