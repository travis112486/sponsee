import { describe, it, expect } from "vitest";
import {
  contactSyncBlockers,
  greetingName,
  indexLedger,
  normalizeEmail,
  normalizeHandle,
  planContactSync,
  planTouch,
  validateLedgerEntry,
  type LedgerEntry,
  type ResendContactState,
  type RosterRow,
} from "./wave1-suppression.js";

// Three rows standing in for the Wave 1 shape: a fully-contactable creator, one
// with a channel name but no confirmed first name (the "Hey TundraByte"
// case v5 was written to kill), and one reachable on X only.
const ROSTER: RosterRow[] = [
  { id: "ada", name: "Ada Stream", firstName: "Ada", email: "ada@example.com", xHandle: "@adastream" },
  { id: "tundrabyte", name: "TundraByte", firstName: null, email: "tundrabyte@example.com", xHandle: "tundrabyte" },
  { id: "gravelgospel", name: "Gravel Gospel", firstName: "Otis", email: null, xHandle: "@gravelgospel" },
];

const SUBSCRIBED: ResendContactState[] = [
  { email: "ada@example.com", unsubscribed: false, firstName: "Ada" },
  { email: "tundrabyte@example.com", unsubscribed: false, firstName: null },
];

function decisionFor(plan: ReturnType<typeof planTouch>, rosterId: string) {
  const found = plan.decisions.find((d) => d.rosterId === rosterId);
  if (!found) throw new Error(`no decision for ${rosterId}`);
  return found.decision;
}

describe("normalization", () => {
  it("matches an opt-out recorded in a different case or with stray whitespace", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
    expect(normalizeHandle(" @@AdaStream ")).toBe("adastream");
  });

  it("treats blank and missing as absent rather than as an empty key", () => {
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeHandle("@")).toBeNull();
    expect(normalizeHandle(null)).toBeNull();
  });
});

describe("greetingName", () => {
  it("falls back to 'there', never to the channel name", () => {
    expect(greetingName("Ada")).toBe("Ada");
    expect(greetingName(null)).toBe("there");
    expect(greetingName("  ")).toBe("there");
  });
});

describe("indexLedger", () => {
  it("reports the earliest reason when a recipient exits more than once", () => {
    const entries: LedgerEntry[] = [
      { at: "2026-09-25T10:00:00Z", reason: "manual", email: "ada@example.com" },
      { at: "2026-09-22T10:00:00Z", reason: "replied", email: "ada@example.com" },
    ];
    expect(indexLedger(entries).byEmail.get("ada@example.com")).toBe("replied");
  });

  it("keeps an entry whose timestamp will not parse instead of dropping it", () => {
    const entries: LedgerEntry[] = [{ at: "not-a-date", reason: "stop_requested", xHandle: "adastream" }];
    expect(indexLedger(entries).byHandle.get("adastream")).toBe("stop_requested");
  });
});

describe("planTouch — email", () => {
  it("clears a subscribed contact with no ledger entry", () => {
    const plan = planTouch({ touch: "T1", channel: "email", roster: ROSTER, ledger: [], contacts: SUBSCRIBED });
    expect(decisionFor(plan, "ada")).toEqual({ action: "send", recipient: "ada@example.com" });
    expect(plan.clearToSend).toBe(true);
  });

  it("suppresses at T2 someone who unsubscribed after T1 went out", () => {
    // The regression this whole gate exists for: T1's roster snapshot still
    // says "send", and only the live contact read knows otherwise.
    const afterUnsubscribe: ResendContactState[] = [
      { email: "ada@example.com", unsubscribed: true, firstName: "Ada" },
      { email: "tundrabyte@example.com", unsubscribed: false, firstName: null },
    ];
    const plan = planTouch({
      touch: "T2",
      channel: "email",
      roster: ROSTER,
      ledger: [],
      contacts: afterUnsubscribe,
    });
    expect(decisionFor(plan, "ada")).toEqual({
      action: "suppress",
      reason: "unsubscribed",
      source: "resend",
    });
    expect(decisionFor(plan, "tundrabyte")).toEqual({ action: "send", recipient: "tundrabyte@example.com" });
  });

  it("honors a reply the provider cannot see", () => {
    const plan = planTouch({
      touch: "T2",
      channel: "email",
      roster: ROSTER,
      ledger: [{ at: "2026-09-23T09:00:00Z", reason: "replied", email: "ADA@example.com" }],
      contacts: SUBSCRIBED,
    });
    expect(decisionFor(plan, "ada")).toEqual({
      action: "suppress",
      reason: "replied",
      source: "ledger",
    });
  });

  it("blocks the touch when a roster row is not in the audience", () => {
    // No contact means no hosted unsubscribe URL, so the opt-out promised in the
    // copy would not exist for this recipient. Refuse the whole touch.
    const plan = planTouch({
      touch: "T1",
      channel: "email",
      roster: ROSTER,
      ledger: [],
      contacts: [SUBSCRIBED[0]],
    });
    expect(decisionFor(plan, "tundrabyte")).toEqual({ action: "block", reason: "not-in-audience" });
    expect(plan.clearToSend).toBe(false);
  });

  it("skips a row with no email without blocking the touch", () => {
    const plan = planTouch({ touch: "T1", channel: "email", roster: ROSTER, ledger: [], contacts: SUBSCRIBED });
    expect(decisionFor(plan, "gravelgospel")).toEqual({ action: "skip", reason: "no-address" });
    expect(plan.clearToSend).toBe(true);
  });

  it("suppresses email when the person said stop over DM", () => {
    const plan = planTouch({
      touch: "T3",
      channel: "email",
      roster: ROSTER,
      ledger: [{ at: "2026-09-23T09:00:00Z", reason: "stop_requested", xHandle: "@AdaStream" }],
      contacts: SUBSCRIBED,
    });
    expect(decisionFor(plan, "ada")).toEqual({
      action: "suppress",
      reason: "stop_requested",
      source: "cross-channel",
    });
  });
});

describe("planTouch — dm", () => {
  it("honors a stop reply on the handle", () => {
    const plan = planTouch({
      touch: "T2",
      channel: "dm",
      roster: ROSTER,
      ledger: [{ at: "2026-09-23T09:00:00Z", reason: "stop_requested", xHandle: "gravelgospel" }],
      contacts: SUBSCRIBED,
    });
    expect(decisionFor(plan, "gravelgospel")).toEqual({
      action: "suppress",
      reason: "stop_requested",
      source: "ledger",
    });
  });

  it("does not DM someone who unsubscribed from the email", () => {
    // X has no unsubscribe primitive, so nothing on the DM side would catch
    // this on its own — the opt-out has to carry across channels.
    const plan = planTouch({
      touch: "T2",
      channel: "dm",
      roster: ROSTER,
      ledger: [],
      contacts: [{ email: "ada@example.com", unsubscribed: true, firstName: "Ada" }],
    });
    expect(decisionFor(plan, "ada")).toEqual({
      action: "suppress",
      reason: "unsubscribed",
      source: "cross-channel",
    });
  });

  it("never blocks on audience membership — DMs do not use Resend contacts", () => {
    // Audience membership decides nothing on this channel: the send list is the
    // roster's handles. An empty audience must not stop a DM touch.
    const plan = planTouch({ touch: "T1", channel: "dm", roster: ROSTER, ledger: [], contacts: [] });
    expect(decisionFor(plan, "ada")).toEqual({ action: "send", recipient: "@adastream" });
    expect(decisionFor(plan, "tundrabyte")).toEqual({ action: "send", recipient: "@tundrabyte" });
    expect(plan.clearToSend).toBe(true);
  });

  it("refuses to plan a DM touch without the live contact read", () => {
    // The regression guard for the shape of the bug, not just its symptom: the
    // CLI is plain JS, so an omitted `contacts` used to reach here as
    // `undefined`, make `emailUnsubscribed` unconditionally false, and clear a
    // DM to someone who had clicked unsubscribe. Refusing the plan outright is
    // what makes the cross-channel rule unreachable-by-accident rather than
    // merely asserted by a test that hand-supplies contacts.
    expect(() =>
      // @ts-expect-error — contacts is required; this reproduces the JS caller.
      planTouch({ touch: "T2", channel: "dm", roster: ROSTER, ledger: [] }),
    ).toThrow(/requires live Resend contact state on every channel/);

    expect(() =>
      // @ts-expect-error — same on the email channel.
      planTouch({ touch: "T2", channel: "email", roster: ROSTER, ledger: [] }),
    ).toThrow(/requires live Resend contact state on every channel/);
  });
});

describe("validateLedgerEntry", () => {
  // Every case here is an entry that looks present and suppresses nobody. The
  // consumer tests `reason !== undefined` against a map, so all of them are
  // indistinguishable downstream from "this person never opted out".

  it("rejects an entry with no reason", () => {
    expect(() =>
      validateLedgerEntry({ at: "2026-09-23T09:00:00Z", xHandle: "@gravelgospel" }, "ledger.jsonl:1"),
    ).toThrow(/ledger\.jsonl:1: "reason" must be one of/);
  });

  it("rejects a reason outside the union", () => {
    expect(() =>
      validateLedgerEntry(
        { at: "2026-09-23T09:00:00Z", reason: "opted_out", email: "ada@example.com" },
        "ledger.jsonl:2",
      ),
    ).toThrow(/"reason" must be one of/);
  });

  it("rejects an address that is truthy but normalizes to nothing", () => {
    expect(() =>
      validateLedgerEntry({ at: "2026-09-23T09:00:00Z", reason: "replied", xHandle: "@" }, "l:3"),
    ).toThrow(/would match nobody/);
    expect(() =>
      validateLedgerEntry({ at: "2026-09-23T09:00:00Z", reason: "replied", email: "   " }, "l:4"),
    ).toThrow(/would match nobody/);
  });

  it("rejects a missing timestamp and a non-object line", () => {
    expect(() => validateLedgerEntry({ reason: "replied", email: "ada@example.com" }, "l:5")).toThrow(
      /"at" must be a non-empty ISO 8601/,
    );
    expect(() => validateLedgerEntry("replied", "l:6")).toThrow(/expected a JSON object/);
  });

  it("returns the entry with both keys normalized", () => {
    expect(
      validateLedgerEntry({
        at: "2026-09-23T09:00:00Z",
        reason: "replied",
        email: "  Ada@Example.COM ",
        xHandle: "@AdaStream",
        note: "replied to T1",
      }),
    ).toEqual({
      at: "2026-09-23T09:00:00Z",
      reason: "replied",
      email: "ada@example.com",
      xHandle: "adastream",
      note: "replied to T1",
    });
  });

  it("is enforced by indexLedger, not only by the CLI that calls it", () => {
    // Second line of defence: no caller can reach a plan through this module
    // carrying an entry that suppresses nobody.
    const bad = [{ at: "2026-09-23T09:00:00Z", email: "ada@example.com" }] as unknown as LedgerEntry[];
    expect(() => indexLedger(bad)).toThrow(/"reason" must be one of/);
    expect(() =>
      planTouch({ touch: "T2", channel: "email", roster: ROSTER, ledger: bad, contacts: SUBSCRIBED }),
    ).toThrow(/"reason" must be one of/);
  });
});

describe("planTouch — the audience is the send list", () => {
  const STRANGER: ResendContactState = { email: "leftover@example.com", unsubscribed: false };

  it("blocks an email touch on a subscribed contact that is on no roster row", () => {
    // The inverse of not-in-audience, and the direction that actually delivers:
    // a Broadcast sends to the audience, so this contact receives Wave 1 while
    // appearing in no decision line.
    const plan = planTouch({
      touch: "T1",
      channel: "email",
      roster: ROSTER,
      ledger: [],
      contacts: [...SUBSCRIBED, STRANGER],
    });
    expect(plan.unknownRecipients).toEqual([{ email: "leftover@example.com", unsubscribed: false }]);
    expect(plan.clearToSend).toBe(false);
  });

  it("reports but does not block an unsubscribed stranger — Resend skips them", () => {
    const plan = planTouch({
      touch: "T1",
      channel: "email",
      roster: ROSTER,
      ledger: [],
      contacts: [...SUBSCRIBED, { ...STRANGER, unsubscribed: true }],
    });
    expect(plan.unknownRecipients).toEqual([{ email: "leftover@example.com", unsubscribed: true }]);
    expect(plan.clearToSend).toBe(true);
  });

  it("reports a stranger on dm but does not block — the send list is the roster's handles", () => {
    const plan = planTouch({
      touch: "T1",
      channel: "dm",
      roster: ROSTER,
      ledger: [],
      contacts: [...SUBSCRIBED, STRANGER],
    });
    expect(plan.unknownRecipients).toHaveLength(1);
    expect(plan.clearToSend).toBe(true);
  });
});

// SPO-289 item 3. `contacts` is required on `dm`, but requiring the read is not
// the same as the read saying anything: a DM row can be cleared to send having
// consulted an audience that holds nothing about it. That is approved — the
// block would make the no-email cohort uncontactable — so it has to be counted.
describe("planTouch — uncoveredByAudience (the vacuous dm read)", () => {
  it("reports a dm send row with no email — nothing to look the audience up by", () => {
    const plan = planTouch({
      touch: "T1",
      channel: "dm",
      roster: ROSTER,
      ledger: [],
      contacts: SUBSCRIBED,
    });
    // Gravel Gospel is DM-only. Ada and TundraByte are both contacts, so the read spoke for them.
    expect(decisionFor(plan, "gravelgospel")).toEqual({ action: "send", recipient: "@gravelgospel" });
    expect(plan.uncoveredByAudience).toEqual([
      { rosterId: "gravelgospel", name: "Gravel Gospel", reason: "no-email" },
    ]);
    // Report only — this is exactly the row that must stay contactable.
    expect(plan.clearToSend).toBe(true);
  });

  it("distinguishes a row whose email the audience lost from one that never had an email", () => {
    // The case that bites later: TundraByte has an address, and the contact
    // carrying their unsubscribe state is gone. On email that blocks; on dm they send.
    const plan = planTouch({
      touch: "T1",
      channel: "dm",
      roster: ROSTER,
      ledger: [],
      contacts: [SUBSCRIBED[0]],
    });
    expect(plan.uncoveredByAudience).toEqual([
      { rosterId: "tundrabyte", name: "TundraByte", reason: "not-in-audience" },
      { rosterId: "gravelgospel", name: "Gravel Gospel", reason: "no-email" },
    ]);
    expect(plan.clearToSend).toBe(true);
  });

  it("counts only send rows — a suppressed row has no send for the read to miss", () => {
    const ledger: LedgerEntry[] = [
      { at: "2026-09-01T00:00:00Z", reason: "stop_requested", xHandle: "@gravelgospel" },
    ];
    const plan = planTouch({ touch: "T1", channel: "dm", roster: ROSTER, ledger, contacts: SUBSCRIBED });
    expect(decisionFor(plan, "gravelgospel")).toMatchObject({ action: "suppress" });
    expect(plan.uncoveredByAudience).toEqual([]);
  });

  it("is empty on email by construction, which makes the count a live positive control", () => {
    // Every email send row is a contact — `not-in-audience` blocks the rest — so
    // a non-empty list here would mean planTouch and this count disagree about
    // what the audience holds.
    for (const contacts of [SUBSCRIBED, [SUBSCRIBED[0]], []]) {
      const plan = planTouch({ touch: "T1", channel: "email", roster: ROSTER, ledger: [], contacts });
      expect(plan.uncoveredByAudience).toEqual([]);
    }
  });

  it("stays aligned with the roster when an earlier row is skipped", () => {
    // decisions is a positional map over roster; a skip must not shift which row
    // an uncovered send is attributed to.
    const roster: RosterRow[] = [
      { id: "nohandle", name: "No Handle", email: "nohandle@example.com", xHandle: null },
      ...ROSTER,
    ];
    const plan = planTouch({ touch: "T1", channel: "dm", roster, ledger: [], contacts: SUBSCRIBED });
    expect(decisionFor(plan, "nohandle")).toEqual({ action: "skip", reason: "no-address" });
    expect(plan.uncoveredByAudience).toEqual([
      { rosterId: "gravelgospel", name: "Gravel Gospel", reason: "no-email" },
    ]);
  });
});

describe("planContactSync", () => {
  it("lists roster rows Resend has never seen", () => {
    const plan = planContactSync(ROSTER, [], [SUBSCRIBED[0]]);
    expect(plan.toCreate).toEqual([
      { email: "tundrabyte@example.com", firstName: null, rosterId: "tundrabyte", unsubscribed: false },
    ]);
  });

  it("pushes a reply-based suppression Resend has no way to observe", () => {
    const plan = planContactSync(
      ROSTER,
      [{ at: "2026-09-23T09:00:00Z", reason: "replied", email: "ada@example.com" }],
      SUBSCRIBED,
    );
    expect(plan.toUnsubscribe).toEqual([
      { email: "ada@example.com", reason: "replied", rosterId: "ada" },
    ]);
  });

  it("does not re-push a suppression Resend already has", () => {
    const plan = planContactSync(
      ROSTER,
      [{ at: "2026-09-23T09:00:00Z", reason: "replied", email: "ada@example.com" }],
      [{ email: "ada@example.com", unsubscribed: true, firstName: "Ada" }, SUBSCRIBED[1]],
    );
    expect(plan.toUnsubscribe).toEqual([]);
  });

  it("reports a first name we know but the contact does not", () => {
    // Resend renders {{{contact.first_name|there}}} from the contact, so this
    // drift silently downgrades a personalized greeting to "Hey there".
    const plan = planContactSync(
      [{ id: "ada", name: "Ada Stream", firstName: "Ada", email: "ada@example.com" }],
      [],
      [{ email: "ada@example.com", unsubscribed: false, firstName: null }],
    );
    expect(plan.firstNameDrift).toEqual([
      { email: "ada@example.com", roster: "Ada", resend: null, rosterId: "ada" },
    ]);
  });

  it("reports no drift when both sides agree", () => {
    const plan = planContactSync([ROSTER[0]], [], [SUBSCRIBED[0]]);
    expect(plan.firstNameDrift).toEqual([]);
    expect(plan.toCreate).toEqual([]);
    expect(plan.toUnsubscribe).toEqual([]);
  });

  it("marks a ledger-suppressed row that is not yet a contact as create-unsubscribed", () => {
    // The ordering trap. planTouch consults the ledger before the audience, so
    // this row decides `suppress` and never reaches toUnsubscribe — the count
    // the gate keys on. The operator then follows "add every roster row before
    // T1", Resend creates the contact subscribed, and the Broadcast mails
    // someone the ledger pulled.
    const plan = planContactSync(
      ROSTER,
      [{ at: "2026-09-20T09:00:00Z", reason: "manual", email: "tundrabyte@example.com" }],
      [SUBSCRIBED[0]],
    );
    expect(plan.toUnsubscribe).toEqual([]);
    expect(plan.toCreate).toEqual([
      { email: "tundrabyte@example.com", firstName: null, rosterId: "tundrabyte", unsubscribed: true },
    ]);
  });

  it("picks up a handle-side stop for a row that is not yet a contact", () => {
    const plan = planContactSync(
      ROSTER,
      [{ at: "2026-09-20T09:00:00Z", reason: "stop_requested", xHandle: "@tundrabyte" }],
      [SUBSCRIBED[0]],
    );
    expect(plan.toCreate[0]).toMatchObject({ rosterId: "tundrabyte", unsubscribed: true });
  });
});

describe("contactSyncBlockers", () => {
  it("is empty when the audience matches the roster and the ledger", () => {
    expect(contactSyncBlockers(planContactSync([ROSTER[0]], [], [SUBSCRIBED[0]]))).toEqual([]);
  });

  it("blocks on a ledger suppression Resend has not been told about", () => {
    const plan = planContactSync(
      ROSTER,
      [{ at: "2026-09-23T09:00:00Z", reason: "replied", email: "ada@example.com" }],
      SUBSCRIBED,
    );
    expect(contactSyncBlockers(plan)).toEqual([
      expect.stringContaining("ada@example.com: ledger says replied"),
    ]);
  });

  it("blocks on a suppressed row that is not in the audience, which toUnsubscribe cannot see", () => {
    const plan = planContactSync(
      ROSTER,
      [{ at: "2026-09-20T09:00:00Z", reason: "manual", email: "tundrabyte@example.com" }],
      [SUBSCRIBED[0]],
    );
    expect(plan.toUnsubscribe).toHaveLength(0); // the count the old gate used
    expect(contactSyncBlockers(plan)).toEqual([
      expect.stringContaining("create the contact with unsubscribed=true"),
    ]);
  });

  it("reports a missing greeting as a warning by default and a blocker on request", () => {
    // A fallback greeting is a copy miss, not a broken opt-out, so it must not
    // fail a send-day touch on its own. SPO-280 builds the audience in order to
    // carry SPO-269's names, so its acceptance check opts in and gets an exit
    // code rather than a line of output to notice.
    const plan = planContactSync(
      [{ id: "ada", name: "Ada Stream", firstName: "Ada", email: "ada@example.com" }],
      [],
      [{ email: "ada@example.com", unsubscribed: false, firstName: null }],
    );
    expect(contactSyncBlockers(plan)).toEqual([]);
    expect(contactSyncBlockers(plan, { requireFirstNames: true })).toEqual([
      expect.stringContaining('sends "Hey there —"'),
    ]);
  });
});

// SPO-288. The flag used to key on roster-vs-contact drift, which is neither
// necessary nor sufficient for a bad greeting. Resend renders
// {{{contact.first_name|there}}} from the CONTACT, so the contact's value alone
// decides what the recipient reads. All five combinations are pinned below:
// dropping either blocker condition, or widening one back to plain drift, turns
// one of them red.
describe("contactSyncBlockers --require-first-names (SPO-288)", () => {
  const ON = { requireFirstNames: true } as const;

  function planFor(roster: string | null, resend: string | null, ledger: LedgerEntry[] = []) {
    return planContactSync(
      [{ id: "ada", name: "Ada Stream", firstName: roster, email: "ada@example.com" }],
      ledger,
      [{ email: "ada@example.com", unsubscribed: false, firstName: resend }],
    );
  }

  it("blocks the row neither side has a name for — the case drift cannot see", () => {
    // The hole this ticket was filed for. Roster null and contact null agree, so
    // there is no drift to report, and the old predicate cleared the send: this
    // recipient reads "Hey there —" with the flag on and exit 0.
    const plan = planFor(null, null);
    expect(plan.firstNameDrift).toEqual([]); // what the old gate keyed on
    expect(plan.missingFirstName).toEqual([
      { email: "ada@example.com", roster: null, rosterId: "ada" },
    ]);
    expect(contactSyncBlockers(plan, ON)).toEqual([
      expect.stringContaining("confirmed first name on the roster either"),
    ]);
    // Nothing to sync — the fix is an SPO-269 lookup, and the copy says so.
    expect(contactSyncBlockers(plan, ON)[0]).toContain('sends "Hey there —"');
  });

  it("blocks a name we hold that the contact lacks, and says to push it", () => {
    const plan = planFor("Ada", null);
    expect(contactSyncBlockers(plan, ON)).toEqual([
      expect.stringContaining('The roster has "Ada" — push it to the contact'),
    ]);
  });

  it("blocks two names that disagree, quoting the one that will actually render", () => {
    const plan = planFor("Ada", "Adam");
    expect(plan.firstNameConflict).toEqual([
      { email: "ada@example.com", roster: "Ada", resend: "Adam", rosterId: "ada" },
    ]);
    expect(contactSyncBlockers(plan, ON)).toEqual([
      expect.stringContaining('sends "Hey Adam —" while the roster says "Ada"'),
    ]);
  });

  it("does not block a contact name the roster simply does not carry", () => {
    // The over-fire. This drifts, but the mail greets them correctly by name —
    // the old blocker printed `sends "Hey Jeff —"` as if that were the defect.
    // It stays in the drift report as the warning it is.
    const plan = planFor(null, "Jeff");
    expect(plan.firstNameDrift).toEqual([
      { email: "ada@example.com", roster: null, resend: "Jeff", rosterId: "ada" },
    ]);
    expect(plan.missingFirstName).toEqual([]);
    expect(plan.firstNameConflict).toEqual([]);
    expect(contactSyncBlockers(plan, ON)).toEqual([]);
  });

  it("does not block when both sides carry the same name", () => {
    expect(contactSyncBlockers(planFor("Ada", "Ada"), ON)).toEqual([]);
  });

  it("ignores a nameless recipient Resend will skip anyway", () => {
    // An unsubscribed contact gets no Broadcast, so there is no greeting to get
    // wrong — and demanding a name for someone who opted out before we ever
    // confirmed one is a gate that can never go green.
    const plan = planContactSync(
      [{ id: "ada", name: "Ada Stream", firstName: null, email: "ada@example.com" }],
      [{ at: "2026-09-23T09:00:00Z", reason: "replied", email: "ada@example.com" }],
      [{ email: "ada@example.com", unsubscribed: true, firstName: null }],
    );
    expect(plan.toUnsubscribe).toEqual([]); // nothing else is firing
    expect(plan.missingFirstName).toEqual([]);
    expect(contactSyncBlockers(plan, ON)).toEqual([]);
    // Positive control: the same nameless row still blocks once it is a live
    // recipient, so the empty result above is the exclusion and not a no-op.
    expect(contactSyncBlockers(planFor(null, null), ON)).toHaveLength(1);
  });

  it("skips a row the ledger has pulled but Resend still has subscribed", () => {
    // Same exclusion from the other side: this row is on its way to
    // unsubscribed, so it reports the sync blocker it already had and does not
    // also demand a greeting for a send that will not happen.
    const plan = planFor(null, null, [
      { at: "2026-09-23T09:00:00Z", reason: "replied", email: "ada@example.com" },
    ]);
    expect(plan.missingFirstName).toEqual([]);
    expect(contactSyncBlockers(plan, ON)).toEqual([
      expect.stringContaining("ledger says replied"),
    ]);
  });

  it("stays off by default for every shape", () => {
    for (const plan of [planFor(null, null), planFor("Ada", null), planFor("Ada", "Adam")]) {
      expect(contactSyncBlockers(plan)).toEqual([]);
    }
  });

  it("carries the fixture the flag was added for: a contact with no name on either side", () => {
    // ROSTER's `tundrabyte` row is the "Hey TundraByte" case v5 was written to
    // kill: a channel name, no confirmed first name, and a contact that has
    // never been given one. Wired through the real fixture rather than a
    // hand-built row so the shape the live audience actually holds is covered.
    const plan = planContactSync(ROSTER, [], SUBSCRIBED);
    expect(plan.firstNameDrift).toEqual([]);
    expect(plan.missingFirstName).toEqual([
      { email: "tundrabyte@example.com", roster: null, rosterId: "tundrabyte" },
    ]);
    expect(contactSyncBlockers(plan)).toEqual([]);
    expect(contactSyncBlockers(plan, ON)).toEqual([
      expect.stringContaining("tundrabyte@example.com: the Resend contact has no first_name"),
    ]);
  });
});
