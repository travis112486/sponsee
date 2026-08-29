import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

import { readJournal, type JournalEntry as JournalFileEntry } from "./journal.js";

// Ledger doctor for the failure mode found in SPO-72 / SPO-76.
//
// `drizzle-kit migrate` applies a journal entry only when its `when` is greater
// than the newest `created_at` in `drizzle.__drizzle_migrations`. It walks the
// journal in declaration order but never sorts it, so one entry dated ahead of
// its successors swallows every migration after it — while still printing
// "migrations applied successfully!".
//
// `migrations.test.ts` guards the *journal*. That guard is necessary but not
// sufficient: fixing the journal does not repair a database whose ledger
// already recorded the bad timestamp. This checks the *ledger* against the
// journal, which is the half that survives a correct journal.
//
// SPO-81 adds a second, disjoint comparison over the ledger's `hash` column.
// The two catch different things and neither subsumes the other:
//
//   positional `created_at`  a ledger ahead of the journal, so drizzle skips
//                            migrations while reporting success (SPO-72)
//   `hash`                   a .sql edited after it was applied, or a row
//                            applied from a journal this checkout does not have
//
// A hash-only doctor would call the SPO-72 case "migrations pending" — true,
// but silent about *why* drizzle is about to skip them, which is the diagnosis
// this tool exists to produce.

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsFolder = path.join(packageDir, "drizzle");

/**
 * `hash` is optional on both sides so the timestamp checks stay usable without
 * it: a caller that has not read the .sql files, or a ledger row predating the
 * column, simply skips the hash comparison rather than reporting a false edit.
 */
export type JournalEntry = JournalFileEntry & { hash?: string };
export type LedgerRow = { id: number; createdAt: number; hash?: string };

export type Problem = {
  title: string;
  detail: string;
  /** SQL that repairs this specific problem, when a repair is mechanical. */
  repair?: string;
};

export type Diagnosis = {
  applied: number;
  pending: JournalEntry[];
  problems: Problem[];
};

/**
 * Compare an applied-migration ledger against the journal that produced it.
 *
 * `rows` must be ordered by `id` ascending — the serial primary key is the
 * order drizzle applied them in, so row N corresponds to journal entry N.
 */
export function diagnose(
  entries: JournalEntry[],
  rows: LedgerRow[],
  { strict = false }: { strict?: boolean } = {},
): Diagnosis {
  const problems: Problem[] = [];

  const outOfOrder = entries.filter(
    (entry, i) => i > 0 && entry.when <= entries[i - 1].when,
  );
  if (outOfOrder.length > 0) {
    problems.push({
      title: "journal is out of order",
      detail:
        `${outOfOrder.map((e) => e.tag).join(", ")} — a \`when\` that is not ` +
        "greater than its predecessor's will be skipped on any database that " +
        "already has the predecessor applied. Fix _journal.json first; a " +
        "repaired ledger will be re-poisoned by the next migrate.",
    });
  }

  if (rows.length > entries.length) {
    problems.push({
      title: "ledger has more rows than the journal has entries",
      detail:
        `${rows.length} applied vs ${entries.length} in the journal — a ` +
        "migration was applied from a journal that no longer matches this " +
        "checkout. Resolve by hand; this is not mechanically repairable.",
    });
  }

  // ── hash checks ─────────────────────────────────────────────────────────
  //
  // drizzle keys applied migrations by the sha256 of the .sql it ran. Editing
  // an applied file leaves every timestamp in perfect order while the schema in
  // the repo stops describing the schema in the database, so nothing above can
  // see it.
  const journalHashes = new Set(entries.flatMap((e) => (e.hash ? [e.hash] : [])));
  const ledgerHashes = new Set(rows.flatMap((r) => (r.hash ? [r.hash] : [])));

  const modified: Array<{ id: number; tag: string; applied: string; onDisk: string }> = [];
  for (let i = 0; i < Math.min(rows.length, entries.length); i++) {
    const { hash: applied, id } = rows[i];
    const { hash: onDisk, tag } = entries[i];
    if (!applied || !onDisk || applied === onDisk) continue;

    // An in-place edit is the case that orphans *both* sides: the ledger holds
    // a hash for content that no longer exists on disk, and the file on disk
    // hashes to something no row ever applied. Reordered-but-intact migrations
    // find both hashes elsewhere in the other set, so they fall through to the
    // timestamp checks below instead of being misreported as an edit.
    if (!journalHashes.has(applied) && !ledgerHashes.has(onDisk)) {
      modified.push({ id, tag, applied, onDisk });
    }
  }

  if (modified.length > 0) {
    problems.push({
      title: "migration files were modified after they were applied",
      detail:
        modified
          .map(
            ({ id, tag, applied, onDisk }) =>
              `  ${tag}: ledger row ${id} applied ${short(applied)}, ` +
              `${tag}.sql now hashes to ${short(onDisk)}`,
          )
          .join("\n") +
        "\n\ndrizzle never re-runs a migration it has already recorded, so this " +
        "edit exists in the repo and in no database that ran the original. " +
        "Restore the file (`git checkout` the .sql) and ship the change as a " +
        "new migration; `db:generate` will not do it for you.",
    });
  }

  // Set membership, the same comparison `migrate.ts` makes on the deploy side:
  // a row whose hash matches no .sql in this journal ran from a journal this
  // checkout does not have. Rows already explained as an in-place edit are
  // excluded so the operator gets one diagnosis per row, not two.
  const modifiedIds = new Set(modified.map((m) => m.id));
  const foreign = rows.flatMap((row) =>
    row.hash && !journalHashes.has(row.hash) && !modifiedIds.has(row.id)
      ? [{ id: row.id, hash: row.hash, createdAt: row.createdAt }]
      : [],
  );

  if (foreign.length > 0) {
    problems.push({
      title: "ledger contains migrations that are not in this journal",
      detail:
        foreign
          .map(
            ({ id, hash, createdAt }) =>
              `  row ${id}: ${short(hash)}, applied ${iso(createdAt)}`,
          )
          .join("\n") +
        "\n\nNo .sql in drizzle/ hashes to these, so this database ran " +
        "migrations from a journal this checkout is missing — usually a branch " +
        "whose migrations were applied here and then abandoned. Point at the " +
        "right database, or rebase onto the branch that generated them; " +
        "applying this journal on top risks conflicting DDL.",
    });
  }

  // Row N must carry journal entry N's `when`. Any divergence means the ledger
  // no longer describes the journal, and drizzle's "is it applied?" comparison
  // is running against a timestamp nothing on disk agrees with.
  const mismatched: Array<{ row: LedgerRow; entry: JournalEntry }> = [];
  for (let i = 0; i < Math.min(rows.length, entries.length); i++) {
    if (rows[i].createdAt !== entries[i].when) {
      mismatched.push({ row: rows[i], entry: entries[i] });
    }
  }

  if (mismatched.length > 0) {
    problems.push({
      title: "ledger timestamps do not match the journal",
      detail: mismatched
        .map(
          ({ row, entry }) =>
            `  ${entry.tag}: ledger row ${row.id} has ${row.createdAt} ` +
            `(${iso(row.createdAt)}), journal says ${entry.when} (${iso(entry.when)})`,
        )
        .join("\n"),
      repair: mismatched
        .map(
          ({ row, entry }) =>
            `update drizzle.__drizzle_migrations set created_at = ${entry.when} ` +
            `where id = ${row.id}; -- ${entry.tag}`,
        )
        .join("\n"),
    });
  }

  // The headline symptom, called out separately because it is the one that
  // makes future `db:migrate` runs silently succeed while applying nothing.
  const maxApplied = rows.reduce((max, r) => Math.max(max, r.createdAt), 0);
  const maxJournal = entries.reduce((max, e) => Math.max(max, e.when), 0);
  if (rows.length > 0 && maxApplied > maxJournal) {
    problems.push({
      title: "ledger is ahead of the journal — migrations will silently no-op",
      detail:
        `newest applied \`created_at\` is ${maxApplied} (${iso(maxApplied)}), ` +
        `but the newest journal \`when\` is ${maxJournal} (${iso(maxJournal)}). ` +
        "Every migration in this journal now compares as already-applied. " +
        "`db:migrate` will report success and apply nothing.",
    });
  }

  // Unapplied entries split cleanly by timestamp: anything dated at or below
  // the newest applied migration is one drizzle will never come back for.
  // Position, not timestamp, decides what was applied — a mis-stamped row
  // (reported above) still ran its DDL.
  const unapplied = entries.filter((_, i) => i >= rows.length);
  const skipped = unapplied.filter((e) => e.when <= maxApplied);
  if (skipped.length > 0) {
    problems.push({
      title: "migrations were skipped, not applied",
      detail:
        `${skipped.map((e) => e.tag).join(", ")} — dated below the newest ` +
        "applied migration, so drizzle considers them done. Their DDL never ran.",
    });
  }

  const pending = unapplied.filter((e) => e.when > maxApplied);
  if (strict && pending.length > 0) {
    problems.push({
      title: "migrations are pending",
      detail: `${pending.map((e) => e.tag).join(", ")} — run \`pnpm -C packages/db db:migrate\`.`,
    });
  }

  return { applied: rows.length, pending, problems };
}

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/** Enough sha256 to compare two by eye; the full 64 chars are noise in a diff. */
function short(hash: string): string {
  return hash.slice(0, 12);
}

// ── runner ────────────────────────────────────────────────────────────────

/**
 * Minimal `.env` reader. Deliberately non-overriding: a real environment
 * variable (CI, Render) always wins over the file.
 */
function loadEnvFile(file: string): void {
  let contents: string;
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    return;
  }

  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    if (key in process.env) continue;

    let value = trimmed.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      (value[0] === '"' || value[0] === "'") &&
      value.at(-1) === value[0]
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function main(): Promise<void> {
  const strict = !process.argv.includes("--preflight");
  const label = strict ? "check" : "preflight";

  loadEnvFile(path.join(packageDir, ".env"));

  // Same precedence as drizzle.config.ts: migrations run on the direct
  // (non-pooled) connection, so the doctor must inspect that same database.
  const url =
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.DATABASE_URL ||
    "postgresql://localhost:5432/sponsee";

  // Hashes the .sql files as it reads the journal, so `diagnose` can compare
  // them against the ledger's own `hash` column.
  const entries = readJournal(migrationsFolder);

  const client = new Client({ connectionString: url });
  await client.connect();

  let rows: LedgerRow[] = [];
  try {
    const result = await client.query<{
      id: string;
      hash: string | null;
      created_at: string;
    }>(
      "select id, hash, created_at from drizzle.__drizzle_migrations order by id asc",
    );
    rows = result.rows.map((r) => ({
      id: Number(r.id),
      createdAt: Number(r.created_at),
      hash: r.hash ?? undefined,
    }));
  } catch (error) {
    // No ledger table yet — a fresh database. Nothing is applied, which is a
    // legitimate preflight state and a strict-mode failure ("all pending").
    if ((error as { code?: string }).code !== "42P01") throw error;
  } finally {
    await client.end();
  }

  const { applied, pending, problems } = diagnose(entries, rows, { strict });

  console.log(
    `db:doctor (${label}) — ${new URL(url).host}: ` +
      `${applied}/${entries.length} applied, ${pending.length} pending`,
  );

  if (problems.length === 0) {
    console.log("ledger agrees with the journal.");
    return;
  }

  console.error("\nPOISONED MIGRATION LEDGER\n");
  for (const problem of problems) {
    console.error(`- ${problem.title}`);
    console.error(`${problem.detail}\n`);
  }

  const repairs = problems.flatMap((p) => (p.repair ? [p.repair] : []));
  if (repairs.length > 0) {
    console.error("Repair, then re-run `db:migrate`:\n");
    console.error(repairs.join("\n"));
    console.error("");
  }

  process.exitCode = 1;
}

// Only run when invoked directly, so the test suite can import `diagnose`.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`db:doctor failed: ${(error as Error).message}`);
    process.exit(1);
  });
}
