import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { eq, sql } from "drizzle-orm";
import { proofRouter } from "./proof.js";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "../test-utils/schema-sql.js";
import {
  createDownloadUrl,
  deleteObject,
  MAX_UPLOAD_BYTES,
  StorageNotConfiguredError,
} from "../storage/index.js";

// The proof router touches the storage module for two side effects — presigning
// a GET (listByDeal) and deleting an object (delete). Both hit the network, so
// they're stubbed; everything else (keyBelongsToDeal, MAX_UPLOAD_BYTES, the
// domain errors) stays real so the ownership + size guards are actually tested.
vi.mock("../storage/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage/index.js")>();
  return {
    ...actual,
    createDownloadUrl: vi.fn(),
    deleteObject: vi.fn(),
  };
});

function mockCtx(creatorId: string) {
  return {
    session: { user: { id: `user-${creatorId}`, email: "test@example.com", name: "Test User" } },
    creatorId,
    db,
  };
}

/** A key that keyBelongsToDeal accepts for the given creator/deal pair. */
function keyFor(creatorId: string, dealId: string, ext = "png") {
  return `creators/${creatorId}/deals/${dealId}/proofs/00000000-0000-0000-0000-000000000000.${ext}`;
}

let creatorAId = "";
let creatorBId = "";
let dealAId = "";
let dealBId = "";
let deliverableAId = "";

async function seed() {
  const [creatorA] = await db
    .insert(schema.creators)
    .values({ displayName: "Creator A" })
    .returning();
  const [creatorB] = await db
    .insert(schema.creators)
    .values({ displayName: "Creator B" })
    .returning();
  creatorAId = creatorA.id;
  creatorBId = creatorB.id;

  const [brandA] = await db
    .insert(schema.brands)
    .values({ creatorId: creatorAId, name: "Brand A" })
    .returning();
  const [brandB] = await db
    .insert(schema.brands)
    .values({ creatorId: creatorBId, name: "Brand B" })
    .returning();

  const [dealA] = await db
    .insert(schema.deals)
    .values({ creatorId: creatorAId, brandId: brandA.id, title: "Deal A", stage: "negotiating" })
    .returning();
  const [dealB] = await db
    .insert(schema.deals)
    .values({ creatorId: creatorBId, brandId: brandB.id, title: "Deal B" })
    .returning();
  dealAId = dealA.id;
  dealBId = dealB.id;

  const [deliverableA] = await db
    .insert(schema.deliverables)
    .values({ dealId: dealAId, title: "Deliverable A" })
    .returning();
  deliverableAId = deliverableA.id;
}

async function cleanTables() {
  await db.execute(sql`
    TRUNCATE TABLE
      activity_events,
      proofs,
      deliverables,
      deals,
      brands,
      creators
    CASCADE
  `);
}

beforeAll(async () => {
  await initPgliteSchema(SCHEMA_SQL);
});

beforeEach(async () => {
  vi.mocked(createDownloadUrl).mockReset();
  vi.mocked(deleteObject).mockReset();
  await cleanTables();
  await seed();
});

describe("proof router", () => {
  describe("create", () => {
    it("accepts a file-only proof with no link or note", async () => {
      const key = keyFor(creatorAId, dealAId);
      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      const proof = await caller.create({
        dealId: dealAId,
        deliverableId: deliverableAId,
        kind: "file",
        storageKey: key,
        mimeType: "image/png",
        sizeBytes: 2048,
        originalFilename: "screenshot.png",
      });

      expect(proof.storageKey).toBe(key);
      expect(proof.mimeType).toBe("image/png");
      expect(proof.sizeBytes).toBe(2048);
      expect(proof.originalFilename).toBe("screenshot.png");
      expect(proof.url).toBeNull();
      expect(proof.note).toBeNull();
    });

    it("rejects a storageKey signed for another creator", async () => {
      const key = keyFor(creatorBId, dealBId);
      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.create({
          dealId: dealAId,
          kind: "file",
          storageKey: key,
          mimeType: "image/png",
          sizeBytes: 2048,
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("rejects an oversized file proof", async () => {
      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.create({
          dealId: dealAId,
          kind: "file",
          storageKey: keyFor(creatorAId, dealAId),
          mimeType: "image/png",
          sizeBytes: MAX_UPLOAD_BYTES + 1,
        })
      ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    });

    it("rejects a submission with no link, note, or file", async () => {
      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.create({ dealId: dealAId, kind: "link" })).rejects.toThrow();
    });
  });

  describe("listByDeal", () => {
    it("returns a presigned GET for a file-backed proof", async () => {
      vi.mocked(createDownloadUrl).mockResolvedValue({
        url: "https://example.com/signed-get",
        expiresAt: new Date("2026-01-01T00:00:00Z"),
      });

      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      await caller.create({
        dealId: dealAId,
        kind: "file",
        storageKey: keyFor(creatorAId, dealAId),
        mimeType: "application/pdf",
        sizeBytes: 2048,
        originalFilename: "contract.pdf",
      });

      const rows = await caller.listByDeal({ dealId: dealAId });
      expect(rows).toHaveLength(1);
      expect(rows[0].signedUrl).toBe("https://example.com/signed-get");
      expect(vi.mocked(createDownloadUrl)).toHaveBeenCalledWith({
        key: keyFor(creatorAId, dealAId),
        filename: "contract.pdf",
      });
    });

    it("returns a null signedUrl when storage is not configured", async () => {
      vi.mocked(createDownloadUrl).mockRejectedValue(new StorageNotConfiguredError());

      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      await caller.create({
        dealId: dealAId,
        kind: "file",
        storageKey: keyFor(creatorAId, dealAId),
        mimeType: "image/png",
        sizeBytes: 2048,
      });

      const rows = await caller.listByDeal({ dealId: dealAId });
      expect(rows).toHaveLength(1);
      expect(rows[0].signedUrl).toBeNull();
    });
  });

  describe("delete", () => {
    it("deletes the object, not just the row", async () => {
      const key = keyFor(creatorAId, dealAId);
      vi.mocked(deleteObject).mockResolvedValue(undefined);

      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      const proof = await caller.create({
        dealId: dealAId,
        kind: "file",
        storageKey: key,
        mimeType: "image/png",
        sizeBytes: 2048,
      });

      const result = await caller.delete({ id: proof.id });
      expect(result).toEqual({ success: true });
      expect(vi.mocked(deleteObject)).toHaveBeenCalledWith(key);

      const remaining = await db
        .select()
        .from(schema.proofs)
        .where(eq(schema.proofs.id, proof.id));
      expect(remaining).toHaveLength(0);
    });

    it("does not call deleteObject for a link-only proof", async () => {
      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      const proof = await caller.create({
        dealId: dealAId,
        kind: "clip",
        url: "https://clips.twitch.tv/abc",
      });

      await caller.delete({ id: proof.id });
      expect(vi.mocked(deleteObject)).not.toHaveBeenCalled();
    });
  });
});
