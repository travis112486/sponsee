import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import type { DB } from "@sponsee/db";
import { deals } from "@sponsee/db/schema";
import { z } from "zod";
import {
  FileTooLargeError,
  InvalidSizeError,
  StorageNotConfiguredError,
  UnsupportedMimeTypeError,
  createDownloadUrl,
  createUploadUrl,
  keyBelongsToDeal,
  storageScopes,
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
});
