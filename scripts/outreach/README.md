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

## Where the roster and ledger live

**Not in this repo, and not in any repo.** `travis112486/sponsee` is public.

The roster names real creators with their business email addresses and X
handles. The ledger is sharper still: from the first touch onward it records
`unsubscribed` / `complained` / `stop_requested` / `replied` against those same
named people, which is an opt-out record of an identifiable person. Committing
either publishes it to every clone and to GitHub code search — and because
`refs/pull/*` is permanent, a later history rewrite cannot take it back. So
`outreach/*.json` and `outreach/*.jsonl` are gitignored (SPO-415 / SPO-417).

Keep the real files outside the working tree and pass them explicitly:

```
~/.config/sponsee/outreach/wave1-roster.json
~/.config/sponsee/outreach/wave1-ledger.jsonl
```

`--roster` and `--ledger` are required arguments with no default, so there is no
path that silently falls back to an in-repo copy. Any location works; the one
above is the convention this runbook assumes.

**The tracked fixtures are the schema of record**, and every person in them is
invented:

| Fixture | What it documents |
| --- | --- |
| `outreach/wave1-roster.example.json` | Roster row shape — `id`, `name`, `firstName`, `email`, `xHandle` |
| `outreach/wave1-ledger.example.jsonl` | Ledger line shape — `at`, `reason`, `email` / `xHandle`, `note` |

Point `--roster` / `--ledger` at those two to exercise the gate without touching
real contact data. A fixture is a rehearsal, never a send-day input.

The roster's authoritative contents are the Wave 1 send list on SPO-408, not a
file in this tree.

**The same rule governs this document** (SPO-418). Every identity in every
example below — the T1 census included — comes from those fixtures, and no real
name, address, handle or roster id may be pasted back in. A real address here is
a disclosure, not a typo: the census is the whole target list in the most
greppable form there is, and pasting a live run into this file republishes it
just as surely as committing the roster would. Quote counts and decisions
freely; identities stay in the roster and on the ticket that decided them.

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

**`--ledger` must point at a file that exists.** It is the only hand-typed
argument on send day whose failure mode is mailing someone who opted out: a
missing file suppresses nobody, and downstream that is indistinguishable from
"nobody opted out". So a path that does not resolve is exit 2, not an empty
ledger — see [the ledger path is load-bearing](#the-ledger-path-is-load-bearing).

```bash
pnpm install                          # a fresh checkout has no node_modules
pnpm --filter @sponsee/shared build   # the rules live in @sponsee/shared

source ~/.config/infisical-agent/credentials.env
export INFISICAL_TOKEN=$(infisical login --method=universal-auth \
  --client-id=$INFISICAL_CLIENT_ID --client-secret=$INFISICAL_CLIENT_SECRET --plain --silent)
export RESEND_API_KEY=$(infisical secrets get RESEND_API_KEY \
  --projectId $INFISICAL_PROJECT_ID --env prod --plain --silent)

# 1. Dry run — read-only. Shows the plan and anything unresolved.
#    Both paths point OUTSIDE the repo — see "Where the roster and ledger live".
node scripts/outreach/wave1-preflight.mjs \
  --roster ~/.config/sponsee/outreach/wave1-roster.json \
  --ledger ~/.config/sponsee/outreach/wave1-ledger.jsonl \
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
- **A roster row the ledger suppresses, and the audience does not have yet, must
  be created `unsubscribed: true` — never subscribed.** Resend creates a contact
  subscribed by default, so obeying the first bullet on such a row arms exactly
  the send the ledger recorded an opt-out to prevent. The preflight tags these
  `CREATE UNSUBSCRIBED (ledger suppresses them)` under "Not yet in the audience"
  and blocks the touch — **on either channel** — until that contact exists
  *unsubscribed*. Creating it subscribed does not clear the gate — it only
  trades this blocker for the other one, the `--apply-suppressions` blocker on a
  now-existing subscribed contact. **`--apply-suppressions` does not clear this
  one.** That flag flips an *existing* subscribed contact, and a contact Resend
  has never seen cannot be flipped, so the row never enters its list. The two
  blockers read alike in the output and have different remedies: this one is
  fixed by hand, by creating the contact unsubscribed.

Neither of the two *directions* is a block on `--channel dm`, and deliberately
so: most of the DM cohort carries `"email": null`, so a `not-in-audience` block
would make the no-email carve-out permanently uncontactable. The third bullet
gets no such carve-out — `planContactSync` and `contactSyncBlockers` take no
channel argument, and the send gate ORs their result in unconditionally, so a DM
row that *does* carry an email blocks `dm` exactly as it blocks `email`. The
cost of the carve-out is that the live read — required on `dm` precisely so an
email unsubscribe silences the DM — can be *vacuous* for a given row and still
clear it to send. Every run therefore prints the coverage of its own send list:

```
dm: 7 of 11 SEND row(s) not covered by the audience read
  Alias One                    no email on the roster row — nothing to look up  [a]
  Alias Two                    has an email, but the audience does not hold it  [b]
```

Read it as a denominator, not an alarm. `0 of N` is the healthy line and is what
`--channel email` always prints, since an email send row is a contact by
construction. The number matters when it *moves* — a re-pointed audience, or a
contact deleted after they unsubscribed, silently takes rows out of the
cross-channel rule's reach and changes nothing else in the plan.

`--require-first-names` promotes a bad greeting from a warning to a blocker.
Leave it off on send day — a bad greeting is a copy miss and not a broken
opt-out, and `block` is reserved for the latter.

**Wave 1 runs the SPO-280 acceptance check with the flag off.** Building an
audience is where the flag belongs in general — it is the check for "did we push
every name we hold" — but SPO-292 decided that four contacts keep the
`Hey there —` fallback permanently: SPO-269 recorded them as deliberately
identity-withholding VTuber personas, so there is no name to push and the flag
would block on rows nobody intends to fix. That decision covers all four of them
for good — it is not scoped to Wave 1 and should not be narrowed just because one
of them is not currently in Wave 1's cohort. Which four is in the roster, which
is not in this repo — see
[where the roster and ledger live](#where-the-roster-and-ledger-live). Naming
them here would republish the roster a line at a time.

Wave 1's cohort is narrower than SPO-292's four, though: the `us_only`
jurisdiction cut (SPO-271/SPO-389) holds one of the four out of Wave 1 as a
non-US contact, so only the SPO-292 rows that also land on *this* roster fall
back here. Read the census instead of a fixed count — every fallback recipient is
printed by default. Cross that list against SPO-292's four rows and derive
personalized as (email SEND rows) − (fallback rows among them), rather than
hardcoding a figure that moves every time the roster or the jurisdiction cut
does. A green Wave 1A preflight should name exactly the SPO-292 rows that are on
the current roster and no others. As of the current roster that is three of the
four — the fourth is out of cohort, not gone from the decision — 3 of the 11
email SEND rows, so 8 of 11 render a personalized greeting.

Below is the shape of that T1/email run. The counts, decisions and column layout
are Wave 1's; **the identities are not** — they are the invented rows of
`outreach/wave1-roster.example.json`, which carries the same 16 rows, 11/5 channel
split and 3 nameless SEND rows precisely so this block can be shown without
naming anyone. The real census is never pasted here:

```
Wave 1 preflight — T1 / email
roster: ~/.config/sponsee/outreach/wave1-roster.json (16 rows)
ledger: ~/.config/sponsee/outreach/wave1-ledger.jsonl (0 entries)
endpoint: https://api.resend.com
────────────────────────────────────────────────────────────────────────────
  SEND     PixelForge                   bookings@pixelforge.example  [pixelforge]
  SEND     Nova Quokka                  sponsorships@novaquokka.example  [novaquokka]
  SEND     TundraByte                   hello@tundrabyte.example  [tundrabyte]
  SEND     Lumen Lark                   partnerships@lumenlark.example  [lumenlark]
  SEND     Brass Badger                 deals@brassbadger.example  [brassbadger]
  SEND     KettleCrash                  biz@kettlecrash.example  [kettlecrash]
  SEND     Orchid Octane                contact@orchidoctane.example  [orchidoctane]
  SEND     VellumVex                    sponsor@vellumvex.example  [vellumvex]
  SEND     Harbor Hex                   press@harborhex.example  [harborhex]
  SEND     Saffron Sigil                brand@saffronsigil.example  [saffronsigil]
  SEND     CinderGlove                  team@cinderglove.example  [cinderglove]
  SKIP     Gravel Gospel                no-address  [gravelgospel]
  SKIP     Mint Marauder                no-address  [mintmarauder]
  SKIP     QuillQuasar                  no-address  [quillquasar]
  SKIP     Driftwood Dynamo             no-address  [driftwooddynamo]
  SKIP     Copper Comet                 no-address  [coppercomet]
────────────────────────────────────────────────────────────────────────────
send 11   suppress 0   skip 5   block 0

email: 0 of 11 SEND row(s) not covered by the audience read

No first_name on the contact (3) — these render v5's "Hey there —" fallback:
  hello@tundrabyte.example  no confirmed name on either side — needs an SPO-269 lookup  [tundrabyte]
  partnerships@lumenlark.example  no confirmed name on either side — needs an SPO-269 lookup  [lumenlark]
  contact@orchidoctane.example  no confirmed name on either side — needs an SPO-269 lookup  [orchidoctane]
  (warning only — pass --require-first-names to make this block)

Clear to send T1 on email to 11 recipient(s).
```

On a wave where every recipient *should* have a name, turn the flag on: without
it a green preflight is equally compatible with every greeting silently falling
back.

The flag checks the **contact's** name, not roster-vs-contact drift. Resend
renders `{{{contact.first_name|there}}}` from the contact, so the contact's value
alone decides what the recipient reads, and drift is neither necessary nor
sufficient for a defect:

| roster | contact | renders       | `--require-first-names` |
| ------ | ------- | ------------- | ----------------------- |
| `null` | `null`  | `Hey there —` | **blocks**              |
| `Ada`  | `null`  | `Hey there —` | **blocks**              |
| `Ada`  | `Adam`  | `Hey Adam —`  | **blocks** (`CONFLICT`) |
| `null` | `Kip`   | `Hey Kip —`   | passes — greets correctly |
| `Ada`  | `Ada`   | `Hey Ada —`   | passes                  |

Row 1 is the one to watch: the two sides agree, so it produces no drift line at
all, and a gate keyed on drift clears the send that reads `Hey there —`. Row 4 is
why drift is not the gate — it is reported, not blocked.

Suppressed recipients are exempt from all of it. Resend skips them in a
Broadcast, so there is no greeting to get wrong, and several are suppressed
precisely because we never confirmed a name for them.

## File formats

SPO-267 and SPO-280, which resolved contact channels and populated the audience,
are both closed — the roster and ledger described here are the live artifacts the
preflight reads on send day, not a preview of where they will land. Where they
live, and why not here, is [above](#where-the-roster-and-ledger-live).

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
  { "id": "nova", "name": "Nova Quokka", "firstName": "Nova",
    "email": null, "xHandle": "@novaquokka" }
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
{"at":"2026-09-24T14:20:00Z","reason":"stop_requested","xHandle":"@novaquokka","note":"DM1 reply: stop"}
```

Reasons: `replied`, `stop_requested`, `unsubscribed`, `bounced`, `complained`,
`manual`.

### The ledger path is load-bearing

The file must exist. A path that does not resolve is exit 2 — it is not read as
an empty ledger.

This is the one input where "we could not read it" and "nobody opted out" used
to produce the same run. Everything else here already fails closed: no
`RESEND_API_KEY` is exit 2, an unreachable audience is exit 2, a malformed
ledger *line* is exit 2, a missing roster file is ENOENT. A missing ledger
returned zero suppressions and said nothing, so on T2 the gate cleared a send to
everyone who had replied to T1 — with the same roster, the same audience and the
same real ledger sitting on disk one character away.

Two things close it:

- **`--allow-missing-ledger`, accepted on `--touch T1` only.** T1 is the only
  touch where "there is no ledger yet" can be true; by T2 the ledger *is* the
  record of who replied to T1. On T2/T3 with genuinely nothing to suppress,
  create an empty file. An empty file is a statement; a missing one is an
  accident.
- **The run names what it read.** Every run prints the roster and ledger paths
  with their sizes before the decision lines, and the `--json` audit record
  carries the same under `sources` with resolved absolute paths:

  ```
  Wave 1 preflight — T2 / email
  roster: ~/.config/sponsee/outreach/wave1-roster.json (16 rows)
  ledger: ~/.config/sponsee/outreach/wave1-ledger.jsonl (3 entries)
  ```

  Read those two lines before the SEND/SUPPRESS list. Requiring the file to
  exist closes the mistyped path; printing the count is what makes the next
  variant of the same mistake — right path, wrong or truncated contents —
  visible without another code change.

## Rules worth knowing before you read the output

- **An opt-out on either channel silences both.** Someone who unsubscribed from
  the email has opted out of Wave 1, not merely out of one transport — DMing
  them next reads as an end-run around the choice they just made. v5's copy does
  not say this; the gate enforces it anyway.
- **`block` is not `suppress`.** A block means the opt-out would be broken for
  that recipient, which is worse than not mailing them. It fails the whole touch.
- **`skip: no-address`** marks the X-DM cohort by design — rows that carry an
  `xHandle` and no `email`, not an SPO-267 backlog. It does not fail the touch.
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

The banner is not the guard, though, because a banner cannot change an exit
code: a send-day run with the variable set used to reach exit 0 and print
`Clear to send` all the same. So the variable is paired with
`--allow-test-endpoint`, and the two must agree or the run is refused with exit
2 before it reads a file or opens a socket:

| `WAVE1_PREFLIGHT_RESEND_API_BASE` | `--allow-test-endpoint` | result |
| --- | --- | --- |
| unset | absent | live run, normal |
| set | present | stub run — tests only |
| set | absent | **exit 2** — a live-day run silently pointed at a stub |
| unset | present | **exit 2** — the caller believes they are on a fixture and is not, and `--apply-suppressions` would unsubscribe real contacts |

Every run also names the endpoint it actually used, in the header next to the
roster and ledger lines and under `endpoint` in the `--json` record:

```
endpoint: https://api.resend.com
```

```json
"endpoint": { "resendApiBase": "https://api.resend.com", "live": true, "allowTestEndpoint": false }
```

Check `live` before you read any count in an archived record. The banner lives
on a terminal nobody keeps; that field is what makes a stubbed run and a real
one distinguishable in the artifact QA reads back afterwards.
