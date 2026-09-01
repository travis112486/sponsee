# Wave 1 outreach — send-time suppression gate (SPO-270)

SPO-268's v5 copy promises Wave 1 recipients a working opt-out. This directory
is what makes that promise real rather than decorative.

**Nothing here sends anything.** Send authority for Wave 1 sits with the founder
on SPO-264; the preflight deliberately has no send path.

## The one thing to know

**Send Wave 1 email as a Resend Broadcast, not as per-recipient `POST /emails`.**

Resend skips `unsubscribed` contacts when sending a Broadcast. That makes the
T2/T3 suppression SPO-270 asks for a property of the provider rather than of a
check we remembered to run — there is no code path left that can mail someone
who opted out.

The transactional `POST /emails` path cannot do this:

- `{{{RESEND_UNSUBSCRIBE_URL}}}` is a **Broadcasts-only** merge tag. `POST /emails`
  takes no audience or contact, so it has nothing to mint a per-contact hosted
  unsubscribe URL from. Put that tag in a transactional send and it ships to the
  recipient as literal text.
- On that path Resend expects you to host your own unsubscribe endpoint and set
  `List-Unsubscribe` yourself, and it enforces no suppression at all.

Broadcasts also cover two other v5 requirements natively: `reply_to` for
`Reply-To: hello@sponsee.app`, and `{{{contact.first_name|there}}}` for the
first-name merge field with v5's exact "Hey there —" fallback.

## What Broadcasts do *not* cover

Resend has no notion of a reply, of a "stop" in an X DM, or of an X handle at
all. Those are the residual gap, and the preflight closes it by projecting them
into the contact state Resend *does* enforce on:

```
ledger (replies, stops, manual pulls)  ──apply──▶  Resend contact.unsubscribed
                                                          │
                                                          ▼
                                              Broadcast skips them. Always.
```

## Send-day runbook

Run this immediately before **every** touch — T1, T2 and T3, on both channels.
A snapshot taken at T1 is four to nine days stale by T2/T3, which is the whole
reason this exists.

```bash
pnpm --filter @sponsee/shared build   # the rules live in @sponsee/shared

source ~/.config/infisical-agent/credentials.env
export INFISICAL_TOKEN=$(infisical login --method=universal-auth \
  --client-id=$INFISICAL_CLIENT_ID --client-secret=$INFISICAL_CLIENT_SECRET --plain --silent)
export RESEND_API_KEY=$(infisical secrets get RESEND_API_KEY \
  --projectId $INFISICAL_PROJECT_ID --env prod --plain --silent)

# 1. Dry run — read-only. Shows the plan and anything unresolved.
node scripts/outreach/wave1-preflight.mjs \
  --roster outreach/wave1-roster.json \
  --ledger outreach/wave1-ledger.jsonl \
  --audience wave-1-outreach \
  --touch T2 --channel email

# 2. Push ledger-only suppressions into Resend, then re-verify.
node scripts/outreach/wave1-preflight.mjs ... --touch T2 --channel email \
  --apply-suppressions --json evidence/wave1-T2-email.json

# 3. DM channel — same ledger, keyed by handle. Needs no network.
node scripts/outreach/wave1-preflight.mjs ... --touch T2 --channel dm
```

**Exit code 0 is the gate.** Non-zero means do not send that touch. Keep the
`--json` output as the audit record of who was suppressed and why.

Before T1 the audience must contain every roster row that has an email — the
preflight blocks on `not-in-audience` precisely because a non-contact has no
hosted unsubscribe URL, so mailing them would break the promise in the copy.

## File formats

`--roster` — JSON array (or `{"roster": [...]}`). `id` must be stable and unique.

```json
[
  { "id": "ada", "name": "Ada Stream", "firstName": "Ada",
    "email": "ada@example.com", "xHandle": "@adastream" },
  { "id": "doki", "name": "Dokibird", "firstName": "Doki",
    "email": null, "xHandle": "@dokibird" }
]
```

`firstName: null` is the honest value when no real first name is confirmed — it
renders v5's "Hey there —". Never put the channel or brand name there; that is
the mail-merge tell v5 was written to remove.

`--ledger` — JSONL, one signal per line. `#` comments and blank lines ignored.
Append-only; entries never expire. A line that parses as neither an `email` nor
an `xHandle` match is a hard error rather than a silently dropped opt-out.

```jsonl
# Wave 1 suppression ledger
{"at":"2026-09-23T09:00:00Z","reason":"replied","email":"ada@example.com","note":"replied to T1"}
{"at":"2026-09-24T14:20:00Z","reason":"stop_requested","xHandle":"@dokibird","note":"DM1 reply: stop"}
```

Reasons: `replied`, `stop_requested`, `unsubscribed`, `bounced`, `complained`,
`manual`.

## Rules worth knowing before you read the output

- **An opt-out on either channel silences both.** Someone who unsubscribed from
  the email has opted out of Wave 1, not merely out of one transport — DMing
  them next reads as an end-run around the choice they just made. v5's copy does
  not say this; the gate enforces it anyway.
- **`block` is not `suppress`.** A block means the opt-out would be broken for
  that recipient, which is worse than not mailing them. It fails the whole touch.
- **`skip: no-address`** is expected while SPO-267 is still resolving contact
  channels. It does not fail the touch.
- Emails and handles are matched case-insensitively, with a leading `@` stripped.
  An opt-out that misses because the ledger recorded `Ada@Example.com` is exactly
  the failure this gate exists to prevent.

The decision rules themselves are in `packages/shared/src/wave1-suppression.ts`
with tests alongside — `scripts/**` is outside every vitest `include` glob, so
logic parked here would ship untested.
