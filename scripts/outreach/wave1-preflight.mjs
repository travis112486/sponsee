#!/usr/bin/env node
// Wave 1 outreach preflight gate (SPO-270).
//
// Run this immediately before every Wave 1 touch. It reads live contact state
// from Resend, applies the decision rules in @sponsee/shared/wave1-suppression,
// and prints the exact SEND / SUPPRESS list for the touch.
//
// THIS SCRIPT NEVER SENDS ANYTHING. It reads Resend, and with
// --apply-suppressions it flips contacts to unsubscribed. There is no send path
// in this file, deliberately: send authority for Wave 1 sits with the founder on
// SPO-264 and is not something a preflight tool should be able to exercise.
//
//   node scripts/outreach/wave1-preflight.mjs \
//     --roster outreach/wave1-roster.json \
//     --ledger outreach/wave1-ledger.jsonl \
//     --audience wave-1-outreach \
//     --touch T2 --channel email
//
// The ledger path must exist. `--ledger` is a hand-typed argument on send day
// whose failure mode is mailing someone who opted out: a missing file reads as
// "nobody opted out", which is indistinguishable from a typo in the path. Every
// other input here already fails closed, so this one does too — `--touch T1`
// takes `--allow-missing-ledger` for the one case where there genuinely is no
// ledger yet. The render header names the ledger path and its entry count, so a
// silent 0 is visible even when the file exists and is empty.
//
// The live Resend read happens on BOTH channels. The hosted unsubscribe URL is
// the only opt-out the email copy offers, so a click on it is the primary
// opt-out event for Wave 1 — and it exists only in Resend's contact state. A DM
// preflight that skipped this read would clear a T2/T3 DM to someone who
// unsubscribed at T1, which is the end-run the cross-channel rule exists to
// prevent. That makes RESEND_API_KEY and --audience required for `--channel dm`
// too, and an unreachable audience a hard stop rather than a silent skip:
// blocking a touch during a Resend outage is the safe direction.
//
// Exit codes:
//   0  clear — every roster row resolved to send / suppress / skip
//   1  blocked — do not send this touch until the reported rows are fixed
//   2  usage or environment error
//
// See scripts/outreach/README.md for file formats and the send-day runbook.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const SHARED_DIST = path.join(REPO_ROOT, "packages", "shared", "dist", "wave1-suppression.js");

const RESEND_API_DEFAULT = "https://api.resend.com";

// Test seam, and nothing else. This file has no import-time surface a unit test
// can reach — `main()` runs on import — so the only way to exercise the Resend
// read paths is to spawn the real CLI against a stub server, and that needs a
// base URL to point at. See scripts/outreach/wave1-preflight.test.ts and
// scripts/outreach/wave1-preflight-first-names.test.ts.
//
// Setting this on send day would gate the touch on a fake audience and
// manufacture a false green, so it is deliberately unmissable: every run that
// sets it prints the banner below on BOTH streams. If that line appears in
// preflight evidence, the evidence is worthless — re-run without it.
const RESEND_API = process.env.WAVE1_PREFLIGHT_RESEND_API_BASE ?? RESEND_API_DEFAULT;
if (RESEND_API !== RESEND_API_DEFAULT) {
  const banner =
    `\n!! WAVE1_PREFLIGHT_RESEND_API_BASE is set to ${RESEND_API} — this run did NOT read live Resend\n` +
    `!! contact state. It proves nothing about a real touch. Do not use it as send-day evidence.\n\n`;
  process.stdout.write(banner);
  process.stderr.write(banner);
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function usage(message) {
  process.stderr.write(
    `${message}\n\nUsage:\n  node scripts/outreach/wave1-preflight.mjs \\\n` +
      `    --roster <path> --ledger <path> --audience <name|id> \\\n` +
      `    --touch T1|T2|T3 --channel email|dm \\\n` +
      `    [--apply-suppressions] [--require-first-names] [--json <path>] \\\n` +
      `    [--allow-missing-ledger]   (T1 only)\n`,
  );
  process.exit(2);
}

function parseArgs(argv) {
  const args = { applySuppressions: false, requireFirstNames: false, allowMissingLedger: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--roster": args.roster = argv[++i]; break;
      case "--ledger": args.ledger = argv[++i]; break;
      case "--audience": args.audience = argv[++i]; break;
      case "--touch": args.touch = argv[++i]; break;
      case "--channel": args.channel = argv[++i]; break;
      case "--json": args.json = argv[++i]; break;
      case "--apply-suppressions": args.applySuppressions = true; break;
      case "--require-first-names": args.requireFirstNames = true; break;
      case "--allow-missing-ledger": args.allowMissingLedger = true; break;
      default: usage(`Unknown argument: ${arg}`);
    }
  }
  if (!args.roster) usage("--roster is required");
  if (!args.ledger) usage("--ledger is required");
  if (!["T1", "T2", "T3"].includes(args.touch)) usage("--touch must be T1, T2 or T3");
  if (!["email", "dm"].includes(args.channel)) usage("--channel must be email or dm");
  // Required on both channels. See the header: the DM channel needs the live
  // read to see an email unsubscribe, which is the only opt-out most recipients
  // are offered.
  if (!args.audience) usage("--audience is required on both channels");
  // T1 is the only touch with a defensible reason to have no ledger file: no
  // signal has come in yet. By T2 the ledger IS the record of who replied to or
  // opted out of T1, so "there is no ledger" is not a state that can be true —
  // it is a wrong path. An empty file is a statement; a missing one is an accident.
  if (args.allowMissingLedger && args.touch !== "T1") {
    usage(`--allow-missing-ledger is only accepted with --touch T1 (got ${args.touch}).`);
  }
  return args;
}

async function loadRules() {
  if (!existsSync(SHARED_DIST)) {
    process.stderr.write(
      `@sponsee/shared is not built — the decision rules live there, and this script holds none of its own.\n` +
        `Build it first:\n\n  pnpm install\n  pnpm --filter @sponsee/shared build\n`,
    );
    process.exit(2);
  }
  return import(pathToFileURL(SHARED_DIST).href);
}

async function resend(apiKey, pathname, init = {}) {
  const res = await fetch(`${RESEND_API}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Resend ${init.method ?? "GET"} ${pathname} failed (${res.status}): ${text}`);
  }
  return text.length > 0 ? JSON.parse(text) : null;
}

/** Resolve an audience by id or by exact name, so the runbook can use the name. */
async function resolveAudienceId(apiKey, audience) {
  const list = await resend(apiKey, "/audiences");
  const byId = (list.data ?? []).find((a) => a.id === audience);
  if (byId) return byId.id;
  const byName = (list.data ?? []).filter((a) => a.name === audience);
  if (byName.length === 1) return byName[0].id;
  if (byName.length > 1) {
    throw new Error(`Audience name "${audience}" is ambiguous (${byName.length} matches) — pass the id.`);
  }
  const known = (list.data ?? []).map((a) => `${a.name} (${a.id})`).join(", ") || "none";
  throw new Error(`No Resend audience matches "${audience}". Existing audiences: ${known}`);
}

const CONTACT_PAGE_LIMIT = 100;
const CONTACT_PAGE_CAP = 100;

async function fetchContacts(apiKey, audienceId) {
  const contacts = [];
  let after;
  // Bounded rather than `while (true)`: a pagination contract change that never
  // clears has_more would otherwise hang the gate on send day.
  for (let page = 0; page < CONTACT_PAGE_CAP; page++) {
    const query = new URLSearchParams({ limit: String(CONTACT_PAGE_LIMIT) });
    if (after) query.set("after", after);
    const body = await resend(apiKey, `/audiences/${audienceId}/contacts?${query}`);
    const rows = body?.data ?? [];
    for (const row of rows) {
      contacts.push({
        id: row.id,
        email: row.email,
        unsubscribed: row.unsubscribed === true,
        firstName: row.first_name ?? null,
      });
    }
    if (rows.length === 0) return contacts;
    if (body?.has_more) {
      after = rows[rows.length - 1].id;
      continue;
    }

    // has_more is falsy, so this is the last page — unless it is *absent*.
    // `false` is a statement that the read is complete; a missing field on a
    // FULL page is indistinguishable from a provider that caps `data` and never
    // shipped the flag, and treating that as complete truncates the audience
    // silently. Truncation is not the safe direction here even though it looks
    // like one: a dropped contact makes its roster row read `not-in-audience`
    // and blocks (safe), but it also hides a contact on NO roster row, so
    // `plan.unknownRecipients` under-reports and the audience reads clean when
    // it is not — a false green on the exact stray-recipient check F4 added.
    // Refuse rather than adjudicate a send list we cannot prove is whole.
    if (body?.has_more == null && rows.length >= CONTACT_PAGE_LIMIT) {
      throw new Error(
        `Resend returned a full page of ${rows.length} contacts for audience ${audienceId} with no ` +
          `"has_more" field, so this read cannot be told apart from a truncated one. A truncated ` +
          `contact list hides audience strays instead of reporting them. Refusing to gate a touch ` +
          `on a possibly partial send list — check the Resend pagination contract before re-running.`,
      );
    }
    return contacts;
  }
  throw new Error(`Resend contact pagination did not terminate after ${CONTACT_PAGE_CAP} pages`);
}

async function readRoster(file, rules) {
  const parsed = JSON.parse(await readFile(file, "utf8"));
  const rows = Array.isArray(parsed) ? parsed : parsed.roster;
  if (!Array.isArray(rows)) throw new Error(`${file}: expected an array of roster rows`);
  const seenIds = new Set();
  const seenEmails = new Map();
  const seenHandles = new Map();
  for (const row of rows) {
    if (typeof row.id !== "string" || row.id.length === 0) {
      throw new Error(`${file}: every roster row needs a stable string "id"`);
    }
    // A duplicate id would make two creators share one decision line and one of
    // them would silently vanish from the plan.
    if (seenIds.has(row.id)) throw new Error(`${file}: duplicate roster id "${row.id}"`);
    seenIds.add(row.id);

    // Two rows sharing an address are one recipient with two decision lines —
    // and if the two rows disagree about first name or handle, which greeting
    // and which suppression apply becomes order-dependent.
    const email = rules.normalizeEmail(row.email);
    if (email !== null) {
      const prior = seenEmails.get(email);
      if (prior !== undefined) {
        throw new Error(`${file}: rows "${prior}" and "${row.id}" share the email ${email}`);
      }
      seenEmails.set(email, row.id);
    }

    // Same argument, applied to the handle: it is the DM channel's only
    // recipient key, so two rows sharing one produce two SEND lines for one
    // person — a double-DM at the same touch, from a plan that reads clear.
    // The email guard above catches this pair only when both rows also carry
    // the same address, and the DM-only rows (`"email": null`) that make up
    // most of the DM cohort carry no address to collide on.
    const xHandle = rules.normalizeHandle(row.xHandle);
    if (xHandle !== null) {
      const prior = seenHandles.get(xHandle);
      if (prior !== undefined) {
        throw new Error(`${file}: rows "${prior}" and "${row.id}" share the X handle @${xHandle}`);
      }
      seenHandles.set(xHandle, row.id);
    }
  }
  return rows;
}

/** JSONL, one suppression signal per line. Blank lines and `#` comments ignored. */
async function readLedger(file, rules, { allowMissing }) {
  if (!existsSync(file)) {
    if (!allowMissing) {
      // The fails-open case this guard exists for. A missing ledger yields zero
      // suppressions, which downstream is identical to "nobody opted out" — so a
      // typo'd --ledger clears a T2 send to everyone who replied to T1. Every
      // other input on this path already stops the touch; so does this one.
      throw new Error(
        `${file}: ledger file not found (resolved to ${path.resolve(file)}).\n` +
          `A missing ledger suppresses nobody, which is indistinguishable from "nobody opted out" —\n` +
          `on T2/T3 that clears a send to everyone who replied or unsubscribed at T1.\n` +
          `  - Check the path above.\n` +
          `  - T1 before any signal has come in: pass --allow-missing-ledger (T1 only).\n` +
          `  - T2/T3 with genuinely no suppressions: create an empty ledger file. An empty file is a\n` +
          `    statement; a missing one is an accident.`,
      );
    }
    return { path: file, entries: [], missing: true };
  }
  const raw = await readFile(file, "utf8");
  const entries = [];
  raw.split("\n").forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) return;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Fail loudly: a malformed line is a suppression we would otherwise drop.
      throw new Error(`${file}:${i + 1}: not valid JSON — refusing to run with an unreadable ledger`);
    }
    // Full validation lives in @sponsee/shared so it is covered by the suite —
    // a missing `reason` or an address that normalizes away (`"   "`, `"@"`)
    // both produce an entry that suppresses nobody while looking present.
    entries.push(rules.validateLedgerEntry(parsed, `${file}:${i + 1}`));
  });
  return { path: file, entries, missing: false };
}

function render(plan, syncPlan, blockers, args, sources) {
  const counts = { send: 0, suppress: 0, skip: 0, block: 0 };
  const lines = [];
  for (const { rosterId, name, decision } of plan.decisions) {
    counts[decision.action]++;
    const detail =
      decision.action === "send"
        ? decision.recipient
        : decision.action === "suppress"
          ? `${decision.reason} (${decision.source})`
          : decision.reason;
    lines.push(`  ${decision.action.toUpperCase().padEnd(8)} ${name.padEnd(28)} ${detail}  [${rosterId}]`);
  }

  process.stdout.write(`\nWave 1 preflight — ${args.touch} / ${args.channel}\n`);
  // Name every file this run actually read, with its size. A count of 0 that the
  // operator can see is a question they can ask; a count of 0 nothing prints is
  // the shape of the SPO-287 defect, and it recurs for any input read this way.
  process.stdout.write(`roster: ${args.roster} (${plural(sources.rosterRows, "row")})\n`);
  process.stdout.write(
    `ledger: ${sources.ledger.path} ` +
      `${sources.ledger.missing ? "(MISSING — allowed by --allow-missing-ledger)" : `(${plural(sources.ledger.entries.length, "entry", "entries")})`}\n`,
  );
  process.stdout.write(`${"─".repeat(76)}\n`);
  process.stdout.write(`${lines.join("\n")}\n`);
  process.stdout.write(`${"─".repeat(76)}\n`);
  process.stdout.write(
    `send ${counts.send}   suppress ${counts.suppress}   skip ${counts.skip}   block ${counts.block}\n`,
  );

  // The audience is the Broadcast's send list, so a contact on no roster row is
  // a recipient nothing above adjudicated.
  if (plan.unknownRecipients.length > 0) {
    process.stdout.write(
      `\nIn the audience but on no roster row (${plan.unknownRecipients.length}) — a Broadcast sends to the audience:\n` +
        plan.unknownRecipients
          .map((c) => `  ${c.email}  ${c.unsubscribed ? "unsubscribed (Resend will skip)" : "SUBSCRIBED — would receive Wave 1"}`)
          .join("\n") +
        "\n",
    );
  }

  if (syncPlan) {
    if (syncPlan.toCreate.length > 0) {
      process.stdout.write(
        `\nNot yet in the audience (${syncPlan.toCreate.length}) — add before T1, else they have no unsubscribe URL:\n` +
          syncPlan.toCreate
            .map(
              (c) =>
                `  ${c.email}  first_name=${c.firstName ?? "—"}` +
                `${c.unsubscribed ? "  CREATE UNSUBSCRIBED (ledger suppresses them)" : ""}  [${c.rosterId}]`,
            )
            .join("\n") +
          "\n",
      );
    }
    // Two reports, because they are two different facts. The greeting renders
    // from the Resend contact, so `missingFirstName` is the list of recipients
    // who will read "Hey there —" — including the ones the roster has no name
    // for either, which drift cannot see because both sides agree on nothing.
    // Drift stays as the wider warning: some of it is a defect, some of it is a
    // contact name we simply do not carry, which reads correctly.
    if (syncPlan.missingFirstName.length > 0) {
      process.stdout.write(
        `\nNo first_name on the contact (${syncPlan.missingFirstName.length}) — these render v5's "Hey there —" fallback:\n` +
          syncPlan.missingFirstName
            .map(
              (d) =>
                `  ${d.email}  ` +
                (d.roster === null
                  ? "no confirmed name on either side — needs an SPO-269 lookup"
                  : `roster has "${d.roster}" — push it to the contact`) +
                `  [${d.rosterId}]`,
            )
            .join("\n") +
          `${args.requireFirstNames ? "" : "\n  (warning only — pass --require-first-names to make this block)"}\n`,
      );
    }
    if (syncPlan.firstNameDrift.length > 0) {
      // Mark from the blocking list itself rather than re-deriving "both sides
      // named" here — a suppressed row can drift, and it does not block.
      const conflicting = new Set(syncPlan.firstNameConflict.map((c) => c.rosterId));
      process.stdout.write(
        `\nFirst-name drift (${syncPlan.firstNameDrift.length}) — the greeting renders from the Resend contact, not the roster:\n` +
          syncPlan.firstNameDrift
            .map(
              (d) =>
                `  ${d.email}  roster=${d.roster ?? "—"}  resend=${d.resend ?? "—"}  [${d.rosterId}]` +
                (conflicting.has(d.rosterId) ? "  CONFLICT" : ""),
            )
            .join("\n") +
          `${
            args.requireFirstNames
              ? "\n  (only the CONFLICT rows block; a contact name the roster lacks still greets correctly)"
              : "\n  (warning only — --require-first-names blocks the rows marked CONFLICT)"
          }\n`,
      );
    }
  }

  if (blockers.length > 0) {
    process.stdout.write(
      `\nAudience not ready (${blockers.length}):\n` + blockers.map((b) => `  ${b}`).join("\n") + "\n",
    );
  }

  return counts;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rules = await loadRules();

  const [roster, ledgerFile] = await Promise.all([
    readRoster(args.roster, rules),
    readLedger(args.ledger, rules, { allowMissing: args.allowMissingLedger }),
  ]);
  const ledger = ledgerFile.entries;
  const sources = { rosterRows: roster.length, ledger: ledgerFile };

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    process.stderr.write(
      "RESEND_API_KEY is not set. The whole point of this gate is a LIVE read — it must not fall back to a snapshot,\n" +
        "and that applies to --channel dm too: an email unsubscribe is the opt-out most recipients are offered, and it\n" +
        "lives only in Resend's contact state.\n" +
        "  source ~/.config/infisical-agent/credentials.env\n" +
        "  export RESEND_API_KEY=$(infisical secrets get RESEND_API_KEY --projectId $INFISICAL_PROJECT_ID --env prod --plain --silent)\n",
    );
    process.exit(2);
  }

  const audienceId = await resolveAudienceId(apiKey, args.audience);
  let contacts = await fetchContacts(apiKey, audienceId);
  let syncPlan = rules.planContactSync(roster, ledger, contacts);

  // `packages/shared/dist` is gitignored and built out of band, so a checkout
  // can pair this script with rules older than it. That must read as an
  // environment error, not as a weaker gate: defaulting the missing list to `[]`
  // would silently drop the --require-first-names condition and print a green
  // preflight, which is the exact failure SPO-288 was filed for.
  if (!Array.isArray(syncPlan.missingFirstName)) {
    process.stderr.write(
      `@sponsee/shared is built from rules that predate SPO-288 — planContactSync returned no\n` +
        `"missingFirstName" list, so --require-first-names cannot be evaluated. Rebuild it:\n\n` +
        `  pnpm --filter @sponsee/shared build\n`,
    );
    process.exit(2);
  }

  if (syncPlan.toUnsubscribe.length > 0) {
    if (args.applySuppressions) {
      const byEmail = new Map(contacts.map((c) => [rules.normalizeEmail(c.email), c]));
      for (const row of syncPlan.toUnsubscribe) {
        const contact = byEmail.get(rules.normalizeEmail(row.email));
        if (!contact) continue;
        await resend(apiKey, `/audiences/${audienceId}/contacts/${contact.id}`, {
          method: "PATCH",
          body: JSON.stringify({ unsubscribed: true }),
        });
        process.stdout.write(`applied: ${row.email} -> unsubscribed (${row.reason})\n`);
      }
      // Re-read rather than trust the PATCH. Marking the local copy
      // unsubscribed would mean the recompute below checks a snapshot this
      // script just authored — a 2xx that did not persist would read as clear,
      // which is the snapshot this file refuses to run on.
      contacts = await fetchContacts(apiKey, audienceId);
      syncPlan = rules.planContactSync(roster, ledger, contacts);
    } else {
      process.stdout.write(
        `\n${syncPlan.toUnsubscribe.length} ledger suppression(s) not yet reflected in Resend:\n` +
          syncPlan.toUnsubscribe.map((r) => `  ${r.email}  ${r.reason}  [${r.rosterId}]`).join("\n") +
          "\nRe-run with --apply-suppressions to push them before sending.\n",
      );
    }
  }

  const plan = rules.planTouch({
    touch: args.touch,
    channel: args.channel,
    roster,
    ledger,
    contacts,
  });

  const blockers = rules.contactSyncBlockers(syncPlan, { requireFirstNames: args.requireFirstNames });

  const counts = render(plan, syncPlan, blockers, args, sources);

  if (args.json) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      args.json,
      `${JSON.stringify(
        {
          touch: args.touch,
          channel: args.channel,
          audienceId,
          // The audit record has to say which ledger produced these decisions.
          // "0 suppressions" is only meaningful next to the file it came from.
          sources: {
            roster: { path: args.roster, resolvedPath: path.resolve(args.roster), rows: roster.length },
            ledger: {
              path: ledgerFile.path,
              resolvedPath: path.resolve(ledgerFile.path),
              entries: ledger.length,
              missing: ledgerFile.missing,
            },
          },
          plan,
          syncPlan,
          blockers,
        },
        null,
        2,
      )}\n`,
    );
  }

  // Two independent gates, both hard. `plan.clearToSend` covers the recipients
  // — a roster row with no contact, and an audience contact on no roster row.
  // `blockers` covers the audience state — a ledger suppression Resend has not
  // been told about, in either of the two shapes it can take.
  if (!plan.clearToSend || blockers.length > 0) {
    process.stderr.write(
      `\nBLOCKED — do not send ${args.touch}. ${counts.block} unresolved row(s), ` +
        `${plan.unknownRecipients.filter((c) => !c.unsubscribed).length} unknown recipient(s), ` +
        `${blockers.length} audience blocker(s).\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`\nClear to send ${args.touch} on ${args.channel} to ${counts.send} recipient(s).\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
});
