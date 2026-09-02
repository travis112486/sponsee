import { z } from "zod";
import { createTRPCRouter, creatorScopedProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { eq, and, desc, sql } from "drizzle-orm";
import { invoices, invoiceChaseState, chaseTemplates, deals, contacts, brands } from "@sponsee/db/schema";

const PAID_REQUIRES_PAID_AT_CONSTRAINT = "invoices_paid_requires_paid_at";

/**
 * Did this update fail the DB-level status='paid' <=> paidAt not-null invariant?
 *
 * The router-level guards in `update` reject the input shapes they can decide
 * from the input alone (`paidAt` with no `status`, in either direction) and
 * normalize paidAt whenever `status` is provided, so no input to this
 * mutation can itself request an inconsistent row. The CHECK is now a
 * biconditional (SPO-273), so it is enforced on every column, not just the
 * ones this mutation touches: an `update` on an unrelated field (e.g.
 * `title`) against a row that is already inconsistent — a legacy row, or one
 * written by some other path that bypasses these guards — still reaches
 * Postgres and fails the `invoices_paid_requires_paid_at` CHECK. Catching
 * that here turns it into a typed BAD_REQUEST instead of a 500 that carries
 * the raw query in `error.message`.
 */
function isPaidInvariantViolation(error: unknown): boolean {
  const cause = (error as { cause?: { constraint?: string } } | undefined)?.cause;
  return cause?.constraint === PAID_REQUIRES_PAID_AT_CONSTRAINT;
}

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

      // `paidAt` with no `status` is undecidable from the input alone, in both
      // directions, so both are rejected rather than resolved by reading the row.
      // The 0014 CHECK (SPO-273) is now biconditional and owns the invariant at
      // the schema layer for every writer, not just this mutation; these two
      // guards are belt-and-braces — they exist to reject a bad input shape
      // early with a typed, actionable message instead of surfacing the CHECK
      // violation as a BAD_REQUEST with a generic message (see
      // isPaidInvariantViolation below).
      //
      // `paidAt: null` (SPO-260): on a paid invoice it would strand status='paid'
      // with a null paidAt. On a non-paid one it is a no-op — either way the
      // intent is better expressed as status: "open".
      if (data.paidAt === null && data.status === undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: 'Set "status" to change whether an invoice is paid; "paidAt" alone cannot clear it.',
        });
      }

      // `paidAt: <date>` (SPO-265): the mirror image. It would silently write
      // paid_at onto a draft/open/void invoice. The intent is better expressed
      // as status: "paid" (which may carry an explicit paidAt alongside it to
      // backdate the payment).
      if (data.paidAt != null && data.status === undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: 'Set "status" to "paid" to mark an invoice paid; "paidAt" alone cannot do it.',
        });
      }

      // Keep status='paid' <=> paidAt IS NOT NULL atomic: callers may set either
      // field independently, so this mutation must not be able to produce a
      // paid invoice with no paidAt (or a non-paid invoice with a stale one).
      if (data.status === "paid" && data.paidAt == null) {
        data.paidAt = new Date();
      } else if (data.status !== undefined && data.status !== "paid") {
        data.paidAt = null;
      }

      let invoice;
      try {
        [invoice] = await ctx.db
          .update(invoices)
          .set({ ...data, updatedAt: new Date() })
          .where(and(eq(invoices.id, id), eq(invoices.creatorId, ctx.creatorId)))
          .returning();
      } catch (error) {
        if (isPaidInvariantViolation(error)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That update would leave a paid invoice without a paid date.",
          });
        }
        throw error;
      }

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
