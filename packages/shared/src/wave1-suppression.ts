// Wave 1 outreach suppression gate (SPO-270).
//
// GTM tooling, not product code — nothing in the app imports this. It lives in
// @sponsee/shared for one reason: `scripts/**` is outside every vitest
// `include` glob, so logic parked there ships untested. `packages/*/src/**` is
// covered, so the decision rules below run in CI. The CLI wrapper that talks to
// Resend is `scripts/outreach/wave1-preflight.mjs`; it holds no rules of its own.
//
// ── Why this file exists ─────────────────────────────────────────────────────
//
// SPO-268's v5 copy promises Wave 1 recipients a working opt-out. There is no
// product send job to hang that promise on: Wave 1 goes out the same way the
// SPO-198 warm-up ramp does — an agent calling the Resend API. So the gate has
// to live where the send is composed, and it has to be enforced by something
// that cannot be forgotten on send day.
//
// The enforcement point is Resend itself. Resend skips `unsubscribed` contacts
// when sending a Broadcast, so once a suppression is reflected in the contact's
// state there is no code path left that can mail them. This module's job is
// therefore NOT to re-implement suppression — it is to (a) project the reasons
// Resend cannot know about (a reply, a "stop", a manual pull) into that contact
// state, and (b) refuse the touch outright when the two sides disagree in a way
// that would make the opt-out decorative.
//
// The DM channel (1B) has no provider primitive at all. X exposes no
// unsubscribe, so the same ledger is the only gate, keyed by handle — plus the
// live Resend read, because an email unsubscribe has to silence the DM too.
//
// ── The invariant everything here serves ─────────────────────────────────────
//
// Every way this file can be wrong is a way to mail someone who opted out, so
// every ambiguous input resolves toward *stopping the touch*: a suppression we
// cannot match, a ledger line we cannot parse, a contact we cannot account for.
// Blocking a touch costs a day. The other direction costs the promise the copy
// makes.

/** Which channel a touch goes out on. Email is Resend; dm is X/Twitter. */
export type OutreachChannel = "email" | "dm";

/** Touch identifier. T1 = day 0, T2 = +4d, T3 = +9d (v5 §Timing). */
export type OutreachTouch = "T1" | "T2" | "T3";

export interface RosterRow {
  /** Stable per-creator key. Survives a name or handle change. */
  id: string;
  /** Display/channel name, e.g. "Craft Computing". Never used as a greeting. */
  name: string;
  /**
   * Real first name where one is confirmed (SPO-269). `null` when unknown —
   * which must render as v5's "Hey there —" fallback, never as `name`.
   */
  firstName?: string | null;
  email?: string | null;
  xHandle?: string | null;
}

/**
 * Why a recipient is suppressed.
 *
 * `replied` covers the standing ground rule that any reply — positive or
 * negative — exits the sequence. `stop_requested` is the DM channel's explicit
 * opt-out. The rest mirror provider signals we already ingest elsewhere.
 */
export type SuppressionReason =
  | "replied"
  | "stop_requested"
  | "unsubscribed"
  | "bounced"
  | "complained"
  | "manual";

/**
 * The union above, at runtime. The ledger is a hand-edited file read through
 * `JSON.parse`, so the reason has to be checked against a real list — the type
 * annotation erases at exactly that boundary.
 */
export const SUPPRESSION_REASONS: readonly SuppressionReason[] = [
  "replied",
  "stop_requested",
  "unsubscribed",
  "bounced",
  "complained",
  "manual",
];

export function isSuppressionReason(value: unknown): value is SuppressionReason {
  return typeof value === "string" && (SUPPRESSION_REASONS as readonly string[]).includes(value);
}

export interface LedgerEntry {
  /** ISO 8601 instant the signal was observed. */
  at: string;
  reason: SuppressionReason;
  /**
   * At least one of these must survive normalization, or the entry matches
   * nobody. Presence is not enough — `"   "` and `"@"` are both truthy and both
   * normalize to null, so an entry carrying one of them is an opt-out that
   * silently applies to no one.
   */
  email?: string | null;
  xHandle?: string | null;
  note?: string;
}

/**
 * Validate one ledger entry, returning it normalized, or throw.
 *
 * This lives here rather than in the CLI on purpose: a ledger entry that fails
 * to match its recipient is an opt-out dropped on the floor, so the check
 * belongs in the tested module.
 *
 * Both rejections below describe entries that are *structurally* indistinguish-
 * able downstream from "this person never opted out", because every consumer
 * tests `reason !== undefined` against a map:
 *
 *   - an absent or unrecognized `reason` indexes the address to `undefined`, so
 *     `has()` is true while `get()` is not a suppression;
 *   - an address that is truthy but normalizes to null indexes under no key at
 *     all, so the entry suppresses nobody.
 *
 * `label` is prefixed to the message; the CLI passes `file:line`.
 */
export function validateLedgerEntry(value: unknown, label = "ledger entry"): LedgerEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label}: expected a JSON object`);
  }
  const entry = value as Record<string, unknown>;

  // `at` drives the "earliest reason wins" tiebreak below. A missing one still
  // suppresses (it sorts last and is kept) but can report the wrong reason, so
  // require it rather than degrade quietly.
  if (typeof entry.at !== "string" || entry.at.trim().length === 0) {
    throw new Error(`${label}: "at" must be a non-empty ISO 8601 timestamp string`);
  }
  if (!isSuppressionReason(entry.reason)) {
    throw new Error(
      `${label}: "reason" must be one of ${SUPPRESSION_REASONS.join(", ")} — got ` +
        `${JSON.stringify(entry.reason)}. An unrecognized reason indexes as undefined and ` +
        `reads downstream as "not suppressed".`,
    );
  }

  const email = normalizeEmail(entry.email as string | null | undefined);
  const xHandle = normalizeHandle(entry.xHandle as string | null | undefined);
  if (email === null && xHandle === null) {
    throw new Error(
      `${label}: neither "email" nor "xHandle" survives normalization, so this entry would ` +
        `match nobody (email=${JSON.stringify(entry.email)}, xHandle=${JSON.stringify(entry.xHandle)})`,
    );
  }

  return {
    at: entry.at,
    reason: entry.reason,
    email,
    xHandle,
    ...(typeof entry.note === "string" ? { note: entry.note } : {}),
  };
}

/** A contact as Resend currently reports it. */
export interface ResendContactState {
  email: string;
  unsubscribed: boolean;
  firstName?: string | null;
}

export type Decision =
  /** Clear to send this touch. */
  | { action: "send"; recipient: string }
  /** Deliberately not sent. Not an error — record it and move on. */
  | { action: "suppress"; reason: SuppressionReason; source: "ledger" | "resend" | "cross-channel" }
  /** No address/handle on this channel. Expected while SPO-267 is open. */
  | { action: "skip"; reason: "no-address" }
  /**
   * The touch must not proceed for anyone until this is fixed. A block means
   * the opt-out would be broken for this recipient, which is worse than not
   * mailing them at all.
   */
  | { action: "block"; reason: BlockReason };

export type BlockReason =
  /**
   * On the roster with an address, but absent from the Resend audience. A
   * Broadcast only reaches audience contacts, and only a contact has a hosted
   * unsubscribe URL — so this row would either not send at all or send without
   * a working opt-out.
   */
  | "not-in-audience";

export interface RosterDecision {
  rosterId: string;
  name: string;
  decision: Decision;
}

/**
 * An audience contact matching no roster row.
 *
 * The inverse of `not-in-audience`, and the direction that actually delivers
 * mail: a Broadcast sends to the *audience*, so the audience is the send list.
 * A stray subscribed contact receives Wave 1 while appearing in no decision line
 * and in no audit record.
 */
export interface UnknownRecipient {
  email: string;
  unsubscribed: boolean;
}

export interface TouchPlan {
  touch: OutreachTouch;
  channel: OutreachChannel;
  decisions: RosterDecision[];
  /**
   * Audience contacts on no roster row. Always computed, so a DM run still
   * reports them, but only blocking on `email` — see `clearToSend`.
   */
  unknownRecipients: UnknownRecipient[];
  /**
   * True only when nothing is blocked. The CLI exits non-zero when false.
   *
   * A *subscribed* unknown recipient blocks an email touch for the same reason
   * `not-in-audience` does: the send list and the roster must agree before a
   * Broadcast goes out. An unsubscribed one does not — Resend skips it, so it is
   * reported and harmless. On `dm` the send list is the roster's handles and
   * audience membership decides nothing, so neither blocks.
   */
  clearToSend: boolean;
}

// ── Normalization ────────────────────────────────────────────────────────────
//
// Both keys are matched case-insensitively. An opt-out that misses because the
// ledger recorded `Ada@Example.com` and the roster holds `ada@example.com` is
// exactly the failure this whole file exists to prevent, so normalize once and
// compare only normalized values.

export function normalizeEmail(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/** Strips a leading `@` and lowercases. X handles are case-insensitive. */
export function normalizeHandle(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^@+/, "").toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * v5's greeting rule. Falls back to "there" when no real first name is
 * confirmed — never to the channel/brand name, which is the mail-merge tell
 * v5 was written to remove.
 *
 * On the email channel Resend renders `{{{contact.first_name|there}}}` from the
 * *contact*, not from our roster, which is why `planContactSync` treats a
 * roster-vs-contact first-name mismatch as drift worth reporting: the send would
 * silently degrade to "Hey there" for someone we do know the name of.
 */
export function greetingName(firstName: string | null | undefined): string {
  const trimmed = typeof firstName === "string" ? firstName.trim() : "";
  return trimmed.length > 0 ? trimmed : "there";
}

// ── Ledger lookup ────────────────────────────────────────────────────────────

interface LedgerIndex {
  byEmail: Map<string, SuppressionReason>;
  byHandle: Map<string, SuppressionReason>;
}

/**
 * Index the ledger for lookup. Entries are additive and never expire: once a
 * recipient is in, they stay in. When one recipient has several entries the
 * earliest is kept, because the reason we report should be the one that
 * actually removed them from the sequence.
 *
 * Every entry is validated first. That is a second line of defence behind the
 * CLI's own parse, and it is what makes the rule unskippable: no caller can
 * reach a plan through this module carrying an entry that suppresses nobody.
 */
export function indexLedger(entries: readonly LedgerEntry[]): LedgerIndex {
  const byEmail = new Map<string, SuppressionReason>();
  const byHandle = new Map<string, SuppressionReason>();

  const validated = entries.map((entry, i) => validateLedgerEntry(entry, `ledger entry ${i}`));

  const ordered = [...validated].sort((a, b) => {
    const at = Date.parse(a.at);
    const bt = Date.parse(b.at);
    // An unparseable timestamp must not silently reorder — or worse, drop —
    // an entry. Sort it last and keep it.
    if (Number.isNaN(at) && Number.isNaN(bt)) return 0;
    if (Number.isNaN(at)) return 1;
    if (Number.isNaN(bt)) return -1;
    return at - bt;
  });

  for (const entry of ordered) {
    const email = normalizeEmail(entry.email);
    if (email !== null && !byEmail.has(email)) byEmail.set(email, entry.reason);
    const handle = normalizeHandle(entry.xHandle);
    if (handle !== null && !byHandle.has(handle)) byHandle.set(handle, entry.reason);
  }

  return { byEmail, byHandle };
}

// ── The gate ─────────────────────────────────────────────────────────────────

export interface PlanTouchInput {
  touch: OutreachTouch;
  channel: OutreachChannel;
  roster: readonly RosterRow[];
  ledger: readonly LedgerEntry[];
  /**
   * Live contact state read from Resend immediately before the touch.
   *
   * Required on **both** channels, and required rather than optional on
   * purpose. The hosted unsubscribe URL is the only opt-out v5's email copy
   * offers, so clicking it is the primary opt-out event for Wave 1 — and it
   * lands in Resend's contact state and nowhere else. A DM plan built without
   * this read cannot see that click, so it would DM at T2/T3 someone who
   * unsubscribed at T1. An optional field is what previously let the CLI omit
   * it on `dm` while a unit test that hand-supplied `contacts` reported the
   * cross-channel rule as enforced.
   *
   * "Live" is the other half: a snapshot taken when T1 went out is four to nine
   * days stale by T2/T3.
   */
  contacts: readonly ResendContactState[];
}

/**
 * Decide, per roster row, whether this touch may go to them.
 *
 * Ordering is deliberate: the ledger is consulted before Resend. Both are
 * authoritative for suppression, but the ledger holds the reasons a human
 * observed (a reply, a "stop") and those are the ones worth reporting when a
 * recipient is suppressed for several reasons at once.
 */
export function planTouch(input: PlanTouchInput): TouchPlan {
  const { touch, channel, roster, ledger } = input;
  const index = indexLedger(ledger);

  // The CLI is plain JS, so the required-ness of `contacts` has to be enforced
  // at runtime too — a type a caller can ignore is not a gate.
  if (!Array.isArray(input.contacts)) {
    throw new Error(
      `planTouch requires live Resend contact state on every channel, including "${channel}". ` +
        `Without it an email unsubscribe cannot suppress the DM, and the plan would report ` +
        `"send" for someone who has already opted out.`,
    );
  }

  const contactsByEmail = new Map<string, ResendContactState>();
  for (const contact of input.contacts) {
    const email = normalizeEmail(contact.email);
    if (email !== null) contactsByEmail.set(email, contact);
  }

  const decisions = roster.map<RosterDecision>((row) => {
    const email = normalizeEmail(row.email);
    const handle = normalizeHandle(row.xHandle);
    const base = { rosterId: row.id, name: row.name };

    // An opt-out on either channel silences both. Someone who unsubscribed from
    // the email has opted out of Wave 1, not merely out of one transport, and
    // DMing them next would read as a deliberate end-run around the choice they
    // just made. v5 does not say this; it should, and the gate enforces it
    // rather than waiting for the copy to catch up.
    const emailSuppression = email !== null ? index.byEmail.get(email) : undefined;
    const emailUnsubscribed =
      email !== null && contactsByEmail.get(email)?.unsubscribed === true;

    if (channel === "dm") {
      if (handle === null) {
        return { ...base, decision: { action: "skip", reason: "no-address" } };
      }
      const handleSuppression = index.byHandle.get(handle);
      if (handleSuppression !== undefined) {
        return {
          ...base,
          decision: { action: "suppress", reason: handleSuppression, source: "ledger" },
        };
      }
      if (emailSuppression !== undefined) {
        return {
          ...base,
          decision: { action: "suppress", reason: emailSuppression, source: "cross-channel" },
        };
      }
      if (emailUnsubscribed) {
        return {
          ...base,
          decision: { action: "suppress", reason: "unsubscribed", source: "cross-channel" },
        };
      }
      return { ...base, decision: { action: "send", recipient: `@${handle}` } };
    }

    if (email === null) {
      return { ...base, decision: { action: "skip", reason: "no-address" } };
    }
    if (emailSuppression !== undefined) {
      return {
        ...base,
        decision: { action: "suppress", reason: emailSuppression, source: "ledger" },
      };
    }
    // A handle-side "stop" suppresses the email too, same reasoning as above.
    const handleSuppression = handle !== null ? index.byHandle.get(handle) : undefined;
    if (handleSuppression !== undefined) {
      return {
        ...base,
        decision: { action: "suppress", reason: handleSuppression, source: "cross-channel" },
      };
    }
    const contact = contactsByEmail.get(email);
    if (contact === undefined) {
      return { ...base, decision: { action: "block", reason: "not-in-audience" } };
    }
    if (contact.unsubscribed) {
      return {
        ...base,
        decision: { action: "suppress", reason: "unsubscribed", source: "resend" },
      };
    }
    return { ...base, decision: { action: "send", recipient: email } };
  });

  // Walk the audience, not only the roster. Everything above answers "is this
  // roster row safe to mail". This answers the question a Broadcast actually
  // asks — "who is on the send list" — and the two sets are not the same.
  const rosterEmails = new Set<string>();
  for (const row of roster) {
    const email = normalizeEmail(row.email);
    if (email !== null) rosterEmails.add(email);
  }
  const unknownRecipients: UnknownRecipient[] = [];
  for (const contact of input.contacts) {
    const email = normalizeEmail(contact.email);
    if (email === null || rosterEmails.has(email)) continue;
    unknownRecipients.push({ email, unsubscribed: contact.unsubscribed === true });
  }

  const blockedRow = decisions.some((d) => d.decision.action === "block");
  const blockedByStranger =
    channel === "email" && unknownRecipients.some((c) => !c.unsubscribed);

  return {
    touch,
    channel,
    decisions,
    unknownRecipients,
    clearToSend: !blockedRow && !blockedByStranger,
  };
}

// ── Projecting the ledger into Resend ────────────────────────────────────────

export interface ContactToCreate {
  email: string;
  firstName: string | null;
  rosterId: string;
  /**
   * Create this contact already unsubscribed.
   *
   * True when the ledger holds a suppression for the row. Resend creates
   * contacts subscribed by default, so following the runbook's "add every roster
   * row before T1" step on such a row would arm precisely the send the ledger
   * says must not happen. `contactSyncBlockers` refuses the touch until the
   * contact exists, so this flag is an instruction, not a hope.
   */
  unsubscribed: boolean;
}

export interface ContactSyncPlan {
  /** Roster rows with an address that Resend has never seen. Create before T1. */
  toCreate: ContactToCreate[];
  /**
   * Contacts our ledger says are out but Resend still has as subscribed.
   * Pushing these is what makes Resend's own Broadcast exclusion honor a reply
   * or a "stop" — signals Resend has no way to observe on its own.
   */
  toUnsubscribe: Array<{ email: string; reason: SuppressionReason; rosterId: string }>;
  /**
   * Contacts whose first name disagrees with the roster. Reported rather than
   * auto-fixed: the greeting is the most visible line in the mail and a silent
   * overwrite in either direction is the wrong default.
   */
  firstNameDrift: Array<{ email: string; roster: string | null; resend: string | null; rosterId: string }>;
}

export function planContactSync(
  roster: readonly RosterRow[],
  ledger: readonly LedgerEntry[],
  contacts: readonly ResendContactState[],
): ContactSyncPlan {
  const index = indexLedger(ledger);
  const contactsByEmail = new Map<string, ResendContactState>();
  for (const contact of contacts) {
    const email = normalizeEmail(contact.email);
    if (email !== null) contactsByEmail.set(email, contact);
  }

  const plan: ContactSyncPlan = { toCreate: [], toUnsubscribe: [], firstNameDrift: [] };

  for (const row of roster) {
    const email = normalizeEmail(row.email);
    if (email === null) continue;

    const rosterFirstName =
      typeof row.firstName === "string" && row.firstName.trim().length > 0
        ? row.firstName.trim()
        : null;
    const handle = normalizeHandle(row.xHandle);
    const reason =
      index.byEmail.get(email) ?? (handle !== null ? index.byHandle.get(handle) : undefined);
    const contact = contactsByEmail.get(email);

    if (contact === undefined) {
      plan.toCreate.push({
        email,
        firstName: rosterFirstName,
        rosterId: row.id,
        unsubscribed: reason !== undefined,
      });
      continue;
    }

    if (reason !== undefined && !contact.unsubscribed) {
      plan.toUnsubscribe.push({ email, reason, rosterId: row.id });
    }

    const resendFirstName =
      typeof contact.firstName === "string" && contact.firstName.trim().length > 0
        ? contact.firstName.trim()
        : null;
    if (rosterFirstName !== resendFirstName) {
      plan.firstNameDrift.push({
        email,
        roster: rosterFirstName,
        resend: resendFirstName,
        rosterId: row.id,
      });
    }
  }

  return plan;
}

export interface ContactSyncBlockerOptions {
  /**
   * Promote first-name drift from a warning to a blocker.
   *
   * Off by default: drift degrades the greeting to "Hey there —", which is a
   * copy-quality miss rather than a broken opt-out, and `block` is otherwise
   * reserved for the latter. SPO-280 populates the audience *in order to* carry
   * SPO-269's confirmed names, so its acceptance check runs with this on —
   * without it a green preflight is compatible with every greeting silently
   * falling back.
   */
  requireFirstNames?: boolean;
}

/**
 * Reasons the audience is not ready, in the operator's words. Empty means ready.
 *
 * The CLI exits non-zero when this is non-empty, so these are rules that decide
 * whether a touch may proceed — which is why they live here under test rather
 * than as an `if` in the script.
 */
export function contactSyncBlockers(
  plan: ContactSyncPlan,
  options: ContactSyncBlockerOptions = {},
): string[] {
  const blockers: string[] = [];

  for (const row of plan.toUnsubscribe) {
    blockers.push(
      `${row.email}: ledger says ${row.reason} but Resend still has them subscribed — ` +
        `a Broadcast would mail them. Re-run with --apply-suppressions. [${row.rosterId}]`,
    );
  }

  // The ordering trap: planTouch consults the ledger before the audience, so a
  // suppressed row that is not yet a contact decides `suppress` rather than
  // `block` and never reaches toUnsubscribe — the count the gate keys on. Left
  // alone the operator reads "add every roster row before T1", creates the
  // contact subscribed, and the next Broadcast mails someone the ledger pulled.
  for (const row of plan.toCreate) {
    if (!row.unsubscribed) continue;
    blockers.push(
      `${row.email}: the ledger suppresses them but they are not in the audience yet — ` +
        `create the contact with unsubscribed=true before T1, never subscribed. [${row.rosterId}]`,
    );
  }

  if (options.requireFirstNames) {
    for (const row of plan.firstNameDrift) {
      blockers.push(
        `${row.email}: first name differs (roster=${row.roster ?? "—"}, resend=${row.resend ?? "—"}) — ` +
          `the greeting renders from the contact, so this sends "Hey ${greetingName(row.resend)} —". ` +
          `[${row.rosterId}]`,
      );
    }
  }

  return blockers;
}
