import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { mediaKitRouter } from "./media-kit.js";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "../test-utils/schema-sql.js";

const ctx = (creatorId: string) => ({
  session: { user: { id: `user-${creatorId}`, email: "test@example.com", name: "Test" } },
  creatorId,
  db,
});

let creatorA = "";
let creatorB = "";

beforeAll(() => initPgliteSchema(SCHEMA_SQL));
beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE media_kit_examples, media_kit_offerings, media_kits, creator_platforms, deals, brands, creators CASCADE`);
  const [a] = await db.insert(schema.creators).values({ displayName: "A" }).returning();
  const [b] = await db.insert(schema.creators).values({ displayName: "B" }).returning();
  creatorA = a.id;
  creatorB = b.id;
});

describe("media kit", () => {
  it("projects live creator and platform data and shares CPVH guidance", async () => {
    await db.insert(schema.creatorPlatforms).values({ creatorId: creatorA, platform: "twitch", handle: "live-a", followers: 42, ccv: 100 });
    const [brand] = await db.insert(schema.brands).values({ creatorId: creatorA, name: "Brand" }).returning();
    await db.insert(schema.deals).values({ creatorId: creatorA, brandId: brand.id, title: "Deal", valueCents: 6000, ccv: 100, sponsoredMinutes: 60 });
    const result = await mediaKitRouter.createCaller(ctx(creatorA)).get();
    expect(result.creator.displayName).toBe("A");
    expect(result.platforms[0]).toMatchObject({ handle: "live-a", followers: 42, provenance: "creator_platforms" });
    expect(result.cpvhGuidance).toMatchObject({ floor: 6000, mid: 10500, agency: 20000, provenance: "shared-benchmark" });
  });

  it("denies cross-tenant child mutation and preserves ordered items", async () => {
    const callerA = mediaKitRouter.createCaller(ctx(creatorA));
    const callerB = mediaKitRouter.createCaller(ctx(creatorB));
    const first = await callerA.offering.create({ title: "First", priceCents: 100, currency: "usd" });
    const second = await callerA.offering.create({ title: "Second", priceCents: 200, currency: "USD" });
    await expect(callerB.offering.update({ id: first.id, title: "Stolen", priceCents: 1, currency: "USD" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const result = await callerA.offering.reorder({ ids: [second.id, first.id] });
    expect(result.offerings.map((row) => row.title)).toEqual(["Second", "First"]);
  });

  it("validates HTTPS examples and non-negative prices", async () => {
    const caller = mediaKitRouter.createCaller(ctx(creatorA));
    await expect(caller.example.create({ title: "Bad", url: "http://example.com" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.offering.create({ title: "Bad", priceCents: -1, currency: "USD" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
