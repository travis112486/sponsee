// Vitest setup file: runs before any test module is loaded.
// Forces PGlite into in-memory mode so test files don't race on disk.
process.env.VERCEL = "1";

// SPO-382. `packages/db`'s createDb() prefers DATABASE_URL over the PGlite
// fallback, so a developer who has sourced .env into their shell runs the whole
// suite — including the ones that truncate tables — against a real network
// Postgres. Before SPO-382 that network Postgres was production.
//
// ci.yml's `test` job already documents the intent ("Deliberately no
// DATABASE_URL … pointing them at a real Postgres would silently change what
// they exercise"). A comment in a workflow file does not bind a local run, so
// enforce it here: unset the variable rather than trusting the ambient
// environment. Anything that wants a real Postgres asks for it explicitly (see
// scripts/verify-deploy-migrator.mjs and the `db-check` CI job) rather than
// inheriting a shell export.
if (process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED) {
  const inherited = process.env.DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED;
  console.warn(
    `[vitest-setup] Ignoring inherited DATABASE_URL (${safeHost(inherited)}); ` +
      `the suite runs on in-memory PGlite.`,
  );
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_UNPOOLED;
}

/** Host only — a connection string carries a password. */
function safeHost(url: string | undefined): string {
  if (!url) return "unset";
  try {
    return new URL(url).hostname;
  } catch {
    return "unparseable";
  }
}
