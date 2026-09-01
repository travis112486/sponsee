# @sponsee/marketing

The public site at [sponsee.app](https://sponsee.app) — landing page, blog, waitlist form,
and the terms/privacy pages.

## Deploying

**Merging to `main` does not deploy this app.** The Vercel `marketing` project has no GitHub
connection, so production only moves when someone pushes it by hand:

```sh
cd apps/marketing
vercel link --project marketing --yes --scope travis112486s-projects   # first time only
vercel --prod --scope travis112486s-projects
```

Connecting the project to GitHub so this stops being manual is tracked in **SPO-215**.

Because nothing deploys automatically, a broken `vercel.json` does not show up as a red build —
it shows up the next time a person tries to ship, possibly weeks later. `vercel-config.test.ts`
guards the file in CI for that reason.

## Redirects

The three static blog pages from SPO-20 (commit `c020060`) are retired in favour of the real
`/blog/<slug>` posts, and `vercel.json` 301s each of them:

| Retired page | Goes to | Why |
| --- | --- | --- |
| `how-to-chase-late-payments.html` | `/blog/sponsor-paying-late` | The stub cannibalised the new post's keywords, so it points at its successor. |
| `pricing-your-first-sponsorship.html` | `/blog/deliverable-pricing` | Direct successor post. |
| `rate-calculator-for-streamers.html` | `/blog/` | No successor — there is still no `/calculator` route — so it falls back to the blog index per the CoS rule on SPO-33. |

Each entry sets `statusCode: 301` explicitly. Vercel's `permanent: true` shorthand emits a **308**,
which is not what SPO-199 called for.

## Waitlist

`api/waitlist.ts` is a Vercel Edge Function that exists only to keep the signup form same-origin.
It forwards to the API (`WAITLIST_UPSTREAM_URL`, defaulting to the Render deployment), which is the
only store of record — it deliberately keeps no local state. It previously held signups in a
module-level array that died on every cold start, silently losing leads (SPO-207).

Leads are read back with `GET /api/admin/waitlist/export` **on the API**, not from this app.
