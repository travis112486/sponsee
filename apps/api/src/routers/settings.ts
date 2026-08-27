import { z } from "zod";
import { eq } from "drizzle-orm";
import { createTRPCRouter, creatorScopedProcedure } from "../trpc.js";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { platforms } from "@sponsee/shared";

export const settingsRouter = createTRPCRouter({
  // ── Profile ──
  getProfile: creatorScopedProcedure.query(async ({ ctx }) => {
    const [creator] = await db
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
        avatarUrl: z.string().url().optional().nullable(),
        timezone: z.string().max(64).optional(),
        defaultCurrency: z.string().length(3).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [creator] = await db
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
    return db
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
        const [platform] = await db
          .update(schema.creatorPlatforms)
          .set({ ...data, updatedAt: new Date() })
          .where(eq(schema.creatorPlatforms.id, id))
          .returning();
        return platform;
      }
      const [platform] = await db
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
      await db
        .delete(schema.creatorPlatforms)
        .where(eq(schema.creatorPlatforms.id, input.id));
      return { success: true };
    }),

  // ── Payout rails ──
  getRails: creatorScopedProcedure.query(async ({ ctx }) => {
    const [creator] = await db
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
        paypalLink: z.string().url().optional().nullable(),
        wiseText: z.string().optional().nullable(),
        bankText: z.string().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [creator] = await db
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
