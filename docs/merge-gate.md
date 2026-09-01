# The `main` merge gate

What protects `main`, why each setting is set the way it is, and what is
deliberately *not* protected. Decided on SPO-225.

Read this before changing branch protection or adding a CI job. If you change a
setting, change this file in the same PR.

## Current state

`gh api repos/travis112486/sponsee/branches/main/protection`

| Setting | Value |
| --- | --- |
| `required_status_checks.strict` | `true` |
| `required_status_checks.contexts` | `lint-and-typecheck`, `build`, `db-check`, `test`, `storage-e2e` |
| `enforce_admins` | `false` |
| `required_pull_request_reviews` | none |
| `allow_force_pushes` / `allow_deletions` | `false` |

That is **five** required contexts. It was four until SPO-225 — `storage-e2e`
ran on every PR but did not gate, while several ticket threads described the
repo as having "five required checks". If you quote a number, quote it from the
API.

## `strict: true` — branches must be up to date before merging

**Decision: on.** Turned on 2026-09-01 (SPO-225).

Without it, two PRs can each be green, each report no git conflict, and still
red `main` when both merge — because the second is never re-tested against the
first. Git only sees textual conflicts; it cannot see semantic ones.

This is not hypothetical. SPO-247 is the observed instance: PR #81 added a
`CHECK (status <> 'paid' OR paid_at IS NOT NULL)` constraint and PR #83 added a
test seeding exactly that row. Different files, so no conflict, both green.
Merging both produced `1 failed | 18 passed` on `main`, and containing it by
hand cost a full sequencing cycle plus a delegated rebase.

**The cost, honestly.** Every merge to `main` marks every other open PR out of
date, and this repo runs 10-12 open PRs at a time. But the bill is not
"N PRs × a re-run per merge" — stale PRs cost nothing while they sit. You only
pay for the *next* PR you actually merge, at the moment you merge it: one
update-branch, one CI run.

That run is ~2.5 minutes. The critical path is `lint-and-typecheck` (~45s) then
`test` (~112s); `build`, `db-check` and `storage-e2e` all finish inside `test`.

So: ~2.5 minutes per merge, against a failure mode that has already cost a
sequencing cycle once. Worth it.

**If it ever stops being worth it,** the honest tell is CI wall-clock, not PR
count — if `test` grows past roughly five minutes, revisit rather than suffer.

## `storage-e2e` — required, not advisory

**Decision: required.** Added to `contexts` 2026-09-01 (SPO-225).

SPO-171 built this job specifically because the storage suite "must never
silently no-op" — it is the only wire-level proof the storage module works
against a real S3 server. A check built on that premise that cannot block a
merge is not doing the job it was built for.

This was not a close call, and it is close to free:

- It is **not on the critical path.** It needs only `lint-and-typecheck` and
  runs 24-32s, finishing well inside `test`'s ~112s. Requiring it adds **zero**
  wall-clock to the gate.
- It is **not flaky.** 10/10 green over the ten runs before the change.

If it does start flaking, fix it or delete it. Do not quietly drop it back to
advisory — that recreates the exact hole SPO-225 closed.

## `enforce_admins: false` — deliberate, and the one real gap

**Decision: stays off.** This is the deliberate exception, so it needs saying
plainly rather than being left as an unexamined default.

Every agent on this project shares one GitHub account, and that account has
admin. With `enforce_admins: false` an admin can merge past a red required
check. **So for us the gate above is a norm, not a wall.** Everything on this
page describes what we agree to do, not what GitHub physically prevents.

It stays off because the same shared-account constraint removes the usual
escape hatch. There is no second reviewer and no second account: if a required
check breaks in a way that is itself fixed by a PR — a job whose dependency
download starts 404ing, say — then with `enforce_admins: true` nobody could
merge the fix. Keeping it off preserves break-glass.

**The compensating control, since the wall is not real:**

1. Do not bypass a red required check. If you are about to, that is an
   escalation to the Chief of staff, not a judgement call — say so on the
   ticket, with the reason, before merging.
2. Merge one PR at a time and let each land before updating the next. `strict`
   makes staleness *visible*; it does not sequence merges for you.
3. `required_pull_request_reviews` is off for the same shared-account reason —
   GitHub will not let an account approve its own PR, so requiring approvals
   would deadlock every PR. Review happens on the ticket thread instead, and
   that is where the QA/Reviewer sign-off lives.

Turning `enforce_admins` on is a one-line flip if the board decides the lockout
risk is worth a real wall. It is a board call, not a repo-settings call, because
it can stop all merges.

## Adding a CI job

A new job in `ci.yml` is **advisory by default** — it runs, and nothing stops a
merge when it is red. It gates only once its name is in `contexts`, which is an
API change, not a file change:

```sh
gh api repos/travis112486/sponsee/branches/main/protection \
  -q '.required_status_checks.contexts'
```

If a job is worth writing, decide explicitly which one it is and record the
answer. `storage-e2e` spent from SPO-171 to SPO-225 in the gap between "built
because it must never silently no-op" and "actually able to block anything".
