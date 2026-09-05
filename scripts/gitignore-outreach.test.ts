import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// SPO-415 / SPO-417 / SPO-431: the root `.gitignore` is the only thing standing
// between the Wave 1 roster — 16 named real creators, their business emails, and
// a ledger of who asked us to stop — and a PUBLIC repo. `refs/pull/*` is
// permanent, so a single accidental `git add` is not retractable.
//
// SPO-417 shipped the rule as `outreach/*.json` + `outreach/*.jsonl`. That is
// filename-shaped: `*` does not cross `/`, and it names two extensions. A
// `.csv`, a `.md` census (the actual #141 vector), or anything under
// `outreach/wave2/` all sailed straight through. SPO-431 replaced it with a
// deny-by-default allowlist.
//
// This suite exists because the rule is one line of config that reads as
// interchangeable with several near-miss forms that silently do nothing:
//
//   - `outreach/` instead of `outreach/**` stops git descending into the
//     directory at all, so `!outreach/*.example.*` never fires and the tracked
//     fixtures are dropped — a *louder* failure, but still a wrong rule.
//   - reverting to an extension list re-opens the census hole.
//   - dropping the unanchored `wave1-roster.json` / `wave1-ledger.jsonl` lines
//     leaves the same two files trackable in `scripts/outreach/`, next to the
//     script that reads them.
//
// A comment cannot enforce any of that, so these assert real `git` behaviour
// against the real `.gitignore`, in a throwaway repo.
//
// Both directions are asserted deliberately. A rule that ignored *everything*
// would pass the first list; only the second catches it. And `check-ignore -q`
// rather than `-v`: `-v` exits 0 whenever any pattern matches, INCLUDING a
// negation, so it reports identically for an ignored file and a re-included one.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gitignore = readFileSync(path.join(repoRoot, ".gitignore"), "utf8");

// Don't inherit the developer's git config: a global `core.excludesFile` would
// let a personal ignore file supply a rule this repo does not actually ship,
// turning a red into a green on one machine only.
const ISOLATED_GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

// Paths that must never become trackable. Each is a real shape the Wave 1 data
// has taken or would plausibly take.
const MUST_IGNORE = [
  "outreach/wave1-roster.json", // the original PII roster
  "outreach/wave1-ledger.jsonl", // the original opt-out ledger
  "outreach/wave2/roster.json", // a future wave in a subdirectory
  "outreach/wave1-roster.csv", // same data, exported
  "outreach/census.md", // the #141 vector: a markdown census
  "outreach/wave1-roster.txt",
  "outreach/notes/2026-09/census.md", // deeper nesting
  "outreach/wave1-roster.json.bak", // editor leftovers
  "scripts/outreach/wave1-roster.json", // beside the script that reads it
  "scripts/outreach/wave1-ledger.jsonl",
  "wave1-roster.json", // dropped at the repo root
];

// The fixtures are the schema of record and MUST stay tracked, and the code in
// scripts/outreach/ must not be swept up by the directory-shaped rule.
const MUST_TRACK = [
  "outreach/wave1-roster.example.json",
  "outreach/wave1-ledger.example.jsonl",
  "scripts/outreach/README.md",
  "scripts/outreach/wave1-preflight.mjs",
  "scripts/outreach/wave1-preflight.test.ts",
];

let fixture: string;

function git(args: string[]) {
  return spawnSync("git", args, { cwd: fixture, env: ISOLATED_GIT_ENV, encoding: "utf8" });
}

function isIgnored(p: string) {
  return git(["check-ignore", "-q", p]).status === 0;
}

/** Ground truth: the set of paths `git add -A` would actually stage. `-n` is a dry run. */
function wouldStage(): Set<string> {
  const out = git(["add", "-An", "."]).stdout ?? "";
  return new Set(
    out
      .split("\n")
      .filter((l) => l.startsWith("add '") && l.endsWith("'"))
      .map((l) => l.slice(5, -1)),
  );
}

beforeAll(() => {
  fixture = mkdtempSync(path.join(tmpdir(), "spo431-gitignore-"));
  execFileSync("git", ["init", "-q"], { cwd: fixture, env: ISOLATED_GIT_ENV });
  // The rule under test is the repo's real file, copied verbatim.
  writeFileSync(path.join(fixture, ".gitignore"), gitignore);
  for (const p of [...MUST_IGNORE, ...MUST_TRACK]) {
    const full = path.join(fixture, p);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, "fixture\n");
  }
});

afterAll(() => {
  if (fixture) rmSync(fixture, { recursive: true, force: true });
});

describe("root .gitignore — Wave 1 outreach data (SPO-431)", () => {
  it.each(MUST_IGNORE)("ignores %s", (p) => {
    expect(isIgnored(p)).toBe(true);
  });

  it.each(MUST_TRACK)("leaves %s trackable", (p) => {
    expect(isIgnored(p)).toBe(false);
  });

  it("stages every fixture and no PII-shaped path, per `git add -An`", () => {
    const staged = wouldStage();
    // The ignore predicate and the thing git actually does are separate
    // questions; this is the one that decides what lands in a commit.
    expect([...MUST_IGNORE].filter((p) => staged.has(p))).toEqual([]);
    expect([...MUST_TRACK].filter((p) => !staged.has(p))).toEqual([]);
  });

  it("keeps the deny-by-default shape rather than an extension list", () => {
    // Pins the two edits the comment block warns about. `outreach/` without the
    // `**` would stop git descending and silently drop the fixtures; an
    // extension list is what let the #141 census through.
    expect(gitignore).toMatch(/^outreach\/\*\*$/m);
    expect(gitignore).toMatch(/^!outreach\/\*\.example\.\*$/m);
    expect(gitignore).not.toMatch(/^outreach\/\*\.jsonl?$/m);
  });
});
