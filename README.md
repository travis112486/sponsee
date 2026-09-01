# Sponsee

Sponsorship CRM for mid-tier live streamers.

## Stack

- **Frontend:** React 19 + Vite + Tailwind CSS v3 + shadcn/ui
- **Backend:** Hono + tRPC + Better Auth + Drizzle ORM
- **Database:** PostgreSQL
- **Monorepo:** pnpm workspaces + Turbo

## Project Structure

```
sponsee/
├── apps/
│   ├── web/          # React frontend (port 3000)
│   └── api/          # Hono API server (port 3001)
├── packages/
│   ├── shared/       # Shared enums, constants, schemas
│   └── db/           # Drizzle ORM schema + migrations
```

## Development

```bash
# Install dependencies
pnpm install

# Start dev servers (both API and web)
pnpm dev

# Build everything
pnpm build

# Database
pnpm db:generate   # Generate migrations
pnpm db:migrate    # Run migrations
pnpm db:studio     # Drizzle Studio
```

## Merging to `main`

Five required CI contexts, and branches must be up to date before merging.
`docs/merge-gate.md` has the settings, why each is set that way, and the one
place the gate is a norm rather than a wall.

## Environment Variables

Copy `.env.example` in each app and fill in real values:

- `apps/api/.env.example` — Database URL, Better Auth secret, OAuth credentials
- `apps/web/.env.example` — API URL

## Deploy

Staging deploys automatically on push to `main` via GitHub Actions + Fly.io.

```bash
# Manual deploy
flyctl deploy --config apps/api/fly.toml
flyctl deploy --config apps/web/fly.toml
```

## Staging URLs

- **Web:** https://sponsee-web-staging.fly.dev
- **API:** https://sponsee-api-staging.fly.dev

> Note: Actual deploy requires `FLY_API_TOKEN` secret in GitHub and `fly apps create` for both services.
# Sponsee
