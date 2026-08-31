import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { db } from "@sponsee/db";
import { deals } from "@sponsee/db/schema";
import { inArray } from "drizzle-orm";
import { buildS3Client } from "./client.js";
import { getStorageConfig } from "./config.js";

/**
 * Grace period before an orphaned object is actually deleted. A placeholder
 * pending the founder's retention-policy decision (SPO-155 card) — bump this
 * constant once that lands, nothing else needs to change.
 */
export const STORAGE_ORPHAN_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

const DEAL_ID_FROM_KEY = /^creators\/[^/]+\/deals\/([^/]+)\//;

/**
 * `deals.id` is a `uuid` column, so a captured segment that isn't one would
 * fail the `inArray` query below — and since that query batches every
 * candidate id from the page in one call, a single bad key would throw for
 * the whole page instead of just that key. Keys are always server-generated
 * via `buildObjectKey` (see keys.ts), but the bucket can still contain a
 * hand-uploaded object or a leftover from a migration/manual test whose path
 * merely resembles the convention, so this can't be assumed away.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StorageSweepResult {
  scanned: number;
  deleted: number;
  skippedUnrecognized: number;
  skippedUnconfigured: boolean;
}

/**
 * Reconciliation sweep for objects orphaned by a hard `deals` row deletion.
 *
 * `proofs` and `contracts` FK-cascade off `deals` at the DB level (see
 * packages/db/src/schema/index.ts), so once a deal row is actually deleted,
 * Postgres removes its proof/contract rows itself — no application code runs,
 * so nothing calls `deleteObject` for whatever those rows pointed at. This
 * job is the backstop for exactly that gap; a creator-initiated delete of a
 * single proof/contract should call `deleteObject` directly at the call site
 * instead (see the doc comment on `deleteObject` in delete.ts) and never
 * needs to wait for this to run.
 *
 * The key convention (`creators/{creatorId}/deals/{dealId}/{scope}/{uuid}.ext`)
 * embeds the owning deal id, so detecting an orphan needs no tracking table:
 * list every key, read the deal id back out of it, and check whether that
 * deal still exists. Anything whose deal is gone — and whose `LastModified`
 * is older than the grace period, so an object doesn't get swept in the
 * narrow window before its deal row exists — is deleted.
 *
 * Registered as a scheduled pg-boss job in jobs/index.ts. Safe to call with
 * storage unconfigured: it no-ops rather than throwing, same as the rest of
 * this module.
 */
export async function runStorageOrphanSweep(
  env: Record<string, string | undefined> = process.env
): Promise<StorageSweepResult> {
  const config = getStorageConfig(env);
  if (!config) {
    return { scanned: 0, deleted: 0, skippedUnrecognized: 0, skippedUnconfigured: true };
  }

  const client = buildS3Client(config);
  const cutoff = Date.now() - STORAGE_ORPHAN_GRACE_PERIOD_MS;

  let scanned = 0;
  let deleted = 0;
  let skippedUnrecognized = 0;
  let continuationToken: string | undefined;

  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: "creators/",
        ContinuationToken: continuationToken,
      })
    );

    const objects = page.Contents ?? [];
    scanned += objects.length;

    const dealIdByKey = new Map<string, string>();
    for (const obj of objects) {
      const match = obj.Key ? DEAL_ID_FROM_KEY.exec(obj.Key) : null;
      const dealId = match?.[1];
      if (dealId && UUID_PATTERN.test(dealId)) {
        dealIdByKey.set(obj.Key!, dealId);
      } else if (obj.Key) {
        skippedUnrecognized++;
      }
    }

    if (dealIdByKey.size > 0) {
      const candidateDealIds = [...new Set(dealIdByKey.values())];
      const existing = await db.select({ id: deals.id }).from(deals).where(inArray(deals.id, candidateDealIds));
      const existingIds = new Set(existing.map((row) => row.id));

      const toDelete = objects.filter((obj) => {
        const dealId = obj.Key ? dealIdByKey.get(obj.Key) : undefined;
        if (!dealId || existingIds.has(dealId)) return false;
        const modifiedAt = obj.LastModified?.getTime() ?? 0;
        return modifiedAt <= cutoff;
      });

      if (toDelete.length > 0) {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: config.bucket,
            Delete: { Objects: toDelete.map((obj) => ({ Key: obj.Key! })) },
          })
        );
        deleted += toDelete.length;
      }
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  return { scanned, deleted, skippedUnrecognized, skippedUnconfigured: false };
}
