import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { sql } from "drizzle-orm";
import { storageRouter } from "./storage.js";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "../test-utils/schema-sql.js";
import { createDownloadUrl, deleteObject } from "../storage/index.js";

// The Files page procedures touch the bucket only at the two edges that need
// credentials — presigning a preview URL and deleting an object. Everything
// else (ownership, registry row lifecycle) is a real DB read/write.
vi.mock("../storage/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage/index.js")>();
  return {
    ...actual,
    createDownloadUrl: vi.fn().mockResolvedValue({
      url: "https://example.com/get/signed",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    }),
    deleteObject: vi.fn().mockResolvedValue(undefined),
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
let otherCreatorId = "";
let dealId = "";

async function seed() {
  const [creator] = await db.insert(schema.creators).values({ displayName: "Creator", plan: "starter" }).returning();
  creatorId = creator.id;
  const [other] = await db.insert(schema.creators).values({ displayName: "Other", plan: "starter" }).returning();
  otherCreatorId = other.id;
  const [brand] = await db.insert(schema.brands).values({ creatorId, name: "Acme" }).returning();
  const [deal] = await db.insert(schema.deals).values({ creatorId, brandId: brand.id, title: "Acme Q3" }).returning();
  dealId = deal.id;
}

let fileCounter = 0;
async function seedFile(overrides: Partial<typeof schema.creatorFiles.$inferInsert> = {}) {
  fileCounter += 1;
  const [row] = await db
    .insert(schema.creatorFiles)
    .values({
      creatorId,
      storageKey: `creators/${creatorId}/deals/${dealId}/proofs/file-${fileCounter}.png`,
      mimeType: "image/png",
      sizeBytes: 1000 + fileCounter,
      originalFilename: `screenshot-${fileCounter}.png`,
      originDealId: dealId,
      originDealTitle: "Acme Q3",
      scope: "evidence",
      ...overrides,
    })
    .returning();
  return row;
}

async function cleanTables() {
  await db.execute(sql`TRUNCATE TABLE creator_files, deals, brands, creators CASCADE`);
}

beforeAll(async () => {
  await initPgliteSchema(SCHEMA_SQL);
});

beforeEach(async () => {
  vi.mocked(createDownloadUrl).mockClear();
  vi.mocked(deleteObject).mockClear();
  await cleanTables();
  fileCounter = 0;
});

describe("storage.list", () => {
  it("returns the creator's files, including one whose deal was deleted", async () => {
    await seed();
    const live = await seedFile({ originalFilename: "live.png", createdAt: new Date("2026-02-01T00:00:00Z") });
    // A file whose deal row is gone: originDealId null but title preserved.
    await seedFile({
      storageKey: `creators/${creatorId}/deals/${dealId}/proofs/deleted.png`,
      originalFilename: "deleted.png",
      originDealId: null,
      originDealTitle: "Acme Q3",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });

    const caller = storageRouter.createCaller(mockCtx(creatorId));
    const { files } = await caller.list();

    expect(files).toHaveLength(2);
    const deleted = files.find((f) => f.storageKey.endsWith("deleted.png"));
    expect(deleted).toMatchObject({
      originDealId: null,
      originDealTitle: "Acme Q3",
      originalFilename: "deleted.png",
    });
    expect(files[0].storageKey).toBe(live.storageKey); // newest first
  });

  it("excludes tombstoned files and other creators' files", async () => {
    await seed();
    await seedFile({ storageKey: `creators/${creatorId}/deals/${dealId}/proofs/tombstoned.png`, deletedAt: new Date() });
    await db.insert(schema.creatorFiles).values({
      creatorId: otherCreatorId,
      storageKey: `creators/${otherCreatorId}/deals/${dealId}/proofs/other.png`,
      mimeType: "image/png",
      sizeBytes: 999,
      originDealId: dealId,
      originDealTitle: "Acme Q3",
      scope: "evidence",
    });

    const caller = storageRouter.createCaller(mockCtx(creatorId));
    const { files } = await caller.list();

    expect(files).toHaveLength(0);
  });

  it("flags a file whose deal was soft-deleted (deletedAt set, FK still live)", async () => {
    await seed();
    await seedFile({ originalFilename: "soft-deleted.png" });
    // The app soft-deletes deals (deals.ts `delete` sets deletedAt) — it does
    // not hard-delete, so the `set null` FK never fires on the real path.
    await db.update(schema.deals).set({ deletedAt: new Date() }).where(sql`${schema.deals.id} = ${dealId}`);

    const caller = storageRouter.createCaller(mockCtx(creatorId));
    const { files } = await caller.list();

    expect(files).toHaveLength(1);
    expect(files[0].originDealId).toBe(dealId);
    expect(files[0].originDealDeletedAt).toBeInstanceOf(Date);
  });

  it("flags a file whose deal was hard-deleted (originDealId set null)", async () => {
    await seed();
    await seedFile({ originalFilename: "hard-deleted.png" });
    await db.delete(schema.deals).where(sql`${schema.deals.id} = ${dealId}`);

    const caller = storageRouter.createCaller(mockCtx(creatorId));
    const { files } = await caller.list();

    expect(files).toHaveLength(1);
    expect(files[0].originDealId).toBeNull();
    expect(files[0].originDealDeletedAt).toBeNull();
  });
});

describe("storage.fileUrl", () => {
  it("presigns a preview URL for an owned file", async () => {
    await seed();
    const file = await seedFile({ originalFilename: "screenshot.png" });

    const caller = storageRouter.createCaller(mockCtx(creatorId));
    const result = await caller.fileUrl({ storageKey: file.storageKey });

    expect(result.url).toBe("https://example.com/get/signed");
    expect(createDownloadUrl).toHaveBeenCalledWith({ key: file.storageKey, filename: "screenshot.png" });
  });

  it("presigns for a deleted-deal file (originDealId null)", async () => {
    await seed();
    await seedFile({
      storageKey: `creators/${creatorId}/deals/${dealId}/proofs/deleted.png`,
      originDealId: null,
      originDealTitle: "Acme Q3",
    });

    const caller = storageRouter.createCaller(mockCtx(creatorId));
    await expect(
      caller.fileUrl({ storageKey: `creators/${creatorId}/deals/${dealId}/proofs/deleted.png` })
    ).resolves.toMatchObject({ url: "https://example.com/get/signed" });
  });

  it("rejects a file owned by another creator", async () => {
    await seed();
    const key = `creators/${otherCreatorId}/deals/${dealId}/proofs/other.png`;
    await db.insert(schema.creatorFiles).values({
      creatorId: otherCreatorId,
      storageKey: key,
      mimeType: "image/png",
      sizeBytes: 10,
      scope: "evidence",
    });

    const caller = storageRouter.createCaller(mockCtx(creatorId));
    await expect(caller.fileUrl({ storageKey: key })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("storage.deleteFile", () => {
  it("deletes the object and removes the registry row", async () => {
    await seed();
    const file = await seedFile();

    const caller = storageRouter.createCaller(mockCtx(creatorId));
    await expect(caller.deleteFile({ storageKey: file.storageKey })).resolves.toEqual({ success: true });

    expect(deleteObject).toHaveBeenCalledWith(file.storageKey);

    const [row] = await db
      .select()
      .from(schema.creatorFiles)
      .where(sql`${schema.creatorFiles.storageKey} = ${file.storageKey}`);
    expect(row).toBeUndefined();
  });

  it("drops usage by the freed bytes (meter matches immediately)", async () => {
    await seed();
    const a = await seedFile({ sizeBytes: 1000 });
    await seedFile({ sizeBytes: 2000 });

    const caller = storageRouter.createCaller(mockCtx(creatorId));
    const before = await caller.usage();
    expect(before.usedBytes).toBe(3000);

    await caller.deleteFile({ storageKey: a.storageKey });

    const after = await caller.usage();
    expect(after.usedBytes).toBe(2000);
  });

  it("deletes a file whose deal was deleted", async () => {
    await seed();
    await seedFile({
      storageKey: `creators/${creatorId}/deals/${dealId}/proofs/deleted.png`,
      originDealId: null,
      originDealTitle: "Acme Q3",
    });

    const caller = storageRouter.createCaller(mockCtx(creatorId));
    await expect(
      caller.deleteFile({ storageKey: `creators/${creatorId}/deals/${dealId}/proofs/deleted.png` })
    ).resolves.toEqual({ success: true });
    expect(deleteObject).toHaveBeenCalledTimes(1);
  });

  it("rejects deleting another creator's file", async () => {
    await seed();
    const key = `creators/${otherCreatorId}/deals/${dealId}/proofs/other.png`;
    await db.insert(schema.creatorFiles).values({
      creatorId: otherCreatorId,
      storageKey: key,
      mimeType: "image/png",
      sizeBytes: 10,
      scope: "evidence",
    });

    const caller = storageRouter.createCaller(mockCtx(creatorId));
    await expect(caller.deleteFile({ storageKey: key })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("tombstones the row and does not throw when the object delete fails", async () => {
    await seed();
    const file = await seedFile();
    // Object delete fails transiently. The tombstone committed before the
    // delete means usage/list already exclude the file (so the meter doesn't
    // lie), and the orphan sweep reclaims the object later — the request
    // itself still succeeds.
    vi.mocked(deleteObject).mockRejectedValueOnce(new Error("NoSuchKey"));

    const caller = storageRouter.createCaller(mockCtx(creatorId));
    await expect(caller.deleteFile({ storageKey: file.storageKey })).resolves.toEqual({ success: true });

    const [row] = await db
      .select()
      .from(schema.creatorFiles)
      .where(sql`${schema.creatorFiles.storageKey} = ${file.storageKey}`);
    expect(row?.deletedAt).toBeInstanceOf(Date);

    const { files } = await caller.list();
    expect(files).toHaveLength(0);
  });
});
