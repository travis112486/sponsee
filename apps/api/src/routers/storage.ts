import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { DB } from "@sponsee/db";
import { creatorFiles, deals } from "@sponsee/db/schema";
import { z } from "zod";
import {
  FileTooLargeError,
  InvalidSizeError,
  QuotaExceededError,
  StorageNotConfiguredError,
  UnsupportedMimeTypeError,
  assertStorageQuotaAvailable,
  createDownloadUrl,
  createUploadUrl,
  deleteObject,
  getStorageUsage,
  keyBelongsToDeal,
  removeCreatorFile,
  storageScopes,
  tombstoneCreatorFile,
} from "../storage/index.js";
import { createTRPCRouter, creatorScopedProcedure } from "../trpc.js";

/** Translates the storage module's domain errors onto the wire codes error-formatter.ts already has copy for. */
function throwAsTRPCError(err: unknown): never {
  if (err instanceof StorageNotConfiguredError) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "File uploads are not configured yet." });
  }
  if (err instanceof UnsupportedMimeTypeError) {
    throw new TRPCError({ code: "UNSUPPORTED_MEDIA_TYPE", message: err.message });
  }
  if (err instanceof FileTooLargeError) {
    throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: err.message });
  }
  if (err instanceof InvalidSizeError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
  }
  if (err instanceof QuotaExceededError) {
    // No `message` here — tRPC falls back to `cause.message`, and the
    // error-formatter's `isQuotaExceededFailure` branch republishes both that
    // message and the structured usedBytes/capBytes/planTier from the cause.
    throw new TRPCError({ code: "FORBIDDEN", cause: err });
  }
  throw err;
}

async function requireOwnedDeal(db: DB, creatorId: string, dealId: string) {
  const [deal] = await db
    .select({ id: deals.id })
    .from(deals)
    .where(and(eq(deals.id, dealId), eq(deals.creatorId, creatorId)));

  if (!deal) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Deal not found" });
  }
}

/**
 * Ownership for the creator-scoped Files page (SPO-350) is the registry row
 * itself — not the deal. A file whose deal was deleted has `originDealId`
 * null but the row (and its `creatorId`) survives, so this keeps working for
 * exactly the files the retention policy says must remain deletable.
 */
async function requireOwnedFile(db: DB, creatorId: string, storageKey: string) {
  const [file] = await db
    .select({
      id: creatorFiles.id,
      storageKey: creatorFiles.storageKey,
      mimeType: creatorFiles.mimeType,
      originalFilename: creatorFiles.originalFilename,
    })
    .from(creatorFiles)
    .where(
      and(
        eq(creatorFiles.storageKey, storageKey),
        eq(creatorFiles.creatorId, creatorId),
        isNull(creatorFiles.deletedAt)
      )
    );

  if (!file) {
    throw new TRPCError({ code: "NOT_FOUND", message: "File not found" });
  }
  return file;
}

export const storageRouter = createTRPCRouter({
  createUploadUrl: creatorScopedProcedure
    .input(
      z.object({
        dealId: z.string().uuid(),
        scope: z.enum(storageScopes),
        filename: z.string().min(1).max(255),
        mimeType: z.string().min(1).max(255),
        sizeBytes: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireOwnedDeal(ctx.db, ctx.creatorId, input.dealId);

      try {
        // SPO-349: checked before signing, not after the creator has already
        // uploaded the bytes — a rejection here costs nothing but a request.
        await assertStorageQuotaAvailable(ctx.db, ctx.creatorId, input.sizeBytes);
        return await createUploadUrl({
          creatorId: ctx.creatorId,
          dealId: input.dealId,
          scope: input.scope,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          filename: input.filename,
        });
      } catch (err) {
        throwAsTRPCError(err);
      }
    }),

  createDownloadUrl: creatorScopedProcedure
    .input(
      z.object({
        dealId: z.string().uuid(),
        key: z.string().min(1).max(1024),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireOwnedDeal(ctx.db, ctx.creatorId, input.dealId);

      // Belt-and-suspenders on top of the deal-ownership check above: the key
      // itself must be prefixed with this exact creator/deal pair, so a
      // creator can't request a download for a key copied from elsewhere.
      if (!keyBelongsToDeal(input.key, { creatorId: ctx.creatorId, dealId: input.dealId })) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to that file" });
      }

      try {
        return await createDownloadUrl({ key: input.key });
      } catch (err) {
        throwAsTRPCError(err);
      }
    }),

  // SPO-349: lets the UI show a real usage meter instead of a creator only
  // discovering their cap when an upload gets refused.
  usage: creatorScopedProcedure.query(async ({ ctx }) => {
    return await getStorageUsage(ctx.db, ctx.creatorId);
  }),

  // SPO-350: the Files page. Lists every live registry row for this creator —
  // including files whose origin deal was deleted (originDealId null) — so the
  // "keep files until explicitly deleted" retention call has a real surface.
  list: creatorScopedProcedure.query(async ({ ctx }) => {
    const files = await ctx.db
      .select({
        id: creatorFiles.id,
        storageKey: creatorFiles.storageKey,
        mimeType: creatorFiles.mimeType,
        sizeBytes: creatorFiles.sizeBytes,
        originalFilename: creatorFiles.originalFilename,
        originDealId: creatorFiles.originDealId,
        originDealTitle: creatorFiles.originDealTitle,
        originDealDeletedAt: deals.deletedAt,
        scope: creatorFiles.scope,
        createdAt: creatorFiles.createdAt,
      })
      .from(creatorFiles)
      .leftJoin(deals, eq(creatorFiles.originDealId, deals.id))
      .where(and(eq(creatorFiles.creatorId, ctx.creatorId), isNull(creatorFiles.deletedAt)))
      .orderBy(desc(creatorFiles.createdAt));

    return { files };
  }),

  // A short-TTL presigned GET for a single file, scoped to the creator via the
  // registry row rather than a live deal — this is what makes a deleted-deal
  // file previewable. Fetched on demand (not inline in `list`) so the preview
  // always gets a URL that is fresh, not one already halfway to expiry.
  fileUrl: creatorScopedProcedure
    .input(z.object({ storageKey: z.string().min(1).max(1024) }))
    .mutation(async ({ ctx, input }) => {
      const file = await requireOwnedFile(ctx.db, ctx.creatorId, input.storageKey);
      try {
        return await createDownloadUrl({
          key: file.storageKey,
          filename: file.originalFilename ?? undefined,
        });
      } catch (err) {
        throwAsTRPCError(err);
      }
    }),

  // The explicit-delete affordance the retention policy depends on. Mirrors
  // proof.delete/contract.remove: tombstone first (usage drops immediately and
  // the sweep can reclaim the object if the synchronous delete fails), then
  // delete the object, then remove the row. Loud on real failures — a silently
  // dropped delete would make the freed-bytes meter lie to the creator.
  deleteFile: creatorScopedProcedure
    .input(z.object({ storageKey: z.string().min(1).max(1024) }))
    .mutation(async ({ ctx, input }) => {
      const file = await requireOwnedFile(ctx.db, ctx.creatorId, input.storageKey);

      await tombstoneCreatorFile(ctx.db, file.storageKey);
      try {
        await deleteObject(file.storageKey);
        await removeCreatorFile(ctx.db, file.storageKey);
      } catch (err) {
        // The tombstone above is already committed: usage and the file list no
        // longer count this file, and the orphan sweep will reclaim the object.
        console.warn(
          `[storage.deleteFile] Failed to delete object ${file.storageKey}; orphan sweep will reclaim it:`,
          (err as Error).message
        );
      }

      return { success: true };
    }),
});
