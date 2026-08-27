import { z } from "zod";
import { createTRPCRouter, creatorScopedProcedure } from "../trpc.js";
import { eq } from "drizzle-orm";
import { brands, contacts } from "@sponsee/db/schema";

export const brandRouter = createTRPCRouter({
  list: creatorScopedProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(brands).where(eq(brands.creatorId, ctx.creatorId));
  }),

  create: creatorScopedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        category: z.string().max(128).optional(),
        domain: z.string().max(255).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [brand] = await ctx.db
        .insert(brands)
        .values({ ...input, creatorId: ctx.creatorId })
        .returning();
      return brand;
    }),

  contacts: creatorScopedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.select().from(contacts).where(eq(contacts.brandId, input.brandId));
    }),

  addContact: creatorScopedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        name: z.string().min(1).max(255),
        email: z.string().email(),
        role: z.string().max(128).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [contact] = await ctx.db.insert(contacts).values(input).returning();
      return contact;
    }),
});
