# Neon (Lakebase Postgres) setup

Status as of 2026-09-03: **live.** The database is provisioned and migrated, `NEON_API_KEY`
is in the environment and in Infisical, and there are two branches — `production` and `dev`.
Read the branch table below before pointing anything at a connection string.

(The CLI's OAuth flow `neon auth` needs a browser, which agent runs don't have; use
`NEON_API_KEY` against the REST API instead.)

## Identifiers

- Organization: **Sponsee** — `org-fragrant-haze-95727566`
- Project: **Sponsee** — `shiny-unit-91967908`
- Context file: `.neon` at repo root (git-ignored), pre-written with the IDs above.

## Branches — which database you are talking to

| Branch | Id | Endpoint | Who uses it |
|--------|----|----------|-------------|
| `production` (default) | `br-holy-surf-ayl0rcfq` | `ep-still-queen-ay38fcls` | The deployed API on Render, and its pre-deploy migrator. Nothing else. |
| `dev` | `br-odd-flower-ayowdgui` | `ep-patient-shape-ayd83nu3` | Local development, local `db:migrate`, `db:seed`, anything on a laptop. |

**The `dev` branch exists because until 2026-09-03 it did not (SPO-382).** The project had
exactly one branch, `production`, and the repo-local `.env` pointed at it — so local dev,
local tests and local migrations all wrote straight to prod. The blast radius was small only
because prod was nearly empty; it stops being small at the first paying creator.

Consequences to keep in mind:

- **Do not put the production connection string in a repo-local `.env`.** It lives in
  Infisical (env `prod`: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`) and on the Render service.
  Infisical env `dev` holds the `dev` branch strings — that is what a fresh checkout should
  copy in.
- `packages/db/src/production-guard.ts` refuses to let **drizzle-kit** (`db:migrate`,
  `db:push`, `db:generate`, `db:studio`) or **`db:seed`** run against the production
  endpoint, and `scripts/vitest-setup.ts` strips `DATABASE_URL` out of the test environment
  entirely so the suite cannot reach any network database. The override for a genuine one-off
  is `ALLOW_PRODUCTION_DB=1` in front of that single command — never exported in a shell
  profile, never in `.env`.
- The guard is a **denylist keyed on the production endpoint id**, so it fails *open* on a
  host it does not recognise. **If the production endpoint is ever rotated, add the new id to
  `PRODUCTION_ENDPOINT_IDS` in that file** (or set `SPONSEE_PRODUCTION_DB_HOSTS`) as part of
  the rotation, or the guard silently stops guarding.
- The guard is deliberately **not** wired into `packages/db/src/index.ts` or
  `migrate.ts`. Those are the two paths production depends on, and a false positive there is
  an outage — worse than the leak this prevents. Prod migrations go through
  `dist/migrate.js`, which is *supposed* to reach production; see
  [staging-deploy.md §6](./staging-deploy.md#6-migrations-automated--spo-74).

`dev` is a copy-on-write branch of `production`, so it started as an exact clone (ledger and
all) and then had `db:seed` run against it. Confirm which one you are on before trusting any
row count — a census through the `dev` string returns the seeded fixture numbers, a census
through prod does not.

## What's already configured

- Neon agent skills installed at `.agents/skills/neon` and `.agents/skills/neon-postgres` (via `npx skills add neondatabase/agent-skills`).
- Neon CLI v4.10.1 installed globally (`npm i -g neon`).
- Neon MCP server registered in `.mcp.json` (remote `https://mcp.neon.tech/mcp`, authenticates with `NEON_API_KEY` from the environment).
- `packages/db/drizzle.config.ts` prefers `DATABASE_URL_UNPOOLED` for migrations — Neon's pooled endpoint (PgBouncer transaction mode) breaks migration tooling.
- App runtime (`packages/db/src/index.ts`) already uses `pg` Pool + Drizzle via `DATABASE_URL`, which is the recommended driver setup for Neon on Vercel. PGlite remains the fallback when `DATABASE_URL` is unset.

## Once NEON_API_KEY is available

```bash
export NEON_API_KEY=...        # or put it in the agent environment
cd sponsee
neon link --org-id org-fragrant-haze-95727566 --project-id shiny-unit-91967908 -y
# link pulls the branch env into .env/.env.local: DATABASE_URL, DATABASE_URL_UNPOOLED, …
pnpm -C packages/db db:migrate  # runs drizzle migrations over the direct URL
pnpm -C packages/db db:seed     # optional: seed demo data
```

Then set the same vars on Vercel (staging project) so the deployed API stops using in-memory PGlite:

```bash
vercel env add DATABASE_URL            # pooled URL
vercel env add DATABASE_URL_UNPOOLED   # direct URL (build-time migrations only)
```

## Services in use

The app currently uses one Neon service: **Lakebase Postgres**. Auth is self-hosted Better Auth (`BETTER_AUTH_SECRET`), email is Resend/Postmark — neither runs on Neon. If we later adopt Neon Auth, Object Storage, or Functions, declare them in a `neon.ts` (`@neon/config`) and provision with `neon deploy`; note the beta services require a `us-east-2` project.

## Branch-first flow (recommended once linked)

- `neon checkout dev-<feature>` — copy-on-write DB branch per feature, auto-pulls that branch's env.
- `neon diff` — schema diff vs parent before merging.
- Migrations: test on a branch of production data before applying to the default branch.

For a **destructive** check — anything that truncates, drops, or deliberately corrupts state —
branch off `production`, break the branch, then delete it in the same sitting:

```bash
set -a && . packages/db/.env && set +a   # NEON_API_KEY, NEON_PROJECT_ID
curl -s -X POST "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches" \
  -H "Authorization: Bearer $NEON_API_KEY" -H "Content-Type: application/json" \
  -d '{"branch":{"name":"scratch-x"},"endpoints":[{"type":"read_write"}]}'
# -> .branch.id, and .connection_uris[0].connection_uri (a full read-write URI)
curl -s -X DELETE ".../branches/<id>" -H "Authorization: Bearer $NEON_API_KEY"
```

Pass that URI as **both** `DATABASE_URL` and `DATABASE_URL_UNPOOLED` so app code and
drizzle-kit hit the same place. Neon bills compute-hours and a stray branch is invisible on
the board, so delete it when you are done — `dev` and `production` should be the only two
branches at rest.
