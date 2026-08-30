import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { createTRPCRouter, creatorScopedProcedure } from "../trpc.js";
import * as schema from "@sponsee/db/schema";
import { platforms } from "@sponsee/shared";
import { syncPlatformRow } from "../jobs/platform-sync.js";

/**
 * Creator-supplied URL that we store and may later render as an `href`/`src`.
 *
 * Zod's `.url()` accepts any scheme, including `javascript:` and `data:`.
 * Nothing renders these fields today, so this is hardening rather than a live
 * XSS fix — but the allowlist has to be in place before a public profile page
 * ever links them, not after.
 */
const httpsUrl = z
  .string()
  .url()
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "Must be an https:// URL");

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
        handle: z.string().trim().max(255).optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      // A new handle means prior sync state no longer applies
      const syncReset =
        "handle" in input ? ({ syncStatus: "never", syncError: null } as const) : {};
      if (id) {
        const [platform] = await ctx.db
          .update(schema.creatorPlatforms)
          .set({ ...data, ...syncReset, updatedAt: new Date() })
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
            handle: data.handle ?? undefined,
            ...syncReset,
            updatedAt: new Date(),
          },
        })
        .returning();
      return platform;
    }),

  syncPlatform: creatorScopedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(schema.creatorPlatforms)
        .where(
          and(
            eq(schema.creatorPlatforms.id, input.id),
            eq(schema.creatorPlatforms.creatorId, ctx.creatorId)
          )
        );
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Platform not found" });
      }
      if (!row.handle) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Add a channel handle first" });
      }
      // Records ok/error on the row rather than throwing on API failures
      return syncPlatformRow(row);
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
