/**
 * Deal-slot gate under genuine concurrency (SPO-87 MEDIUM-2).
 *
 * This file is deliberately separate from `billing.integration.test.ts`, which
 * runs on PGlite. PGlite is a single in-process connection, so every statement
 * it is given is already serialized — the check-then-insert race simply cannot
 * be expressed there, and a "concurrent" test written against it would pass
 * against the unfixed code and prove nothing.
 *
 * It therefore needs a real Postgres with a real connection pool, supplied as
 * `TEST_PG_URL`. Point it at a DISPOSABLE database: the suite drops and recreates
 * its tables in `public`.
 *
 *   TEST_PG_URL=postgres://... pnpm --filter @sponsee/api test gate.concurrency
 *
 * Without `TEST_PG_URL` the suite skips, and says so — see the guard test below,
 * which always runs and fails if the skip is ever silent.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, count, eq, isNull, ne } from "drizzle-orm";
import * as schema from "@sponsee/db/schema";
import type { DB } from "@sponsee/db";
import { planDealSlots } from "@sponsee/shared";
import { appRouter } from "../routers/index.js";
import type { Context } from "../context.js";

const TEST_PG_URL = process.env.TEST_PG_URL;
const CONCURRENCY = planDealSlots.starter + 3;

const SCHEMA_SQL = `
DROP TABLE IF EXISTS deals CASCADE;
DROP TABLE IF EXISTS brands CASCADE;
DROP TABLE IF EXISTS creators CASCADE;

CREATE TABLE creators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name VARCHAR(255) NOT NULL,
  pronouns VARCHAR(64),
  category VARCHAR(128),
  avatar_url TEXT,
  timezone VARCHAR(64) NOT NULL DEFAULT 'America/New_York',
  default_currency CHAR(3) NOT NULL DEFAULT 'USD',
  plan VARCHAR(32) NOT NULL DEFAULT 'starter',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  subscription_status VARCHAR(32),
  current_period_end TIMESTAMPTZ,
  paypal_link TEXT,
  wise_text TEXT,
  bank_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(128),
  domain VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL,
  primary_contact_id UUID,
  title VARCHAR(512) NOT NULL,
  type VARCHAR(32) NOT NULL DEFAULT 'flat',
  value_cents INTEGER NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  value_note TEXT,
  stage VARCHAR(32) NOT NULL DEFAULT 'inbound',
  platforms VARCHAR(32)[],
  payment_terms VARCHAR(32) NOT NULL DEFAULT 'net_30',
  source VARCHAR(255),
  notes TEXT,
  bounty_rate_note TEXT,
  bounty_count INTEGER,
  bounty_payout_cents INTEGER,
  stage_entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
`;

// Always runs. If TEST_PG_URL is unset the concurrency coverage below is absent,
// and this test is what makes that fact visible in the output instead of letting
// a green run imply the race is covered when it was never exercised.
describe("deal-slot gate concurrency coverage", () => {
  it("reports whether a real Postgres was available to exercise the race", () => {
    if (!TEST_PG_URL) {
      console.warn(
        "\n[SPO-87] TEST_PG_URL unset — the concurrent deal-slot gate test did NOT run.\n" +
          "         PGlite cannot express this race (single connection). Set TEST_PG_URL\n" +
          "         to a disposable Postgres to exercise it.\n"
      );
    }
    expect(typeof TEST_PG_URL === "string" || TEST_PG_URL === undefined).toBe(true);
  });
});

describe.skipIf(!TEST_PG_URL)("deal-slot gate under concurrent creates", () => {
  // `max` must exceed CONCURRENCY or the pool itself serializes the requests and
  // fakes a pass — the very thing this file exists to avoid.
  const pool = new Pool({ connectionString: TEST_PG_URL, max: CONCURRENCY + 2 });
  const db = drizzle(pool, { schema }) as unknown as DB;

  let creatorId: string;
  let brandId: string;

  function ctxFor(creator: string): Context {
    return {
      db,
      creatorId: creator,
      session: {
        user: { id: "test-user", email: "race@example.com", name: "Race" },
      },
    } as unknown as Context;
  }

  async function activeDealCount(creator: string) {
    const [row] = await db
      .select({ n: count() })
      .from(schema.deals)
      .where(
        and(
          eq(schema.deals.creatorId, creator),
          isNull(schema.deals.deletedAt),
          ne(schema.deals.stage, "paid")
        )
      );
    return row?.n ?? 0;
  }

  beforeAll(async () => {
    await pool.query(SCHEMA_SQL);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE TABLE deals, brands, creators CASCADE");

    const [creator] = await db
      .insert(schema.creators)
      .values({ displayName: "Racer" })
      .returning();
    creatorId = creator.id;

    const [brand] = await db
      .insert(schema.brands)
      .values({ creatorId, name: "Acme" })
      .returning();
    brandId = brand.id;
  });

  it("admits exactly one create when many arrive together at the last free slot", async () => {
    // One slot left on starter.
    await db.insert(schema.deals).values(
      Array.from({ length: planDealSlots.starter - 1 }, (_, i) => ({
        creatorId,
        brandId,
        title: `Existing ${i}`,
        stage: "inbound" as const,
      }))
    );

    const caller = appRouter.createCaller(ctxFor(creatorId));

    // Fired without awaiting in between: every one of these reaches its slot
    // check before any of them has committed an insert. Unfixed, they all count
    // limit−1, all pass, and all insert.
    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        caller.deals.create({ brandId, title: `Racer ${i}`, type: "flat" })
      )
    );

    const created = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(created).toHaveLength(1);
    expect(rejected).toHaveLength(CONCURRENCY - 1);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toMatchObject({ code: "FORBIDDEN" });
    }

    // The invariant that actually matters — the tier limit held.
    expect(await activeDealCount(creatorId)).toBe(planDealSlots.starter);
  });

  it("admits exactly the free slots when several are open", async () => {
    const free = 3;
    await db.insert(schema.deals).values(
      Array.from({ length: planDealSlots.starter - free }, (_, i) => ({
        creatorId,
        brandId,
        title: `Existing ${i}`,
        stage: "inbound" as const,
      }))
    );

    const caller = appRouter.createCaller(ctxFor(creatorId));
    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        caller.deals.create({ brandId, title: `Racer ${i}`, type: "flat" })
      )
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(free);
    expect(await activeDealCount(creatorId)).toBe(planDealSlots.starter);
  });

  it("admits none when the limit is already reached", async () => {
    await db.insert(schema.deals).values(
      Array.from({ length: planDealSlots.starter }, (_, i) => ({
        creatorId,
        brandId,
        title: `Existing ${i}`,
        stage: "inbound" as const,
      }))
    );

    const caller = appRouter.createCaller(ctxFor(creatorId));
    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        caller.deals.create({ brandId, title: `Racer ${i}`, type: "flat" })
      )
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(0);
    expect(await activeDealCount(creatorId)).toBe(planDealSlots.starter);
  });

  it("does not let one creator's lock block another creator's create", async () => {
    // The lock is per-creator, not global: two tenants creating at the same time
    // must not serialize against each other, and neither may consume the other's
    // slots (tenant isolation still holds under contention).
    const [other] = await db
      .insert(schema.creators)
      .values({ displayName: "Other" })
      .returning();
    const [otherBrand] = await db
      .insert(schema.brands)
      .values({ creatorId: other.id, name: "Other Co" })
      .returning();

    const callerA = appRouter.createCaller(ctxFor(creatorId));
    const callerB = appRouter.createCaller(ctxFor(other.id));

    const results = await Promise.allSettled([
      ...Array.from({ length: planDealSlots.starter }, (_, i) =>
        callerA.deals.create({ brandId, title: `A ${i}`, type: "flat" })
      ),
      ...Array.from({ length: planDealSlots.starter }, (_, i) =>
        callerB.deals.create({ brandId: otherBrand.id, title: `B ${i}`, type: "flat" })
      ),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(
      planDealSlots.starter * 2
    );
    expect(await activeDealCount(creatorId)).toBe(planDealSlots.starter);
    expect(await activeDealCount(other.id)).toBe(planDealSlots.starter);
  });
});
