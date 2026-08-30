import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, sql } from "drizzle-orm";
import { createTRPCRouter, creatorScopedProcedure } from "../trpc.js";
import * as schema from "@sponsee/db/schema";
import { platforms } from "@sponsee/shared";
import { syncPlatformRow } from "../jobs/platform-sync.js";
import { SlidingWindowLimiter } from "../rate-limit.js";

// "Sync now" fans out into 2-3 upstream requests (with retry/backoff) against
// app credentials shared by every tenant, so one click-happy creator can burn
// quota for all of them. `sync.isPending` in the panel guards a single browser
// tab and nothing else. Ten per window is far above real use — a creator has at
// most three syncable platforms — while bounding a stuck retry loop or script.
export const SYNC_NOW_MAX_PER_WINDOW = 10;
export const SYNC_NOW_WINDOW_MS = 5 * 60 * 1000;

export const syncNowLimiter = new SlidingWindowLimiter(
  SYNC_NOW_MAX_PER_WINDOW,
  SYNC_NOW_WINDOW_MS
);

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
      // A *changed* handle means prior sync state no longer applies. Compared
      // in SQL against the stored row because the panel sends `handle` on
      // every save — resetting whenever the key is merely present would wipe
      // syncStatus/syncError on unrelated edits (e.g. updating CCV).
      // IS DISTINCT FROM makes clearing a handle count as a change too.
      const handleChanged = sql`${schema.creatorPlatforms.handle} IS DISTINCT FROM ${input.handle ?? null}`;
      const syncReset =
        "handle" in input
          ? {
              syncStatus: sql`CASE WHEN ${handleChanged} THEN 'never' ELSE ${schema.creatorPlatforms.syncStatus} END`,
              syncError: sql`CASE WHEN ${handleChanged} THEN NULL ELSE ${schema.creatorPlatforms.syncError} END`,
            }
          : {};
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
            // Explicit null means "clear this field" — the panel sends nulls
            // for blanked inputs, and the id-carrying update path applies
            // them, so this path must too (SPO-126a, SPO-130). Absent stays
            // absent — Drizzle omits undefined from the SET clause.
            ccv: data.ccv,
            followers: data.followers,
            scheduleLabel: data.scheduleLabel,
            handle: data.handle,
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
      // Checked after the ownership/handle guards so only requests that would
      // actually reach the upstream APIs consume budget.
      const decision = syncNowLimiter.check(ctx.creatorId);
      if (!decision.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Too many syncs — try again in ${decision.retryAfter}s`,
        });
      }
      // Records ok/error on the row rather than throwing on API failures.
      // `outcome: "skipped"` means nothing was attempted (credentials not
      // provisioned) — the panel shows a neutral notice, not a failure.
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
