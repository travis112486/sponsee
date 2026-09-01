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
// unsubscribe, so the same ledger is the only gate, keyed by handle.

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

export interface LedgerEntry {
  /** ISO 8601 instant the signal was observed. */
  at: string;
  reason: SuppressionReason;
  /** At least one of these must be set, or the entry matches nobody. */
  email?: string | null;
  xHandle?: string | null;
  note?: string;
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

export interface TouchPlan {
  touch: OutreachTouch;
  channel: OutreachChannel;
  decisions: RosterDecision[];
  /** True only when nothing is blocked. The CLI exits non-zero when false. */
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
 */
export function indexLedger(entries: readonly LedgerEntry[]): LedgerIndex {
  const byEmail = new Map<string, SuppressionReason>();
  const byHandle = new Map<string, SuppressionReason>();

  const ordered = [...entries].sort((a, b) => {
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
   * Live contact state read from Resend immediately before the touch. Required
   * on the email channel; ignored on `dm`. "Live" is the point — a snapshot
   * taken when T1 went out is four to nine days stale by T2/T3.
   */
  contacts?: readonly ResendContactState[];
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

  const contactsByEmail = new Map<string, ResendContactState>();
  for (const contact of input.contacts ?? []) {
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

  return {
    touch,
    channel,
    decisions,
    clearToSend: !decisions.some((d) => d.decision.action === "block"),
  };
}

// ── Projecting the ledger into Resend ────────────────────────────────────────

export interface ContactSyncPlan {
  /** Roster rows with an address that Resend has never seen. Create before T1. */
  toCreate: Array<{ email: string; firstName: string | null; rosterId: string }>;
  /**
   * Contacts our ledger says are out but Resend still has as subscribed.
   * Pushing these is what makes Resend's own Broadcast exclusion honor a reply
   * or a "stop" — signals Resend has no way to observe on its own.
   */
  toUnsubscribe: Array<{ email: string; reason: SuppressionReason; rosterId: string }>;
  /**
   * Contacts whose first name disagrees with the roster. Left as a report
   * rather than an auto-fix: the greeting is the most visible line in the mail
   * and a silent overwrite in either direction is the wrong default.
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
    const contact = contactsByEmail.get(email);

    if (contact === undefined) {
      plan.toCreate.push({ email, firstName: rosterFirstName, rosterId: row.id });
      continue;
    }

    const handle = normalizeHandle(row.xHandle);
    const reason =
      index.byEmail.get(email) ?? (handle !== null ? index.byHandle.get(handle) : undefined);
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
