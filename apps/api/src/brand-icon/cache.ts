// SPO-374 step 4: the cache is the whole privacy argument. With it, unavatar
// sees one fetch per brand domain per TTL for the entire product instead of
// one per creator per view. Backed by Postgres (not the object-storage bucket
// — SPO-167's vendor decision hasn't landed and getStorageConfig() returns
// null today) and not partitioned by creator, since the point is exactly that
// this is shared across every creator's pipeline.

import { eq } from "drizzle-orm";
import { db, schema } from "@sponsee/db";

export interface CachedIcon {
  outcome: "hit" | "miss";
  contentType?: string;
  body?: Buffer;
  source?: "favicon" | "unavatar";
  fetchedAt: Date;
}

// unavatar's own Cloudflare cache-control on a hit is 28 days; ours matches so
// a cached tile is never staler on our side than it would be on theirs. A miss
// gets a much shorter TTL — a brand adding a favicon later, or unavatar
// recovering from a transient failure, shouldn't stay a permanent monogram.
export const HIT_TTL_MS = 28 * 24 * 60 * 60 * 1000;
export const MISS_TTL_MS = 24 * 60 * 60 * 1000;

function isFresh(outcome: "hit" | "miss", fetchedAt: Date, now: number): boolean {
  const ttl = outcome === "hit" ? HIT_TTL_MS : MISS_TTL_MS;
  return now - fetchedAt.getTime() < ttl;
}

export async function getFreshCachedIcon(domain: string, now: number = Date.now()): Promise<CachedIcon | null> {
  const row = await db.query.brandIconCache.findFirst({
    where: eq(schema.brandIconCache.domain, domain),
  });
  if (!row) return null;
  if (!isFresh(row.outcome, row.fetchedAt, now)) return null;

  if (row.outcome === "miss") {
    return { outcome: "miss", fetchedAt: row.fetchedAt };
  }

  return {
    outcome: "hit",
    contentType: row.contentType ?? undefined,
    body: row.bodyBase64 ? Buffer.from(row.bodyBase64, "base64") : undefined,
    source: (row.source as "favicon" | "unavatar" | undefined) ?? undefined,
    fetchedAt: row.fetchedAt,
  };
}

export async function putCachedIcon(
  domain: string,
  result:
    | { outcome: "hit"; contentType: string; body: Buffer; source: "favicon" | "unavatar" }
    | { outcome: "miss" }
): Promise<void> {
  const values =
    result.outcome === "hit"
      ? {
          domain,
          outcome: "hit" as const,
          contentType: result.contentType,
          bodyBase64: result.body.toString("base64"),
          sizeBytes: result.body.length,
          source: result.source,
          fetchedAt: new Date(),
        }
      : {
          domain,
          outcome: "miss" as const,
          contentType: null,
          bodyBase64: null,
          sizeBytes: null,
          source: null,
          fetchedAt: new Date(),
        };

  await db
    .insert(schema.brandIconCache)
    .values(values)
    .onConflictDoUpdate({ target: schema.brandIconCache.domain, set: values });
}
