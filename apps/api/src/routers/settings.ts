import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, desc, ne, sql } from "drizzle-orm";
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
        // Platform is the row's identity, not a field to edit in place (SPO-136).
        // Match it in the WHERE so a changing `platform` can neither silently
        // reclassify the row nor trip the (creatorId, platform) unique index into
        // a raw 500; a mismatch resolves below into NOT_FOUND or CONFLICT.
        const { platform: requestedPlatform, ...updates } = data;
        const [platform] = await ctx.db
          .update(schema.creatorPlatforms)
          .set({ ...updates, ...syncReset, updatedAt: new Date() })
          .where(
            and(
              eq(schema.creatorPlatforms.id, id),
              eq(schema.creatorPlatforms.creatorId, ctx.creatorId),
              eq(schema.creatorPlatforms.platform, requestedPlatform)
            )
          )
          .returning();
        if (!platform) {
          const [existing] = await ctx.db
            .select({ id: schema.creatorPlatforms.id })
            .from(schema.creatorPlatforms)
            .where(
              and(
                eq(schema.creatorPlatforms.id, id),
                eq(schema.creatorPlatforms.creatorId, ctx.creatorId)
              )
            );
          if (!existing) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Platform not found" });
          }
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Platform can't be changed on an existing row — delete it and add the new platform instead",
          });
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
            // Spread the same shape the id path applies so the two paths
            // can't drift when fields are added (SPO-126a, SPO-130, SPO-134).
            // Explicit null clears a field, absent stays absent (Drizzle
            // omits undefined), and re-setting `platform` on a row matched
            // by (creatorId, platform) is a no-op.
            ...data,
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
      if (!row.handle && !row.connectedAccountId) {
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

  /**
   * Which OAuth connect providers have credentials provisioned (SPO-109). The
   * panel hides Connect buttons for the rest — clicking one could only end in
   * Better Auth's opaque PROVIDER_NOT_FOUND. Read per-request (not at module
   * load) so tests and env changes behave predictably.
   */
  getConnectProviders: creatorScopedProcedure.query(() => ({
    twitch: Boolean(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET),
    kick: Boolean(process.env.KICK_CLIENT_ID && process.env.KICK_CLIENT_SECRET),
  })),

  /**
   * Finish an OAuth connect (SPO-109). The browser returns from Better Auth's
   * linkSocial redirect with a fresh row in the `account` table; this stitches
   * it into creator_platforms.connectedAccountId and syncs immediately so the
   * true subscriber count appears without waiting for the daily job.
   */
  completePlatformConnect: creatorScopedProcedure
    .input(z.object({ platform: z.enum(["twitch", "kick"]) }))
    .mutation(async ({ ctx, input }) => {
      // Scoped to the session user, so one tenant can never claim an OAuth
      // account another user linked.
      const [linked] = await ctx.db
        .select()
        .from(schema.account)
        .where(
          and(
            eq(schema.account.userId, ctx.user.id),
            eq(schema.account.providerId, input.platform)
          )
        )
        .orderBy(desc(schema.account.updatedAt))
        .limit(1);
      if (!linked) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No linked ${input.platform} account — the Connect flow didn't finish`,
        });
      }

      // Connecting account B after account A strands A's `account` row —
      // unreachable from the UI (Disconnect only knows the current link) but
      // still holding a live refresh token. Same standard as disconnect:
      // tokens we no longer use must not sit in the DB.
      await ctx.db
        .delete(schema.account)
        .where(
          and(
            eq(schema.account.userId, ctx.user.id),
            eq(schema.account.providerId, input.platform),
            ne(schema.account.id, linked.id)
          )
        );

      // Caveat: `account` is user-scoped while this link is creator-scoped. A
      // user in two workspaces who connects the same channel to both shares
      // one account row, so disconnecting in one workspace breaks the other's
      // sync. v1 is effectively one creator per user; revisit with multi-seat.
      const [row] = await ctx.db
        .insert(schema.creatorPlatforms)
        .values({
          creatorId: ctx.creatorId,
          platform: input.platform,
          connectedAccountId: linked.id,
        })
        .onConflictDoUpdate({
          target: [schema.creatorPlatforms.creatorId, schema.creatorPlatforms.platform],
          set: { connectedAccountId: linked.id, updatedAt: new Date() },
        })
        .returning();

      // Same upstream budget as "Sync now". When exhausted, the link itself
      // still succeeded — the daily job picks the row up, so report "skipped"
      // rather than failing the connect.
      if (!syncNowLimiter.check(ctx.creatorId).allowed) {
        return { row, outcome: "skipped" as const };
      }
      return syncPlatformRow(row);
    }),

  /**
   * Sever an OAuth connect: clears the link and deletes the stored tokens.
   * Synced values stay as last-known (manual entry remains the fallback);
   * future daily syncs fall back to the public no-OAuth path if a handle is set.
   */
  disconnectPlatform: creatorScopedProcedure
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
      if (!row.connectedAccountId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Platform is not connected" });
      }

      const [updated] = await ctx.db
        .update(schema.creatorPlatforms)
        .set({ connectedAccountId: null, updatedAt: new Date() })
        .where(eq(schema.creatorPlatforms.id, row.id))
        .returning();

      // Drop the tokens too — a disconnect that leaves a live refresh token
      // behind isn't one. userId guard mirrors the connect path; the
      // providerId guard means a future write to connectedAccountId can never
      // make this delete a login account (e.g. Google). Magic link remains as
      // a sign-in method, so this can't lock the user out.
      await ctx.db
        .delete(schema.account)
        .where(
          and(
            eq(schema.account.id, row.connectedAccountId),
            eq(schema.account.userId, ctx.user.id),
            eq(schema.account.providerId, row.platform)
          )
        );

      return updated;
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
      // Removing a connected platform removes its stored OAuth tokens too —
      // same reasoning (and same guards) as disconnectPlatform.
      const connectedAccountId = result[0].connectedAccountId;
      if (connectedAccountId) {
        await ctx.db
          .delete(schema.account)
          .where(
            and(
              eq(schema.account.id, connectedAccountId),
              eq(schema.account.userId, ctx.user.id),
              eq(schema.account.providerId, result[0].platform)
            )
          );
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
