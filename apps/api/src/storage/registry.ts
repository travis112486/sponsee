import { eq } from "drizzle-orm";
import { creatorFiles } from "@sponsee/db/schema";
import type { DB } from "@sponsee/db";

export type CreatorFileScope = "evidence" | "contract";

export interface RegisterCreatorFileParams {
  creatorId: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  originalFilename?: string | null;
  originDealId: string;
  originDealTitle: string;
  scope: CreatorFileScope;
}

/**
 * Registers an uploaded object in the creator-scoped file registry (SPO-348),
 * whose lifecycle is independent of the deal it was uploaded against —
 * `proofs.dealId`/`contracts.dealId` still cascade-delete with their deal,
 * but this row's `originDealId` only ever gets set null. Callers must run
 * this in the same transaction as the proof/contract insert that carries
 * `storageKey`: a crash between the two would leave an object referenced by
 * a proof/contract row but invisible to the registry the orphan sweep reads
 * (sweep.ts).
 *
 * `storageKey` carries a UNIQUE index, and this insert shares a transaction
 * with the proof/contract write that references it (SPO-353): a bare insert
 * would raise 23505 on a repeat key and take that write down too. The row's
 * content is fully derivable from the key, so a repeat has nothing to
 * update — except `deletedAt`. sweep.ts and quota.ts both read this table
 * filtered on `deletedAt IS NULL`, so if the repeat key belongs to a
 * tombstoned row (see `tombstoneCreatorFile` below), leaving `deletedAt` set
 * would let the orphan sweep destroy an object a live proof/contract row
 * still references, and its bytes would escape quota accounting. Clearing
 * `deletedAt` on conflict — `onConflictDoUpdate` — makes re-registering the
 * same key a resurrection instead of a no-op, mirroring how `contract.upsert`
 * already converges concurrent writes via `onConflictDoUpdate` rather than
 * throwing.
 */
export async function registerCreatorFile(tx: DB, params: RegisterCreatorFileParams): Promise<void> {
  await tx
    .insert(creatorFiles)
    .values({
      creatorId: params.creatorId,
      storageKey: params.storageKey,
      mimeType: params.mimeType,
      sizeBytes: params.sizeBytes,
      originalFilename: params.originalFilename ?? null,
      originDealId: params.originDealId,
      originDealTitle: params.originDealTitle,
      scope: params.scope,
    })
    .onConflictDoUpdate({ target: creatorFiles.storageKey, set: { deletedAt: null } });
}

/**
 * Explicit-delete path (a creator removing their own proof/contract):
 * tombstones the registry row *before* the object delete is attempted. If
 * the object delete then fails, the tombstoned row (deletedAt set) is what
 * tells the orphan sweep the object is safe to reclaim later instead of
 * leaking forever — see the `deletedAt IS NULL` filter in sweep.ts and the
 * matching filter in quota.ts, which excludes tombstoned rows from usage.
 */
export async function tombstoneCreatorFile(db: DB, storageKey: string): Promise<void> {
  await db.update(creatorFiles).set({ deletedAt: new Date() }).where(eq(creatorFiles.storageKey, storageKey));
}

/** Finishes the explicit-delete path once the object delete has actually succeeded. */
export async function removeCreatorFile(db: DB, storageKey: string): Promise<void> {
  await db.delete(creatorFiles).where(eq(creatorFiles.storageKey, storageKey));
}
