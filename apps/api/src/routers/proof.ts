import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, creatorScopedProcedure } from "../trpc.js";
import { eq, and, desc } from "drizzle-orm";
import { proofs, deliverables, deals, activityEvents } from "@sponsee/db/schema";
import { proofKinds } from "@sponsee/shared";
import { httpUrl } from "./validators.js";
import {
  createDownloadUrl,
  deleteObject,
  keyBelongsToDeal,
  MAX_UPLOAD_BYTES,
  StorageNotConfiguredError,
} from "../storage/index.js";

export const proofRouter = createTRPCRouter({
  listByDeal: creatorScopedProcedure
    .input(z.object({ dealId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [deal] = await ctx.db
        .select({ id: deals.id })
        .from(deals)
        .where(and(eq(deals.id, input.dealId), eq(deals.creatorId, ctx.creatorId)));

      if (!deal) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deal not found" });
      }

      const rows = await ctx.db
        .select()
        .from(proofs)
        .where(eq(proofs.dealId, input.dealId))
        .orderBy(desc(proofs.createdAt));

      // File-backed proofs get a short-TTL presigned GET so the client can
      // render the thumbnail/PDF inline. Link proofs pass through unchanged.
      return Promise.all(
        rows.map(async (proof) => {
          if (!proof.storageKey) return proof;
          try {
            const { url, expiresAt } = await createDownloadUrl({
              key: proof.storageKey,
              filename: proof.originalFilename ?? undefined,
            });
            return { ...proof, signedUrl: url, signedUrlExpiresAt: expiresAt };
          } catch (err) {
            // A creator whose deal predates the bucket (or a storage outage)
            // still needs to see the rest of their evidence; surface the file
            // as unrenderable rather than failing the whole list.
            if (err instanceof StorageNotConfiguredError) {
              return { ...proof, signedUrl: null, signedUrlExpiresAt: null };
            }
            throw err;
          }
        }),
      );
    }),

  create: creatorScopedProcedure
    .input(
      z
        .object({
          dealId: z.string().uuid(),
          deliverableId: z.string().uuid().optional(),
          kind: z.enum(proofKinds),
          url: httpUrl.optional(),
          note: z.string().max(4096).optional(),
          storageKey: z.string().min(1).max(1024).optional(),
          mimeType: z.string().min(1).max(255).optional(),
          sizeBytes: z.number().int().positive().optional(),
          originalFilename: z.string().min(1).max(255).optional(),
        })
        .refine((v) => v.url || v.note?.trim() || v.storageKey, {
          message: "Evidence needs a link, a file, or a note",
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
          .where(and(eq(deliverables.id, input.deliverableId), eq(deliverables.dealId, input.dealId)));

        if (!deliverable) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Deliverable not found" });
        }
      }

      if (input.storageKey) {
        // Never trust a client-supplied key that was signed for someone else:
        // the key embeds `creators/{creatorId}/deals/{dealId}/`, so ownership is
        // verifiable from the key alone (see storage/keys.ts).
        if (!keyBelongsToDeal(input.storageKey, { creatorId: ctx.creatorId, dealId: input.dealId })) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to that file" });
        }
        // The size cap is enforced at presign time, but re-checked here so a
        // proof row can't be created for an object that could never be valid.
        if (input.sizeBytes != null && input.sizeBytes > MAX_UPLOAD_BYTES) {
          throw new TRPCError({
            code: "PAYLOAD_TOO_LARGE",
            message: `File is ${input.sizeBytes} bytes, exceeding the ${MAX_UPLOAD_BYTES} byte limit`,
          });
        }
      }

      const [proof] = await ctx.db
        .insert(proofs)
        .values({
          dealId: input.dealId,
          deliverableId: input.deliverableId,
          kind: input.kind,
          url: input.url,
          note: input.note?.trim() || null,
          storageKey: input.storageKey ?? null,
          mimeType: input.mimeType ?? null,
          sizeBytes: input.sizeBytes ?? null,
          originalFilename: input.originalFilename ?? null,
        })
        .returning();

      await ctx.db.insert(activityEvents).values({
        creatorId: ctx.creatorId,
        actor: "creator",
        entityType: "proof",
        entityId: proof.id,
        kind: "deliverable",
        payload: {
          action: "proof_added",
          proofKind: input.kind,
          dealId: input.dealId,
          deliverableId: input.deliverableId ?? null,
        },
      });

      return proof;
    }),

  delete: creatorScopedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Verify proof ownership through deal
      const [owned] = await ctx.db
        .select({
          id: proofs.id,
          kind: proofs.kind,
          dealId: proofs.dealId,
          deliverableId: proofs.deliverableId,
          storageKey: proofs.storageKey,
        })
        .from(proofs)
        .innerJoin(deals, eq(proofs.dealId, deals.id))
        .where(and(eq(proofs.id, input.id), eq(deals.creatorId, ctx.creatorId)));

      if (!owned) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Proof not found" });
      }

      await ctx.db.delete(proofs).where(eq(proofs.id, input.id));

      // Removing the proof removes the object too, not just the row (SPO-157).
      // The row delete above succeeds first (see delete.ts: the orphan sweep is
      // the backstop if this object delete fails).
      if (owned.storageKey) {
        await deleteObject(owned.storageKey);
      }

      await ctx.db.insert(activityEvents).values({
        creatorId: ctx.creatorId,
        actor: "creator",
        entityType: "proof",
        entityId: owned.id,
        kind: "deliverable",
        payload: {
          action: "proof_removed",
          proofKind: owned.kind,
          dealId: owned.dealId,
          deliverableId: owned.deliverableId,
        },
      });

      return { success: true };
    }),
});
