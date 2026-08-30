import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { createTRPCRouter, creatorScopedProcedure } from "../trpc.js";
import * as schema from "@sponsee/db/schema";
import { platforms } from "@sponsee/shared";
import { httpsUrl } from "./validators.js";

export const settingsRouter = createTRPCRouter({
  // ── Profile ──
  getProfile: creatorScopedProcedure.query(async ({ ctx }) => {
    const [creator] = await ctx.db
      .select()
      .from(schema.creators)
      .where(eq(schema.creators.id, ctx.creatorId));
    return creator ?? null;
  }),

  updateProfile: creatorScopedProcedure
    .input(
      z.object({
        displayName: z.string().min(1).max(255).optional(),
        pronouns: z.string().max(64).optional().nullable(),
        category: z.string().max(128).optional().nullable(),
        avatarUrl: httpsUrl.optional().nullable(),
        timezone: z.string().max(64).optional(),
        defaultCurrency: z.string().length(3).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [creator] = await ctx.db
        .update(schema.creators)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(eq(schema.creators.id, ctx.creatorId))
        .returning();
      return creator;
    }),

  // ── Platforms ──
  getPlatforms: creatorScopedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(schema.creatorPlatforms)
      .where(eq(schema.creatorPlatforms.creatorId, ctx.creatorId));
  }),

  upsertPlatform: creatorScopedProcedure
    .input(
      z.object({
        id: z.string().uuid().optional(),
        platform: z.enum(platforms),
        ccv: z.number().int().min(0).optional().nullable(),
        followers: z.number().int().min(0).optional().nullable(),
        scheduleLabel: z.string().max(255).optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      if (id) {
        const [platform] = await ctx.db
          .update(schema.creatorPlatforms)
          .set({ ...data, updatedAt: new Date() })
          .where(
            and(
              eq(schema.creatorPlatforms.id, id),
              eq(schema.creatorPlatforms.creatorId, ctx.creatorId)
            )
          )
          .returning();
        if (!platform) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Platform not found" });
        }
        return platform;
      }
      const [platform] = await ctx.db
        .insert(schema.creatorPlatforms)
        .values({
          creatorId: ctx.creatorId,
          ...data,
        })
        .onConflictDoUpdate({
          target: [schema.creatorPlatforms.creatorId, schema.creatorPlatforms.platform],
          set: {
            ccv: data.ccv ?? undefined,
            followers: data.followers ?? undefined,
            scheduleLabel: data.scheduleLabel ?? undefined,
            updatedAt: new Date(),
          },
        })
        .returning();
      return platform;
    }),

  deletePlatform: creatorScopedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db
        .delete(schema.creatorPlatforms)
        .where(
          and(
            eq(schema.creatorPlatforms.id, input.id),
            eq(schema.creatorPlatforms.creatorId, ctx.creatorId)
          )
        )
        .returning();
      if (!result.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Platform not found" });
      }
      return { success: true };
    }),

  // ── Payout rails ──
  getRails: creatorScopedProcedure.query(async ({ ctx }) => {
    const [creator] = await ctx.db
      .select({
        paypalLink: schema.creators.paypalLink,
        wiseText: schema.creators.wiseText,
        bankText: schema.creators.bankText,
      })
      .from(schema.creators)
      .where(eq(schema.creators.id, ctx.creatorId));
    return creator ?? null;
  }),

  updateRails: creatorScopedProcedure
    .input(
      z.object({
        paypalLink: httpsUrl.optional().nullable(),
        wiseText: z.string().optional().nullable(),
        bankText: z.string().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [creator] = await ctx.db
        .update(schema.creators)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(eq(schema.creators.id, ctx.creatorId))
        .returning();
      return creator;
    }),
});
