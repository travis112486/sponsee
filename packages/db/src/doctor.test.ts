import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { diagnose, type JournalEntry, type LedgerRow } from "./doctor.js";
import { hashMigrationSql, readJournal } from "./journal.js";
import { readJournal as readJournalFromMigrate } from "./migrate.js";

const drizzleDir = path.resolve(__dirname, "../drizzle");

// The real journal, so these cases stay anchored to the shipped migrations.
const journal = JSON.parse(
  readFileSync(path.join(drizzleDir, "meta/_journal.json"), "utf8"),
) as { entries: JournalEntry[] };

/** The same entries, with each `.sql` hashed the way the ledger records it. */
const planned = readJournal(drizzleDir);

/** A ledger that applied the first `n` journal entries correctly. */
function healthyLedger(n: number): LedgerRow[] {
  return journal.entries
    .slice(0, n)
    .map((entry, i) => ({ id: i + 1, createdAt: entry.when }));
}

/** The same, plus the `hash` column drizzle actually writes. */
function hashedLedger(n: number): LedgerRow[] {
  return planned
    .slice(0, n)
    .map((m, i) => ({ id: i + 1, createdAt: m.when, hash: m.hash }));
}

const POISON = 1788105600000; // 2026-08-30T16:00Z — the value 0002 shipped with

describe("diagnose", () => {
  it("passes on a fully migrated database", () => {
    const { problems, pending } = diagnose(
      journal.entries,
      healthyLedger(journal.entries.length),
      { strict: true },
    );

    expect(problems).toEqual([]);
    expect(pending).toEqual([]);
  });

  it("passes preflight on a fresh database", () => {
    expect(diagnose(journal.entries, []).problems).toEqual([]);
  });

  it("treats pending migrations as fine on preflight and fatal on strict", () => {
    const partial = healthyLedger(2);

    expect(diagnose(journal.entries, partial).problems).toEqual([]);
    expect(diagnose(journal.entries, partial, { strict: true }).problems).toContainEqual(
      expect.objectContaining({ title: "migrations are pending" }),
    );
  });

  // The SPO-76 case: a long-lived database that ran `db:migrate` between 8/27
  // and PR #4. 0002 recorded the future timestamp, 0003 and 0004 were skipped,
  // and the CLI reported success.
  describe("a ledger poisoned by the pre-PR#4 journal", () => {
    const poisoned: LedgerRow[] = [
      { id: 1, createdAt: journal.entries[0].when },
      { id: 2, createdAt: journal.entries[1].when },
      { id: 3, createdAt: POISON },
    ];

    it("fails, and names the silent no-op", () => {
      const { problems } = diagnose(journal.entries, poisoned);

      expect(problems.map((p) => p.title)).toContain(
        "ledger is ahead of the journal — migrations will silently no-op",
      );
    });

    it("reports 0003 and 0004 as skipped rather than pending", () => {
      const { pending, problems } = diagnose(journal.entries, poisoned);
      const skipped = problems.find(
        (p) => p.title === "migrations were skipped, not applied",
      )?.detail;

      expect(pending).toEqual([]);
      expect(skipped).toContain("0003_ordinary_fabian_cortez");
      expect(skipped).toContain("0004_oval_quasar");

      // 0002 carries the poisoned timestamp but its DDL did run. Listing it as
      // skipped would send an operator chasing a migration that already applied.
      expect(skipped).not.toContain("0002_sturdy_war_machine");
    });

    it("emits repair SQL that makes the ledger healthy again", () => {
      const { problems } = diagnose(journal.entries, poisoned);
      const repair = problems.find((p) => p.repair)?.repair;

      expect(repair).toContain(
        `set created_at = ${journal.entries[2].when} where id = 3`,
      );

      // Apply the repair the way an operator would, then confirm the only
      // remaining finding is the pending work `db:migrate` will now do for real.
      const repaired = poisoned.map((row) =>
        row.createdAt === POISON ? { ...row, createdAt: journal.entries[2].when } : row,
      );

      expect(diagnose(journal.entries, repaired).problems).toEqual([]);
      // Everything the 3-row ledger has not applied — derived from the journal
      // so that adding a migration does not fail this test for the wrong reason.
      expect(diagnose(journal.entries, repaired).pending.map((e) => e.tag)).toEqual(
        journal.entries.slice(poisoned.length).map((e) => e.tag),
      );
    });
  });

  it("flags an out-of-order journal as unfixable-by-repair", () => {
    const badJournal = journal.entries.map((entry, i) =>
      i === 2 ? { ...entry, when: POISON } : entry,
    );

    const { problems } = diagnose(badJournal, healthyLedger(2));

    expect(problems.map((p) => p.title)).toContain("journal is out of order");
  });

  it("flags a ledger with more rows than the journal has entries", () => {
    const { problems } = diagnose(journal.entries.slice(0, 2), healthyLedger(3));

    expect(problems.map((p) => p.title)).toContain(
      "ledger has more rows than the journal has entries",
    );
  });

  // SPO-81. The ledger's `hash` column catches a class of damage the positional
  // `created_at` comparison is blind to, and vice versa.
  describe("hash comparison", () => {
    it("passes when every ledger hash matches the file on disk", () => {
      const { problems } = diagnose(planned, hashedLedger(planned.length), {
        strict: true,
      });

      expect(problems).toEqual([]);
    });

    it("flags a .sql that was edited after it was applied", () => {
      // 0001 still occupies row 2 at exactly the right timestamp — only its
      // contents changed, which is the whole point of the check.
      const editedHash = hashMigrationSql("-- someone edited an applied migration\n");
      const entries = planned.map((m, i) => (i === 1 ? { ...m, hash: editedHash } : m));

      const { problems } = diagnose(entries, hashedLedger(planned.length));
      const modified = problems.find(
        (p) => p.title === "migration files were modified after they were applied",
      );

      expect(modified).toBeDefined();
      expect(modified?.detail).toContain(planned[1].tag);
      expect(modified?.detail).toContain(planned[1].hash.slice(0, 12));
      expect(modified?.detail).toContain(editedHash.slice(0, 12));

      // The timestamps are immaculate, so nothing else in the doctor sees this.
      expect(problems.map((p) => p.title)).toEqual([
        "migration files were modified after they were applied",
      ]);
    });

    it("does not report intact-but-transposed migrations as edited", () => {
      // Both hashes are still accounted for, just not where the doctor expects
      // them. That is an ordering question, not a content one — reporting it as
      // an edit would send an operator to `git checkout` a file that is fine.
      const rows = hashedLedger(planned.length);
      const swapped = rows.map((row, i) =>
        i === 0 ? { ...row, hash: rows[1].hash } : i === 1 ? { ...row, hash: rows[0].hash } : row,
      );

      const { problems } = diagnose(planned, swapped);

      expect(problems.map((p) => p.title)).not.toContain(
        "migration files were modified after they were applied",
      );
    });

    it("flags a ledger row that no migration in this journal hashes to", () => {
      const rows: LedgerRow[] = [
        ...hashedLedger(2),
        {
          id: 3,
          createdAt: planned[2].when,
          hash: hashMigrationSql("create table from_an_abandoned_branch ();"),
        },
      ];

      const { problems } = diagnose(planned.slice(0, 2), rows);

      expect(problems.map((p) => p.title)).toContain(
        "ledger contains migrations that are not in this journal",
      );
    });

    // The reason the hash check is additive rather than a replacement: on the
    // SPO-72 ledger every hash is correct — 0002's DDL really did run, it just
    // recorded a timestamp from the future. A hash-only doctor would report
    // "0003, 0004 pending" and say nothing about why migrate is skipping them.
    it("leaves the silent-no-op diagnosis to the timestamp checks", () => {
      const poisonedWithGoodHashes: LedgerRow[] = [
        { id: 1, createdAt: planned[0].when, hash: planned[0].hash },
        { id: 2, createdAt: planned[1].when, hash: planned[1].hash },
        { id: 3, createdAt: POISON, hash: planned[2].hash },
      ];

      const titles = diagnose(planned, poisonedWithGoodHashes).problems.map(
        (p) => p.title,
      );

      expect(titles).toContain(
        "ledger is ahead of the journal — migrations will silently no-op",
      );
      expect(titles).not.toContain(
        "migration files were modified after they were applied",
      );
      expect(titles).not.toContain(
        "ledger contains migrations that are not in this journal",
      );
    });

    // Two guards that hash the same file differently are worse than one.
    it("hashes migrations through the same function the deploy migrator uses", () => {
      expect(readJournalFromMigrate).toBe(readJournal);
    });
  });
});
