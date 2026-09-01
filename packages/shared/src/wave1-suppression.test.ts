import { describe, it, expect } from "vitest";
import {
  greetingName,
  indexLedger,
  normalizeEmail,
  normalizeHandle,
  planContactSync,
  planTouch,
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
    const plan = planTouch({ touch: "T1", channel: "dm", roster: ROSTER, ledger: [] });
    expect(decisionFor(plan, "ada")).toEqual({ action: "send", recipient: "@adastream" });
    expect(decisionFor(plan, "craft")).toEqual({ action: "send", recipient: "@craftcomputing" });
    expect(plan.clearToSend).toBe(true);
  });
});

describe("planContactSync", () => {
  it("lists roster rows Resend has never seen", () => {
    const plan = planContactSync(ROSTER, [], [SUBSCRIBED[0]]);
    expect(plan.toCreate).toEqual([{ email: "craft@example.com", firstName: null, rosterId: "craft" }]);
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
});
