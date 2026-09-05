// End-to-end exit-code tests for the Wave 1 preflight CLI (SPO-288).
//
// wave1-suppression.test.ts covers the decision rules by calling them directly.
// That is not the same claim as "the gate stops the send": send day reads this
// script's EXIT CODE, and every step between the rules and that exit — argument
// parsing, the Resend contact mapping (`first_name` -> `firstName`), which plan
// the blockers are computed from — is code a unit test never executes.
//
// SPO-288's repro was stated against the CLI ("`--require-first-names` with a
// contact whose `first_name` is null -> exit 0, `Clear to send`"), so it is
// verified against the CLI, through a stub Resend on WAVE1_PREFLIGHT_RESEND_API_BASE.
//
// Requires `packages/shared/dist` — the script imports the built rules and
// refuses to run without them. CI's `test` job builds every package first; run
// `pnpm --filter @sponsee/shared build` locally.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "wave1-preflight.mjs");

const AUDIENCE_ID = "aud_wave1";

interface StubContact {
  id: string;
  email: string;
  unsubscribed: boolean;
  first_name: string | null;
}

/** Contacts the next CLI run will see. Reassigned per test. */
let contacts: StubContact[] = [];
let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? "";
    res.setHeader("content-type", "application/json");
    if (url === "/audiences") {
      res.end(JSON.stringify({ data: [{ id: AUDIENCE_ID, name: "wave-1-outreach" }] }));
      return;
    }
    if (url.startsWith(`/audiences/${AUDIENCE_ID}/contacts`)) {
      res.end(JSON.stringify({ data: contacts, has_more: false }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: `stub has no route for ${url}` }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("stub server has no port");
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

interface RosterRowFixture {
  id: string;
  name: string;
  firstName: string | null;
  email: string | null;
  xHandle?: string | null;
}

async function runPreflight(
  roster: RosterRowFixture[],
  extraArgs: string[] = [],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "wave1-preflight-"));
  try {
    const rosterPath = path.join(dir, "roster.json");
    const ledgerPath = path.join(dir, "ledger.jsonl");
    await writeFile(rosterPath, JSON.stringify(roster));
    await writeFile(ledgerPath, "");

    const child = spawn(
      process.execPath,
      [
        CLI,
        "--roster", rosterPath,
        "--ledger", ledgerPath,
        "--audience", "wave-1-outreach",
        "--touch", "T1",
        "--channel", "email",
        ...extraArgs,
        // Pairs with WAVE1_PREFLIGHT_RESEND_API_BASE below; the CLI exits 2
        // against a stub without it.
        "--allow-test-endpoint",
      ],
      { env: { ...process.env, RESEND_API_KEY: "re_stub", WAVE1_PREFLIGHT_RESEND_API_BASE: base } },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    const code = await new Promise<number>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (c) => resolve(c ?? -1));
    });
    // Exit 2 is "usage or environment error" — almost always an unbuilt
    // @sponsee/shared. Surface it rather than letting it read as a gate result.
    if (code === 2) throw new Error(`preflight exited 2 (environment):\n${stderr}${stdout}`);
    return { code, stdout, stderr };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("wave1-preflight --require-first-names", () => {
  it("exits 1 on a contact with no first_name — the SPO-288 repro", async () => {
    // Roster null / contact null. The two agree, so there is no drift, and the
    // predicate this replaced cleared the send: exit 0, "Clear to send", and the
    // recipient reads "Hey there —".
    contacts = [{ id: "c1", email: "tundrabyte@example.com", unsubscribed: false, first_name: null }];
    const roster = [
      { id: "tundrabyte", name: "TundraByte", firstName: null, email: "tundrabyte@example.com" },
    ];

    const withoutFlag = await runPreflight(roster);
    expect(withoutFlag.code).toBe(0);
    // Exit 0 is only half of what "off by default" means. The other half — that
    // the run still names who falls back — is what SPO-292 turned into the
    // acceptance evidence, and is pinned by the last test in this file.
    expect(withoutFlag.stdout).toContain('No first_name on the contact (1)');

    const withFlag = await runPreflight(roster, ["--require-first-names"]);
    expect(withFlag.code).toBe(1);
    expect(withFlag.stdout).toContain("the Resend contact has no first_name");
    expect(withFlag.stderr).toContain("BLOCKED");
  });

  it("exits 1 when we hold a name the contact lacks", async () => {
    contacts = [{ id: "c1", email: "ada@example.com", unsubscribed: false, first_name: null }];
    const roster = [{ id: "ada", name: "Ada Stream", firstName: "Ada", email: "ada@example.com" }];

    const result = await runPreflight(roster, ["--require-first-names"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('The roster has "Ada" — push it to the contact');
  });

  it("marks that same row in the drift section, which used to say it did not block", async () => {
    // Roster named / contact unnamed lands in missingFirstName AND firstNameDrift,
    // but not firstNameConflict. It blocks — and it printed unmarked in the drift
    // section under a footer reading "only the CONFLICT rows block", which reads
    // on send day as "ignore this row". Fails safe (the run still blocks); it
    // misdirects the triage.
    contacts = [{ id: "c1", email: "ada@example.com", unsubscribed: false, first_name: null }];
    const roster = [{ id: "ada", name: "Ada Stream", firstName: "Ada", email: "ada@example.com" }];

    const result = await runPreflight(roster, ["--require-first-names"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("First-name drift (1)");
    // The row carries the reason it blocks, on the row itself.
    expect(result.stdout).toMatch(/ada@example\.com.*NO CONTACT NAME/);
    // And the footer no longer claims CONFLICT is the only blocking mark.
    expect(result.stdout).toContain("the CONFLICT and NO CONTACT NAME rows block");
    expect(result.stdout).not.toContain("only the CONFLICT rows block");
  });

  it("leaves the genuinely non-blocking drift row unmarked", async () => {
    // Positive control for the mark above: contact named / roster unnamed drifts,
    // greets correctly, and does not block — so it must stay unmarked, or the new
    // label is just painted on every drift row and says nothing.
    contacts = [{ id: "c1", email: "jeff@example.com", unsubscribed: false, first_name: "Jeff" }];
    const roster = [{ id: "jeff", name: "Jeff Stream", firstName: null, email: "jeff@example.com" }];

    const result = await runPreflight(roster, ["--require-first-names"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("First-name drift (1)");
    // Assert on the ROW, not the whole stream — the footer names both marks, so
    // a stream-wide `not.toContain` would pass for the wrong reason.
    const row = result.stdout.split("\n").find((l) => l.includes("jeff@example.com  roster="));
    expect(row).toBeDefined();
    expect(row).not.toContain("NO CONTACT NAME");
    expect(row).not.toContain("CONFLICT");
  });

  it("exits 0 on a contact name the roster does not carry — the over-fire", async () => {
    // Drifts, but Resend greets them "Hey Jeff —", which is correct. The old
    // blocker failed this row and quoted the correct greeting as the defect.
    contacts = [{ id: "c1", email: "jeff@example.com", unsubscribed: false, first_name: "Jeff" }];
    const roster = [{ id: "jeff", name: "Jeff Stream", firstName: null, email: "jeff@example.com" }];

    const result = await runPreflight(roster, ["--require-first-names"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Clear to send");
    // Still reported — it is a warning, not a silence.
    expect(result.stdout).toContain("First-name drift (1)");
  });

  it("exits 0 when every contact carries its name", async () => {
    contacts = [{ id: "c1", email: "ada@example.com", unsubscribed: false, first_name: "Ada" }];
    const roster = [{ id: "ada", name: "Ada Stream", firstName: "Ada", email: "ada@example.com" }];

    const result = await runPreflight(roster, ["--require-first-names"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Clear to send");
  });
});

describe("wave1-preflight fallback census, flag off (SPO-292)", () => {
  // SPO-292 accepted the "Hey there —" fallback for four Wave 1 contacts with
  // no first_name: SPO-269 has no confirmed name for them, so none is coming.
  // The SPO-280 acceptance check therefore runs WITHOUT --require-first-names,
  // and the operator confirms the split from this run's own output.
  //
  // That makes the default-path report load-bearing, and exit 0 does not pin
  // it. Move the `missingFirstName` block under `if (args.requireFirstNames)`
  // and every other test in this file still passes: the flag-off run keeps
  // exiting 0 and printing "Clear to send", while silently reporting nothing
  // about the recipients the acceptance check exists to count. Then a green
  // preflight is equally consistent with 4 of 15 on the fallback and 15 of 15.
  it("names and counts every fallback recipient without the flag", async () => {
    const nameless = ["pixelforge", "novaquokka", "gravelgospel", "kettlecrash"];
    const named = [
      { id: "ada", first: "Ada" },
      { id: "jeff", first: "Jeff" },
    ];
    contacts = [
      ...nameless.map((id) => ({
        id: `c_${id}`,
        email: `${id}@example.com`,
        unsubscribed: false,
        first_name: null,
      })),
      ...named.map((n) => ({
        id: `c_${n.id}`,
        email: `${n.id}@example.com`,
        unsubscribed: false,
        first_name: n.first,
      })),
    ];
    const roster = [
      ...nameless.map((id) => ({
        id,
        name: id,
        firstName: null,
        email: `${id}@example.com`,
      })),
      ...named.map((n) => ({
        id: n.id,
        name: `${n.first} Stream`,
        firstName: n.first,
        email: `${n.id}@example.com`,
      })),
    ];

    const result = await runPreflight(roster);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Clear to send");

    // A real count, not a hardcoded 1: four of the six recipients fall back.
    expect(result.stdout).toContain('No first_name on the contact (4) — these render v5\'s "Hey there —" fallback');
    expect(result.stdout).toContain("(warning only — pass --require-first-names to make this block)");

    // Scope the membership assertions to that block. Every address on the
    // roster shows up elsewhere in stdout on its own SEND line, so a bare
    // `toContain(email)` would pass against a block that never rendered.
    const header = result.stdout.indexOf("No first_name on the contact (");
    const census = result.stdout.slice(header, result.stdout.indexOf("(warning only", header));
    for (const id of nameless) {
      expect(census).toContain(`${id}@example.com`);
      // The roster has no name for them either, so there is nothing to sync —
      // which is precisely why SPO-292 accepted the fallback instead.
      expect(census).toContain("no confirmed name on either side");
    }
    for (const n of named) expect(census).not.toContain(`${n.id}@example.com`);

    // And the point of SPO-288: drift sees none of this. Both sides agree on
    // null for all four, so the predicate this replaced prints nothing at all.
    expect(result.stdout).not.toContain("First-name drift");
  });
});
