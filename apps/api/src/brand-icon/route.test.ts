import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { db } from "@sponsee/db";
import { brandIconCache } from "@sponsee/db/schema";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "../test-utils/schema-sql.js";

vi.mock("./origin-favicon.js", () => ({ fetchOriginFavicon: vi.fn() }));

const { fetchOriginFavicon } = await import("./origin-favicon.js");
const { default: brandIconApp, brandIconLimiter, BRAND_ICON_MAX_PER_WINDOW } = await import("./route.js");
const { unavatarDailyCounter } = await import("./quota.js");

function get(domain: string | undefined, ip = "203.0.113.7") {
  const query = domain === undefined ? "" : `?domain=${encodeURIComponent(domain)}`;
  return brandIconApp.request(`/${query}`, { headers: { "x-forwarded-for": ip } });
}

function stubUnavatarFetch(response: Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(response))
  );
}

function unavatarMiss() {
  stubUnavatarFetch(new Response(null, { status: 404 }));
}

beforeAll(async () => {
  await initPgliteSchema(SCHEMA_SQL);
});

beforeEach(async () => {
  await db.delete(brandIconCache);
  brandIconLimiter.reset();
  unavatarDailyCounter.reset();
  vi.mocked(fetchOriginFavicon).mockReset();
  vi.mocked(fetchOriginFavicon).mockResolvedValue({ outcome: "miss" });
  unavatarMiss();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/brand-icon", () => {
  it("404s with an empty body for a missing domain param — never an image body on a miss", async () => {
    const res = await get(undefined);
    expect(res.status).toBe(404);
    expect(await res.arrayBuffer()).toEqual(new ArrayBuffer(0));
  });

  it("404s for a domain that does not normalize, without touching the fetch pipeline", async () => {
    const res = await get("127.0.0.1");
    expect(res.status).toBe(404);
    expect(fetchOriginFavicon).not.toHaveBeenCalled();
  });

  it("serves a favicon-origin hit as 200 with a long Cache-Control and hardened headers, and caches it", async () => {
    vi.mocked(fetchOriginFavicon).mockResolvedValue({
      outcome: "hit",
      contentType: "image/png",
      body: Buffer.from([1, 2, 3]),
    });

    const res = await get("redbull.com");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    // 28 days — matches cache.ts HIT_TTL_MS (PR #123 F3: the old value was 30
    // days and its comment falsely claimed a match).
    expect(res.headers.get("Cache-Control")).toContain("max-age=2419200");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));

    const row = await db.query.brandIconCache.findFirst();
    expect(row?.outcome).toBe("hit");
    expect(row?.source).toBe("favicon");

    // unavatar must never be called once the origin favicon already hit.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("falls back to unavatar when the origin favicon misses, and caches source=unavatar", async () => {
    stubUnavatarFetch(
      new Response(new Uint8Array([9, 9]), { status: 200, headers: { "Content-Type": "image/png" } })
    );

    const res = await get("bangenergy.com");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");

    const row = await db.query.brandIconCache.findFirst();
    expect(row?.source).toBe("unavatar");
  });

  it("404s with an empty body and caches a miss when neither source resolves", async () => {
    const res = await get("nobrand.example");
    expect(res.status).toBe(404);
    expect(await res.arrayBuffer()).toEqual(new ArrayBuffer(0));

    const row = await db.query.brandIconCache.findFirst();
    expect(row?.outcome).toBe("miss");
  });

  it("serves the second request for the same domain from cache, without calling the fetch pipeline again", async () => {
    vi.mocked(fetchOriginFavicon).mockResolvedValue({
      outcome: "hit",
      contentType: "image/x-icon",
      body: Buffer.from([1]),
    });

    const first = await get("redbull.com");
    expect(first.status).toBe(200);
    expect(fetchOriginFavicon).toHaveBeenCalledTimes(1);

    const second = await get("redbull.com");
    expect(second.status).toBe(200);
    expect(fetchOriginFavicon).toHaveBeenCalledTimes(1); // not called again
  });

  it("skips the unavatar call once the daily soft cap is exhausted, and still 404s cleanly without poisoning the cache (PR #123 F2)", async () => {
    for (let i = 0; i < 20; i++) unavatarDailyCounter.tryConsume();

    const res = await get("overquota.example");
    expect(res.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
    // Not a genuine lookup outcome for this domain — neither the DB cache nor
    // downstream caches should hold onto it.
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const row = await db.query.brandIconCache.findFirst();
    expect(row).toBeUndefined();
  });

  it("rate-limits a single IP past the per-minute cap with 429 and Retry-After", async () => {
    for (let i = 0; i < BRAND_ICON_MAX_PER_WINDOW; i++) {
      const res = await get(`brand${i}.example`, "203.0.113.9");
      expect(res.status).toBe(404); // each of these is a genuine miss
    }

    const res = await get("overflow.example", "203.0.113.9");
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});
