import { z } from "zod";
import { createTRPCRouter, creatorScopedProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { eq, and, desc, sql } from "drizzle-orm";
import { invoices, invoiceChaseState, chaseTemplates, deals, contacts, brands } from "@sponsee/db/schema";

export const invoiceRouter = createTRPCRouter({
  list: creatorScopedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(invoices)
      .where(eq(invoices.creatorId, ctx.creatorId))
      .orderBy(desc(invoices.createdAt));
  }),

  listByDeal: creatorScopedProcedure
    .input(z.object({ dealId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(invoices)
        .where(and(eq(invoices.dealId, input.dealId), eq(invoices.creatorId, ctx.creatorId)))
        .orderBy(desc(invoices.createdAt));
    }),

  create: creatorScopedProcedure
    .input(
      z.object({
        dealId: z.string().uuid(),
        contactId: z.string().uuid().optional(),
        title: z.string().max(512).optional(),
        amountCents: z.number().int().min(0),
        currency: z.string().length(3).default("USD"),
        terms: z.enum(["net_15", "net_30", "net_45"]).default("net_30"),
        dueAt: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify deal ownership
      const [deal] = await ctx.db
        .select()
        .from(deals)
        .where(and(eq(deals.id, input.dealId), eq(deals.creatorId, ctx.creatorId)));
      if (!deal) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deal not found" });
      }

      // Verify contact ownership if provided
      if (input.contactId) {
        const [contact] = await ctx.db
          .select()
          .from(contacts)
          .innerJoin(brands, eq(contacts.brandId, brands.id))
          .where(
            and(eq(contacts.id, input.contactId), eq(brands.creatorId, ctx.creatorId))
          );
        if (!contact) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Contact not found" });
        }
      }

      // Get next invoice number for creator
      const [{ max }] = await ctx.db
        .select({ max: sql<number>`COALESCE(MAX(${invoices.number}), 0)` })
        .from(invoices)
        .where(eq(invoices.creatorId, ctx.creatorId));

      const [invoice] = await ctx.db
        .insert(invoices)
        .values({
          ...input,
          creatorId: ctx.creatorId,
          number: max + 1,
          status: "open",
        })
        .returning();

      // Initialize chase state with nextActionAt derived from step-1 template offset
      const [template] = await ctx.db
        .select()
        .from(chaseTemplates)
        .where(and(eq(chaseTemplates.creatorId, ctx.creatorId), eq(chaseTemplates.step, 1)));

      const baseDate = invoice.dueAt ? new Date(invoice.dueAt) : new Date(invoice.issuedAt);
      const nextActionAt = template && template.enabled
        ? new Date(baseDate.getTime() + template.offsetDays * 24 * 60 * 60 * 1000)
        : null;

      await ctx.db.insert(invoiceChaseState).values({
        invoiceId: invoice.id,
        mode: "armed",
        nextStep: 1,
        nextActionAt,
      });

      return invoice;
    }),

  update: creatorScopedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().max(512).optional().nullable(),
        amountCents: z.number().int().min(0).optional(),
        status: z.enum(["draft", "open", "paid", "void"]).optional(),
        paidAt: z.date().optional().nullable(),
        paidNote: z.string().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      // Keep status='paid' <=> paidAt IS NOT NULL atomic: callers may set either
      // field independently, so this mutation must not be able to produce a
      // paid invoice with no paidAt (or a non-paid invoice with a stale one).
      if (data.status === "paid" && data.paidAt === undefined) {
        data.paidAt = new Date();
      } else if (data.status !== undefined && data.status !== "paid") {
        data.paidAt = null;
      }

      const [invoice] = await ctx.db
        .update(invoices)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(invoices.id, id), eq(invoices.creatorId, ctx.creatorId)))
        .returning();

      if (!invoice) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
      }

      return invoice;
    }),

  markPaid: creatorScopedProcedure
    .input(z.object({ id: z.string().uuid(), paidNote: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [invoice] = await ctx.db
        .update(invoices)
        .set({ status: "paid", paidAt: new Date(), paidNote: input.paidNote, updatedAt: new Date() })
        .where(and(eq(invoices.id, input.id), eq(invoices.creatorId, ctx.creatorId)))
        .returning();

      if (!invoice) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
      }

      // Complete chase state
      await ctx.db
        .update(invoiceChaseState)
        .set({ mode: "completed", updatedAt: new Date() })
        .where(eq(invoiceChaseState.invoiceId, input.id));

      return invoice;
    }),
});
