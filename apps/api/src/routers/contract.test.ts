import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { eq, sql } from "drizzle-orm";
import { contractRouter } from "./contract.js";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "../test-utils/schema-sql.js";

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
  });
});
