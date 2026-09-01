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

Both channels need `RESEND_API_KEY` and `--audience`, including `--channel dm`.
The hosted unsubscribe link is the only opt-out the email copy offers, so a click
on it is the primary opt-out event for Wave 1 — and it exists only in Resend's
contact state. A DM preflight that skipped that read would clear a T2/T3 DM to
someone who unsubscribed at T1. If Resend is unreachable the gate stops the
touch; blocking during an outage is the safe direction.

```bash
pnpm install                          # a fresh checkout has no node_modules
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

# 3. DM channel — same ledger keyed by handle, plus the same live Resend read,
#    so an email unsubscribe suppresses the DM too.
node scripts/outreach/wave1-preflight.mjs ... --touch T2 --channel dm
```

**Exit code 0 is the gate.** Non-zero means do not send that touch. Keep the
`--json` output as the audit record of who was suppressed and why.

### What has to agree before T1

The audience and the roster must match **in both directions**, because a
Broadcast sends to the *audience* — the audience is the send list, and the
roster is only our description of it.

- **Roster ∖ audience** blocks (`not-in-audience`). A non-contact has no hosted
  unsubscribe URL, so mailing them would break the promise in the copy — and a
  silently short send list would read as "all N were mailed" when N−k were.
- **Audience ∖ roster** blocks too, when the stray contact is *subscribed*: it
  receives Wave 1 while appearing in no decision line and in no audit record.
  An unsubscribed stray is reported and not blocked, because Resend skips it.

`--require-first-names` promotes first-name drift from a warning to a blocker.
Leave it off on send day — drift downgrades the greeting to "Hey there —", which
is a copy miss and not a broken opt-out, and `block` is reserved for the latter.
Turn it on when *building* the audience (SPO-280), where the whole point is to
carry SPO-269's confirmed names: without it a green preflight is compatible with
every greeting silently falling back.

## File formats

Neither file is in the repo yet — SPO-267 is still resolving contact channels
and SPO-280 is populating the audience. The paths above are where they land.

`--roster` — JSON array (or `{"roster": [...]}`). `id` must be stable and unique,
and no two rows may share an email — nor an `xHandle`. Either collision is one
recipient with two decision lines. On email, if the rows disagree about first
name or handle, which greeting and which suppression apply becomes
order-dependent; on DM the handle is the only recipient key, so a shared one
prints two `SEND` lines and DMs one person twice at the same touch. Both are hard
errors, and both compare *normalized* values, so `@SamStream` and `samstream`
collide. Rows with no handle at all (`"xHandle": null`, the email-only cohort) do
not collide with each other.

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
Append-only; entries never expire.

Every line is validated, and each rule below rejects an entry that *looks*
present while suppressing nobody — which downstream is indistinguishable from
"this person never opted out", i.e. a send. All three are hard errors rather
than a silently dropped opt-out:

- `reason` must be one of the six below. A missing or unrecognized one indexes
  the address to `undefined`: present to `has()`, absent to `get()`.
- `email`/`xHandle` must survive normalization. `"   "` and `"@"` are truthy and
  match nobody, so presence alone is not enough.
- `at` must be a non-empty timestamp; it drives the earliest-reason-wins tiebreak.

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
- **A contact read it cannot prove is complete is an error, not a short list.**
  If Resend returns a full page and omits `has_more`, the gate exits 2 instead of
  paginating no further. Truncation looks like the safe direction — a dropped
  contact makes its roster row read `not-in-audience` and blocks — but it also
  hides a contact on *no* roster row, so the "in the audience but on no roster
  row" section under-reports and the audience reads clean when it is not. An
  explicit `has_more: false` on a full page is fine; only an absent field is not.

The decision rules themselves are in `packages/shared/src/wave1-suppression.ts`
with tests alongside. `wave1-preflight.test.ts` covers the CLI's own guards by
spawning it against a stub Resend server and asserting on the exit code —
`scripts/**/*.test.ts` is inside `scripts/vitest-api.config.ts`'s `include`, so
it runs in CI. It exercises the real binary deliberately: SPO-278's F1 was a
defect a unit test hand-supplying inputs reported as covered while the CLI could
not reach the path at all.

`WAVE1_PREFLIGHT_RESEND_API_BASE` exists for that test and nothing else. Setting
it points the gate at a fake audience, so any run that does prints a banner on
stdout *and* stderr. If you see that line in preflight evidence, the evidence is
worthless — re-run without it.
