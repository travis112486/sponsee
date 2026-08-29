import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Guards the drizzle migration ledger against the failure mode found in SPO-72.
//
// `drizzle-kit migrate` applies an entry only when its journal `when` is greater
// than the newest `created_at` already in `__drizzle_migrations`. It walks the
// journal in order but never sorts it, so a single entry with a `when` ahead of
// its successors silently swallows every migration after it: the CLI reports
// "migrations applied successfully" and applies nothing. A fresh database is
// immune (there is no prior row to compare against), so CI cannot catch this —
// only a long-lived database like staging is affected, and only in silence.

const drizzleDir = path.resolve(__dirname, "../drizzle");

type JournalEntry = { idx: number; when: number; tag: string };

const journal = JSON.parse(
  readFileSync(path.join(drizzleDir, "meta/_journal.json"), "utf8"),
) as { entries: JournalEntry[] };

describe("drizzle migration journal", () => {
  it("has strictly increasing `when` timestamps", () => {
    const outOfOrder = journal.entries.filter(
      (entry, i) => i > 0 && entry.when <= journal.entries[i - 1].when,
    );

    expect(
      outOfOrder.map((e) => e.tag),
      "a migration whose `when` is not greater than its predecessor's will be " +
        "skipped on any database that already has the predecessor applied",
    ).toEqual([]);
  });

  it("keeps `idx` aligned with journal order", () => {
    expect(journal.entries.map((e) => e.idx)).toEqual(
      journal.entries.map((_, i) => i),
    );
  });

  it("has no `when` in the future", () => {
    const future = journal.entries.filter((e) => e.when > Date.now());

    expect(
      future.map((e) => e.tag),
      "a future-dated migration swallows every migration generated before that date",
    ).toEqual([]);
  });

  it("matches the .sql files on disk one-for-one", () => {
    const onDisk = readdirSync(drizzleDir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.replace(/\.sql$/, ""))
      .sort();

    expect(journal.entries.map((e) => e.tag).sort()).toEqual(onDisk);
  });
});
