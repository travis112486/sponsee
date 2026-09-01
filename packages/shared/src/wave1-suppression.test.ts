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
// with a channel name but no confirmed first name (the "Hey Craft Computing"
// case v5 was written to kill), and one reachable on X only.
const ROSTER: RosterRow[] = [
  { id: "ada", name: "Ada Stream", firstName: "Ada", email: "ada@example.com", xHandle: "@adastream" },
  { id: "craft", name: "Craft Computing", firstName: null, email: "craft@example.com", xHandle: "craftcomputing" },
  { id: "doki", name: "Dokibird", firstName: "Doki", email: null, xHandle: "@dokibird" },
];

const SUBSCRIBED: ResendContactState[] = [
  { email: "ada@example.com", unsubscribed: false, firstName: "Ada" },
  { email: "craft@example.com", unsubscribed: false, firstName: null },
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
      { email: "craft@example.com", unsubscribed: false, firstName: null },
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
    expect(decisionFor(plan, "craft")).toEqual({ action: "send", recipient: "craft@example.com" });
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
    expect(decisionFor(plan, "craft")).toEqual({ action: "block", reason: "not-in-audience" });
    expect(plan.clearToSend).toBe(false);
  });

  it("skips a row with no email without blocking the touch", () => {
    const plan = planTouch({ touch: "T1", channel: "email", roster: ROSTER, ledger: [], contacts: SUBSCRIBED });
    expect(decisionFor(plan, "doki")).toEqual({ action: "skip", reason: "no-address" });
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
      ledger: [{ at: "2026-09-23T09:00:00Z", reason: "stop_requested", xHandle: "dokibird" }],
      contacts: SUBSCRIBED,
    });
    expect(decisionFor(plan, "doki")).toEqual({
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
    expect(decisionFor(plan, "craft")).toEqual({ action: "send", recipient: "@craftcomputing" });
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
      validateLedgerEntry({ at: "2026-09-23T09:00:00Z", xHandle: "@dokibird" }, "ledger.jsonl:1"),
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

describe("planContactSync", () => {
  it("lists roster rows Resend has never seen", () => {
    const plan = planContactSync(ROSTER, [], [SUBSCRIBED[0]]);
    expect(plan.toCreate).toEqual([
      { email: "craft@example.com", firstName: null, rosterId: "craft", unsubscribed: false },
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
      [{ at: "2026-09-20T09:00:00Z", reason: "manual", email: "craft@example.com" }],
      [SUBSCRIBED[0]],
    );
    expect(plan.toUnsubscribe).toEqual([]);
    expect(plan.toCreate).toEqual([
      { email: "craft@example.com", firstName: null, rosterId: "craft", unsubscribed: true },
    ]);
  });

  it("picks up a handle-side stop for a row that is not yet a contact", () => {
    const plan = planContactSync(
      ROSTER,
      [{ at: "2026-09-20T09:00:00Z", reason: "stop_requested", xHandle: "@craftcomputing" }],
      [SUBSCRIBED[0]],
    );
    expect(plan.toCreate[0]).toMatchObject({ rosterId: "craft", unsubscribed: true });
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
      [{ at: "2026-09-20T09:00:00Z", reason: "manual", email: "craft@example.com" }],
      [SUBSCRIBED[0]],
    );
    expect(plan.toUnsubscribe).toHaveLength(0); // the count the old gate used
    expect(contactSyncBlockers(plan)).toEqual([
      expect.stringContaining("create the contact with unsubscribed=true"),
    ]);
  });

  it("treats first-name drift as a warning by default and a blocker on request", () => {
    // Drift degrades the greeting to "Hey there —": a copy miss, not a broken
    // opt-out, so it must not fail a send-day touch on its own. SPO-280 builds
    // the audience in order to carry SPO-269's names, so its acceptance check
    // opts in and gets an exit code rather than a line of output to notice.
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
