import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { sql } from "drizzle-orm";
import { storageRouter } from "./storage.js";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "../test-utils/schema-sql.js";
import { createUploadUrl, STORAGE_QUOTA_BYTES_BY_PLAN } from "../storage/index.js";

// The quota gate and the ownership checks are real DB reads; only the actual
// S3 presign — which needs bucket credentials — is stubbed, mirroring how
// proof.test.ts stubs createDownloadUrl/deleteObject.
vi.mock("../storage/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage/index.js")>();
  return {
    ...actual,
    createUploadUrl: vi.fn().mockResolvedValue({
      url: "https://example.com/put",
      key: "creators/x/deals/y/proofs/z.png",
      method: "PUT",
      expiresAt: new Date(),
      requiredHeaders: { "Content-Type": "image/png", "Content-Length": "1" },
      filename: "file.png",
    }),
  };
});

function mockCtx(creatorId: string) {
  return {
    session: { user: { id: `user-${creatorId}`, email: "test@example.com", name: "Test User" } },
    creatorId,
    db,
  };
}

let creatorId = "";
let dealId = "";

async function seed(plan: "starter" | "creator" | "pro" = "starter") {
  const [creator] = await db.insert(schema.creators).values({ displayName: "Creator", plan }).returning();
  creatorId = creator.id;
  const [brand] = await db.insert(schema.brands).values({ creatorId, name: "Brand" }).returning();
  const [deal] = await db.insert(schema.deals).values({ creatorId, brandId: brand.id, title: "Deal" }).returning();
  dealId = deal.id;
}

let fileCounter = 0;
async function seedFile(sizeBytes: number, overrides: Partial<typeof schema.creatorFiles.$inferInsert> = {}) {
  fileCounter += 1;
  await db.insert(schema.creatorFiles).values({
    creatorId,
    storageKey: `creators/${creatorId}/deals/${dealId}/proofs/file-${fileCounter}.png`,
    mimeType: "image/png",
    sizeBytes,
    originDealId: dealId,
    originDealTitle: "Deal",
    scope: "evidence",
    ...overrides,
  });
}

// `size_bytes` is a Postgres `integer` column, fine for any one real file
// since presign enforces MAX_UPLOAD_BYTES (25 MB) per object — so simulating
// gigabytes of *existing* usage has to spread it across rows instead of
// writing one row bigger than a real upload could ever be.
const MAX_ROW_BYTES = 2_000_000_000;
async function seedUsage(totalBytes: number, overrides: Partial<typeof schema.creatorFiles.$inferInsert> = {}) {
  let remaining = totalBytes;
  while (remaining > 0) {
    const chunk = Math.min(remaining, MAX_ROW_BYTES);
    await seedFile(chunk, overrides);
    remaining -= chunk;
  }
}

async function cleanTables() {
  await db.execute(sql`TRUNCATE TABLE creator_files, deals, brands, creators CASCADE`);
}

beforeAll(async () => {
  await initPgliteSchema(SCHEMA_SQL);
});

beforeEach(async () => {
  vi.mocked(createUploadUrl).mockClear();
  await cleanTables();
  fileCounter = 0;
});

const FIFTY_MB = 50 * 1024 * 1024;

describe("storage.createUploadUrl quota gate", () => {
  it("refuses a starter creator at 4.99 GB a 50 MB upload before signing", async () => {
    await seed("starter");
    await seedUsage(STORAGE_QUOTA_BYTES_BY_PLAN.starter - 10 * 1024 * 1024);

    const caller = storageRouter.createCaller(mockCtx(creatorId));
    const call = caller.createUploadUrl({
      dealId,
      scope: "proofs",
      filename: "big.png",
      mimeType: "image/png",
      sizeBytes: FIFTY_MB,
    });

    await expect(call).rejects.toMatchObject({ code: "FORBIDDEN" });
    // The rejected promise above already consumed the error; check the cap
    // and current usage rode along on a fresh rejection's cause.
    await call.catch((err) => {
      expect(err.message).toMatch(/starter plan's storage limit/);
    });
    expect(createUploadUrl).not.toHaveBeenCalled();
  });

  it("allows the same creator at the same usage on pro", async () => {
    await seed("pro");
    await seedUsage(STORAGE_QUOTA_BYTES_BY_PLAN.starter - 10 * 1024 * 1024);

    const caller = storageRouter.createCaller(mockCtx(creatorId));
    await expect(
      caller.createUploadUrl({
        dealId,
        scope: "proofs",
        filename: "big.png",
        mimeType: "image/png",
        sizeBytes: FIFTY_MB,
      })
    ).resolves.toBeDefined();
    expect(createUploadUrl).toHaveBeenCalledTimes(1);
  });

  // The interaction acceptance criteria calls out explicitly: a file whose
  // deal was deleted (originDealId null) must still count against the cap.
  it("counts usage from a file whose origin deal is gone", async () => {
    await seed("starter");
    await seedUsage(STORAGE_QUOTA_BYTES_BY_PLAN.starter - 10 * 1024 * 1024, {
      originDealId: null,
      originDealTitle: "Deleted Deal",
    });

    const caller = storageRouter.createCaller(mockCtx(creatorId));
    await expect(
      caller.createUploadUrl({
        dealId,
        scope: "proofs",
        filename: "big.png",
        mimeType: "image/png",
        sizeBytes: FIFTY_MB,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(createUploadUrl).not.toHaveBeenCalled();
  });

  it("blocks new uploads after a downgrade but never touches existing files", async () => {
    await seed("pro");
    // Well over the starter cap, comfortably under pro's.
    await seedUsage(STORAGE_QUOTA_BYTES_BY_PLAN.starter + 1024);

    await db.update(schema.creators).set({ plan: "starter" }).where(sql`${schema.creators.id} = ${creatorId}`);

    const caller = storageRouter.createCaller(mockCtx(creatorId));
    await expect(
      caller.createUploadUrl({ dealId, scope: "proofs", filename: "x.png", mimeType: "image/png", sizeBytes: 1 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Downgrade must not delete anything, and reads (the usage query) must
    // keep working off whatever is actually there.
    const [row] = await db.select().from(schema.creatorFiles).where(sql`${schema.creatorFiles.creatorId} = ${creatorId}`);
    expect(row).toBeDefined();

    const usage = await caller.usage();
    expect(usage.usedBytes).toBe(STORAGE_QUOTA_BYTES_BY_PLAN.starter + 1024);
    expect(usage.planTier).toBe("starter");
    expect(usage.capBytes).toBe(STORAGE_QUOTA_BYTES_BY_PLAN.starter);
  });
});

describe("storage.usage", () => {
  it("returns usedBytes/capBytes/planTier for the current creator", async () => {
    await seed("creator");
    await seedFile(123);
    await seedFile(456);

    const caller = storageRouter.createCaller(mockCtx(creatorId));
    const usage = await caller.usage();

    expect(usage).toEqual({
      usedBytes: 579,
      capBytes: STORAGE_QUOTA_BYTES_BY_PLAN.creator,
      planTier: "creator",
    });
  });
});
