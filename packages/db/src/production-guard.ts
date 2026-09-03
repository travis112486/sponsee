/**
 * Refuses to point developer tooling at the production database (SPO-382).
 *
 * Until 2026-09-03 the Neon project had exactly one branch — `production` —
 * and the repo-local `.env` pointed at it, so `db:migrate`, `db:push`,
 * `db:seed` and any test that happened to inherit `DATABASE_URL` all wrote
 * straight to prod. There is now a persistent `dev` branch, but a fixed `.env`
 * is not a control: the next agent to paste a connection string, or the next
 * fresh worktree, puts it back. This is the control.
 *
 * Scope is deliberately narrow. This guard is wired into the paths that only
 * ever run on a developer machine or in CI:
 *
 *   - `drizzle.config.ts`  — drizzle-kit is a devDependency and is pruned out
 *                            of `apps/api/Dockerfile`'s runtime image, so it
 *                            cannot run in production by construction.
 *   - `seed.ts`            — a local fixture script.
 *   - `vitest-setup.ts`    — tests must never reach a network database.
 *
 * It is NOT wired into `createDb()` or `migrate.ts`. Those two are exactly the
 * paths production depends on, and a false positive there is an outage — a
 * worse outcome than the leak this file prevents.
 */

/**
 * Neon encodes the endpoint id in the hostname, and the pooled endpoint is the
 * same id with a `-pooler` suffix. Comparing on the id therefore catches both
 * the pooled and the direct string for a branch.
 *
 * Extend this list (or set `SPONSEE_PRODUCTION_DB_HOSTS`) if the production
 * endpoint is ever rotated. Note the failure mode that implies: after a
 * rotation this guard goes quiet until the new id is added here. It is a
 * denylist, so it fails *open* on an unknown host — see docs/neon-setup.md.
 */
export const PRODUCTION_ENDPOINT_IDS = ["ep-still-queen-ay38fcls"];

/** Explicit, deliberately awkward opt-out for the rare intentional case. */
export const OVERRIDE_ENV_VAR = "ALLOW_PRODUCTION_DB";

export function productionEndpointIds(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const extra = env.SPONSEE_PRODUCTION_DB_HOSTS?.trim();
  if (!extra) return PRODUCTION_ENDPOINT_IDS;
  return [
    ...PRODUCTION_ENDPOINT_IDS,
    ...extra
      .split(",")
      .map((h) => normalizeEndpointId(h.trim()))
      .filter(Boolean),
  ];
}

/** `ep-x-1-pooler.c-5.aws.neon.tech` -> `ep-x-1`. */
function normalizeEndpointId(hostOrId: string): string {
  const host = hostOrId.split(".")[0] ?? "";
  return host.endsWith("-pooler") ? host.slice(0, -"-pooler".length) : host;
}

export function isProductionDatabaseUrl(
  url: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!url?.trim()) return false;

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    // Not parseable as a URL — it cannot be the production Neon string, and
    // whatever consumes it will produce a better error than this guard would.
    return false;
  }

  return productionEndpointIds(env).includes(normalizeEndpointId(hostname));
}

/**
 * Throws when `url` is the production database and the caller has not opted
 * out. `context` names the tool being blocked so the message is actionable
 * rather than a bare stack trace.
 */
export function assertNotProductionDatabase(
  url: string | undefined,
  context: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isProductionDatabaseUrl(url, env)) return;
  if (env[OVERRIDE_ENV_VAR]) return;

  throw new Error(
    `${context} is pointed at the PRODUCTION database and has been blocked (SPO-382).\n\n` +
      `Neon project shiny-unit-91967908 has a persistent 'dev' branch for exactly this. ` +
      `Point DATABASE_URL / DATABASE_URL_UNPOOLED at it — the values are in Infisical ` +
      `under env 'dev', or run 'neon connection-string dev'.\n\n` +
      `If you genuinely mean to touch production, set ${OVERRIDE_ENV_VAR}=1 for that ` +
      `single command. Do not export it in your shell profile, and do not put it in .env.`,
  );
}
