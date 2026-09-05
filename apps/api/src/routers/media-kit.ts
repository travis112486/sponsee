import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, creatorScopedProcedure } from "../trpc.js";
import * as schema from "@sponsee/db/schema";
import { compute, defaultBenchmarkConfig, type MediaKitViewModel } from "@sponsee/shared";

const httpsUrl = z.string().url().refine((value) => new URL(value).protocol === "https:", "Must be an https:// URL");
const id = z.string().uuid();
const position = z.number().int().min(0);
const offeringFields = {
  title: z.string().trim().min(1).max(255),
  description: z.string().max(5000).nullable().optional(),
  priceCents: z.number().int().min(0),
  currency: z.string().trim().length(3).transform((v) => v.toUpperCase()),
};

async function kitFor(ctx: { db: typeof import("@sponsee/db").db; creatorId: string }) {
  const [kit] = await ctx.db.select().from(schema.mediaKits).where(eq(schema.mediaKits.creatorId, ctx.creatorId));
  if (kit) return kit;
  const [created] = await ctx.db.insert(schema.mediaKits).values({ creatorId: ctx.creatorId }).returning();
  return created;
}

async function appendPosition(db: typeof import("@sponsee/db").db, mediaKitId: string, creatorId: string, table: typeof schema.mediaKitOfferings | typeof schema.mediaKitExamples) {
  const rows = await db.select({ position: table.position }).from(table).where(and(eq(table.mediaKitId, mediaKitId), eq(table.creatorId, creatorId)));
  return rows.reduce((max, row) => Math.max(max, row.position), -1) + 1;
}

async function reorderRows(db: typeof import("@sponsee/db").db, table: typeof schema.mediaKitOfferings | typeof schema.mediaKitExamples, ids: string[], mediaKitId: string, creatorId: string) {
  await db.transaction(async (tx) => {
    for (const [offset, rowId] of ids.entries()) {
      await tx.update(table).set({ position: 1_000_000 + offset, updatedAt: new Date() }).where(and(eq(table.id, rowId), eq(table.mediaKitId, mediaKitId), eq(table.creatorId, creatorId)));
    }
    for (const [nextPosition, rowId] of ids.entries()) {
      await tx.update(table).set({ position: nextPosition, updatedAt: new Date() }).where(and(eq(table.id, rowId), eq(table.mediaKitId, mediaKitId), eq(table.creatorId, creatorId)));
    }
  });
}

async function view(ctx: { db: typeof import("@sponsee/db").db; creatorId: string }): Promise<MediaKitViewModel> {
  const kit = await kitFor(ctx);
  const [[creator], platformRows, offerings, examples, deals] = await Promise.all([
    ctx.db.select().from(schema.creators).where(eq(schema.creators.id, ctx.creatorId)),
    ctx.db.select().from(schema.creatorPlatforms).where(eq(schema.creatorPlatforms.creatorId, ctx.creatorId)).orderBy(asc(schema.creatorPlatforms.platform)),
    ctx.db.select().from(schema.mediaKitOfferings).where(and(eq(schema.mediaKitOfferings.mediaKitId, kit.id), eq(schema.mediaKitOfferings.creatorId, ctx.creatorId))).orderBy(asc(schema.mediaKitOfferings.position), asc(schema.mediaKitOfferings.id)),
    ctx.db.select().from(schema.mediaKitExamples).where(and(eq(schema.mediaKitExamples.mediaKitId, kit.id), eq(schema.mediaKitExamples.creatorId, ctx.creatorId))).orderBy(asc(schema.mediaKitExamples.position), asc(schema.mediaKitExamples.id)),
    ctx.db.select({ valueCents: schema.deals.valueCents, ccv: schema.deals.ccv, sponsoredMinutes: schema.deals.sponsoredMinutes }).from(schema.deals).where(eq(schema.deals.creatorId, ctx.creatorId)),
  ]);
  const validDeals = deals.filter((d) => d.ccv != null && d.sponsoredMinutes != null && d.ccv > 0 && d.sponsoredMinutes > 0);
  const cpvhGuidance = validDeals.length ? compute({ ccv: validDeals[0].ccv!, durationMinutes: validDeals[0].sponsoredMinutes!, deliverableType: "ad-read" }, defaultBenchmarkConfig) : null;
  return {
    id: kit.id,
    creator: { id: creator.id, displayName: creator.displayName, pronouns: creator.pronouns, category: creator.category, avatarUrl: creator.avatarUrl },
    platforms: platformRows.map((p) => ({ platform: p.platform, handle: p.handle, channelUrl: p.channelUrl, followers: p.followers, ccv: p.ccv, scheduleLabel: p.scheduleLabel, lastSyncedAt: p.lastSyncedAt?.toISOString() ?? null, provenance: "creator_platforms" as const })),
    headline: kit.headline, bio: kit.bio, accentColor: kit.accentColor,
    offerings: offerings.map(({ id, title, description, priceCents, currency, position }) => ({ id, title, description, priceCents, currency, position })),
    examples: examples.map(({ id, title, url, position }) => ({ id, title, url, position })),
    cpvhGuidance: cpvhGuidance ? { ...cpvhGuidance, provenance: "shared-benchmark" as const } : null,
  };
}

export const mediaKitRouter = createTRPCRouter({
  get: creatorScopedProcedure.query(({ ctx }) => view(ctx)),
  update: creatorScopedProcedure.input(z.object({ headline: z.string().max(255).nullable().optional(), bio: z.string().max(10000).nullable().optional(), accentColor: z.string().max(32).nullable().optional() })).mutation(async ({ ctx, input }) => {
    const kit = await kitFor(ctx);
    const [updated] = await ctx.db.update(schema.mediaKits).set({ ...input, updatedAt: new Date() }).where(and(eq(schema.mediaKits.id, kit.id), eq(schema.mediaKits.creatorId, ctx.creatorId))).returning();
    return updated;
  }),
  offering: createTRPCRouter({
    create: creatorScopedProcedure.input(z.object({ ...offeringFields, position: position.optional() })).mutation(async ({ ctx, input }) => {
      const kit = await kitFor(ctx); const nextPosition = input.position ?? await appendPosition(ctx.db, kit.id, ctx.creatorId, schema.mediaKitOfferings); const [row] = await ctx.db.insert(schema.mediaKitOfferings).values({ ...input, position: nextPosition, mediaKitId: kit.id, creatorId: ctx.creatorId }).returning(); return row;
    }),
    update: creatorScopedProcedure.input(z.object({ id, ...offeringFields, position: position.optional() })).mutation(async ({ ctx, input }) => {
      const kit = await kitFor(ctx); const { id: rowId, ...data } = input; const [row] = await ctx.db.update(schema.mediaKitOfferings).set({ ...data, updatedAt: new Date() }).where(and(eq(schema.mediaKitOfferings.id, rowId), eq(schema.mediaKitOfferings.mediaKitId, kit.id), eq(schema.mediaKitOfferings.creatorId, ctx.creatorId))).returning(); if (!row) throw new TRPCError({ code: "NOT_FOUND" }); return row;
    }),
    reorder: creatorScopedProcedure.input(z.object({ ids: z.array(id).min(1) })).mutation(async ({ ctx, input }) => { const kit = await kitFor(ctx); const rows = await ctx.db.select({ id: schema.mediaKitOfferings.id }).from(schema.mediaKitOfferings).where(and(eq(schema.mediaKitOfferings.mediaKitId, kit.id), eq(schema.mediaKitOfferings.creatorId, ctx.creatorId))); if (rows.length !== input.ids.length || new Set(input.ids).size !== input.ids.length || rows.some((r) => !input.ids.includes(r.id))) throw new TRPCError({ code: "BAD_REQUEST", message: "ids must contain every offering exactly once" }); await reorderRows(ctx.db, schema.mediaKitOfferings, input.ids, kit.id, ctx.creatorId); return view(ctx); }),
    delete: creatorScopedProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => { const kit = await kitFor(ctx); const [row] = await ctx.db.delete(schema.mediaKitOfferings).where(and(eq(schema.mediaKitOfferings.id, input.id), eq(schema.mediaKitOfferings.mediaKitId, kit.id), eq(schema.mediaKitOfferings.creatorId, ctx.creatorId))).returning(); if (!row) throw new TRPCError({ code: "NOT_FOUND" }); return { id: row.id }; }),
  }),
  example: createTRPCRouter({
    create: creatorScopedProcedure.input(z.object({ title: z.string().trim().min(1).max(255), url: httpsUrl, position: position.optional() })).mutation(async ({ ctx, input }) => { const kit = await kitFor(ctx); const nextPosition = input.position ?? await appendPosition(ctx.db, kit.id, ctx.creatorId, schema.mediaKitExamples); const [row] = await ctx.db.insert(schema.mediaKitExamples).values({ ...input, position: nextPosition, mediaKitId: kit.id, creatorId: ctx.creatorId }).returning(); return row; }),
    update: creatorScopedProcedure.input(z.object({ id, title: z.string().trim().min(1).max(255), url: httpsUrl, position: position.optional() })).mutation(async ({ ctx, input }) => { const kit = await kitFor(ctx); const { id: rowId, ...data } = input; const [row] = await ctx.db.update(schema.mediaKitExamples).set({ ...data, updatedAt: new Date() }).where(and(eq(schema.mediaKitExamples.id, rowId), eq(schema.mediaKitExamples.mediaKitId, kit.id), eq(schema.mediaKitExamples.creatorId, ctx.creatorId))).returning(); if (!row) throw new TRPCError({ code: "NOT_FOUND" }); return row; }),
    reorder: creatorScopedProcedure.input(z.object({ ids: z.array(id).min(1) })).mutation(async ({ ctx, input }) => { const kit = await kitFor(ctx); const rows = await ctx.db.select({ id: schema.mediaKitExamples.id }).from(schema.mediaKitExamples).where(and(eq(schema.mediaKitExamples.mediaKitId, kit.id), eq(schema.mediaKitExamples.creatorId, ctx.creatorId))); if (rows.length !== input.ids.length || new Set(input.ids).size !== input.ids.length || rows.some((r) => !input.ids.includes(r.id))) throw new TRPCError({ code: "BAD_REQUEST", message: "ids must contain every example exactly once" }); await reorderRows(ctx.db, schema.mediaKitExamples, input.ids, kit.id, ctx.creatorId); return view(ctx); }),
    delete: creatorScopedProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => { const kit = await kitFor(ctx); const [row] = await ctx.db.delete(schema.mediaKitExamples).where(and(eq(schema.mediaKitExamples.id, input.id), eq(schema.mediaKitExamples.mediaKitId, kit.id), eq(schema.mediaKitExamples.creatorId, ctx.creatorId))).returning(); if (!row) throw new TRPCError({ code: "NOT_FOUND" }); return { id: row.id }; }),
  }),
});
