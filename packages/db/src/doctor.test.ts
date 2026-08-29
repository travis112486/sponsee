import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { diagnose, type JournalEntry, type LedgerRow } from "./doctor.js";

// The real journal, so these cases stay anchored to the shipped migrations.
const journal = JSON.parse(
  readFileSync(
    path.join(path.resolve(__dirname, "../drizzle"), "meta/_journal.json"),
    "utf8",
  ),
) as { entries: JournalEntry[] };

/** A ledger that applied the first `n` journal entries correctly. */
function healthyLedger(n: number): LedgerRow[] {
  return journal.entries
    .slice(0, n)
    .map((entry, i) => ({ id: i + 1, createdAt: entry.when }));
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
      expect(diagnose(journal.entries, repaired).pending.map((e) => e.tag)).toEqual([
        "0003_ordinary_fabian_cortez",
        "0004_oval_quasar",
      ]);
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
});
