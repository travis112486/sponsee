import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
 *
 * The budget covers the boot *and* the replay of every committed migration, so
 * it grows with the journal. Measured here at 5 migrations: boot ~3.6-4.3s,
 * replay ~0.3s. The boot still dominates by an order of magnitude, so replaying
 * the whole journal instead of just 0000 did not meaningfully move the budget.
 * Re-measure if a future migration does real data backfill. See SPO-86, SPO-90.
 */
const COLD_PGLITE_BOOT_TIMEOUT_MS = 60_000;

const drizzleDir = path.resolve(__dirname, "../../../packages/db/drizzle");

type JournalEntry = { idx: number; when: number; tag: string };

/**
 * The journal — not a glob, and not a hardcoded filename — is the migration
 * list, because the journal is what `drizzle-kit migrate` and the Render
 * pre-deploy migrator actually replay. Driving off it means this test exercises
 * the real deploy path, and that a migration added tomorrow is covered without
 * anyone remembering to edit this file.
 *
 * The journal's own integrity (ordering, `idx` alignment, one-for-one with the
 * .sql files on disk) is asserted separately in packages/db/src/migrations.test.ts.
 */
const journal = JSON.parse(
  readFileSync(path.join(drizzleDir, "meta/_journal.json"), "utf8"),
) as { entries: JournalEntry[] };

/**
 * Smoke test: prove the committed Drizzle migrations can create a clean
 * database from scratch and that the resulting schema supports Better Auth,
 * tenancy and billing.
 *
 * This validates the production deploy path — a fresh checkout must be able to
 * replay the whole journal and end up with working tables. It used to apply
 * only 0000 while claiming to cover all of them (SPO-90); a green test that
 * exercises one migration of five reads as coverage it does not have, which is
 * exactly the SPO-72 / SPO-76 bug class it exists to catch.
 */
describe("deployable migration smoke test", () => {
  let client: PGlite;
  const appliedTags: string[] = [];

  beforeAll(async () => {
    // Fresh in-memory PGlite (no shared state with other tests)
    client = new PGlite();

    for (const entry of journal.entries) {
      const migrationPath = path.join(drizzleDir, `${entry.tag}.sql`);
      const migrationSql = readFileSync(migrationPath, "utf-8");

      // PGlite uses statement-breakpoint comments as delimiters
      const statements = migrationSql
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const [i, stmt] of statements.entries()) {
        try {
          await client.exec(stmt);
        } catch (err) {
          // Without the tag and statement index, a failure here surfaces as a
          // bare Postgres error with no clue which migration produced it.
          throw new Error(
            `migration ${entry.tag} failed at statement ${i + 1}/${statements.length}: ` +
              `${err instanceof Error ? err.message : String(err)}\n` +
              `--- statement ---\n${stmt}`,
          );
        }
      }

      appliedTags.push(entry.tag);
    }
  }, COLD_PGLITE_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await client?.close();
  });

  it("replays every migration in the journal, in journal order", () => {
    expect(journal.entries.length).toBeGreaterThan(0);
    expect(appliedTags).toEqual(journal.entries.map((e) => e.tag));
  });

  it("creates Better Auth tables that accept and return data", async () => {
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

    const userRes = await client.query<{ email: string }>(
      `SELECT email FROM "user" WHERE id = 'u_test'`,
    );
    expect(userRes.rows[0].email).toBe("test@example.com");

    const sessionRes = await client.query<{ token: string }>(
      `SELECT token FROM session WHERE id = 's_test'`,
    );
    expect(sessionRes.rows[0].token).toBe("tok_test");

    const accountRes = await client.query<{ provider_id: string }>(
      `SELECT provider_id FROM account WHERE id = 'a_test'`,
    );
    expect(accountRes.rows[0].provider_id).toBe("google");

    const verifRes = await client.query<{ identifier: string }>(
      `SELECT identifier FROM verification WHERE id = 'v_test'`,
    );
    expect(verifRes.rows[0].identifier).toBe("test@example.com");
  });

  it("creates the tenancy tables (creators + memberships)", async () => {
    await client.exec(`
      INSERT INTO creators (id, display_name, created_at, updated_at)
      VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Test Creator', NOW(), NOW());
    `);

    await client.exec(`
      INSERT INTO memberships (id, user_id, creator_id, role, created_at)
      VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'u_test', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner', NOW());
    `);

    const creatorRes = await client.query<{ display_name: string }>(
      `SELECT display_name FROM creators WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'`,
    );
    expect(creatorRes.rows[0].display_name).toBe("Test Creator");

    const membershipRes = await client.query<{ role: string }>(
      `SELECT role FROM memberships WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'`,
    );
    expect(membershipRes.rows[0].role).toBe("owner");
  });

  // Everything below observes an object introduced *after* 0000. These are the
  // assertions that make the replay meaningful rather than merely error-free.

  it("adds the Stripe billing columns to creators and stores a subscription (0001)", async () => {
    const enumRes = await client.query<{ label: string }>(
      `SELECT e.enumlabel AS label
         FROM pg_type t
         JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = 'subscription_status'
        ORDER BY e.enumsortorder`,
    );
    expect(enumRes.rows.map((r) => r.label)).toEqual([
      "active",
      "past_due",
      "canceled",
      "unpaid",
      "incomplete",
      "incomplete_expired",
      "trialing",
      // Appended by 0006 (SPO-97), which is why it sorts last rather than
      // beside the other non-paying statuses.
      "paused",
    ]);

    // Round-trip rather than a catalog check: proves the enum type is usable
    // from the column, not just that both objects exist.
    await client.exec(`
      UPDATE creators
         SET stripe_customer_id = 'cus_test',
             stripe_subscription_id = 'sub_test',
             subscription_status = 'past_due',
             current_period_end = NOW() + INTERVAL '30 days'
       WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    `);

    const billingRes = await client.query<{
      stripe_customer_id: string;
      stripe_subscription_id: string;
      subscription_status: string;
      current_period_end: string | null;
    }>(
      `SELECT stripe_customer_id, stripe_subscription_id, subscription_status, current_period_end
         FROM creators WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'`,
    );
    expect(billingRes.rows[0]).toMatchObject({
      stripe_customer_id: "cus_test",
      stripe_subscription_id: "sub_test",
      subscription_status: "past_due",
    });
    expect(billingRes.rows[0].current_period_end).not.toBeNull();
  });

  // 0006. The catalog assertion above proves the label exists; this proves the
  // column will actually take it. The API's own suite runs against a PGlite
  // schema where `subscription_status` is a VARCHAR, so a missing enum value
  // would be invisible there and only surface as a failing webhook UPDATE in
  // production (SPO-97).
  it("accepts 'paused' in the subscription_status column (0006)", async () => {
    await client.exec(`
      UPDATE creators
         SET subscription_status = 'paused'
       WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    `);

    const res = await client.query<{ subscription_status: string }>(
      `SELECT subscription_status FROM creators
        WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'`,
    );
    expect(res.rows[0].subscription_status).toBe("paused");
  });

  it("extends chase_event_status with 'sending', ordered before 'sent' (0001)", async () => {
    const res = await client.query<{ label: string }>(
      `SELECT e.enumlabel AS label
         FROM pg_type t
         JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = 'chase_event_status'
        ORDER BY e.enumsortorder`,
    );
    const labels = res.rows.map((r) => r.label);
    expect(labels).toContain("sending");
    // 0001 adds it with `BEFORE 'sent'` — position is the point of that clause.
    expect(labels.indexOf("sending")).toBeLessThan(labels.indexOf("sent"));
  });

  it("adds chase_events.updated_at as NOT NULL with a default (0002/0003)", async () => {
    const res = await client.query<{
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'chase_events'
          AND column_name = 'updated_at'`,
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].is_nullable).toBe("NO");
    expect(res.rows[0].column_default).toContain("now()");
  });

  it("adds the chase send-job columns to chase_events (0004)", async () => {
    const res = await client.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'chase_events'
          AND column_name IN ('enqueued_at', 'send_job_id')
        ORDER BY column_name`,
    );
    expect(res.rows.map((r) => r.column_name)).toEqual([
      "enqueued_at",
      "send_job_id",
    ]);
  });
});
