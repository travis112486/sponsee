import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, creatorScopedProcedure } from "../trpc.js";
import { eq, and, desc } from "drizzle-orm";
import { proofs, deliverables, deals, activityEvents } from "@sponsee/db/schema";
import { proofKinds } from "@sponsee/shared";

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

      return ctx.db
        .select()
        .from(proofs)
        .where(eq(proofs.dealId, input.dealId))
        .orderBy(desc(proofs.createdAt));
    }),

  create: creatorScopedProcedure
    .input(
      z
        .object({
          dealId: z.string().uuid(),
          deliverableId: z.string().uuid().optional(),
          kind: z.enum(proofKinds),
          url: z.string().url().max(2048).optional(),
          note: z.string().max(4096).optional(),
        })
        .refine((v) => v.url || v.note?.trim(), {
          message: "Evidence needs a link or a note",
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

      const [proof] = await ctx.db
        .insert(proofs)
        .values({
          dealId: input.dealId,
          deliverableId: input.deliverableId,
          kind: input.kind,
          url: input.url,
          note: input.note?.trim() || null,
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
        .select({ id: proofs.id, kind: proofs.kind, dealId: proofs.dealId, deliverableId: proofs.deliverableId })
        .from(proofs)
        .innerJoin(deals, eq(proofs.dealId, deals.id))
        .where(and(eq(proofs.id, input.id), eq(deals.creatorId, ctx.creatorId)));

      if (!owned) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Proof not found" });
      }

      await ctx.db.delete(proofs).where(eq(proofs.id, input.id));

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
