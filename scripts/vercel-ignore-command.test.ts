import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// SPO-225: the root vercel.json `ignoreCommand` decides whether the `sponsee`
// (apps/web) Vercel project builds a commit. Vercel reads it as: exit 0 = skip
// the build, exit 1 = build. Any OTHER exit status is not a decision — it fails
// the deployment outright with a red `Vercel` check.
//
// The original command was a bare `git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD`.
// After a force-push (every rebase of every PR) that variable points at the old
// head, which no longer exists in Vercel's clone, so git exits 128 —
// `fatal: bad object d841587...` — and the deploy dies before it starts. That is
// what the red Vercel check on PR #69 was. A check that goes red for a boring
// reason is a check people learn to ignore, which is roughly how #69's missing
// CI went unnoticed for five hours.
//
// The fix resolves the base commit first and falls back to "build" when it is
// unknown. This suite pins the exit status for each branch against real git
// repositories rather than string-matching the command, because the thing that
// matters is what git actually returns.
//
// The command must stay POSIX sh-clean: Vercel's build container shell is not
// contractually bash, so a bashism would pass here and fail at deploy time —
// the same "green locally, red there" gap this suite exists to close. Hence
// `/bin/sh` below rather than the developer's shell.

const SKIP = 0;
const BUILD = 1;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ignoreCommand = (
  JSON.parse(readFileSync(path.join(repoRoot, "vercel.json"), "utf8")) as { ignoreCommand: string }
).ignoreCommand;

let fixture: string;

// The fixture must not inherit the developer's git config: a global
// `commit.gpgsign` or `core.hooksPath` would break the throwaway commits and
// error the suite out for reasons unrelated to the command under test.
const ISOLATED_GIT_ENV = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...ISOLATED_GIT_ENV,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  }).trim();
}

function commit(cwd: string, file: string, contents: string, message: string): string {
  const full = path.join(cwd, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, contents);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

/** Runs the real ignoreCommand the way Vercel does and returns its exit status. */
function runIgnoreCommand(cwd: string, previousSha: string | undefined): number {
  // Annotated: spreading `process.env` into an object literal loses its index
  // signature, so the `delete`/assign below would not typecheck otherwise.
  const env: NodeJS.ProcessEnv = { ...process.env, ...ISOLATED_GIT_ENV };
  if (previousSha === undefined) delete env.VERCEL_GIT_PREVIOUS_SHA;
  else env.VERCEL_GIT_PREVIOUS_SHA = previousSha;

  const result = spawnSync(ignoreCommand, { cwd, env, shell: "/bin/sh", stdio: "ignore" });
  return result.status ?? -1;
}

/**
 * apps/web at c1 -> c2, then an apps/api-only c3. HEAD is c3, so diffing from
 * c2 touches nothing on the watch list (skip) and diffing from c1 touches
 * apps/web (build).
 */
function buildFixture(): { dir: string; c1: string; c2: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "spo225-ignorecmd-"));
  git(dir, "init", "-q", "-b", "main", ".");
  writeFileSync(path.join(dir, "package.json"), "{}\n");
  const c1 = commit(dir, "apps/web/app.tsx", "v1", "c1");
  const c2 = commit(dir, "apps/web/app.tsx", "v2", "c2 (web)");
  commit(dir, "apps/api/server.ts", "v2", "c3 (api only)");
  return { dir, c1, c2 };
}

describe("root vercel.json ignoreCommand", () => {
  let dir: string;
  let c1: string;
  let c2: string;

  beforeAll(() => {
    ({ dir, c1, c2 } = buildFixture());
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("skips the build when no watched path changed", () => {
    expect(runIgnoreCommand(dir, c2)).toBe(SKIP);
  });

  it("builds when apps/web changed", () => {
    expect(runIgnoreCommand(dir, c1)).toBe(BUILD);
  });

  it("builds when the base sha is unresolvable, instead of failing the deploy", () => {
    // The force-push case: VERCEL_GIT_PREVIOUS_SHA points at a commit that was
    // rewritten away and is not in Vercel's clone. Before SPO-225 this exited
    // 128 and Vercel reported `status ● Error`.
    const status = runIgnoreCommand(dir, "d84158772760d0ebed4e7340ef5bd07fdfd0bce6");

    expect(status, "an unknown base commit must mean 'build', not a failed deployment").toBe(BUILD);
  });

  it("builds when VERCEL_GIT_PREVIOUS_SHA is unset and there is no parent commit", () => {
    // Depth-1 clone analogue: the `HEAD^1` fallback is itself unresolvable.
    const shallow = mkdtempSync(path.join(tmpdir(), "spo225-shallow-"));
    try {
      git(shallow, "init", "-q", "-b", "main", ".");
      commit(shallow, "apps/web/app.tsx", "v1", "root");

      expect(runIgnoreCommand(shallow, undefined)).toBe(BUILD);
    } finally {
      rmSync(shallow, { recursive: true, force: true });
    }
  });

  it("falls back to HEAD^1 when VERCEL_GIT_PREVIOUS_SHA is unset", () => {
    expect(runIgnoreCommand(dir, undefined)).toBe(SKIP);
  });

  it("never exits with a status Vercel treats as an error", () => {
    // Vercel only understands 0 and 1 here. Anything else is a failed deploy,
    // so every branch above must land in this set — including the ones that
    // exist to handle git failing.
    const statuses = [
      runIgnoreCommand(dir, c1),
      runIgnoreCommand(dir, c2),
      runIgnoreCommand(dir, undefined),
      runIgnoreCommand(dir, "d84158772760d0ebed4e7340ef5bd07fdfd0bce6"),
      runIgnoreCommand(dir, "not-a-sha-at-all"),
      runIgnoreCommand(dir, ""),
    ];

    expect(statuses.filter((s) => s !== SKIP && s !== BUILD)).toEqual([]);
  });
});
