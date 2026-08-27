import { z } from "zod";
import { createTRPCRouter, creatorScopedProcedure } from "../trpc.js";
import { eq, and } from "drizzle-orm";
import { deliverables, deals } from "@sponsee/db/schema";

export const deliverableRouter = createTRPCRouter({
  listByDeal: creatorScopedProcedure
    .input(z.object({ dealId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(deliverables)
        .where(eq(deliverables.dealId, input.dealId))
        .orderBy(deliverables.position);
    }),

  create: creatorScopedProcedure
    .input(
      z.object({
        dealId: z.string().uuid(),
        title: z.string().min(1).max(512),
        platform: z.enum(["twitch", "youtube", "kick", "tiktok"]).optional(),
        dueAt: z.date().optional(),
        position: z.number().int().default(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify deal ownership
      const [deal] = await ctx.db
        .select()
        .from(deals)
        .where(and(eq(deals.id, input.dealId), eq(deals.creatorId, ctx.creatorId)));
      if (!deal) throw new Error("Deal not found");

      const [del] = await ctx.db.insert(deliverables).values(input).returning();
      return del;
    }),

  update: creatorScopedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().min(1).max(512).optional(),
        status: z.enum(["not_started", "scheduled", "in_progress", "done", "missed", "rescheduled"]).optional(),
        dueAt: z.date().optional().nullable(),
        progressDone: z.number().int().optional().nullable(),
        progressTotal: z.number().int().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const [del] = await ctx.db
        .update(deliverables)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(deliverables.id, id))
        .returning();
      return del;
    }),

  delete: creatorScopedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(deliverables).where(eq(deliverables.id, input.id));
      return { success: true };
    }),
});
