import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { sql, eq } from "drizzle-orm";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "../test-utils/schema-sql.js";
import { registerCreatorFile } from "./registry.js";

// ── Schema SQL (shared with every other PGlite suite via test-utils/schema-sql.ts;
// fileParallelism: false / maxWorkers: 1 in scripts/vitest-api.config.ts (SPO-86)
// serialises the suite onto one PGlite instance, so whichever file runs first
// must set up every table the suite touches) ─────────────────────────────────

async function cleanTables() {
  await db.execute(sql`TRUNCATE TABLE deals, brands, creators, creator_files CASCADE`);
}

async function seedDeal() {
  const [creator] = await db.insert(schema.creators).values({ displayName: "Creator A" }).returning();
  const [brand] = await db.insert(schema.brands).values({ creatorId: creator.id, name: "Brand A" }).returning();
  const [deal] = await db
    .insert(schema.deals)
    .values({ creatorId: creator.id, brandId: brand.id, title: "Deal A" })
    .returning();
  return { creator, deal };
}

beforeAll(async () => {
  await initPgliteSchema(SCHEMA_SQL);
});

beforeEach(async () => {
  await cleanTables();
});

describe("registerCreatorFile", () => {
  it("registers a new storage key", async () => {
    const { creator, deal } = await seedDeal();
    const storageKey = `creators/${creator.id}/deals/${deal.id}/proofs/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png`;

    await db.transaction(async (tx) => {
      await registerCreatorFile(tx, {
        creatorId: creator.id,
        storageKey,
        mimeType: "image/png",
        sizeBytes: 100,
        originDealId: deal.id,
        originDealTitle: deal.title,
        scope: "evidence",
      });
    });

    const rows = await db.select().from(schema.creatorFiles).where(eq(schema.creatorFiles.storageKey, storageKey));
    expect(rows).toHaveLength(1);
  });

  // SPO-353: registerCreatorFile now runs inside the same transaction as the
  // proof/contract insert that carries storageKey (PR #114). A bare insert
  // against the storageKey unique index would raise 23505 on a repeat key
  // and take that write down with it, turning a previously idempotent commit
  // path into a 500.
  it("does not throw when the same storage key is registered twice inside a transaction", async () => {
    const { creator, deal } = await seedDeal();
    const storageKey = `creators/${creator.id}/deals/${deal.id}/contracts/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.pdf`;

    const registerOnce = () =>
      db.transaction(async (tx) => {
        await registerCreatorFile(tx, {
          creatorId: creator.id,
          storageKey,
          mimeType: "application/pdf",
          sizeBytes: 200,
          originDealId: deal.id,
          originDealTitle: deal.title,
          scope: "contract",
        });
      });

    await registerOnce();
    await expect(registerOnce()).resolves.not.toThrow();

    const rows = await db.select().from(schema.creatorFiles).where(eq(schema.creatorFiles.storageKey, storageKey));
    expect(rows).toHaveLength(1);
  });

  it("does not overwrite the existing row's fields on a repeat registration", async () => {
    const { creator, deal } = await seedDeal();
    const storageKey = `creators/${creator.id}/deals/${deal.id}/proofs/cccccccc-cccc-cccc-cccc-cccccccccccc.png`;

    await db.transaction(async (tx) => {
      await registerCreatorFile(tx, {
        creatorId: creator.id,
        storageKey,
        mimeType: "image/png",
        sizeBytes: 100,
        originalFilename: "first.png",
        originDealId: deal.id,
        originDealTitle: deal.title,
        scope: "evidence",
      });
    });

    await db.transaction(async (tx) => {
      await registerCreatorFile(tx, {
        creatorId: creator.id,
        storageKey,
        mimeType: "image/png",
        sizeBytes: 999,
        originalFilename: "second.png",
        originDealId: deal.id,
        originDealTitle: "Deal B",
        scope: "evidence",
      });
    });

    const [row] = await db.select().from(schema.creatorFiles).where(eq(schema.creatorFiles.storageKey, storageKey));
    expect(row.sizeBytes).toBe(100);
    expect(row.originalFilename).toBe("first.png");
  });
});
