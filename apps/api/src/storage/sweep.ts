import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { db } from "@sponsee/db";
import { creatorFiles } from "@sponsee/db/schema";
import { and, inArray, isNull } from "drizzle-orm";
import { buildS3Client } from "./client.js";
import { getStorageConfig } from "./config.js";

/**
 * Grace period before an unreferenced object is actually deleted. Exists for
 * one narrow race: a client presigns an upload, PUTs the object, and the
 * commit mutation (proof.create / contract.upsert) that inserts the
 * `creator_files` row hasn't run yet when a sweep happens to land in that
 * window. It is not a retention policy — see SPO-155/SPO-348 for that — this
 * only protects objects that are moments away from being registered.
 */
export const STORAGE_ORPHAN_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

export interface StorageSweepResult {
  scanned: number;
  deleted: number;
  skippedUnconfigured: boolean;
}

/**
 * Reconciliation sweep for objects nothing references any more.
 *
 * The `creator_files` table (packages/db/src/schema/index.ts) is the single
 * source of truth for whether an object is still "alive": every commit path
 * that finishes an upload (proof.create, contract.upsert) inserts a row
 * there in the same transaction as the proof/contract row, and that row's
 * `originDealId` goes `set null` — not cascade — when the deal it was
 * uploaded against is deleted, so the file survives even though the deal
 * doesn't (SPO-155's retention call: keep files indefinitely until
 * explicitly deleted). So this sweep does not care whether an object's deal
 * still exists — it asks only "does a live `creator_files` row reference
 * this key," which is exactly the set of objects an explicit
 * proof/contract delete has not already tombstoned (see registry.ts) and a
 * commit mutation has not yet abandoned mid-upload.
 *
 * Anything under the `creators/` prefix with no such row — a presigned
 * upload the client PUT but never committed, or a tombstoned explicit
 * delete whose synchronous object delete failed — is a candidate, subject
 * to the grace period below so a request that's mid-flight right now isn't
 * swept out from under it.
 *
 * Registered as a scheduled pg-boss job in jobs/index.ts. Safe to call with
 * storage unconfigured: it no-ops rather than throwing, same as the rest of
 * this module.
 */
export async function runStorageOrphanSweep(
  env: Record<string, string | undefined> = process.env,
  options: { graceMs?: number } = {}
): Promise<StorageSweepResult> {
  const config = getStorageConfig(env);
  if (!config) {
    return { scanned: 0, deleted: 0, skippedUnconfigured: true };
  }

  const client = buildS3Client(config);
  // `graceMs` is only ever overridden by tests — real integration tests can't
  // wait out a 24h grace period for a real orphan to become sweepable, and
  // faking `LastModified` isn't possible against a real S3 server (it's
  // server-assigned). Production always uses the real constant.
  const cutoff = Date.now() - (options.graceMs ?? STORAGE_ORPHAN_GRACE_PERIOD_MS);

  let scanned = 0;
  let deleted = 0;
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

    const keys = objects.map((obj) => obj.Key).filter((key): key is string => Boolean(key));

    if (keys.length > 0) {
      const referenced = await db
        .select({ storageKey: creatorFiles.storageKey })
        .from(creatorFiles)
        .where(and(inArray(creatorFiles.storageKey, keys), isNull(creatorFiles.deletedAt)));
      const referencedKeys = new Set(referenced.map((row) => row.storageKey));

      const toDelete = objects.filter((obj) => {
        if (!obj.Key || referencedKeys.has(obj.Key)) return false;
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

  return { scanned, deleted, skippedUnconfigured: false };
}
