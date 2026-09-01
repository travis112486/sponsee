import { z } from "zod";
import { eq, and, isNull, desc, inArray } from "drizzle-orm";
import { createTRPCRouter, creatorScopedProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { db, type DB } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { dealStages, dealTypes, platforms, paymentTerms } from "@sponsee/shared";
import {
  assertDealSlotAvailable,
  assertSlotForReopen,
  withCreatorSlotLock,
} from "../billing/gate.js";

export const dealsRouter = createTRPCRouter({
  list: creatorScopedProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select({
        deal: schema.deals,
        brand: schema.brands,
        contact: schema.contacts,
      })
      .from(schema.deals)
      .leftJoin(schema.brands, eq(schema.deals.brandId, schema.brands.id))
      .leftJoin(schema.contacts, eq(schema.deals.primaryContactId, schema.contacts.id))
      .where(and(eq(schema.deals.creatorId, ctx.creatorId), isNull(schema.deals.deletedAt)))
      .orderBy(desc(schema.deals.updatedAt));

    const dealIds = rows.map((r) => r.deal.id);

    // Fetch the board's deliverables and invoices in two flat queries and group
    // them by deal, rather than N+1 per-deal reads. Both are creator-scoped
    // transitively through `dealIds` (which came from a creator-scoped query).
    const deliverables = dealIds.length
      ? await db
          .select()
          .from(schema.deliverables)
          .where(inArray(schema.deliverables.dealId, dealIds))
          .orderBy(schema.deliverables.position)
      : [];

    const invoices = dealIds.length
      ? await db
          .select()
          .from(schema.invoices)
          .where(inArray(schema.invoices.dealId, dealIds))
          .orderBy(desc(schema.invoices.issuedAt))
      : [];

    const deliverablesByDeal = new Map<string, typeof deliverables>();
    for (const d of deliverables) {
      const list = deliverablesByDeal.get(d.dealId) ?? [];
      list.push(d);
      deliverablesByDeal.set(d.dealId, list);
    }

    const invoicesByDeal = new Map<string, typeof invoices>();
    for (const i of invoices) {
      if (!i.dealId) continue;
      const list = invoicesByDeal.get(i.dealId) ?? [];
      list.push(i);
      invoicesByDeal.set(i.dealId, list);
    }

    return rows.map((r) => ({
      ...r.deal,
      brand: r.brand,
      primaryContact: r.contact,
      deliverables: deliverablesByDeal.get(r.deal.id) ?? [],
      invoices: invoicesByDeal.get(r.deal.id) ?? [],
    }));
  }),

  getById: creatorScopedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [deal] = await db
        .select()
        .from(schema.deals)
        .where(and(eq(schema.deals.id, input.id), eq(schema.deals.creatorId, ctx.creatorId), isNull(schema.deals.deletedAt)));

      if (!deal) return null;

      const [brand] = await db
        .select()
        .from(schema.brands)
        .where(and(eq(schema.brands.id, deal.brandId), eq(schema.brands.creatorId, ctx.creatorId)));

      const contactRows = deal.primaryContactId
        ? await db
            .select()
            .from(schema.contacts)
            .innerJoin(schema.brands, eq(schema.contacts.brandId, schema.brands.id))
            .where(
              and(
                eq(schema.contacts.id, deal.primaryContactId),
                eq(schema.brands.creatorId, ctx.creatorId)
              )
            )
        : [];

      const contact = contactRows[0]?.contacts ?? null;

      const deliverables = await db
        .select()
        .from(schema.deliverables)
        .where(eq(schema.deliverables.dealId, deal.id))
        .orderBy(schema.deliverables.position);

      return { ...deal, brand, primaryContact: contact, deliverables };
    }),

  create: creatorScopedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        primaryContactId: z.string().uuid().optional().nullable(),
        title: z.string().min(1).max(512),
        type: z.enum(dealTypes),
        valueCents: z.number().int().min(0).default(0),
        currency: z.string().length(3).default("USD"),
        valueNote: z.string().optional().nullable(),
        stage: z.enum(dealStages).default("inbound"),
        platforms: z.array(z.enum(platforms)).optional().nullable(),
        paymentTerms: z.enum(paymentTerms).default("net_30"),
        source: z.string().max(255).optional().nullable(),
        notes: z.string().optional().nullable(),
        bountyRateNote: z.string().optional().nullable(),
        bountyCount: z.number().int().optional().nullable(),
        bountyPayoutCents: z.number().int().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Plan gate (SPO-24): enforce the tier's active-deal slot limit. The check
      // and the insert run inside one creator-locked transaction so two creates
      // arriving together at limit−1 cannot both pass (SPO-87 MEDIUM-2).
      return withCreatorSlotLock(ctx.db, ctx.creatorId, async (tx) => {
        await assertDealSlotAvailable(tx, ctx.creatorId);

        // Verify brand ownership
        const [brand] = await tx
          .select()
          .from(schema.brands)
          .where(
            and(eq(schema.brands.id, input.brandId), eq(schema.brands.creatorId, ctx.creatorId))
          );
        if (!brand) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Brand not found" });
        }

        // Verify contact ownership if provided
        if (input.primaryContactId) {
          const [contact] = await tx
            .select()
            .from(schema.contacts)
            .innerJoin(schema.brands, eq(schema.contacts.brandId, schema.brands.id))
            .where(
              and(
                eq(schema.contacts.id, input.primaryContactId),
                eq(schema.brands.creatorId, ctx.creatorId)
              )
            );
          if (!contact) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Contact not found" });
          }
        }

        const [deal] = await tx
          .insert(schema.deals)
          .values({
            creatorId: ctx.creatorId,
            ...input,
          })
          .returning();
        return deal;
      });
    }),

  update: creatorScopedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().min(1).max(512).optional(),
        type: z.enum(dealTypes).optional(),
        valueCents: z.number().int().min(0).optional(),
        currency: z.string().length(3).optional(),
        valueNote: z.string().optional().nullable(),
        stage: z.enum(dealStages).optional(),
        platforms: z.array(z.enum(platforms)).optional().nullable(),
        paymentTerms: z.enum(paymentTerms).optional(),
        source: z.string().max(255).optional().nullable(),
        notes: z.string().optional().nullable(),
        primaryContactId: z.string().uuid().optional().nullable(),
        bountyRateNote: z.string().optional().nullable(),
        bountyCount: z.number().int().optional().nullable(),
        bountyPayoutCents: z.number().int().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      const applyUpdate = async (tx: DB) => {
        // Verify contact ownership if provided
        if (data.primaryContactId) {
          const [contact] = await tx
            .select()
            .from(schema.contacts)
            .innerJoin(schema.brands, eq(schema.contacts.brandId, schema.brands.id))
            .where(
              and(
                eq(schema.contacts.id, data.primaryContactId),
                eq(schema.brands.creatorId, ctx.creatorId)
              )
            );
          if (!contact) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Contact not found" });
          }
        }

        const [deal] = await tx
          .update(schema.deals)
          .set({
            ...data,
            updatedAt: new Date(),
            stageEnteredAt: data.stage ? new Date() : undefined,
          })
          .where(and(eq(schema.deals.id, id), eq(schema.deals.creatorId, ctx.creatorId)))
          .returning();

        if (!deal) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Deal not found" });
        }

        return deal;
      };

      // Only a move *out of* `paid` can consume a slot, so nothing else pays the
      // cost of a lock.
      if (data.stage === undefined || data.stage === "paid") {
        return applyUpdate(ctx.db);
      }

      return withCreatorSlotLock(ctx.db, ctx.creatorId, async (tx) => {
        await assertSlotForReopen(tx, ctx.creatorId, id);
        return applyUpdate(tx);
      });
    }),

  updateStage: creatorScopedProcedure
    .input(z.object({ id: z.string().uuid(), stage: z.enum(dealStages) }))
    .mutation(async ({ ctx, input }) => {
      const applyStage = async (tx: DB) => {
        const [deal] = await tx
          .update(schema.deals)
          .set({ stage: input.stage, stageEnteredAt: new Date(), updatedAt: new Date() })
          .where(and(eq(schema.deals.id, input.id), eq(schema.deals.creatorId, ctx.creatorId)))
          .returning();

        if (!deal) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Deal not found" });
        }

        return deal;
      };

      if (input.stage === "paid") {
        return applyStage(ctx.db);
      }

      return withCreatorSlotLock(ctx.db, ctx.creatorId, async (tx) => {
        await assertSlotForReopen(tx, ctx.creatorId, input.id);
        return applyStage(tx);
      });
    }),

  delete: creatorScopedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [deal] = await db
        .update(schema.deals)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(schema.deals.id, input.id), eq(schema.deals.creatorId, ctx.creatorId)))
        .returning();

      if (!deal) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deal not found" });
      }

      return deal;
    }),
});
