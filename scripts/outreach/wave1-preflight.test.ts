// SPO-289: the two hardening guards on wave1-preflight.mjs, exercised through
// the real CLI.
//
// Spawned, not imported, and deliberately so. `main()` runs at import time, so
// there is no exported surface to unit-test — and the SPO-270 review already
// found one defect (F1) that a unit test hand-supplying inputs reported as
// covered while the CLI could not reach the path at all. These tests assert on
// the process's EXIT CODE and streams, which is what the send-day operator
// actually sees, and they run against a stub Resend server so the pagination
// contract can be varied on demand. Nothing here touches api.resend.com.

import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const CLI = path.join(REPO_ROOT, "scripts", "outreach", "wave1-preflight.mjs");
const SHARED_DIST = path.join(REPO_ROOT, "packages", "shared", "dist", "wave1-suppression.js");

const AUDIENCE_ID = "aud_stub_wave1";

/** What the stub answers for the next GET /audiences/:id/contacts page. */
type ContactPage = { data: unknown[]; has_more?: boolean };

let server: Server;
let baseUrl: string;
let pages: ContactPage[] = [];
let contactRequests: string[] = [];
let tmpDir: string;

function contact(i: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `ctc_${i}`,
    email: `stray${i}@example.com`,
    unsubscribed: false,
    first_name: null,
    ...overrides,
  };
}

/** Serve `pages` in order; the last one repeats if the CLI keeps asking. */
beforeAll(async () => {
  // A skip here would be worse than a failure: these are the only tests that
  // reach fetchContacts/readRoster at all, and CI builds the packages before
  // `pnpm test`, so an unbuilt dist means the harness changed, not that the
  // suite is legitimately unrunnable.
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
      contactRequests.push(url.search);
      const page = pages[Math.min(contactRequests.length - 1, pages.length - 1)] ?? { data: [] };
      res.end(JSON.stringify(page));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ message: `stub has no route for ${url.pathname}` }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  tmpDir = await mkdtemp(path.join(os.tmpdir(), "spo289-"));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  pages = [];
  contactRequests = [];
});

async function writeFixtures(name: string, roster: unknown) {
  const rosterPath = path.join(tmpDir, `${name}.roster.json`);
  const ledgerPath = path.join(tmpDir, `${name}.ledger.jsonl`);
  await writeFile(rosterPath, `${JSON.stringify(roster, null, 2)}\n`);
  // An empty ledger file, not a missing one: a missing path is its own hard
  // error (SPO-287) and would mask whatever this test is actually asserting.
  await writeFile(ledgerPath, "# no suppressions\n");
  return { rosterPath, ledgerPath };
}

async function runPreflight(
  name: string,
  roster: unknown,
  extra: string[] = [],
): Promise<{ code: number; stdout: string; stderr: string; jsonPath: string }> {
  const { rosterPath, ledgerPath } = await writeFixtures(name, roster);
  const jsonPath = path.join(tmpDir, `${name}.out.json`);
  const child = spawn(
    process.execPath,
    [
      CLI,
      "--roster", rosterPath,
      "--ledger", ledgerPath,
      "--audience", AUDIENCE_ID,
      "--touch", "T1",
      "--channel", "email",
      "--json", jsonPath,
      ...extra,
      // Required by the CLI whenever WAVE1_PREFLIGHT_RESEND_API_BASE is set
      // (below). The pair is what keeps the seam from being usable by accident;
      // the tests that assert on the guard itself spawn without this helper.
      "--allow-test-endpoint",
    ],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        RESEND_API_KEY: "re_stub_key_not_a_real_credential",
        WAVE1_PREFLIGHT_RESEND_API_BASE: baseUrl,
      },
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (c) => (stdout += String(c)));
  child.stderr.on("data", (c) => (stderr += String(c)));
  const code = await new Promise<number>((resolve) => child.on("close", (c) => resolve(c ?? -1)));
  return { code, stdout, stderr, jsonPath };
}

describe("wave1-preflight: duplicate xHandle is a hard error (SPO-289 finding 1)", () => {
  const TWO_ROWS_ONE_HANDLE = [
    { id: "a", name: "Alias One", firstName: "Alias", email: null, xHandle: "@samstream" },
    { id: "b", name: "Alias Two", firstName: null, email: null, xHandle: "@samstream" },
  ];

  it("rejects two rows sharing a handle, naming both row ids", async () => {
    const { code, stderr } = await runPreflight("dup-handle", TWO_ROWS_ONE_HANDLE);
    expect(stderr).toContain("share the X handle @samstream");
    expect(stderr).toContain('"a"');
    expect(stderr).toContain('"b"');
    expect(code).toBe(2);
  });

  it("fails before any network read, so a Resend outage cannot mask it", async () => {
    await runPreflight("dup-handle-no-net", TWO_ROWS_ONE_HANDLE);
    expect(contactRequests).toEqual([]);
  });

  it("compares normalized handles, so @SamStream and samstream collide", async () => {
    const { code, stderr } = await runPreflight("dup-handle-case", [
      { id: "a", name: "Alias One", firstName: null, email: null, xHandle: "@SamStream" },
      { id: "b", name: "Alias Two", firstName: null, email: null, xHandle: "  samstream " },
    ]);
    expect(stderr).toContain("share the X handle @samstream");
    expect(code).toBe(2);
  });

  // Positive control for the guard. Without this, a `readRoster` that threw on
  // every roster would pass all three tests above.
  it("lets distinct handles through to the live read", async () => {
    pages = [{ data: [], has_more: false }];
    const { stderr } = await runPreflight("distinct-handles", [
      { id: "a", name: "Alias One", firstName: null, email: null, xHandle: "@samstream" },
      { id: "b", name: "Alias Two", firstName: null, email: null, xHandle: "@othastream" },
    ]);
    expect(stderr).not.toContain("share the X handle");
    expect(contactRequests.length).toBe(1);
  });

  // The email-only cohort is most of Wave 1's roster: `xHandle: null` on many
  // rows must not read as "they all share the same handle".
  it("does not collide rows that carry no handle at all", async () => {
    pages = [{ data: [], has_more: false }];
    const { stderr } = await runPreflight("no-handles", [
      { id: "a", name: "Alias One", firstName: null, email: "a@example.com", xHandle: null },
      { id: "b", name: "Alias Two", firstName: null, email: "b@example.com" },
      { id: "c", name: "Alias Three", firstName: null, email: "c@example.com", xHandle: "   " },
    ]);
    expect(stderr).not.toContain("share the X handle");
    expect(contactRequests.length).toBe(1);
  });
});

describe("wave1-preflight: contact pagination must prove it terminated (SPO-289 finding 2)", () => {
  const ROSTER = [{ id: "a", name: "Alias One", firstName: null, email: "a@example.com", xHandle: "@a" }];
  const FULL_PAGE = Array.from({ length: 100 }, (_, i) => contact(i));

  it("refuses a full page that omits has_more, rather than silently truncating", async () => {
    pages = [{ data: FULL_PAGE }]; // no has_more field at all
    const { code, stderr } = await runPreflight("no-has-more", ROSTER);
    expect(stderr).toContain('no "has_more" field');
    expect(stderr).toContain("hides audience strays");
    expect(code).toBe(2);
  });

  it("treats an explicit has_more:false on a full page as a complete read", async () => {
    pages = [{ data: FULL_PAGE, has_more: false }];
    const { stdout, stderr } = await runPreflight("explicit-false", ROSTER);
    expect(stderr).not.toContain("has_more");
    // 100 contacts, none on a roster row — the F4 stray check saw all of them.
    expect(stdout).toContain("In the audience but on no roster row (100)");
    expect(contactRequests.length).toBe(1);
  });

  it("does not fire on a short final page that omits has_more", async () => {
    pages = [{ data: FULL_PAGE.slice(0, 99) }];
    const { stdout, stderr } = await runPreflight("short-page", ROSTER);
    expect(stderr).not.toContain('no "has_more" field');
    expect(stdout).toContain("In the audience but on no roster row (99)");
  });

  it("still follows has_more:true across pages", async () => {
    pages = [
      { data: FULL_PAGE, has_more: true },
      { data: [contact(100), contact(101), contact(102)], has_more: false },
    ];
    const { stdout, jsonPath } = await runPreflight("two-pages", ROSTER);
    expect(stdout).toContain("In the audience but on no roster row (103)");
    expect(contactRequests.length).toBe(2);
    // Page 2 asked to continue from the last id of page 1, not from the start.
    expect(contactRequests[1]).toContain("after=ctc_99");
    const written = JSON.parse(await readFile(jsonPath, "utf8"));
    expect(written.plan.unknownRecipients).toHaveLength(103);
  });
});

describe("wave1-preflight: audience coverage of the send list (SPO-289 finding 3)", () => {
  // One DM-only row (the approved carve-out), one whose address the audience
  // does not hold, one fully covered. All three clear to send on dm.
  const MIXED = [
    { id: "gravelgospel", name: "Gravel Gospel", firstName: "Otis", email: null, xHandle: "@gravelgospel" },
    { id: "tundrabyte", name: "TundraByte", firstName: null, email: "tundrabyte@example.com", xHandle: "@tundrabyte" },
    { id: "ada", name: "Ada Stream", firstName: "Ada", email: "ada@example.com", xHandle: "@adastream" },
  ];
  const ADA_ONLY = [contact(0, { email: "ada@example.com", first_name: "Ada" })];

  it("names the uncovered dm rows and still exits 0 — the carve-out stays contactable", async () => {
    pages = [{ data: ADA_ONLY, has_more: false }];
    const { code, stdout } = await runPreflight("dm-coverage", MIXED, ["--channel", "dm"]);
    expect(stdout).toContain("dm: 2 of 3 SEND row(s) not covered by the audience read");
    expect(stdout).toContain("no email on the roster row");
    expect(stdout).toContain("has an email, but the audience does not hold it");
    expect(stdout).toContain("[gravelgospel]");
    expect(stdout).toContain("[tundrabyte]");
    expect(code).toBe(0);
  });

  it("prints the zero line too — silence is indistinguishable from a build without the check", async () => {
    pages = [
      {
        data: [
          contact(0, { email: "ada@example.com", first_name: "Ada" }),
          contact(1, { email: "tundrabyte@example.com", first_name: "TundraByte" }),
        ],
        has_more: false,
      },
    ];
    const { code, stdout } = await runPreflight("dm-coverage-zero", MIXED.slice(1), ["--channel", "dm"]);
    expect(stdout).toContain("dm: 0 of 2 SEND row(s) not covered by the audience read");
    // The zero line stands alone: no per-row detail, no report-only footnote.
    expect(stdout).not.toContain("(report only");
    expect(code).toBe(0);
  });

  it("always reads 0 on email, where a send row is a contact by construction", async () => {
    pages = [{ data: ADA_ONLY, has_more: false }];
    // TundraByte is on the roster and not in the audience: on email that is a
    // block, which is why they can never surface here as an uncovered *send*.
    const { code, stdout } = await runPreflight("email-coverage", MIXED);
    expect(stdout).toContain("email: 0 of 1 SEND row(s) not covered by the audience read");
    expect(code).toBe(1); // tundrabyte blocks — not-in-audience
  });

  it("carries the uncovered rows into the --json audit record", async () => {
    pages = [{ data: ADA_ONLY, has_more: false }];
    const { jsonPath } = await runPreflight("dm-coverage-json", MIXED, ["--channel", "dm"]);
    const written = JSON.parse(await readFile(jsonPath, "utf8"));
    expect(written.plan.uncoveredByAudience).toEqual([
      { rosterId: "gravelgospel", name: "Gravel Gospel", reason: "no-email" },
      { rosterId: "tundrabyte", name: "TundraByte", reason: "not-in-audience" },
    ]);
  });
});

describe("wave1-preflight: the test seam announces itself", () => {
  // The seam exists only for this file. If it is ever set on send day the run
  // proves nothing, so the banner must be impossible to miss in pasted evidence.
  it("prints a banner on both streams when the API base is overridden", async () => {
    pages = [{ data: [], has_more: false }];
    const { stdout, stderr } = await runPreflight("banner", [
      { id: "a", name: "Alias One", firstName: null, email: "a@example.com", xHandle: "@a" },
    ]);
    expect(stdout).toContain("WAVE1_PREFLIGHT_RESEND_API_BASE is set to");
    expect(stdout).toContain("did NOT read live Resend");
    expect(stderr).toContain("WAVE1_PREFLIGHT_RESEND_API_BASE is set to");
  });
});

describe("wave1-preflight: the test seam fails closed, not just loudly", () => {
  // The banner above was the whole mitigation, and a banner does not change an
  // exit code: a send-day run with the variable set still reached exit 0,
  // printed "Clear to send", and wrote a --json record indistinguishable from a
  // live one. Same fail-open shape as SPO-287, shipped by the commit closing it.
  //
  // These spawn the CLI directly rather than through runPreflight, because the
  // thing under test is exactly the flag that helper now always passes.
  async function rawRun(
    name: string,
    opts: { apiBase?: string; allowFlag: boolean },
  ): Promise<{ code: number; stdout: string; stderr: string; jsonPath: string }> {
    const { rosterPath, ledgerPath } = await writeFixtures(name, [
      { id: "a", name: "Ada Stream", firstName: "Ada", email: "ada@example.com", xHandle: "@ada" },
    ]);
    const jsonPath = path.join(tmpDir, `${name}.out.json`);
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      RESEND_API_KEY: "re_stub_key_not_a_real_credential",
    };
    if (opts.apiBase) env.WAVE1_PREFLIGHT_RESEND_API_BASE = opts.apiBase;
    else delete env.WAVE1_PREFLIGHT_RESEND_API_BASE;

    const child = spawn(
      process.execPath,
      [
        CLI,
        "--roster", rosterPath,
        "--ledger", ledgerPath,
        "--audience", AUDIENCE_ID,
        "--touch", "T1",
        "--channel", "email",
        "--json", jsonPath,
        ...(opts.allowFlag ? ["--allow-test-endpoint"] : []),
      ],
      { cwd: REPO_ROOT, env },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += String(c)));
    child.stderr.on("data", (c) => (stderr += String(c)));
    const code = await new Promise<number>((resolve) => child.on("close", (c) => resolve(c ?? -1)));
    return { code, stdout, stderr, jsonPath };
  }

  it("refuses a stub endpoint that no flag asked for, instead of clearing the send", async () => {
    // The exact roster/stub pairing that clears below. Only the flag differs.
    pages = [{ data: [contact(1, { email: "ada@example.com", first_name: "Ada" })], has_more: false }];
    const before = contactRequests.length;
    const { code, stdout, stderr } = await rawRun("seam-no-flag", { apiBase: baseUrl, allowFlag: false });

    expect(code).toBe(2);
    expect(stdout).not.toContain("Clear to send");
    expect(stderr).toContain("would read a stub instead of");
    expect(stderr).toContain("unset WAVE1_PREFLIGHT_RESEND_API_BASE");
    // "Before any work": the refusal precedes the live read, so it cannot be a
    // late abort that already did something.
    expect(contactRequests.length).toBe(before);
    expect(existsSync(path.join(tmpDir, "seam-no-flag.out.json"))).toBe(false);
  });

  it("refuses the flag without the variable, when the run would really hit live Resend", async () => {
    // The other direction. Nothing is stubbed, so a run that got past this would
    // read api.resend.com while the caller believes it is on a fixture — and
    // with --apply-suppressions would unsubscribe real contacts.
    const { code, stdout, stderr } = await rawRun("seam-flag-only", { allowFlag: true });

    expect(code).toBe(2);
    expect(stdout).not.toContain("Clear to send");
    expect(stderr).toContain("--allow-test-endpoint was passed but");
    expect(stderr).toContain("https://api.resend.com");
  });

  it("still clears when both halves agree — the guard is not blanket-blocking", async () => {
    // Positive control. Without this the two refusals above pass just as well
    // against a CLI that exits 2 on everything.
    pages = [{ data: [contact(1, { email: "ada@example.com", first_name: "Ada" })], has_more: false }];
    const { code, stdout } = await rawRun("seam-both", { apiBase: baseUrl, allowFlag: true });

    expect(code).toBe(0);
    expect(stdout).toContain("Clear to send T1 on email to 1 recipient(s)");
  });

  it("records the effective endpoint in the --json record, so the artifact outlives the banner", async () => {
    // The banner lives on a terminal nobody keeps; the archived record is the
    // evidence QA reads back. It has to say which endpoint produced the counts.
    pages = [{ data: [contact(1, { email: "ada@example.com", first_name: "Ada" })], has_more: false }];
    const { jsonPath } = await rawRun("seam-json", { apiBase: baseUrl, allowFlag: true });
    const written = JSON.parse(await readFile(jsonPath, "utf8"));

    expect(written.endpoint).toEqual({
      resendApiBase: baseUrl,
      live: false,
      allowTestEndpoint: true,
    });
  });
});
