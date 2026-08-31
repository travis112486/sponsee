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
  await db.execute(sql`TRUNCATE TABLE deals, brands, creators CASCADE`);
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
  it("skips a malformed key instead of failing the whole pass, and still deletes the valid orphan", async () => {
    const [creator] = await db.insert(schema.creators).values({ displayName: "Creator A" }).returning();
    const [brand] = await db.insert(schema.brands).values({ creatorId: creator.id, name: "Brand A" }).returning();
    const [liveDeal] = await db
      .insert(schema.deals)
      .values({ creatorId: creator.id, brandId: brand.id, title: "Live Deal" })
      .returning();

    const orphanDealId = "99999999-9999-9999-9999-999999999999"; // never inserted → orphan
    const orphanKey = `creators/${creator.id}/deals/${orphanDealId}/proofs/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf`;
    const liveKey = `creators/${creator.id}/deals/${liveDeal.id}/proofs/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.pdf`;
    const malformedKey = `creators/${creator.id}/deals/not-a-uuid/proofs/manual-upload.pdf`;

    listedObjects = [
      { Key: orphanKey, LastModified: OLD_DATE },
      { Key: liveKey, LastModified: OLD_DATE },
      { Key: malformedKey, LastModified: OLD_DATE },
    ];

    const result = await runStorageOrphanSweep(FAKE_ENV);

    expect(result.skippedUnconfigured).toBe(false);
    expect(result.scanned).toBe(3);
    expect(result.skippedUnrecognized).toBe(1);
    expect(result.deleted).toBe(1);

    const deleteCall = sendMock.mock.calls.map(([command]) => command).find((c) => c instanceof DeleteObjectsCommand);
    expect(deleteCall).toBeDefined();
    const deletedKeys = (deleteCall as DeleteObjectsCommand).input.Delete?.Objects?.map((o) => o.Key);
    expect(deletedKeys).toEqual([orphanKey]);
  });

  it("does not query the database at all when every key is unrecognizable", async () => {
    listedObjects = [{ Key: "creators/x/deals/not-a-uuid/proofs/manual-upload.pdf", LastModified: OLD_DATE }];

    const result = await runStorageOrphanSweep(FAKE_ENV);

    expect(result.scanned).toBe(1);
    expect(result.skippedUnrecognized).toBe(1);
    expect(result.deleted).toBe(0);
    expect(sendMock.mock.calls.some(([command]) => command instanceof DeleteObjectsCommand)).toBe(false);
  });
});
