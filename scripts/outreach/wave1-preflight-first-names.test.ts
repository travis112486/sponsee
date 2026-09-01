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
    contacts = [{ id: "c1", email: "craft@example.com", unsubscribed: false, first_name: null }];
    const roster = [
      { id: "craft", name: "Craft Computing", firstName: null, email: "craft@example.com" },
    ];

    const withoutFlag = await runPreflight(roster);
    expect(withoutFlag.code).toBe(0);

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
