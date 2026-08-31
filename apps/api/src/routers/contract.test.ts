import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { eq, sql } from "drizzle-orm";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "../test-utils/schema-sql.js";
import { buildObjectKey } from "../storage/index.js";
import { contractRouter } from "./contract.js";

// deleteObject is the one storage export that actually reaches the network
// (S3Client#send); every other export used here (buildObjectKey,
// keyBelongsToDeal, extensionFromKey, mimeTypeForExtension, createDownloadUrl
// via getSignedUrl) is a pure/local computation, so only this one needs
// mocking to keep the suite offline.
const storageMocks = vi.hoisted(() => ({
  deleteObject: vi.fn(async () => {}),
}));

vi.mock("../storage/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage/index.js")>();
  return { ...actual, deleteObject: storageMocks.deleteObject };
});

// ── Schema SQL (shared with every other PGlite suite via test-utils/schema-sql.ts;
// fileParallelism: false / maxWorkers: 1 in scripts/vitest-api.config.ts (SPO-86)
// serialises the suite onto one PGlite instance, so whichever file runs first
// must set up every table the suite touches) ─────────────────────────────────

// ── Helpers ─────────────────────────────────────────────────────────────────

function mockCtx(creatorId: string) {
  return {
    session: { user: { id: `user-${creatorId}`, email: "test@example.com", name: "Test User" } },
    creatorId,
    db,
  };
}

let creatorAId = "";
let creatorBId = "";
let dealAId = "";
let dealBId = "";

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
}

async function cleanTables() {
  await db.execute(sql`
    TRUNCATE TABLE
      activity_events,
      contracts,
      deals,
      brands,
      creators
    CASCADE
  `);
}

async function activityFor(entityId: string) {
  return db
    .select()
    .from(schema.activityEvents)
    .where(eq(schema.activityEvents.entityId, entityId));
}

beforeAll(async () => {
  await initPgliteSchema(SCHEMA_SQL);
});

beforeEach(async () => {
  await cleanTables();
  await seed();
  storageMocks.deleteObject.mockClear();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("contract router", () => {
  describe("getByDeal", () => {
    it("returns null when no contract is attached", async () => {
      const caller = contractRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.getByDeal({ dealId: dealAId });
      expect(result).toBeNull();
    });

    it("rejects a deal owned by another creator", async () => {
      const caller = contractRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.getByDeal({ dealId: dealBId })).rejects.toThrowError(TRPCError);
    });

    describe("with an uploaded PDF", () => {
      afterEach(() => {
        vi.unstubAllEnvs();
      });

      it("degrades to a null viewUrl when storage isn't configured", async () => {
        vi.stubEnv("STORAGE_ENDPOINT", "");
        vi.stubEnv("STORAGE_BUCKET", "");
        vi.stubEnv("STORAGE_REGION", "");
        vi.stubEnv("STORAGE_ACCESS_KEY_ID", "");
        vi.stubEnv("STORAGE_SECRET_ACCESS_KEY", "");

        const caller = contractRouter.createCaller(mockCtx(creatorAId));
        const storageKey = buildObjectKey({
          creatorId: creatorAId,
          dealId: dealAId,
          scope: "contracts",
          extension: "pdf",
        });
        await caller.upsert({ dealId: dealAId, storageKey, sizeBytes: 100 });

        const result = await caller.getByDeal({ dealId: dealAId });
        expect(result?.viewUrl).toBeNull();
      });

      it("returns a short-TTL presigned GET when storage is configured", async () => {
        vi.stubEnv("STORAGE_ENDPOINT", "http://localhost:9000");
        vi.stubEnv("STORAGE_BUCKET", "sponsee-test");
        vi.stubEnv("STORAGE_REGION", "auto");
        vi.stubEnv("STORAGE_ACCESS_KEY_ID", "test-access-key");
        vi.stubEnv("STORAGE_SECRET_ACCESS_KEY", "test-secret-key");

        const caller = contractRouter.createCaller(mockCtx(creatorAId));
        const storageKey = buildObjectKey({
          creatorId: creatorAId,
          dealId: dealAId,
          scope: "contracts",
          extension: "pdf",
        });
        await caller.upsert({ dealId: dealAId, storageKey, sizeBytes: 100 });

        const result = await caller.getByDeal({ dealId: dealAId });
        expect(result?.viewUrl).toMatch(/^http:\/\/localhost:9000\//);
        expect(new URL(result!.viewUrl!).pathname).toContain(storageKey);
      });
    });
  });

  describe("upsert", () => {
    it("attaches a contract by pasted text and logs an activity event", async () => {
      const caller = contractRouter.createCaller(mockCtx(creatorAId));
      const contract = await caller.upsert({ dealId: dealAId, bodyText: "AGREEMENT between..." });

      expect(contract.dealId).toBe(dealAId);
      expect(contract.status).toBe("draft");
      expect(contract.bodyText).toBe("AGREEMENT between...");
      expect(contract.fileUrl).toBeNull();

      const events = await activityFor(contract.id);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe("contract");
      expect(events[0].payload).toMatchObject({ action: "attached", hasText: true, hasFile: false });
    });

    it("attaches a contract by URL", async () => {
      const caller = contractRouter.createCaller(mockCtx(creatorAId));
      const contract = await caller.upsert({
        dealId: dealAId,
        fileUrl: "https://drive.google.com/file/d/abc/contract.pdf",
      });
      expect(contract.fileUrl).toBe("https://drive.google.com/file/d/abc/contract.pdf");
      expect(contract.bodyText).toBeNull();
    });

    it("updates the existing contract instead of creating a second one", async () => {
      const caller = contractRouter.createCaller(mockCtx(creatorAId));
      const first = await caller.upsert({ dealId: dealAId, bodyText: "v1" });
      const second = await caller.upsert({ dealId: dealAId, bodyText: "v2" });

      expect(second.id).toBe(first.id);
      expect(second.bodyText).toBe("v2");

      const all = await db
        .select()
        .from(schema.contracts)
        .where(eq(schema.contracts.dealId, dealAId));
      expect(all).toHaveLength(1);

      const events = await activityFor(first.id);
      expect(events.map((e) => (e.payload as { action: string }).action)).toEqual([
        "attached",
        "updated",
      ]);
    });

    it("converges to a single row when two upserts race on the same deal", async () => {
      const callerA = contractRouter.createCaller(mockCtx(creatorAId));
      const callerB = contractRouter.createCaller(mockCtx(creatorAId));

      const [first, second] = await Promise.all([
        callerA.upsert({ dealId: dealAId, bodyText: "race v1" }),
        callerB.upsert({ dealId: dealAId, bodyText: "race v2" }),
      ]);

      expect(first.id).toBe(second.id);

      const all = await db
        .select()
        .from(schema.contracts)
        .where(eq(schema.contracts.dealId, dealAId));
      expect(all).toHaveLength(1);
      expect(["race v1", "race v2"]).toContain(all[0].bodyText);
    });

    it("rejects when neither text nor URL is provided", async () => {
      const caller = contractRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.upsert({ dealId: dealAId, bodyText: "   " })).rejects.toThrow();
    });

    it("rejects non-http(s) links", async () => {
      const caller = contractRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.upsert({ dealId: dealAId, fileUrl: "javascript:alert(1)" })
      ).rejects.toThrow();
    });

    it("rejects a deal owned by another creator", async () => {
      const caller = contractRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.upsert({ dealId: dealBId, bodyText: "sneaky" })).rejects.toThrowError(
        TRPCError
      );
    });
  });

  describe("upsert — file upload", () => {
    it("accepts an uploaded PDF and stores its metadata", async () => {
      const caller = contractRouter.createCaller(mockCtx(creatorAId));
      const storageKey = buildObjectKey({
        creatorId: creatorAId,
        dealId: dealAId,
        scope: "contracts",
        extension: "pdf",
      });

      const contract = await caller.upsert({
        dealId: dealAId,
        storageKey,
        sizeBytes: 4096,
        originalFilename: "Master Services Agreement.pdf",
      });

      expect(contract.storageKey).toBe(storageKey);
      expect(contract.mimeType).toBe("application/pdf");
      expect(contract.sizeBytes).toBe(4096);
      expect(contract.originalFilename).toBe("Master Services Agreement.pdf");
      expect(contract.fileUrl).toBeNull();

      const events = await activityFor(contract.id);
      expect(events[0].payload).toMatchObject({ action: "attached", hasFile: true, hasText: false });
    });

    it("rejects a non-PDF upload", async () => {
      const caller = contractRouter.createCaller(mockCtx(creatorAId));
      const storageKey = buildObjectKey({
        creatorId: creatorAId,
        dealId: dealAId,
        scope: "contracts",
        extension: "png",
      });

      await expect(
        caller.upsert({ dealId: dealAId, storageKey, sizeBytes: 1024 })
      ).rejects.toThrowError(TRPCError);

      const all = await db.select().from(schema.contracts).where(eq(schema.contracts.dealId, dealAId));
      expect(all).toHaveLength(0);
    });

    it("rejects a storage key scoped to another creator/deal", async () => {
      const caller = contractRouter.createCaller(mockCtx(creatorAId));
      const foreignKey = buildObjectKey({
        creatorId: creatorBId,
        dealId: dealBId,
        scope: "contracts",
        extension: "pdf",
      });

      await expect(
        caller.upsert({ dealId: dealAId, storageKey: foreignKey, sizeBytes: 1024 })
      ).rejects.toThrowError(TRPCError);

      const all = await db.select().from(schema.contracts).where(eq(schema.contracts.dealId, dealAId));
      expect(all).toHaveLength(0);
    });

    it("rejects a storage key for the right creator but the wrong deal", async () => {
      const caller = contractRouter.createCaller(mockCtx(creatorAId));
      const otherDealKey = buildObjectKey({
        creatorId: creatorAId,
        dealId: dealBId,
        scope: "contracts",
        extension: "pdf",
      });

      await expect(
        caller.upsert({ dealId: dealAId, storageKey: otherDealKey, sizeBytes: 1024 })
      ).rejects.toThrowError(TRPCError);
    });

    it("deletes the superseded object when a new PDF replaces an existing upload", async () => {
      const caller = contractRouter.createCaller(mockCtx(creatorAId));
      const firstKey = buildObjectKey({
        creatorId: creatorAId,
        dealId: dealAId,
        scope: "contracts",
        extension: "pdf",
      });
      await caller.upsert({ dealId: dealAId, storageKey: firstKey, sizeBytes: 100 });

      const secondKey = buildObjectKey({
        creatorId: creatorAId,
        dealId: dealAId,
        scope: "contracts",
        extension: "pdf",
      });
      const contract = await caller.upsert({ dealId: dealAId, storageKey: secondKey, sizeBytes: 200 });

      expect(contract.storageKey).toBe(secondKey);
      expect(storageMocks.deleteObject).toHaveBeenCalledTimes(1);
      expect(storageMocks.deleteObject).toHaveBeenCalledWith(firstKey);

      const all = await db.select().from(schema.contracts).where(eq(schema.contracts.dealId, dealAId));
      expect(all).toHaveLength(1);
    });

    it("deletes the old object when a PDF upload is replaced by a pasted link", async () => {
      const caller = contractRouter.createCaller(mockCtx(creatorAId));
      const storageKey = buildObjectKey({
        creatorId: creatorAId,
        dealId: dealAId,
        scope: "contracts",
        extension: "pdf",
      });
      await caller.upsert({ dealId: dealAId, storageKey, sizeBytes: 100 });

      const contract = await caller.upsert({
        dealId: dealAId,
        fileUrl: "https://drive.google.com/file/d/abc/contract.pdf",
      });

      expect(contract.storageKey).toBeNull();
      expect(contract.fileUrl).toBe("https://drive.google.com/file/d/abc/contract.pdf");
      expect(storageMocks.deleteObject).toHaveBeenCalledTimes(1);
      expect(storageMocks.deleteObject).toHaveBeenCalledWith(storageKey);
    });

    it("does not call deleteObject when there was nothing to replace", async () => {
      const caller = contractRouter.createCaller(mockCtx(creatorAId));
      const storageKey = buildObjectKey({
        creatorId: creatorAId,
        dealId: dealAId,
        scope: "contracts",
        extension: "pdf",
      });
      await caller.upsert({ dealId: dealAId, storageKey, sizeBytes: 100 });
      expect(storageMocks.deleteObject).not.toHaveBeenCalled();
    });
  });

  describe("updateStatus", () => {
    it("moves draft → sent, logs the transition, and advances the deal to contract_sent", async () => {
      const caller = contractRouter.createCaller(mockCtx(creatorAId));
      const contract = await caller.upsert({ dealId: dealAId, bodyText: "terms" });

      const { contract: updated, dealStage } = await caller.updateStatus({
        dealId: dealAId,
        status: "sent",
      });

      expect(updated.status).toBe("sent");
      expect(dealStage).toBe("contract_sent");

      const [deal] = await db.select().from(schema.deals).where(eq(schema.deals.id, dealAId));
      expect(deal.stage).toBe("contract_sent");

      const contractEvents = await activityFor(contract.id);
      expect(contractEvents.map((e) => (e.payload as { action?: string }).action)).toContain(
        "status_change"
      );

      const dealEvents = await activityFor(dealAId);
      const stageChange = dealEvents.find((e) => e.kind === "stage_change");
      expect(stageChange).toBeDefined();
      expect(stageChange!.actor).toBe("system");
      expect(stageChange!.payload).toMatchObject({ from: "negotiating", to: "contract_sent" });
    });

    it("does not move a deal in a later stage backwards", async () => {
      await db.update(schema.deals).set({ stage: "live" }).where(eq(schema.deals.id, dealAId));

      const caller = contractRouter.createCaller(mockCtx(creatorAId));
      await caller.upsert({ dealId: dealAId, bodyText: "terms" });
      const { dealStage } = await caller.updateStatus({ dealId: dealAId, status: "sent" });

      expect(dealStage).toBe("live");
      const [deal] = await db.select().from(schema.deals).where(eq(schema.deals.id, dealAId));
      expect(deal.stage).toBe("live");
    });

    it("stamps signedAt when marked signed and clears it when reverted", async () => {
      const caller = contractRouter.createCaller(mockCtx(creatorAId));
      await caller.upsert({ dealId: dealAId, bodyText: "terms" });

      const { contract: signed } = await caller.updateStatus({ dealId: dealAId, status: "signed" });
      expect(signed.signedAt).toBeInstanceOf(Date);

      const { contract: reverted } = await caller.updateStatus({ dealId: dealAId, status: "viewed" });
      expect(reverted.signedAt).toBeNull();
    });

    it("is a no-op when the status is unchanged", async () => {
      const caller = contractRouter.createCaller(mockCtx(creatorAId));
      const contract = await caller.upsert({ dealId: dealAId, bodyText: "terms" });

      const { contract: same } = await caller.updateStatus({ dealId: dealAId, status: "draft" });
      expect(same.status).toBe("draft");

      // only the attach event — no status_change logged
      const events = await activityFor(contract.id);
      expect(events).toHaveLength(1);
    });

    it("404s when no contract exists on the deal", async () => {
      const caller = contractRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.updateStatus({ dealId: dealAId, status: "sent" })).rejects.toThrowError(
        TRPCError
      );
    });

    it("rejects a deal owned by another creator", async () => {
      const callerB = contractRouter.createCaller(mockCtx(creatorBId));
      await callerB.upsert({ dealId: dealBId, bodyText: "b terms" });

      const callerA = contractRouter.createCaller(mockCtx(creatorAId));
      await expect(callerA.updateStatus({ dealId: dealBId, status: "signed" })).rejects.toThrowError(
        TRPCError
      );
    });
  });

  describe("remove", () => {
    it("deletes the contract and logs an activity event", async () => {
      const caller = contractRouter.createCaller(mockCtx(creatorAId));
      const contract = await caller.upsert({ dealId: dealAId, bodyText: "terms" });

      const result = await caller.remove({ dealId: dealAId });
      expect(result.success).toBe(true);

      const remaining = await db
        .select()
        .from(schema.contracts)
        .where(eq(schema.contracts.dealId, dealAId));
      expect(remaining).toHaveLength(0);

      const events = await activityFor(contract.id);
      expect(events.map((e) => (e.payload as { action: string }).action)).toContain("removed");
    });

    it("rejects a deal owned by another creator", async () => {
      const callerB = contractRouter.createCaller(mockCtx(creatorBId));
      await callerB.upsert({ dealId: dealBId, bodyText: "b terms" });

      const callerA = contractRouter.createCaller(mockCtx(creatorAId));
      await expect(callerA.remove({ dealId: dealBId })).rejects.toThrowError(TRPCError);

      const still = await db
        .select()
        .from(schema.contracts)
        .where(eq(schema.contracts.dealId, dealBId));
      expect(still).toHaveLength(1);
    });

    it("deletes the uploaded object when removing a file-backed contract", async () => {
      const caller = contractRouter.createCaller(mockCtx(creatorAId));
      const storageKey = buildObjectKey({
        creatorId: creatorAId,
        dealId: dealAId,
        scope: "contracts",
        extension: "pdf",
      });
      await caller.upsert({ dealId: dealAId, storageKey, sizeBytes: 100 });

      await caller.remove({ dealId: dealAId });

      expect(storageMocks.deleteObject).toHaveBeenCalledTimes(1);
      expect(storageMocks.deleteObject).toHaveBeenCalledWith(storageKey);
    });
  });
});
