# Staging Deployment Plan — SPO-41

## Goal
Get `sponsee.vercel.app` backed by a real database with real login, real data, and a deployed API.

---

## 1. Postgres: Neon (free tier)

**Decision:** Use Neon serverless Postgres (free tier, 500 MB).

**Why Neon:**
- Serverless Postgres that works well with Vercel (no connection pooling headaches).
- Free tier is generous for staging.
- No credit card required for free tier.
- Direct signup at `neon.tech` — does **not** go through Vercel marketplace (our Vercel token lacks the purchase role).

**Why not Vercel Postgres:** Vercel's native Postgres product has been deprecated in favor of Neon; provisioning through Vercel marketplace would require purchase-role consent that our token cannot perform.

**Founder action:** Sign up at https://neon.tech, create a project named `sponsee-staging`, and copy the connection string (starts with `postgresql://...`). Expected time: ~2 minutes.

---

## 2. API Hosting: Render (starter plan)

**Decision:** Deploy `apps/api` to Render as a persistent Web Service.

**Tradeoff analysis:**

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Render Web Service** | Persistent process (pg-boss runs correctly), simple Docker deploy, $7/mo starter | Requires founder signup (~2 min), sleeps on free tier | **Chosen** |
| **Vercel Functions** | Stays in existing Vercel account | Requires major API refactor (Hono → serverless, pg-boss → Vercel Cron/background functions), auth cookie handling changes, unknown Pro-plan requirements | Rejected — too much engineering for MVP staging |
| **Fly.io** | Persistent process, good DX | Signup impossible headlessly (known blocker from SPO board) | Rejected |
| **Railway** | Persistent process, easy deploy | Signup likely requires human interaction (same class as Fly) | Rejected — same signup barrier |

**Why Render over Vercel Functions:**
The API is architected as a long-running Node.js server with pg-boss background workers. Adapting it to serverless would require:
- Splitting the HTTP layer from the job worker
- Rewriting the Hono server entry for Vercel's Node.js runtime
- Replacing pg-boss cron with Vercel Cron (Pro plan feature, unknown availability)
- Re-testing auth cookie handling across serverless boundaries

This is days of work versus minutes of founder signup. Render's starter plan ($7/mo, always-on) is the cheapest path to a correct, persistent deployment.

**Founder action:** Sign up at https://render.com, create a new Web Service from the `sponsee` GitHub repo (branch `main`), point it at `apps/api/Dockerfile`, and set environment variables. Expected time: ~3 minutes.

---

## 3. Architecture

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────┐
│  sponsee.vercel │─────▶│  api.render.com  │─────▶│  Neon PG    │
│  (static SPA)   │      │  (Hono + tRPC)   │      │  (staging)  │
└─────────────────┘      └──────────────────┘      └─────────────┘
                                │
                                ▼
                         ┌─────────────┐
                         │  pg-boss    │
                         │  (chase     │
                         │   worker)   │
                         └─────────────┘
```

---

## 4. Environment Variables

### Web (Vercel — already deployed)
Add these to the `sponsee` Vercel project:

| Variable | Value | Source |
|----------|-------|--------|
| `VITE_API_URL` | `https://api.render.com/...` | Render service URL |

### API (Render — new service)
Add these to the Render Web Service:

| Variable | Value | Source |
|----------|-------|--------|
| `DATABASE_URL` | `postgresql://...` | Neon dashboard (pooled endpoint is fine here) |
| `DATABASE_URL_UNPOOLED` | `postgresql://...` | Neon dashboard, **direct** endpoint — no `-pooler` in the host. Required by the pre-deploy migrator (§6). |
| `BETTER_AUTH_SECRET` | generate fresh (`openssl rand -base64 32` or Render **Generate**) | new secret, staging-only |
| `BETTER_AUTH_URL` | `https://<render-service>.onrender.com` | Render service URL |
| `WEB_URL` | `https://sponsee.vercel.app` | Known |
| `PORT` | `8080` | Dockerfile default |
| `NODE_ENV` | `production` | Fixed |

### Email (magic link) — pick one

| Variable | Value | Source |
|----------|-------|--------|
| `EMAIL_PROVIDER` | `postmark` or `resend` | Our choice |
| `POSTMARK_SERVER_TOKEN` | `...` | Postmark dashboard (founder) |
| `RESEND_API_KEY` | `...` | Resend dashboard (founder) |
| `SMTP_FROM` | `noreply@sponsee.app` | Fixed |
| `CHASE_FROM_EMAIL` | `chase@sponsee.app` | Fixed |
| `INVOICE_FROM_EMAIL` | `invoices@sponsee.app` | Fixed (falls back to `CHASE_FROM_EMAIL`, then a literal default, if unset) |

### Google OAuth (optional — enables Google sign-in)

| Variable | Value | Source |
|----------|-------|--------|
| `GOOGLE_CLIENT_ID` | `...` | Google Cloud Console (founder) |
| `GOOGLE_CLIENT_SECRET` | `...` | Google Cloud Console (founder) |

> **Note:** Magic link works without Google OAuth. Google OAuth is a nice-to-have for staging but not required for acceptance.

---

## 5. Founder Action Checklist

Please complete these items and reply on this issue with the secrets. Each item should take 1–2 minutes.

### Step 1: Neon Postgres (~2 min)
1. Go to https://neon.tech and sign up (can use GitHub auth).
2. Create a project named `sponsee-staging`.
3. Copy the **connection string** from the dashboard (it looks like `postgresql://user:pass@host.neon.tech/db?sslmode=require`).

### Step 2: Render API Host (~3 min)
1. Go to https://render.com and sign up (can use GitHub auth).
2. Click **New → Web Service**.
3. Connect the `sponsee` GitHub repo, branch `main`.
4. Set:
   - **Runtime:** Docker
   - **Dockerfile path:** `apps/api/Dockerfile`
   - **Plan:** Starter ($7/mo, always-on) — or Free (sleeps after 15 min, acceptable for light staging)
5. Add environment variables from §4 above (you can skip email/Google for now).
6. Deploy.
7. Copy the **service URL** (looks like `https://sponsee-api-staging.onrender.com`).

### Step 3: Provide Secrets (single reply)
Reply on this issue with the following (they will be added to Vercel/Render securely):

```
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=<generate: openssl rand -base64 32>
POSTMARK_SERVER_TOKEN=...   # or RESEND_API_KEY=...
GOOGLE_CLIENT_ID=...        # optional
GOOGLE_CLIENT_SECRET=...    # optional
RENDER_SERVICE_URL=https://...
```

> **If you already have a Postmark or Resend account,** paste the API key. If not, magic-link email won't work until one is added — we can set that up in a follow-up.

---

## 6. Migrations (automated — SPO-74)

**Migrations are not a manual step.** Render runs them as a **Pre-Deploy Command**, before
the new instance takes traffic:

```
node /prod/api/node_modules/@sponsee/db/dist/migrate.js
```

Render aborts the deploy if that exits non-zero, so the ordering is fail-closed: a bad
migration blocks the rollout and the previous version keeps serving. Merging a schema
change to `main` is all that is required to get it onto staging Neon.

### Required service configuration

| Setting | Value | Why |
|---------|-------|-----|
| **Pre-Deploy Command** | `node /prod/api/node_modules/@sponsee/db/dist/migrate.js` | Runs before the new instance takes traffic |
| `DATABASE_URL_UNPOOLED` | Neon's **direct** endpoint (no `-pooler` in the host) | The pooled endpoint is PgBouncer in transaction mode and cannot run migrations. The migrator **refuses to start** against a `-pooler` host rather than half-apply a schema. |

`DATABASE_URL` stays as-is — the API itself should keep using the pooled endpoint.

### Why a script instead of `drizzle-kit migrate`

`drizzle-kit` is a devDependency, and `apps/api/Dockerfile` finishes with
`pnpm deploy --prod`, which prunes dev dependencies — the CLI does not exist in the
runtime image. `drizzle-orm` is a prod dependency, so `packages/db/src/migrate.ts` calls
the migrator programmatically instead. The Dockerfile asserts at build time that both
`dist/migrate.js` and `drizzle/meta/_journal.json` survived the prune.

### It fails loudly on a skipped migration

drizzle decides what to apply from the newest `created_at` in its
`drizzle.__drizzle_migrations` ledger alone. A journal entry dated ahead of the ones
after it therefore makes them permanent no-ops while the CLI still prints
`migrations applied successfully!` — that is exactly what SPO-72 was. After migrating,
this script re-reads the ledger and exits non-zero if any journal entry is missing from
it, naming the entries. `scripts/verify-deploy-migrator.mjs` covers that case against a
real Postgres in the `db-check` CI job.

If a deploy fails with `still unapplied`, compare `packages/db/drizzle/meta/_journal.json`
against the ledger:

```sql
select hash, created_at from drizzle."__drizzle_migrations" order by created_at;
```

A journal `when` that is out of order needs fixing in the journal *and* in the ledger row
that recorded it — fixing the file alone is not enough, because the bad `created_at` is
already stored and is what drizzle compares against.

### Running it by hand

Against a database you have a direct URL for (a local Postgres, or Neon for a one-off
repair):

```bash
pnpm --filter @sponsee/db build
DATABASE_URL_UNPOOLED='postgresql://...' node packages/db/dist/migrate.js
```

It takes a Postgres advisory lock, so two concurrent runs serialise rather than race.

---

## 7. Acceptance Criteria

Once the above is done, the agent will:
1. Confirm the pre-deploy migrator has brought the Neon database up to date.
2. Run the seed script to populate demo data.
3. Wire `VITE_API_URL` in Vercel.
4. Verify: open `https://sponsee.vercel.app`, sign in with magic link, create a deal, refresh, and see it persist.

---

## 8. Technical Prep Already Done

- [x] Drizzle migrations exist (`packages/db/drizzle/0000_*.sql` … `0002_*.sql`)
- [x] Seed script exists (`packages/db/src/seed.ts`)
- [x] Dockerfile exists (`apps/api/Dockerfile`)
- [x] Vercel project exists (`sponsee` → `sponsee.vercel.app`)
- [ ] `BETTER_AUTH_SECRET` generated fresh for Render (never set in Vercel)

**Remaining work (agent-owned, post-secrets):**
- Run seed script
- Set `VITE_API_URL` on Vercel
- Verify end-to-end sign-in + deal creation
