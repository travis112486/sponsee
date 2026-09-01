import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// SPO-287: the gate used to fail OPEN on a mistyped `--ledger` path.
// `readLedger` returned `[]` for a file that did not exist and nothing in the
// output named the ledger, so the run was indistinguishable from "nobody opted
// out". QA's repro: same roster, same audience, the same real ledger on disk —
// only the path differed, and the T2 run that should have blocked printed
// `SEND Ada Stream` and exit 0. Ada had replied to T1.
//
// Spawned rather than imported, like its sibling `wave1-preflight.test.ts`:
// `main()` runs at import time, so the exit code is the only surface, and the
// exit code is also the thing the runbook tells send day to read. These cases
// live in their own file because they are about argument handling and the
// render header, not about the Resend read contract the sibling varies.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const CLI = path.join(HERE, "wave1-preflight.mjs");
const SHARED_DIST = path.join(REPO_ROOT, "packages", "shared", "dist", "wave1-suppression.js");

const CLEAR = 0;
const BLOCKED = 1;
const USAGE_OR_ENV = 2;

const AUDIENCE_ID = "aud_stub_ledger";

/** Both roster rows, both subscribed in Resend. Ada is the one the ledger pulls. */
const CONTACTS = [
  { id: "ctc_ada", email: "ada@example.com", unsubscribed: false, first_name: "Ada" },
  { id: "ctc_bo", email: "bo@example.com", unsubscribed: false, first_name: "Bo" },
];

const ROSTER = [
  { id: "ada", name: "Ada Stream", firstName: "Ada", email: "ada@example.com", xHandle: "@adastream" },
  { id: "bo", name: "Bo Live", firstName: "Bo", email: "bo@example.com", xHandle: "@bolive" },
];

/** Ada replied to T1. This is the signal a wrong `--ledger` path silently dropped. */
const LEDGER_LINE = JSON.stringify({
  at: "2026-09-23T09:00:00Z",
  reason: "replied",
  email: "ada@example.com",
  note: "replied to T1",
});

let server: Server;
let baseUrl: string;
let contactRequests = 0;
let tmpDir: string;
let rosterPath: string;
let ledgerPath: string;
let emptyLedgerPath: string;

/** The typo. Never created — `wave1-ledger.jsonl` is the real one. */
const missingLedger = () => path.join(tmpDir, "ledger.jsonl");

beforeAll(async () => {
  // Without dist the CLI exits 2 on "not built", which is the same status the
  // ledger guard uses — every assertion below would pass for the wrong reason.
  // Fail rather than skip: CI builds packages before `pnpm test`, so an unbuilt
  // dist means the harness changed, not that this suite is unrunnable.
  if (!existsSync(SHARED_DIST)) {
    throw new Error(
      `${SHARED_DIST} is missing — the CLI loads its rules from there and exits 2 without it.\n` +
        `Run: pnpm --filter @sponsee/shared build`,
    );
  }

  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    res.setHeader("content-type", "application/json");
    if (url.pathname === "/audiences") {
      res.end(JSON.stringify({ data: [{ id: AUDIENCE_ID, name: "stub-audience" }] }));
      return;
    }
    if (url.pathname === `/audiences/${AUDIENCE_ID}/contacts`) {
      contactRequests++;
      res.end(JSON.stringify({ data: CONTACTS, has_more: false }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ message: `stub has no route for ${url.pathname}` }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  tmpDir = mkdtempSync(path.join(os.tmpdir(), "spo287-"));
  rosterPath = path.join(tmpDir, "roster.json");
  ledgerPath = path.join(tmpDir, "wave1-ledger.jsonl");
  emptyLedgerPath = path.join(tmpDir, "empty-ledger.jsonl");
  writeFileSync(rosterPath, `${JSON.stringify(ROSTER, null, 2)}\n`);
  writeFileSync(ledgerPath, `# Wave 1 suppression ledger\n${LEDGER_LINE}\n`);
  writeFileSync(emptyLedgerPath, "# no suppressions yet\n");
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

// Async `spawn`, never `spawnSync`. The stub server runs on this process's event
// loop, and spawnSync blocks it — the child's fetch is then refused and every
// case that reaches the network fails with "fetch failed", which reads as a
// gate decision rather than a harness fault.
async function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      // Set deliberately. Exit 2 is shared by usage, environment and ledger
      // errors, so an absent key would make every exit-2 assertion here vacuous.
      RESEND_API_KEY: "re_stub_key_not_a_real_credential",
      WAVE1_PREFLIGHT_RESEND_API_BASE: baseUrl,
    },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (c) => (stdout += String(c)));
  child.stderr.on("data", (c) => (stderr += String(c)));
  const code = await new Promise<number>((resolve) => child.on("close", (c) => resolve(c ?? -1)));
  return { code, stdout, stderr };
}

const t2 = (ledger: string, ...extra: string[]) => [
  "--roster", rosterPath,
  "--ledger", ledger,
  "--audience", AUDIENCE_ID,
  "--touch", "T2",
  "--channel", "email",
  ...extra,
];

describe("wave1-preflight: a --ledger path that does not exist (SPO-287)", () => {
  // Positive control. If this stops blocking, the test below still passes while
  // proving nothing — the correct path would no longer be catching anything either.
  it("blocks T2 when the real ledger suppresses someone Resend still has subscribed", async () => {
    const { code, stdout, stderr } = await run(t2(ledgerPath));

    expect(stdout).toContain("SUPPRESS");
    expect(stdout).toContain("replied (ledger)");
    expect(stderr).toContain("BLOCKED — do not send T2");
    expect(code).toBe(BLOCKED);
  });

  it("is refused rather than read as zero suppressions", async () => {
    const before = contactRequests;
    const { code, stdout, stderr } = await run(t2(missingLedger()));

    expect(code).toBe(USAGE_OR_ENV);
    // The defect itself: this run must not reach either of the two outputs the
    // old code produced for the same inputs one character apart.
    expect(stdout).not.toContain("Clear to send");
    expect(stdout).not.toContain("SEND ");
    // A typo is only obvious next to the absolute path the gate looked in.
    expect(stderr).toContain("ledger file not found");
    expect(stderr).toContain(missingLedger());
    // Refused before the live read, so no `--apply-suppressions` write could
    // have gone out on the way to this exit either.
    expect(contactRequests).toBe(before);
  });

  it("is not escapable with --allow-missing-ledger on T2", async () => {
    const { code, stderr } = await run(t2(missingLedger(), "--allow-missing-ledger"));

    expect(code).toBe(USAGE_OR_ENV);
    expect(stderr).toContain("only accepted with --touch T1");
  });

  it("is allowed on T1 behind the explicit flag, and the header says the file was missing", async () => {
    const { code, stdout } = await run([
      "--roster", rosterPath,
      "--ledger", missingLedger(),
      "--audience", AUDIENCE_ID,
      "--touch", "T1",
      "--channel", "email",
      "--allow-missing-ledger",
    ]);

    expect(stdout).toContain(`ledger: ${missingLedger()} (MISSING — allowed by --allow-missing-ledger)`);
    expect(stdout).toContain("Clear to send T1 on email to 2 recipient(s)");
    expect(code).toBe(CLEAR);
  });
});

describe("wave1-preflight: the render header names what was read (SPO-287)", () => {
  // The second half of the fix. Requiring the file to exist closes the mistyped
  // path; printing the count is what makes the next variant — right path, wrong
  // or truncated contents — visible without another code change.
  it("prints the ledger path and a zero count for an empty ledger", async () => {
    const { code, stdout } = await run(t2(emptyLedgerPath));

    expect(stdout).toContain(`ledger: ${emptyLedgerPath} (0 entries)`);
    expect(stdout).toContain(`roster: ${rosterPath} (2 rows)`);
    expect(code).toBe(CLEAR);
  });

  it("counts parsed entries, not lines — comments and blanks do not inflate it", async () => {
    const { stdout } = await run(t2(ledgerPath));

    // The file is a comment line plus one entry.
    expect(stdout).toContain(`ledger: ${ledgerPath} (1 entry)`);
  });

  it("records the same paths and counts in the --json audit record", async () => {
    const jsonPath = path.join(tmpDir, "audit.json");
    await run(t2(emptyLedgerPath, "--json", jsonPath));

    const audit = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(audit.sources.ledger).toMatchObject({
      path: emptyLedgerPath,
      resolvedPath: emptyLedgerPath,
      entries: 0,
      missing: false,
    });
    expect(audit.sources.roster).toMatchObject({ path: rosterPath, rows: 2 });
  });
});
