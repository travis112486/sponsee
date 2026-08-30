import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { createTRPCRouter, creatorScopedProcedure } from "../trpc.js";
import { deals, deliverables, creators, proofs, contracts } from "@sponsee/db/schema";
import type { DB } from "@sponsee/db";
import { createStorageProvider } from "../storage/index.js";
import {
  assertSizeWithinCap,
  buildStorageKey,
  getStorageQuotaBytes,
  isAllowedMimeType,
  isOwnedKey,
} from "../storage/limits.js";

const purposeSchema = z.enum(["proof", "contract"]);

/** Total bytes currently stored for a creator, across proofs and contracts. */
async function usedStorageBytes(db: DB, creatorId: string): Promise<number> {
  const proofRows = await db
    .select({ sizeBytes: proofs.sizeBytes })
    .from(proofs)
    .innerJoin(deals, eq(proofs.dealId, deals.id))
    .where(eq(deals.creatorId, creatorId));

  const contractRows = await db
    .select({ sizeBytes: contracts.sizeBytes })
    .from(contracts)
    .innerJoin(deals, eq(contracts.dealId, deals.id))
    .where(eq(deals.creatorId, creatorId));

  return [...proofRows, ...contractRows].reduce(
    (sum, row) => sum + (row.sizeBytes ?? 0),
    0,
  );
}

export const storageRouter = createTRPCRouter({
  /**
   * Issue a presigned PUT for a direct-from-browser upload. This is the single
   * chokepoint that enforces the type allowlist, the size cap, and the per-plan
   * storage quota before any object key is ever handed to the browser.
   */
  requestUpload: creatorScopedProcedure
    .input(
      z.object({
        purpose: purposeSchema,
        dealId: z.string().uuid(),
        deliverableId: z.string().uuid().optional(),
        mimeType: z.string().min(1).max(255),
        sizeBytes: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [deal] = await ctx.db
        .select({ id: deals.id })
        .from(deals)
        .where(and(eq(deals.id, input.dealId), eq(deals.creatorId, ctx.creatorId)));

      if (!deal) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deal not found" });
      }

      if (input.deliverableId) {
        const [deliverable] = await ctx.db
          .select({ id: deliverables.id })
          .from(deliverables)
          .where(
            and(
              eq(deliverables.id, input.deliverableId),
              eq(deliverables.dealId, input.dealId),
            )
          );

        if (!deliverable) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Deliverable not found" });
        }
      }

      if (!isAllowedMimeType(input.purpose, input.mimeType)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            input.purpose === "contract"
              ? "Contract uploads must be a PDF"
              : "That file type isn't supported for evidence",
        });
      }

      try {
        assertSizeWithinCap(input.sizeBytes);
      } catch {
        throw new TRPCError({
          code: "PAYLOAD_TOO_LARGE",
          message: "File exceeds the 100 MB upload limit",
        });
      }

      const [creator] = await ctx.db
        .select({ plan: creators.plan, subscriptionStatus: creators.subscriptionStatus })
        .from(creators)
        .where(eq(creators.id, ctx.creatorId));

      if (!creator) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Creator not found" });
      }

      const quota = getStorageQuotaBytes(creator.plan, creator.subscriptionStatus);
      const used = await usedStorageBytes(ctx.db, ctx.creatorId);
      if (used + input.sizeBytes > quota) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Storage quota exceeded — upgrade your plan for more space",
        });
      }

      const key = buildStorageKey({
        creatorId: ctx.creatorId,
        purpose: input.purpose,
        dealId: input.dealId,
        mimeType: input.mimeType,
      });

      const provider = createStorageProvider();
      const presigned = await provider.createPresignedUpload({
        key,
        contentType: input.mimeType,
        sizeBytes: input.sizeBytes,
      });

      return presigned;
    }),

  /**
   * Fresh short-lived presigned GET for a stored object. Only keys under the
   * caller's own tenant prefix are servable.
   */
  getUrl: creatorScopedProcedure
    .input(z.object({ key: z.string().min(1).max(2048) }))
    .query(async ({ ctx, input }) => {
      if (!isOwnedKey(input.key, ctx.creatorId)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your file" });
      }
      const provider = createStorageProvider();
      return { url: await provider.createPresignedGetUrl(input.key) };
    }),
});
