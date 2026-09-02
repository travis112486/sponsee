import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { sql } from "drizzle-orm";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "../test-utils/schema-sql.js";
import { QuotaExceededError } from "./errors.js";
import { assertStorageQuotaAvailable, getStorageUsage, STORAGE_QUOTA_BYTES_BY_PLAN } from "./quota.js";

const GIB = 1024 * 1024 * 1024;

async function cleanTables() {
  await db.execute(sql`TRUNCATE TABLE deals, brands, creators, creator_files CASCADE`);
}

async function seedCreator(plan: "starter" | "creator" | "pro" = "starter") {
  const [creator] = await db.insert(schema.creators).values({ displayName: "Creator A", plan }).returning();
  return creator;
}

let fileCounter = 0;
async function seedFile(creatorId: string, sizeBytes: number, overrides: Partial<typeof schema.creatorFiles.$inferInsert> = {}) {
  fileCounter += 1;
  await db.insert(schema.creatorFiles).values({
    creatorId,
    storageKey: `creators/${creatorId}/deals/deadbeef/proofs/file-${fileCounter}.png`,
    mimeType: "image/png",
    sizeBytes,
    scope: "evidence",
    ...overrides,
  });
}

// `size_bytes` is a Postgres `integer` column — fine for any one real file,
// since presign enforces MAX_UPLOAD_BYTES (25 MB) per object, but a test
// simulating gigabytes of *existing* usage has to spread it across several
// rows rather than write one row bigger than a real upload could ever be.
const MAX_ROW_BYTES = 2_000_000_000;
async function seedUsage(creatorId: string, totalBytes: number, overrides: Partial<typeof schema.creatorFiles.$inferInsert> = {}) {
  let remaining = totalBytes;
  while (remaining > 0) {
    const chunk = Math.min(remaining, MAX_ROW_BYTES);
    await seedFile(creatorId, chunk, overrides);
    remaining -= chunk;
  }
}

beforeAll(async () => {
  await initPgliteSchema(SCHEMA_SQL);
});

beforeEach(async () => {
  await cleanTables();
  fileCounter = 0;
});

describe("STORAGE_QUOTA_BYTES_BY_PLAN", () => {
  it("maps starter/creator/pro to 5/25/100 GiB", () => {
    expect(STORAGE_QUOTA_BYTES_BY_PLAN).toEqual({
      starter: 5 * GIB,
      creator: 25 * GIB,
      pro: 100 * GIB,
    });
  });
});

describe("getStorageUsage", () => {
  it("sums creator_files bytes for that creator only", async () => {
    const creatorA = await seedCreator("starter");
    const creatorB = await seedCreator("starter");
    await seedFile(creatorA.id, 100);
    await seedFile(creatorA.id, 200);
    await seedFile(creatorB.id, 9_999);

    const usage = await getStorageUsage(db, creatorA.id);
    expect(usage.usedBytes).toBe(300);
    expect(usage.planTier).toBe("starter");
    expect(usage.capBytes).toBe(STORAGE_QUOTA_BYTES_BY_PLAN.starter);
  });

  it("returns zero usage for a creator with no files", async () => {
    const creator = await seedCreator("pro");
    const usage = await getStorageUsage(db, creator.id);
    expect(usage.usedBytes).toBe(0);
    expect(usage.capBytes).toBe(STORAGE_QUOTA_BYTES_BY_PLAN.pro);
  });

  // The interaction between the two founder answers on SPO-155: retention
  // says files outlive the deal (originDealId set null, not cascaded), and
  // quota must still see them or a creator could hide unlimited storage
  // behind deleted deals.
  it("counts a file whose origin deal was deleted (originDealId null)", async () => {
    const creator = await seedCreator("starter");
    await seedFile(creator.id, 1_000, { originDealId: null, originDealTitle: "Deleted Deal" });

    const usage = await getStorageUsage(db, creator.id);
    expect(usage.usedBytes).toBe(1_000);
  });

  it("excludes a tombstoned (explicitly deleted) file", async () => {
    const creator = await seedCreator("starter");
    await seedFile(creator.id, 1_000);
    await seedFile(creator.id, 2_000, { deletedAt: new Date() });

    const usage = await getStorageUsage(db, creator.id);
    expect(usage.usedBytes).toBe(1_000);
  });
});

describe("assertStorageQuotaAvailable", () => {
  it("refuses a starter creator at 4.99 GB a 50 MB upload", async () => {
    const creator = await seedCreator("starter");
    const almostFull = STORAGE_QUOTA_BYTES_BY_PLAN.starter - 10 * 1024 * 1024; // 4.99 GB
    await seedUsage(creator.id, almostFull);

    const fiftyMb = 50 * 1024 * 1024;
    await expect(assertStorageQuotaAvailable(db, creator.id, fiftyMb)).rejects.toThrow(QuotaExceededError);

    await expect(assertStorageQuotaAvailable(db, creator.id, fiftyMb)).rejects.toMatchObject({
      usedBytes: almostFull,
      capBytes: STORAGE_QUOTA_BYTES_BY_PLAN.starter,
      planTier: "starter",
    });
  });

  it("allows the same upload for a pro creator at the same usage", async () => {
    const creator = await seedCreator("pro");
    const almostFull = STORAGE_QUOTA_BYTES_BY_PLAN.starter - 10 * 1024 * 1024;
    await seedUsage(creator.id, almostFull);

    await expect(assertStorageQuotaAvailable(db, creator.id, 50 * 1024 * 1024)).resolves.toBeUndefined();
  });

  it("allows an upload that lands exactly at the cap", async () => {
    const creator = await seedCreator("starter");
    await seedUsage(creator.id, STORAGE_QUOTA_BYTES_BY_PLAN.starter - 100);

    await expect(assertStorageQuotaAvailable(db, creator.id, 100)).resolves.toBeUndefined();
  });
});
