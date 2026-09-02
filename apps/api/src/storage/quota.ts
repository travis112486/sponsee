import { and, eq, isNull, sum } from "drizzle-orm";
import type { DB } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import type { PlanTier } from "@sponsee/shared";
import { QuotaExceededError } from "./errors.js";

const GIB = 1024 * 1024 * 1024;

/**
 * Per-tier storage cap (SPO-349), founder-confirmed on SPO-155: 5/25/100 GiB
 * for starter/creator/pro. `creators.plan` is already `planTierEnum`, so this
 * is the only piece the tier -> cap mapping needs — no schema change.
 */
export const STORAGE_QUOTA_BYTES_BY_PLAN: Record<PlanTier, number> = {
  starter: 5 * GIB,
  creator: 25 * GIB,
  pro: 100 * GIB,
};

export interface StorageUsage {
  usedBytes: number;
  capBytes: number;
  planTier: PlanTier;
}

/**
 * Usage is summed from `creator_files` (SPO-348's registry), never from
 * `proofs`/`contracts`: those cascade-delete with their deal, but a file's
 * bytes keep costing us money after the deal that produced it is gone (the
 * founder's "keep indefinitely" retention call on SPO-155). Summing the
 * proof/contract tables instead would let a creator hide unlimited storage
 * behind deleted deals — so a row with `originDealId IS NULL` still counts.
 *
 * A row with `deletedAt` set is excluded: that's an explicit creator delete
 * (see `registry.ts`'s `tombstoneCreatorFile`), tombstoned before the object
 * delete is even attempted, so those bytes are already spoken for as freed —
 * counting them would make a creator who just deleted something to make room
 * look like they hadn't.
 */
export async function getStorageUsage(db: DB, creatorId: string): Promise<StorageUsage> {
  const [creator] = await db.select({ plan: schema.creators.plan }).from(schema.creators).where(eq(schema.creators.id, creatorId));
  const planTier = (creator?.plan ?? "starter") as PlanTier;

  const [row] = await db
    .select({ usedBytes: sum(schema.creatorFiles.sizeBytes) })
    .from(schema.creatorFiles)
    .where(and(eq(schema.creatorFiles.creatorId, creatorId), isNull(schema.creatorFiles.deletedAt)));

  return {
    usedBytes: Number(row?.usedBytes ?? 0),
    capBytes: STORAGE_QUOTA_BYTES_BY_PLAN[planTier],
    planTier,
  };
}

/**
 * Enforced at presign, not at commit (SPO-349): rejecting after the creator
 * has already uploaded the bytes wastes their time and our ingress, so this
 * runs before `createUploadUrl` ever signs anything.
 */
export async function assertStorageQuotaAvailable(db: DB, creatorId: string, sizeBytes: number): Promise<void> {
  const usage = await getStorageUsage(db, creatorId);
  if (usage.usedBytes + sizeBytes > usage.capBytes) {
    throw new QuotaExceededError(usage.usedBytes, usage.capBytes, usage.planTier);
  }
}
