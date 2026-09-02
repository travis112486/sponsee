import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";
import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { sql } from "drizzle-orm";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "../test-utils/schema-sql.js";
import { runStorageOrphanSweep } from "./sweep.js";

// ── Schema SQL (shared with every other PGlite suite via test-utils/schema-sql.ts;
// fileParallelism: false / maxWorkers: 1 in scripts/vitest-api.config.ts (SPO-86)
// serialises the suite onto one PGlite instance, so whichever file runs first
// must set up every table the suite touches) ─────────────────────────────────

const FAKE_ENV = {
  STORAGE_ENDPOINT: "http://localhost:9000",
  STORAGE_BUCKET: "sponsee-test",
  STORAGE_REGION: "auto",
  STORAGE_ACCESS_KEY_ID: "test-access-key",
  STORAGE_SECRET_ACCESS_KEY: "test-secret-key",
};

const OLD_DATE = new Date(Date.now() - 48 * 60 * 60 * 1000); // past the grace period

let listedObjects: { Key: string; LastModified: Date }[] = [];
const sendMock = vi.fn(async (command: unknown) => {
  if (command instanceof ListObjectsV2Command) {
    return { Contents: listedObjects, IsTruncated: false };
  }
  if (command instanceof DeleteObjectsCommand) {
    return {};
  }
  throw new Error(`unexpected S3 command: ${(command as { constructor: { name: string } }).constructor.name}`);
});

vi.mock("./client.js", () => ({
  buildS3Client: () => ({ send: sendMock }),
}));

async function cleanTables() {
  await db.execute(sql`TRUNCATE TABLE deals, brands, creators, creator_files CASCADE`);
}

async function seedCreator() {
  const [creator] = await db.insert(schema.creators).values({ displayName: "Creator A" }).returning();
  return creator;
}

function deletedKeysFrom(mock: typeof sendMock): string[] | undefined {
  const deleteCall = mock.mock.calls.map(([command]) => command).find((c) => c instanceof DeleteObjectsCommand);
  return (deleteCall as DeleteObjectsCommand | undefined)?.input.Delete?.Objects?.map((o) => o.Key!);
}

beforeAll(async () => {
  await initPgliteSchema(SCHEMA_SQL);
});

beforeEach(async () => {
  await cleanTables();
  listedObjects = [];
  sendMock.mockClear();
});

describe("runStorageOrphanSweep", () => {
  it("deletes a key with no creator_files row, keeps one with a live row", async () => {
    const creator = await seedCreator();
    const referencedKey = `creators/${creator.id}/deals/deadbeef/proofs/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png`;
    const unreferencedKey = `creators/${creator.id}/deals/deadbeef/proofs/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.png`;

    await db.insert(schema.creatorFiles).values({
      creatorId: creator.id,
      storageKey: referencedKey,
      mimeType: "image/png",
      sizeBytes: 100,
      scope: "evidence",
    });

    listedObjects = [
      { Key: referencedKey, LastModified: OLD_DATE },
      { Key: unreferencedKey, LastModified: OLD_DATE },
    ];

    const result = await runStorageOrphanSweep(FAKE_ENV);

    expect(result.skippedUnconfigured).toBe(false);
    expect(result.scanned).toBe(2);
    expect(result.deleted).toBe(1);
    expect(deletedKeysFrom(sendMock)).toEqual([unreferencedKey]);
  });

  it("treats a tombstoned creator_files row (deletedAt set) as unreferenced", async () => {
    const creator = await seedCreator();
    const tombstonedKey = `creators/${creator.id}/deals/deadbeef/contracts/cccccccc-cccc-cccc-cccc-cccccccccccc.pdf`;

    await db.insert(schema.creatorFiles).values({
      creatorId: creator.id,
      storageKey: tombstonedKey,
      mimeType: "application/pdf",
      sizeBytes: 100,
      scope: "contract",
      deletedAt: new Date(),
    });

    listedObjects = [{ Key: tombstonedKey, LastModified: OLD_DATE }];

    const result = await runStorageOrphanSweep(FAKE_ENV);

    expect(result.deleted).toBe(1);
    expect(deletedKeysFrom(sendMock)).toEqual([tombstonedKey]);
  });

  it("does not delete an unreferenced key inside the grace period", async () => {
    const creator = await seedCreator();
    const freshKey = `creators/${creator.id}/deals/deadbeef/proofs/dddddddd-dddd-dddd-dddd-dddddddddddd.png`;

    listedObjects = [{ Key: freshKey, LastModified: new Date() }];

    const result = await runStorageOrphanSweep(FAKE_ENV);

    expect(result.scanned).toBe(1);
    expect(result.deleted).toBe(0);
    expect(sendMock.mock.calls.some(([command]) => command instanceof DeleteObjectsCommand)).toBe(false);
  });

  it("does not delete anything when nothing was listed", async () => {
    listedObjects = [];

    const result = await runStorageOrphanSweep(FAKE_ENV);

    expect(result.scanned).toBe(0);
    expect(result.deleted).toBe(0);
    expect(sendMock.mock.calls.some(([command]) => command instanceof DeleteObjectsCommand)).toBe(false);
  });
});
