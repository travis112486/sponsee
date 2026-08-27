import { z } from "zod";
import { createTRPCRouter, creatorScopedProcedure } from "../trpc.js";
import { eq, and, desc } from "drizzle-orm";
import { chaseTemplates, invoiceChaseState, chaseEvents } from "@sponsee/db/schema";

export const chaseRouter = createTRPCRouter({
  templates: creatorScopedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(chaseTemplates)
      .where(eq(chaseTemplates.creatorId, ctx.creatorId))
      .orderBy(chaseTemplates.step);
  }),

  updateTemplate: creatorScopedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        subject: z.string().optional(),
        body: z.string().optional(),
        offsetDays: z.number().int().min(0).optional(),
        enabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const [template] = await ctx.db
        .update(chaseTemplates)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(chaseTemplates.id, id), eq(chaseTemplates.creatorId, ctx.creatorId)))
        .returning();
      return template;
    }),

  state: creatorScopedProcedure
    .input(z.object({ invoiceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [state] = await ctx.db
        .select()
        .from(invoiceChaseState)
        .where(eq(invoiceChaseState.invoiceId, input.invoiceId));
      return state || null;
    }),

  pause: creatorScopedProcedure
    .input(z.object({ invoiceId: z.string().uuid(), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(invoiceChaseState)
        .set({ mode: "paused", pausedReason: input.reason || null, updatedAt: new Date() })
        .where(eq(invoiceChaseState.invoiceId, input.invoiceId));
      return { success: true };
    }),

  resume: creatorScopedProcedure
    .input(z.object({ invoiceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(invoiceChaseState)
        .set({ mode: "armed", pausedReason: null, updatedAt: new Date() })
        .where(eq(invoiceChaseState.invoiceId, input.invoiceId));
      return { success: true };
    }),

  events: creatorScopedProcedure
    .input(z.object({ invoiceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(chaseEvents)
        .where(eq(chaseEvents.invoiceId, input.invoiceId))
        .orderBy(desc(chaseEvents.createdAt));
    }),
});
