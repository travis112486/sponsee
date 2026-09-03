import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { eq, and, sql } from "drizzle-orm";
import {
  settingsRouter,
  syncNowLimiter,
  SYNC_NOW_MAX_PER_WINDOW,
} from "../routers/settings.js";
import { brandRouter } from "../routers/brand.js";
import { deliverableRouter } from "../routers/deliverable.js";
import { proofRouter } from "../routers/proof.js";
import { dealsRouter } from "../routers/deals.js";
import { invoiceRouter } from "../routers/invoice.js";
import { chaseRouter } from "../routers/chase.js";
import { activityRouter } from "../routers/activity.js";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "../test-utils/schema-sql.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockCtx(creatorId: string) {
  return {
    session: { user: { id: `user-${creatorId}`, email: "test@example.com", name: "Test User" } },
    creatorId,
    db,
  };
}

let creatorAId = "";
let creatorBId = "";
let brandAId = "";
let brandBId = "";
let contactAId = "";
let contactBId = "";
let dealAId = "";
let dealBId = "";
let platformAId = "";
let platformBId = "";
let deliverableAId = "";
let deliverableBId = "";
let proofAId = "";
let proofBId = "";
let invoiceAId = "";
let invoiceBId = "";
let templateAId = "";
let templateBId = "";
let chaseEventAId = "";
let chaseEventBId = "";

async function seed() {
  const [creatorA] = await db.insert(schema.creators).values({ displayName: "Creator A" }).returning();
  const [creatorB] = await db.insert(schema.creators).values({ displayName: "Creator B" }).returning();
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
  brandAId = brandA.id;
  brandBId = brandB.id;

  const [contactA] = await db
    .insert(schema.contacts)
    .values({ brandId: brandAId, name: "Contact A", email: "a@example.com" })
    .returning();
  const [contactB] = await db
    .insert(schema.contacts)
    .values({ brandId: brandBId, name: "Contact B", email: "b@example.com" })
    .returning();
  contactAId = contactA.id;
  contactBId = contactB.id;

  const [dealA] = await db
    .insert(schema.deals)
    .values({ creatorId: creatorAId, brandId: brandAId, title: "Deal A" })
    .returning();
  const [dealB] = await db
    .insert(schema.deals)
    .values({ creatorId: creatorBId, brandId: brandBId, title: "Deal B" })
    .returning();
  dealAId = dealA.id;
  dealBId = dealB.id;

  const [platformA] = await db
    .insert(schema.creatorPlatforms)
    .values({ creatorId: creatorAId, platform: "twitch", ccv: 100 })
    .returning();
  const [platformB] = await db
    .insert(schema.creatorPlatforms)
    .values({ creatorId: creatorBId, platform: "youtube", ccv: 200 })
    .returning();
  platformAId = platformA.id;
  platformBId = platformB.id;

  const [delA] = await db
    .insert(schema.deliverables)
    .values({ dealId: dealAId, title: "Deliverable A", position: 0 })
    .returning();
  const [delB] = await db
    .insert(schema.deliverables)
    .values({ dealId: dealBId, title: "Deliverable B", position: 0 })
    .returning();
  deliverableAId = delA.id;
  deliverableBId = delB.id;

  const [proofA] = await db
    .insert(schema.proofs)
    .values({ dealId: dealAId, deliverableId: deliverableAId, kind: "clip", url: "https://clips.twitch.tv/a" })
    .returning();
  const [proofB] = await db
    .insert(schema.proofs)
    .values({ dealId: dealBId, deliverableId: deliverableBId, kind: "vod", url: "https://youtube.com/watch?v=b" })
    .returning();
  proofAId = proofA.id;
  proofBId = proofB.id;

  const [invoiceA] = await db
    .insert(schema.invoices)
    .values({
      creatorId: creatorAId,
      dealId: dealAId,
      contactId: contactAId,
      number: 1,
      amountCents: 10000,
      currency: "USD",
      terms: "net_30",
      status: "open",
      title: "Invoice A",
    })
    .returning();
  invoiceAId = invoiceA.id;

  const [invoiceB] = await db
    .insert(schema.invoices)
    .values({
      creatorId: creatorBId,
      dealId: dealBId,
      contactId: contactBId,
      number: 1,
      amountCents: 20000,
      currency: "USD",
      terms: "net_30",
      status: "open",
      title: "Invoice B",
    })
    .returning();
  invoiceBId = invoiceB.id;

  const [templateA] = await db
    .insert(schema.chaseTemplates)
    .values({
      creatorId: creatorAId,
      step: 1,
      name: "Day 1",
      offsetDays: 1,
      subject: "Payment due",
      body: "Please pay",
      enabled: true,
    })
    .returning();
  const [templateB] = await db
    .insert(schema.chaseTemplates)
    .values({
      creatorId: creatorBId,
      step: 1,
      name: "Day 1",
      offsetDays: 1,
      subject: "Payment due",
      body: "Please pay",
      enabled: true,
    })
    .returning();
  templateAId = templateA.id;
  templateBId = templateB.id;

  await db.insert(schema.invoiceChaseState).values({
    invoiceId: invoiceAId,
    mode: "armed",
    nextStep: 1,
  });
  await db.insert(schema.invoiceChaseState).values({
    invoiceId: invoiceBId,
    mode: "armed",
    nextStep: 1,
  });

  const [chaseEventA] = await db
    .insert(schema.chaseEvents)
    .values({
      invoiceId: invoiceAId,
      step: 1,
      subjectSnapshot: "Pay up",
      bodySnapshot: "Please pay",
      toEmail: "brand-a@example.com",
      status: "awaiting_review",
    })
    .returning();
  const [chaseEventB] = await db
    .insert(schema.chaseEvents)
    .values({
      invoiceId: invoiceBId,
      step: 1,
      subjectSnapshot: "Pay up",
      bodySnapshot: "Please pay",
      toEmail: "brand-b@example.com",
      status: "awaiting_review",
    })
    .returning();
  chaseEventAId = chaseEventA.id;
  chaseEventBId = chaseEventB.id;
}

async function cleanTables() {
  // TRUNCATE is more reliable than DELETE ALL in PGlite/Drizzle
  await db.execute(sql`
    TRUNCATE TABLE
      activity_events,
      chase_events,
      invoice_chase_state,
      chase_templates,
      invoices,
      contracts,
      proofs,
      deliverables,
      deals,
      contacts,
      brands,
      creator_platforms,
      memberships,
      creators
    CASCADE
  `);
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await initPgliteSchema(SCHEMA_SQL);
});

beforeEach(async () => {
  await cleanTables();
  await seed();
});

// ── Settings router ──────────────────────────────────────────────────────────

describe("settings router tenant isolation", () => {
  describe("upsertPlatform", () => {
    it("updates an owned platform", async () => {
      const caller = settingsRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.upsertPlatform({
        id: platformAId,
        platform: "twitch",
        ccv: 999,
      });
      expect(result).toBeDefined();
      expect(result?.ccv).toBe(999);
    });

    it("throws NOT_FOUND when updating a cross-creator platform", async () => {
      const caller = settingsRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.upsertPlatform({
          id: platformBId,
          platform: "youtube",
          ccv: 999,
        })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });

    it("does not mutate a cross-creator platform on rejection", async () => {
      const caller = settingsRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.upsertPlatform({
          id: platformBId,
          platform: "youtube",
          ccv: 999,
        });
      } catch {
        // expected
      }

      const [row] = await db
        .select()
        .from(schema.creatorPlatforms)
        .where(eq(schema.creatorPlatforms.id, platformBId));
      expect(row.ccv).toBe(200);
    });

    it("returns CONFLICT when the id path reclassifies a row onto an existing platform", async () => {
      // Creator A already has a twitch row (platformAId). Add a youtube row, then
      // try to move the twitch row onto "youtube" — this collides with the
      // (creatorId, platform) unique index, which must surface as CONFLICT, not
      // an unhandled Postgres error (SPO-136).
      await db
        .insert(schema.creatorPlatforms)
        .values({ creatorId: creatorAId, platform: "youtube", ccv: 150 });

      const caller = settingsRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.upsertPlatform({
          id: platformAId,
          platform: "youtube",
          ccv: 999,
        })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "CONFLICT");

      // The twitch row keeps its identity and its data — no silent reclassification.
      const [twitch] = await db
        .select()
        .from(schema.creatorPlatforms)
        .where(eq(schema.creatorPlatforms.id, platformAId));
      expect(twitch.platform).toBe("twitch");
      expect(twitch.ccv).toBe(100);
    });

    it("returns CONFLICT when the id path reclassifies a row onto a new platform", async () => {
      // Even when the target platform doesn't collide, changing an existing row's
      // platform is not a meaningful edit — it must CONFLICT, not overwrite.
      const caller = settingsRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.upsertPlatform({
          id: platformAId,
          platform: "kick",
          ccv: 999,
        })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "CONFLICT");

      const [twitch] = await db
        .select()
        .from(schema.creatorPlatforms)
        .where(eq(schema.creatorPlatforms.id, platformAId));
      expect(twitch.platform).toBe("twitch");
      expect(twitch.ccv).toBe(100);
    });

    it("keeps sync state when saving with an unchanged handle", async () => {
      // The panel sends `handle` on every save; an edit that doesn't change it
      // (e.g. updating CCV) must not wipe the row's sync state.
      await db
        .update(schema.creatorPlatforms)
        .set({ handle: "streamer-a", syncStatus: "ok", lastSyncedAt: new Date() })
        .where(eq(schema.creatorPlatforms.id, platformAId));

      const caller = settingsRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.upsertPlatform({
        id: platformAId,
        platform: "twitch",
        ccv: 555,
        handle: "streamer-a",
      });
      expect(result?.ccv).toBe(555);
      expect(result?.syncStatus).toBe("ok");
    });

    it("resets sync state when the handle changes", async () => {
      await db
        .update(schema.creatorPlatforms)
        .set({ handle: "streamer-a", syncStatus: "error", syncError: "old failure" })
        .where(eq(schema.creatorPlatforms.id, platformAId));

      const caller = settingsRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.upsertPlatform({
        id: platformAId,
        platform: "twitch",
        handle: "brand-new-handle",
      });
      expect(result?.syncStatus).toBe("never");
      expect(result?.syncError).toBeNull();
    });

    it("fully applies an explicit null handle on the no-id upsert path", async () => {
      // SPO-126a: the conflict set used to swallow `handle: null` while
      // syncReset still counted it as a change — old handle kept, sync state
      // wiped. Handle and sync state must move together.
      await db
        .update(schema.creatorPlatforms)
        .set({ handle: "streamer-a", syncStatus: "ok", lastSyncedAt: new Date() })
        .where(eq(schema.creatorPlatforms.id, platformAId));

      const caller = settingsRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.upsertPlatform({ platform: "twitch", handle: null });
      expect(result?.id).toBe(platformAId);
      expect(result?.handle).toBeNull();
      expect(result?.syncStatus).toBe("never");
      expect(result?.syncError).toBeNull();
    });

    it("keeps handle and sync state on the no-id path when handle is omitted", async () => {
      await db
        .update(schema.creatorPlatforms)
        .set({ handle: "streamer-a", syncStatus: "ok" })
        .where(eq(schema.creatorPlatforms.id, platformAId));

      const caller = settingsRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.upsertPlatform({ platform: "twitch", ccv: 321 });
      expect(result?.ccv).toBe(321);
      expect(result?.handle).toBe("streamer-a");
      expect(result?.syncStatus).toBe("ok");
    });

    it("keeps sync state on the no-id path when the handle is unchanged", async () => {
      await db
        .update(schema.creatorPlatforms)
        .set({ handle: "streamer-a", syncStatus: "ok" })
        .where(eq(schema.creatorPlatforms.id, platformAId));

      const caller = settingsRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.upsertPlatform({
        platform: "twitch",
        handle: "streamer-a",
        ccv: 42,
      });
      expect(result?.syncStatus).toBe("ok");
    });

    it("applies explicit null ccv, followers, and scheduleLabel on the no-id upsert path", async () => {
      // SPO-130: the conflict set used to swallow explicit nulls for these
      // fields (`?? undefined`), so clearing them via the add-platform form
      // silently kept the stale values while the id path cleared them.
      await db
        .update(schema.creatorPlatforms)
        .set({ followers: 5000, scheduleLabel: "Mon/Wed/Fri" })
        .where(eq(schema.creatorPlatforms.id, platformAId));

      const caller = settingsRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.upsertPlatform({
        platform: "twitch",
        ccv: null,
        followers: null,
        scheduleLabel: null,
      });
      expect(result?.id).toBe(platformAId);
      expect(result?.ccv).toBeNull();
      expect(result?.followers).toBeNull();
      expect(result?.scheduleLabel).toBeNull();
    });

    it("keeps ccv, followers, and scheduleLabel on the no-id path when the keys are omitted", async () => {
      await db
        .update(schema.creatorPlatforms)
        .set({ followers: 5000, scheduleLabel: "Mon/Wed/Fri" })
        .where(eq(schema.creatorPlatforms.id, platformAId));

      const caller = settingsRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.upsertPlatform({
        platform: "twitch",
        handle: "streamer-a",
      });
      expect(result?.id).toBe(platformAId);
      expect(result?.ccv).toBe(100);
      expect(result?.followers).toBe(5000);
      expect(result?.scheduleLabel).toBe("Mon/Wed/Fri");
    });

    it("leaves ccv, followers, and scheduleLabel intact on the no-id path when resent unchanged", async () => {
      await db
        .update(schema.creatorPlatforms)
        .set({ followers: 5000, scheduleLabel: "Mon/Wed/Fri" })
        .where(eq(schema.creatorPlatforms.id, platformAId));

      const caller = settingsRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.upsertPlatform({
        platform: "twitch",
        ccv: 100,
        followers: 5000,
        scheduleLabel: "Mon/Wed/Fri",
      });
      expect(result?.id).toBe(platformAId);
      expect(result?.ccv).toBe(100);
      expect(result?.followers).toBe(5000);
      expect(result?.scheduleLabel).toBe("Mon/Wed/Fri");
    });
  });

  describe("syncPlatform", () => {
    beforeEach(() => {
      // Fresh throttle budget per test; the limiter is module-level state.
      syncNowLimiter.reset();
      // Force every platform client into its unconfigured state so no test
      // can reach a real upstream API, whatever the local shell exports.
      vi.stubEnv("TWITCH_CLIENT_ID", "");
      vi.stubEnv("TWITCH_CLIENT_SECRET", "");
      vi.stubEnv("KICK_CLIENT_ID", "");
      vi.stubEnv("KICK_CLIENT_SECRET", "");
      vi.stubEnv("YOUTUBE_API_KEY", "");
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("throws NOT_FOUND for a cross-creator platform, even one with a handle", async () => {
      await db
        .update(schema.creatorPlatforms)
        .set({ handle: "streamer-b" })
        .where(eq(schema.creatorPlatforms.id, platformBId));

      const caller = settingsRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.syncPlatform({ id: platformBId })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });

    it("does not touch the cross-creator row's sync state on rejection", async () => {
      await db
        .update(schema.creatorPlatforms)
        .set({ handle: "streamer-b" })
        .where(eq(schema.creatorPlatforms.id, platformBId));

      const caller = settingsRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.syncPlatform({ id: platformBId });
      } catch {
        // expected
      }

      const [row] = await db
        .select()
        .from(schema.creatorPlatforms)
        .where(eq(schema.creatorPlatforms.id, platformBId));
      expect(row.syncStatus).toBe("never");
      expect(row.lastSyncedAt).toBeNull();
    });

    it("throws BAD_REQUEST for an owned platform without a handle", async () => {
      const caller = settingsRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.syncPlatform({ id: platformAId })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "BAD_REQUEST"
      );
    });

    it("returns outcome 'skipped' with the row untouched when credentials aren't configured", async () => {
      // SPO-126b: a skipped sync used to be indistinguishable from a failed
      // one, so the panel toasted "Sync failed" in the pre-credentials window.
      await db
        .update(schema.creatorPlatforms)
        .set({ handle: "streamer-a" })
        .where(eq(schema.creatorPlatforms.id, platformAId));

      const caller = settingsRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.syncPlatform({ id: platformAId });
      expect(result.outcome).toBe("skipped");
      expect(result.row.syncStatus).toBe("never");
      expect(result.row.lastSyncedAt).toBeNull();
    });

    it("throttles repeated syncs per creator with TOO_MANY_REQUESTS", async () => {
      await db
        .update(schema.creatorPlatforms)
        .set({ handle: "streamer-a" })
        .where(eq(schema.creatorPlatforms.id, platformAId));

      const caller = settingsRouter.createCaller(mockCtx(creatorAId));
      // With unconfigured clients each call is a no-op sync, so this only
      // exercises the limiter, never the network.
      for (let i = 0; i < SYNC_NOW_MAX_PER_WINDOW; i++) {
        await caller.syncPlatform({ id: platformAId });
      }
      await expect(caller.syncPlatform({ id: platformAId })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "TOO_MANY_REQUESTS"
      );
    });
  });

  describe("deletePlatform", () => {
    it("deletes an owned platform", async () => {
      const caller = settingsRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.deletePlatform({ id: platformAId });
      expect(result.success).toBe(true);

      const rows = await db
        .select()
        .from(schema.creatorPlatforms)
        .where(eq(schema.creatorPlatforms.id, platformAId));
      expect(rows).toHaveLength(0);
    });

    it("throws NOT_FOUND when deleting a cross-creator platform", async () => {
      const caller = settingsRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.deletePlatform({ id: platformBId })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });

    it("does not delete a cross-creator platform on rejection", async () => {
      const caller = settingsRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.deletePlatform({ id: platformBId });
      } catch {
        // expected
      }

      const rows = await db
        .select()
        .from(schema.creatorPlatforms)
        .where(eq(schema.creatorPlatforms.id, platformBId));
      expect(rows).toHaveLength(1);
    });
  });
});

// ── Brand router ─────────────────────────────────────────────────────────────

describe("brand router tenant isolation", () => {
  describe("contacts", () => {
    it("returns contacts for an owned brand", async () => {
      const caller = brandRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.contacts({ brandId: brandAId });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(contactAId);
    });

    it("throws NOT_FOUND for a cross-creator brand", async () => {
      const caller = brandRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.contacts({ brandId: brandBId })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });

    it("does not leak contacts for a cross-creator brand", async () => {
      const caller = brandRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.contacts({ brandId: brandBId });
      } catch {
        // expected
      }
    });
  });

  describe("addContact", () => {
    it("adds a contact to an owned brand", async () => {
      const caller = brandRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.addContact({
        brandId: brandAId,
        name: "New Contact",
        email: "new@example.com",
      });
      expect(result).toBeDefined();
      expect(result.brandId).toBe(brandAId);
    });

    it("throws NOT_FOUND for a cross-creator brand", async () => {
      const caller = brandRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.addContact({
          brandId: brandBId,
          name: "Evil",
          email: "evil@example.com",
        })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });

    it("does not insert a contact for a cross-creator brand on rejection", async () => {
      const caller = brandRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.addContact({
          brandId: brandBId,
          name: "Evil",
          email: "evil@example.com",
        });
      } catch {
        // expected
      }

      const rows = await db
        .select()
        .from(schema.contacts)
        .where(eq(schema.contacts.brandId, brandBId));
      expect(rows).toHaveLength(1); // still only contactB
    });
  });

  describe("update", () => {
    it("sets the domain on an owned brand", async () => {
      const caller = brandRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.update({ brandId: brandAId, domain: "redbull.com" });
      expect(result?.domain).toBe("redbull.com");

      const [row] = await db
        .select()
        .from(schema.brands)
        .where(eq(schema.brands.id, brandAId));
      expect(row.domain).toBe("redbull.com");
    });

    it("clears the domain when passed null", async () => {
      await db
        .update(schema.brands)
        .set({ domain: "redbull.com" })
        .where(eq(schema.brands.id, brandAId));

      const caller = brandRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.update({ brandId: brandAId, domain: null });
      expect(result?.domain).toBeNull();

      const [row] = await db
        .select()
        .from(schema.brands)
        .where(eq(schema.brands.id, brandAId));
      expect(row.domain).toBeNull();
    });

    it("throws NOT_FOUND for a cross-creator brand", async () => {
      const caller = brandRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.update({ brandId: brandBId, domain: "redbull.com" })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });

    it("does not mutate a cross-creator brand's domain on rejection", async () => {
      const caller = brandRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.update({ brandId: brandBId, domain: "redbull.com" });
      } catch {
        // expected
      }

      const [row] = await db
        .select()
        .from(schema.brands)
        .where(eq(schema.brands.id, brandBId));
      expect(row.domain).toBeNull();
    });
  });
});

// ── Deliverable router ───────────────────────────────────────────────────────

describe("deliverable router tenant isolation", () => {
  describe("listByDeal", () => {
    it("returns deliverables for an owned deal", async () => {
      const caller = deliverableRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.listByDeal({ dealId: dealAId });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(deliverableAId);
    });

    it("throws NOT_FOUND for a cross-creator deal", async () => {
      const caller = deliverableRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.listByDeal({ dealId: dealBId })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });
  });

  describe("update", () => {
    it("updates an owned deliverable", async () => {
      const caller = deliverableRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.update({ id: deliverableAId, title: "Updated A" });
      expect(result).toBeDefined();
      expect(result?.title).toBe("Updated A");
    });

    it("throws NOT_FOUND for a cross-creator deliverable", async () => {
      const caller = deliverableRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.update({ id: deliverableBId, title: "Hacked" })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });

    it("does not mutate a cross-creator deliverable on rejection", async () => {
      const caller = deliverableRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.update({ id: deliverableBId, title: "Hacked" });
      } catch {
        // expected
      }

      const [row] = await db
        .select()
        .from(schema.deliverables)
        .where(eq(schema.deliverables.id, deliverableBId));
      expect(row.title).toBe("Deliverable B");
    });
  });

  describe("delete", () => {
    it("deletes an owned deliverable", async () => {
      const caller = deliverableRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.delete({ id: deliverableAId });
      expect(result.success).toBe(true);

      const rows = await db
        .select()
        .from(schema.deliverables)
        .where(eq(schema.deliverables.id, deliverableAId));
      expect(rows).toHaveLength(0);
    });

    it("throws NOT_FOUND for a cross-creator deliverable", async () => {
      const caller = deliverableRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.delete({ id: deliverableBId })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });

    it("does not delete a cross-creator deliverable on rejection", async () => {
      const caller = deliverableRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.delete({ id: deliverableBId });
      } catch {
        // expected
      }

      const rows = await db
        .select()
        .from(schema.deliverables)
        .where(eq(schema.deliverables.id, deliverableBId));
      expect(rows).toHaveLength(1);
    });
  });
});

// ── Proof router ─────────────────────────────────────────────────────────────

describe("proof router tenant isolation", () => {
  describe("listByDeal", () => {
    it("returns proofs for an owned deal", async () => {
      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.listByDeal({ dealId: dealAId });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(proofAId);
    });

    it("throws NOT_FOUND for a cross-creator deal", async () => {
      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.listByDeal({ dealId: dealBId })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });
  });

  describe("create", () => {
    it("creates a proof on an owned deal and records an activity event", async () => {
      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      const proof = await caller.create({
        dealId: dealAId,
        deliverableId: deliverableAId,
        kind: "vod",
        url: "https://twitch.tv/videos/123",
        note: "Sponsor segment at 1:02:00",
      });
      expect(proof.dealId).toBe(dealAId);
      expect(proof.deliverableId).toBe(deliverableAId);
      expect(proof.kind).toBe("vod");

      const events = await db
        .select()
        .from(schema.activityEvents)
        .where(eq(schema.activityEvents.entityId, proof.id));
      expect(events).toHaveLength(1);
      expect(events[0].creatorId).toBe(creatorAId);
      expect(events[0].kind).toBe("deliverable");
      expect(events[0].payload).toMatchObject({ action: "proof_added", proofKind: "vod" });
    });

    it("accepts a note-only proof", async () => {
      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      const proof = await caller.create({
        dealId: dealAId,
        deliverableId: deliverableAId,
        kind: "chat",
        note: "Chat went wild during the ad read",
      });
      expect(proof.url).toBeNull();
      expect(proof.note).toBe("Chat went wild during the ad read");
    });

    it("rejects a proof with neither url nor note", async () => {
      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.create({ dealId: dealAId, deliverableId: deliverableAId, kind: "clip" })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "BAD_REQUEST");
    });

    it("rejects non-http(s) links", async () => {
      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      for (const url of [
        "javascript:alert(document.cookie)",
        "JaVaScRiPt:alert(1)",
        "data:text/html;base64,PHNjcmlwdD4=",
        "file:///etc/passwd",
      ]) {
        await expect(
          caller.create({ dealId: dealAId, deliverableId: deliverableAId, kind: "link", url })
        ).rejects.toSatisfy((err: TRPCError) => err.code === "BAD_REQUEST");
      }
    });

    it("throws NOT_FOUND for a cross-creator deal", async () => {
      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.create({ dealId: dealBId, kind: "clip", url: "https://example.com/x" })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });

    it("throws NOT_FOUND when the deliverable belongs to a different deal", async () => {
      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.create({
          dealId: dealAId,
          deliverableId: deliverableBId,
          kind: "clip",
          url: "https://example.com/x",
        })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });
  });

  describe("delete", () => {
    it("deletes an owned proof and records an activity event", async () => {
      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.delete({ id: proofAId });
      expect(result.success).toBe(true);

      const rows = await db.select().from(schema.proofs).where(eq(schema.proofs.id, proofAId));
      expect(rows).toHaveLength(0);

      const events = await db
        .select()
        .from(schema.activityEvents)
        .where(eq(schema.activityEvents.entityId, proofAId));
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({ action: "proof_removed", proofKind: "clip" });
    });

    it("throws NOT_FOUND for a cross-creator proof", async () => {
      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.delete({ id: proofBId })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });

    it("does not delete a cross-creator proof on rejection", async () => {
      const caller = proofRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.delete({ id: proofBId });
      } catch {
        // expected
      }

      const rows = await db.select().from(schema.proofs).where(eq(schema.proofs.id, proofBId));
      expect(rows).toHaveLength(1);
    });
  });
});

// ── Deals router ─────────────────────────────────────────────────────────────

describe("deals router tenant isolation", () => {
  describe("getById", () => {
    it("returns an owned deal with brand and contact", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.getById({ id: dealAId });
      expect(result).toBeDefined();
      expect(result?.id).toBe(dealAId);
      expect(result?.brand?.id).toBe(brandAId);
    });

    it("returns null for a cross-creator deal", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.getById({ id: dealBId });
      expect(result).toBeNull();
    });
  });

  describe("list", () => {
    it("returns owned deals with deliverables and invoices attached", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.list();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(dealAId);
      expect(result[0].deliverables).toHaveLength(1);
      expect(result[0].deliverables[0].id).toBe(deliverableAId);
      expect(result[0].invoices).toHaveLength(1);
      expect(result[0].invoices[0].id).toBe(invoiceAId);
    });

    it("does not surface creator B's deliverables or invoices", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.list();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(dealAId);
      // The seed owns deliverableBId / invoiceBId on creator B's deal. Creator A's
      // board must surface only their own rows — this fails if the child queries
      // ever widen beyond the creator-scoped dealIds.
      expect(result[0].deliverables.map((d) => d.id)).toEqual([deliverableAId]);
      expect(result[0].deliverables.map((d) => d.id)).not.toContain(deliverableBId);
      expect(result[0].invoices.map((i) => i.id)).toEqual([invoiceAId]);
      expect(result[0].invoices.map((i) => i.id)).not.toContain(invoiceBId);
    });
  });

  describe("create", () => {
    it("creates a deal with an owned brand", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.create({
        brandId: brandAId,
        title: "New Deal",
        type: "flat",
      });
      expect(result).toBeDefined();
      expect(result.brandId).toBe(brandAId);
    });

    it("throws NOT_FOUND when using a cross-creator brand", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.create({
          brandId: brandBId,
          title: "Evil Deal",
          type: "flat",
        })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });

    it("does not create a deal for a cross-creator brand on rejection", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.create({
          brandId: brandBId,
          title: "Evil Deal",
          type: "flat",
        });
      } catch {
        // expected
      }

      const rows = await db
        .select()
        .from(schema.deals)
        .where(eq(schema.deals.brandId, brandBId));
      expect(rows).toHaveLength(1); // still only Deal B
    });

    it("throws NOT_FOUND when using a cross-creator contact", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.create({
          brandId: brandAId,
          primaryContactId: contactBId,
          title: "Evil Deal",
          type: "flat",
        })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });
  });

  describe("update", () => {
    it("updates an owned deal", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.update({ id: dealAId, title: "Updated Deal" });
      expect(result).toBeDefined();
      expect(result?.title).toBe("Updated Deal");
    });

    it("throws NOT_FOUND for a cross-creator deal", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.update({ id: dealBId, title: "Hacked" })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });

    it("does not mutate a cross-creator deal on rejection", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.update({ id: dealBId, title: "Hacked" });
      } catch {
        // expected
      }

      const [row] = await db
        .select()
        .from(schema.deals)
        .where(eq(schema.deals.id, dealBId));
      expect(row.title).toBe("Deal B");
    });

    it("throws NOT_FOUND when updating with a cross-creator contact", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.update({ id: dealAId, primaryContactId: contactBId })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });
  });

  describe("updateStage", () => {
    it("updates stage for an owned deal", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.updateStage({ id: dealAId, stage: "negotiating" });
      expect(result).toBeDefined();
      expect(result?.stage).toBe("negotiating");
    });

    it("throws NOT_FOUND for a cross-creator deal", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.updateStage({ id: dealBId, stage: "negotiating" })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });
  });

  describe("delete", () => {
    it("soft-deletes an owned deal", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.delete({ id: dealAId });
      expect(result).toBeDefined();
      expect(result?.deletedAt).not.toBeNull();
    });

    it("throws NOT_FOUND for a cross-creator deal", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.delete({ id: dealBId })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });

    it("does not soft-delete a cross-creator deal on rejection", async () => {
      const caller = dealsRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.delete({ id: dealBId });
      } catch {
        // expected
      }

      const [row] = await db
        .select()
        .from(schema.deals)
        .where(eq(schema.deals.id, dealBId));
      expect(row.deletedAt).toBeNull();
    });
  });
});

// ── Invoice router ───────────────────────────────────────────────────────────

describe("invoice router tenant isolation", () => {
  describe("listByDeal", () => {
    it("returns invoices for an owned deal", async () => {
      const caller = invoiceRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.listByDeal({ dealId: dealAId });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(invoiceAId);
    });

    it("returns empty for a cross-creator deal", async () => {
      const caller = invoiceRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.listByDeal({ dealId: dealBId });
      expect(result).toHaveLength(0);
    });
  });

  describe("create", () => {
    it("creates an invoice for an owned deal", async () => {
      const caller = invoiceRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.create({
        dealId: dealAId,
        contactId: contactAId,
        amountCents: 50000,
        title: "New Invoice",
      });
      expect(result).toBeDefined();
      expect(result.dealId).toBe(dealAId);
      expect(result.creatorId).toBe(creatorAId);
    });

    it("throws NOT_FOUND when using a cross-creator deal", async () => {
      const caller = invoiceRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.create({
          dealId: dealBId,
          amountCents: 50000,
          title: "Evil Invoice",
        })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });

    it("does not create an invoice for a cross-creator deal on rejection", async () => {
      const caller = invoiceRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.create({
          dealId: dealBId,
          amountCents: 50000,
          title: "Evil Invoice",
        });
      } catch {
        // expected
      }

      const rows = await db
        .select()
        .from(schema.invoices)
        .where(eq(schema.invoices.dealId, dealBId));
      expect(rows).toHaveLength(1); // seeded invoice B only; evil invoice rejected
    });

    it("throws NOT_FOUND when using a cross-creator contact", async () => {
      const caller = invoiceRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.create({
          dealId: dealAId,
          contactId: contactBId,
          amountCents: 50000,
          title: "Evil Invoice",
        })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });
  });

  describe("update", () => {
    it("updates an owned invoice", async () => {
      const caller = invoiceRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.update({ id: invoiceAId, title: "Updated Invoice" });
      expect(result).toBeDefined();
      expect(result?.title).toBe("Updated Invoice");
    });

    it("throws NOT_FOUND for a cross-creator invoice", async () => {
      // Create an invoice for creator B
      const [invoiceB] = await db
        .insert(schema.invoices)
        .values({
          creatorId: creatorBId,
          dealId: dealBId,
          contactId: contactBId,
          number: 99,
          amountCents: 20000,
          title: "Invoice B",
        })
        .returning();

      const caller = invoiceRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.update({ id: invoiceB.id, title: "Hacked" })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });

    it("does not mutate a cross-creator invoice on rejection", async () => {
      const [invoiceB] = await db
        .insert(schema.invoices)
        .values({
          creatorId: creatorBId,
          dealId: dealBId,
          contactId: contactBId,
          number: 99,
          amountCents: 20000,
          title: "Invoice B",
        })
        .returning();

      const caller = invoiceRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.update({ id: invoiceB.id, title: "Hacked" });
      } catch {
        // expected
      }

      const [row] = await db
        .select()
        .from(schema.invoices)
        .where(eq(schema.invoices.id, invoiceB.id));
      expect(row.title).toBe("Invoice B");
    });
  });

  describe("markPaid", () => {
    it("marks an owned invoice as paid", async () => {
      const caller = invoiceRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.markPaid({ id: invoiceAId });
      expect(result).toBeDefined();
      expect(result?.status).toBe("paid");
    });

    it("throws NOT_FOUND for a cross-creator invoice", async () => {
      const [invoiceB] = await db
        .insert(schema.invoices)
        .values({
          creatorId: creatorBId,
          dealId: dealBId,
          contactId: contactBId,
          number: 99,
          amountCents: 20000,
          title: "Invoice B",
        })
        .returning();

      const caller = invoiceRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.markPaid({ id: invoiceB.id })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });

    it("does not mutate chase state for a cross-creator invoice on rejection", async () => {
      const [invoiceB] = await db
        .insert(schema.invoices)
        .values({
          creatorId: creatorBId,
          dealId: dealBId,
          contactId: contactBId,
          number: 99,
          amountCents: 20000,
          title: "Invoice B",
        })
        .returning();

      await db.insert(schema.invoiceChaseState).values({
        invoiceId: invoiceB.id,
        mode: "armed",
        nextStep: 1,
      });

      const caller = invoiceRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.markPaid({ id: invoiceB.id });
      } catch {
        // expected
      }

      const [state] = await db
        .select()
        .from(schema.invoiceChaseState)
        .where(eq(schema.invoiceChaseState.invoiceId, invoiceB.id));
      expect(state.mode).toBe("armed");
    });
  });
});

// ── Chase router ─────────────────────────────────────────────────────────────

describe("chase router tenant isolation", () => {
  describe("templates", () => {
    it("returns only owned templates", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.templates();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(templateAId);
    });
  });

  describe("updateTemplate", () => {
    it("updates an owned template", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.updateTemplate({
        id: templateAId,
        subject: "Updated subject",
      });
      expect(result).toBeDefined();
      expect(result?.subject).toBe("Updated subject");
    });

    it("throws NOT_FOUND for a cross-creator template", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.updateTemplate({
          id: templateBId,
          subject: "Hacked",
        })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });

    it("does not mutate a cross-creator template on rejection", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.updateTemplate({
          id: templateBId,
          subject: "Hacked",
        });
      } catch {
        // expected
      }

      const [row] = await db
        .select()
        .from(schema.chaseTemplates)
        .where(eq(schema.chaseTemplates.id, templateBId));
      expect(row.subject).toBe("Payment due");
    });
  });

  describe("state", () => {
    it("returns chase state for an owned invoice", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.state({ invoiceId: invoiceAId });
      expect(result).toBeDefined();
      expect(result?.invoiceId).toBe(invoiceAId);
    });

    it("throws NOT_FOUND for a cross-creator invoice", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.state({ invoiceId: invoiceBId })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });
  });

  describe("pause", () => {
    it("pauses chase for an owned invoice", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.pause({ invoiceId: invoiceAId, reason: "vacation" });
      expect(result.success).toBe(true);

      const [state] = await db
        .select()
        .from(schema.invoiceChaseState)
        .where(eq(schema.invoiceChaseState.invoiceId, invoiceAId));
      expect(state.mode).toBe("paused");
    });

    it("throws NOT_FOUND for a cross-creator invoice", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.pause({ invoiceId: invoiceBId })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });

    it("does not write an activity event for a cross-creator invoice", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.pause({ invoiceId: invoiceBId, reason: "vacation" });
      } catch {
        // expected
      }

      const afterEvents = await db
        .select()
        .from(schema.activityEvents)
        .where(
          and(
            eq(schema.activityEvents.creatorId, creatorAId),
            eq(schema.activityEvents.entityId, invoiceBId)
          )
        );
      expect(afterEvents).toHaveLength(0);
    });
  });

  describe("resume", () => {
    it("resumes chase for an owned invoice", async () => {
      // First pause
      await db
        .update(schema.invoiceChaseState)
        .set({ mode: "paused", pausedReason: "vacation" })
        .where(eq(schema.invoiceChaseState.invoiceId, invoiceAId));

      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.resume({ invoiceId: invoiceAId });
      expect(result.success).toBe(true);

      const [state] = await db
        .select()
        .from(schema.invoiceChaseState)
        .where(eq(schema.invoiceChaseState.invoiceId, invoiceAId));
      expect(state.mode).toBe("armed");
    });

    it("throws NOT_FOUND for a cross-creator invoice", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.resume({ invoiceId: invoiceBId })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });

    it("does not write an activity event for a cross-creator invoice", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.resume({ invoiceId: invoiceBId });
      } catch {
        // expected
      }

      const afterEvents = await db
        .select()
        .from(schema.activityEvents)
        .where(
          and(
            eq(schema.activityEvents.creatorId, creatorAId),
            eq(schema.activityEvents.entityId, invoiceBId)
          )
        );
      expect(afterEvents).toHaveLength(0);
    });
  });

  describe("events", () => {
    it("returns events for an owned invoice", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.events({ invoiceId: invoiceAId });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(chaseEventAId);
    });

    it("throws NOT_FOUND for a cross-creator invoice", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.events({ invoiceId: invoiceBId })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });
  });

  describe("approve", () => {
    it("throws NOT_FOUND for a cross-creator chase event", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      await expect(caller.approve({ chaseEventId: chaseEventBId })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });

    it("does not mutate a cross-creator chase event on rejection", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.approve({ chaseEventId: chaseEventBId });
      } catch {
        // expected
      }

      const [row] = await db
        .select()
        .from(schema.chaseEvents)
        .where(eq(schema.chaseEvents.id, chaseEventBId));
      expect(row.status).toBe("awaiting_review");
    });
  });

  describe("editAndSend", () => {
    it("throws NOT_FOUND for a cross-creator chase event", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      await expect(
        caller.editAndSend({ chaseEventId: chaseEventBId, subject: "Hey", body: "Pay" })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });

    it("does not mutate a cross-creator chase event on rejection", async () => {
      const caller = chaseRouter.createCaller(mockCtx(creatorAId));
      try {
        await caller.editAndSend({ chaseEventId: chaseEventBId, subject: "Hey", body: "Pay" });
      } catch {
        // expected
      }

      const [row] = await db
        .select()
        .from(schema.chaseEvents)
        .where(eq(schema.chaseEvents.id, chaseEventBId));
      expect(row.status).toBe("awaiting_review");
      expect(row.subjectSnapshot).toBe("Pay up");
    });
  });
});

// ── Activity router ──────────────────────────────────────────────────────────

describe("activity router tenant isolation", () => {
  describe("list", () => {
    it("returns only the caller's own activity events, newest first", async () => {
      const older = new Date("2026-08-19T12:00:00Z");
      const newer = new Date("2026-08-24T12:00:00Z");

      await db.insert(schema.activityEvents).values([
        {
          creatorId: creatorAId,
          actor: "system",
          entityType: "invoice",
          entityId: invoiceAId,
          kind: "chase_sent",
          payload: { status: "sent", step: 1 },
          createdAt: older,
        },
        {
          creatorId: creatorAId,
          actor: "creator",
          entityType: "invoice",
          entityId: invoiceAId,
          kind: "chase_sent",
          payload: { action: "approve" },
          createdAt: newer,
        },
        {
          creatorId: creatorBId,
          actor: "system",
          entityType: "invoice",
          entityId: invoiceBId,
          kind: "chase_sent",
          payload: { status: "sent", step: 1 },
          createdAt: newer,
        },
      ]);

      const caller = activityRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.list();

      expect(result).toHaveLength(2);
      expect(result.every((e) => e.creatorId === creatorAId)).toBe(true);
      expect(result[0].createdAt.getTime()).toBe(newer.getTime());
      expect(result[1].createdAt.getTime()).toBe(older.getTime());
    });

    it("respects the limit input", async () => {
      await db.insert(schema.activityEvents).values(
        Array.from({ length: 5 }, (_, i) => ({
          creatorId: creatorAId,
          actor: "system" as const,
          entityType: "invoice",
          entityId: invoiceAId,
          kind: "chase_sent" as const,
          payload: { step: i },
        }))
      );

      const caller = activityRouter.createCaller(mockCtx(creatorAId));
      const result = await caller.list({ limit: 2 });
      expect(result).toHaveLength(2);
    });
  });
});
