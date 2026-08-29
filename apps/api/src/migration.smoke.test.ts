import { describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Booting a fresh PGlite is inherently slower than a unit test — it compiles
 * and starts a WASM Postgres. Locally that is ~1s; on a 2-core CI runner it is
 * several times that, which puts it right on top of vitest's 5s default. The
 * default is simply the wrong budget for this test, so give it an explicit one
 * with enough headroom that a slow runner is not a red build.
 */
const COLD_PGLITE_BOOT_TIMEOUT_MS = 60_000;

/**
 * Smoke test: prove the committed Drizzle migration can create a clean
 * database from scratch and that the resulting schema supports Better Auth.
 *
 * This validates the production deploy path — a fresh checkout must be
 * able to run the migration and have working auth tables.
 */
describe("deployable migration smoke test", () => {
  it("applies the committed migration to a fresh database and auth tables work", async () => {
    // 1. Fresh in-memory PGlite (no shared state with other tests)
    const client = new PGlite();

    // 2. Read the committed migration SQL
    const migrationPath = path.resolve(
      __dirname,
      "../../../packages/db/drizzle/0000_polite_sharon_ventura.sql"
    );
    const migrationSql = readFileSync(migrationPath, "utf-8");

    // 3. Apply migration — PGlite uses statement-breakpoint comments as delimiters
    const statements = migrationSql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      await client.exec(stmt);
    }

    // 4. Verify Better Auth tables exist and accept data
    await client.exec(`
      INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES ('u_test', 'Test User', 'test@example.com', true, NOW(), NOW());
    `);

    await client.exec(`
      INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id)
      VALUES ('s_test', NOW() + INTERVAL '7 days', 'tok_test', NOW(), NOW(), 'u_test');
    `);

    await client.exec(`
      INSERT INTO account (id, issuer, account_id, provider_id, user_id, created_at, updated_at)
      VALUES ('a_test', 'google', 'gid_123', 'google', 'u_test', NOW(), NOW());
    `);

    await client.exec(`
      INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at)
      VALUES ('v_test', 'test@example.com', 'code_123', NOW() + INTERVAL '10 minutes', NOW(), NOW());
    `);

    // 5. Verify data round-trips
    const userRes = await client.query<{ email: string }>(
      `SELECT email FROM "user" WHERE id = 'u_test'`
    );
    expect(userRes.rows[0].email).toBe("test@example.com");

    const sessionRes = await client.query<{ token: string }>(
      `SELECT token FROM session WHERE id = 's_test'`
    );
    expect(sessionRes.rows[0].token).toBe("tok_test");

    const accountRes = await client.query<{ provider_id: string }>(
      `SELECT provider_id FROM account WHERE id = 'a_test'`
    );
    expect(accountRes.rows[0].provider_id).toBe("google");

    const verifRes = await client.query<{ identifier: string }>(
      `SELECT identifier FROM verification WHERE id = 'v_test'`
    );
    expect(verifRes.rows[0].identifier).toBe("test@example.com");

    // 6. Verify app tables also exist (creators + memberships)
    await client.exec(`
      INSERT INTO creators (id, display_name, created_at, updated_at)
      VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Test Creator', NOW(), NOW());
    `);

    await client.exec(`
      INSERT INTO memberships (id, user_id, creator_id, role, created_at)
      VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'u_test', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner', NOW());
    `);

    const creatorRes = await client.query<{ display_name: string }>(
      `SELECT display_name FROM creators WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'`
    );
    expect(creatorRes.rows[0].display_name).toBe("Test Creator");

    const membershipRes = await client.query<{ role: string }>(
      `SELECT role FROM memberships WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'`
    );
    expect(membershipRes.rows[0].role).toBe("owner");

    await client.close();
  }, COLD_PGLITE_BOOT_TIMEOUT_MS);
});
