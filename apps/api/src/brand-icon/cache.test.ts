import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { db } from "@sponsee/db";
import { brandIconCache } from "@sponsee/db/schema";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "../test-utils/schema-sql.js";
import { getFreshCachedIcon, putCachedIcon, HIT_TTL_MS, MISS_TTL_MS } from "./cache.js";

beforeAll(async () => {
  await initPgliteSchema(SCHEMA_SQL);
});

beforeEach(async () => {
  await db.delete(brandIconCache);
});

describe("brand-icon cache", () => {
  it("round-trips a hit, base64-encoding the body", async () => {
    const body = Buffer.from([10, 20, 30]);
    await putCachedIcon("redbull.com", { outcome: "hit", contentType: "image/svg+xml", body, source: "favicon" });

    const cached = await getFreshCachedIcon("redbull.com");
    expect(cached?.outcome).toBe("hit");
    expect(cached?.contentType).toBe("image/svg+xml");
    expect(cached?.body?.equals(body)).toBe(true);
    expect(cached?.source).toBe("favicon");
  });

  it("round-trips a miss", async () => {
    await putCachedIcon("nobrand.example", { outcome: "miss" });
    const cached = await getFreshCachedIcon("nobrand.example");
    expect(cached?.outcome).toBe("miss");
    expect(cached?.body).toBeUndefined();
  });

  it("returns null for a domain never cached", async () => {
    expect(await getFreshCachedIcon("neverseen.example")).toBeNull();
  });

  it("upserts — a second write for the same domain replaces the first", async () => {
    await putCachedIcon("brand.example", { outcome: "miss" });
    await putCachedIcon("brand.example", {
      outcome: "hit",
      contentType: "image/png",
      body: Buffer.from([1]),
      source: "unavatar",
    });

    const cached = await getFreshCachedIcon("brand.example");
    expect(cached?.outcome).toBe("hit");
  });

  it("treats a hit older than the hit TTL as expired", async () => {
    await putCachedIcon("stale-hit.example", {
      outcome: "hit",
      contentType: "image/png",
      body: Buffer.from([1]),
      source: "favicon",
    });
    const row = await db.query.brandIconCache.findFirst();
    const now = row!.fetchedAt.getTime() + HIT_TTL_MS + 1;

    expect(await getFreshCachedIcon("stale-hit.example", now)).toBeNull();
  });

  it("treats a miss older than the (much shorter) miss TTL as expired", async () => {
    await putCachedIcon("stale-miss.example", { outcome: "miss" });
    const row = await db.query.brandIconCache.findFirst();
    const now = row!.fetchedAt.getTime() + MISS_TTL_MS + 1;

    expect(await getFreshCachedIcon("stale-miss.example", now)).toBeNull();
  });

  it("still serves a hit within the miss TTL window (hit TTL is much longer)", async () => {
    await putCachedIcon("long-hit.example", {
      outcome: "hit",
      contentType: "image/png",
      body: Buffer.from([1]),
      source: "favicon",
    });
    const row = await db.query.brandIconCache.findFirst();
    const now = row!.fetchedAt.getTime() + MISS_TTL_MS + 1;

    expect(await getFreshCachedIcon("long-hit.example", now)).not.toBeNull();
  });
});
