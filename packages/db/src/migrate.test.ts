import { mkdtempSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import {
  findUnappliedMigrations,
  isEntrypoint,
  readJournal,
  resolveConnectionString,
  resolveMigrationsFolder,
} from "./migrate.js";

// The end-to-end behaviour (real Postgres, real exit codes) lives in
// scripts/verify-deploy-migrator.mjs, which the db-check CI job runs. These
// cover the pure pieces that decide whether the deploy is allowed to proceed.

const drizzleDir = path.resolve(__dirname, "../drizzle");

describe("resolveConnectionString", () => {
  it("prefers the unpooled connection", () => {
    expect(
      resolveConnectionString({
        DATABASE_URL_UNPOOLED: "postgresql://u:p@direct.example.com/db",
        DATABASE_URL: "postgresql://u:p@pooled.example.com/db",
      }),
    ).toBe("postgresql://u:p@direct.example.com/db");
  });

  it("falls back to DATABASE_URL when it is not a pooled endpoint", () => {
    expect(
      resolveConnectionString({ DATABASE_URL: "postgresql://u:p@db.example.com/db" }),
    ).toBe("postgresql://u:p@db.example.com/db");
  });

  it("refuses a Neon pooled endpoint", () => {
    // PgBouncer in transaction mode cannot run drizzle's session-level work,
    // and a half-applied schema is worse than a blocked deploy.
    expect(() =>
      resolveConnectionString({
        DATABASE_URL: "postgresql://u:p@ep-x-1-pooler.us-east-2.aws.neon.tech/db",
      }),
    ).toThrow(/pooled connection/);
  });

  it("refuses to run with neither variable set", () => {
    expect(() => resolveConnectionString({})).toThrow(/DATABASE_URL_UNPOOLED/);
  });

  it("treats an empty string as unset rather than as a connection string", () => {
    expect(() =>
      resolveConnectionString({ DATABASE_URL_UNPOOLED: "  ", DATABASE_URL: "" }),
    ).toThrow(/DATABASE_URL_UNPOOLED/);
  });
});

describe("findUnappliedMigrations", () => {
  const planned = [
    { idx: 0, when: 1, tag: "0000_a", hash: "hash-a" },
    { idx: 1, when: 2, tag: "0001_b", hash: "hash-b" },
  ];

  it("returns nothing when every journal entry is in the ledger", () => {
    expect(
      findUnappliedMigrations(planned, [
        { hash: "hash-a", created_at: 1 },
        { hash: "hash-b", created_at: 2 },
      ]),
    ).toEqual([]);
  });

  it("flags entries drizzle skipped even though the ledger is non-empty", () => {
    // This is SPO-72 in miniature: the ledger's newest created_at is ahead of
    // 0001, so drizzle applies nothing and reports success.
    expect(
      findUnappliedMigrations(planned, [{ hash: "hash-a", created_at: 9_999_999 }]).map(
        (m) => m.tag,
      ),
    ).toEqual(["0001_b"]);
  });

  it("flags a migration whose file changed after it was applied", () => {
    expect(
      findUnappliedMigrations(planned, [
        { hash: "hash-a", created_at: 1 },
        { hash: "stale-hash-for-b", created_at: 2 },
      ]).map((m) => m.tag),
    ).toEqual(["0001_b"]);
  });
});

describe("readJournal", () => {
  it("hashes the real migration files the way drizzle records them", () => {
    const planned = readJournal(drizzleDir);

    expect(planned.length).toBeGreaterThan(0);
    for (const migration of planned) {
      expect(migration.hash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(new Set(planned.map((m) => m.hash)).size).toBe(planned.length);
  });
});

describe("resolveMigrationsFolder", () => {
  it("finds the folder from the compiled dist/ location", () => {
    expect(resolveMigrationsFolder(path.resolve(__dirname, "../dist"))).toBe(drizzleDir);
  });

  it("finds the folder from src/ (tsx and vitest run from here)", () => {
    expect(resolveMigrationsFolder(__dirname)).toBe(drizzleDir);
  });

  it("explains itself when the folder was pruned out of the image", () => {
    expect(() => resolveMigrationsFolder(mkdtempSync(path.join(tmpdir(), "no-drizzle-")))).toThrow(
      /pruned out of @sponsee\/db/,
    );
  });
});

describe("isEntrypoint", () => {
  // In the deployed image @sponsee/db is a pnpm symlink into .pnpm/, so
  // process.argv[1] and import.meta.url disagree unless both are realpath'd.
  // Getting this wrong made the migrator exit 0 without doing anything.
  it("matches through a symlink, the way pnpm lays the package out", () => {
    const root = mkdtempSync(path.join(tmpdir(), "entrypoint-"));
    const realDir = path.join(root, "store", "db", "dist");
    mkdirSync(realDir, { recursive: true });
    const realFile = path.join(realDir, "migrate.js");
    writeFileSync(realFile, "");

    const linkDir = path.join(root, "node_modules", "@sponsee");
    mkdirSync(linkDir, { recursive: true });
    symlinkSync(path.join(root, "store", "db"), path.join(linkDir, "db"), "dir");
    const linkedFile = path.join(linkDir, "db", "dist", "migrate.js");

    expect(isEntrypoint(linkedFile, pathToFileURL(realFile).href)).toBe(true);
  });

  it("does not fire when the module is merely imported", () => {
    expect(isEntrypoint("/usr/bin/some-other-script.js", import.meta.url)).toBe(false);
    expect(isEntrypoint(undefined, import.meta.url)).toBe(false);
  });
});
