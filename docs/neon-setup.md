# Neon (Lakebase Postgres) setup

Status as of 2026-08-28: local tooling configured; waiting on a `NEON_API_KEY` from the founder to authenticate. The CLI's OAuth flow (`neon auth`) needs a browser, which agent runs don't have.

## Identifiers

- Organization: **Sponsee** — `org-fragrant-haze-95727566`
- Project: **Sponsee** — `shiny-unit-91967908`
- Context file: `.neon` at repo root (git-ignored), pre-written with the IDs above.

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
