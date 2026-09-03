# @sponsee/marketing

The public site at [sponsee.app](https://sponsee.app) — landing page, blog, waitlist form,
and the terms/privacy pages.

## Deploying

**Merging to `main` publishes this app.** The Vercel `marketing` project has been Git-linked to
`travis112486/sponsee` (production branch `main`) since **SPO-215**, which connected it sometime
between 2026-09-02T18:15Z and 2026-09-03T07:23Z (the last confirmed manual `vercel --prod` and the
first confirmed Git-triggered deployment, respectively — see SPO-438 for the full evidence). There
is no founder gate and no separate deploy step: a merged PR is live on sponsee.app within seconds.

There is no more manual step for a routine change. If you ever need to redeploy without a new
commit (e.g. rolling back), that still goes through the dashboard or:

```sh
cd apps/marketing
vercel link --project marketing --yes --scope travis112486s-projects   # first time only
vercel --prod --scope travis112486s-projects
```

A broken `vercel.json` now shows up as a **red/canceled production deployment on the very next
merge**, not a silent outage discovered weeks later — but `vercel-config.test.ts` is still the
better guard, since it fails the PR's CI run and catches the schema error before it ever merges,
rather than after.

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
