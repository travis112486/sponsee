import { eq, isNotNull } from "drizzle-orm";
import { db } from "@sponsee/db";
import { creatorPlatforms, activityEvents } from "@sponsee/db/schema";
import { createPlatformClient } from "../platforms/index.js";

/**
 * Platform stats sync (SPO-107, no-OAuth v1).
 *
 * Daily job: for every creator_platforms row with a handle, pull public data
 * via the official APIs and fill avatar + counts. Manual entry stays the
 * fallback (PRD §7.2): fields the platform doesn't return are left untouched.
 */

export interface SyncResult {
  synced: number;
  errored: number;
  skipped: number;
}

type PlatformRow = typeof creatorPlatforms.$inferSelect;

/**
 * Sync one creator_platforms row. Records ok/error status on the row instead
 * of throwing, so a bad handle never fails the whole batch or a "Sync now"
 * request. Returns the updated row.
 */
export async function syncPlatformRow(row: PlatformRow): Promise<PlatformRow> {
  const client = createPlatformClient(row.platform);
  if (!client || !row.handle) return row; // TikTok etc. — manual entry only

  if (!client.isConfigured()) {
    // Credentials not provisioned yet — leave the row untouched rather than
    // flagging a creator-visible error for an ops-side gap.
    console.warn(`[platform-sync] ${client.name} skipped: credentials not configured`);
    return row;
  }

  const now = new Date();
  try {
    const stats = await client.fetchStats(row.handle);

    const countsChanged =
      (stats.subscriberCount != null && stats.subscriberCount !== row.subscriberCount) ||
      (stats.followers != null && stats.followers !== row.followers);

    const [updated] = await db
      .update(creatorPlatforms)
      .set({
        // Only overwrite when the API returned a value — manual entry is the fallback
        avatarUrl: stats.avatarUrl ?? row.avatarUrl,
        channelUrl: stats.channelUrl ?? row.channelUrl,
        subscriberCount: stats.subscriberCount ?? row.subscriberCount,
        subscriberCountIsEstimate:
          stats.subscriberCount != null ? stats.subscriberCountIsEstimate : row.subscriberCountIsEstimate,
        followers: stats.followers ?? row.followers,
        lastSyncedAt: now,
        syncStatus: "ok",
        syncError: null,
        updatedAt: now,
      })
      .where(eq(creatorPlatforms.id, row.id))
      .returning();

    if (countsChanged) {
      await db.insert(activityEvents).values({
        creatorId: row.creatorId,
        actor: "system",
        entityType: "creator_platform",
        entityId: row.id,
        kind: "platform_sync",
        payload: {
          platform: row.platform,
          handle: row.handle,
          subscriberCount: { from: row.subscriberCount, to: updated.subscriberCount },
          followers: { from: row.followers, to: updated.followers },
        },
      });
    }

    return updated;
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    const [updated] = await db
      .update(creatorPlatforms)
      .set({ syncStatus: "error", syncError: message, updatedAt: now })
      .where(eq(creatorPlatforms.id, row.id))
      .returning();
    console.error(`[platform-sync] ${row.platform}/${row.handle} failed: ${message}`);
    return updated ?? row;
  }
}

/** Sync every row that has a handle. Called by the daily pg-boss job. */
export async function runPlatformSync(): Promise<SyncResult> {
  const rows = await db
    .select()
    .from(creatorPlatforms)
    .where(isNotNull(creatorPlatforms.handle));

  const result: SyncResult = { synced: 0, errored: 0, skipped: 0 };

  for (const row of rows) {
    const client = createPlatformClient(row.platform);
    if (!client || !client.isConfigured() || !row.handle) {
      result.skipped++;
      continue;
    }
    const updated = await syncPlatformRow(row);
    if (updated.syncStatus === "ok") result.synced++;
    else result.errored++;
  }

  return result;
}
