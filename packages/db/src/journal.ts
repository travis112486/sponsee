/**
 * The migration journal, read the way drizzle reads it.
 *
 * Two independent guards check the applied-migration ledger, and neither can
 * reach the other's entrypoint:
 *
 *   - `doctor.ts` brackets `drizzle-kit migrate` locally and in CI.
 *   - `migrate.ts` is the Render pre-deploy command, running from `dist/` in an
 *     image where `drizzle-kit` has been pruned out by `pnpm deploy --prod`.
 *
 * Both compare on-disk migrations against `drizzle.__drizzle_migrations.hash`,
 * so both derive that hash here. A second `createHash` call somewhere else is
 * how the two guards would quietly start disagreeing about what "the hash of a
 * migration" is, and a guard that disagrees with the ledger is worse than no
 * guard — it fails on healthy databases until someone stops trusting it.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type JournalEntry = {
  idx: number;
  when: number;
  tag: string;
};

/** A journal entry paired with the sha256 drizzle records for it. */
export type PlannedMigration = JournalEntry & { hash: string };

type Journal = {
  entries: JournalEntry[];
};

/**
 * sha256 of the whole .sql file, taken before it is split on statement
 * breakpoints — the value drizzle writes to the ledger's `hash` column. Kept in
 * sync with `drizzle-orm/migrator.js#readMigrationFiles`.
 */
export function hashMigrationSql(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

/**
 * Read `meta/_journal.json` and hash every `.sql` it declares.
 *
 * Throws if a declared migration file is missing. That is deliberate: a journal
 * pointing at a file that is not there is not a state either caller can report
 * on usefully, and both of them are gates that should fail closed.
 */
export function readJournal(migrationsFolder: string): PlannedMigration[] {
  const journalPath = join(migrationsFolder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;

  return journal.entries.map((entry) => {
    const sqlPath = join(migrationsFolder, `${entry.tag}.sql`);
    return {
      ...entry,
      hash: hashMigrationSql(readFileSync(sqlPath, "utf8")),
    };
  });
}
