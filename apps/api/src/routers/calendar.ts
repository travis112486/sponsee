import { createTRPCRouter, creatorScopedProcedure } from "../trpc.js";
import { eq, and, isNull, desc } from "drizzle-orm";
import { deliverables, deals, invoices, brands } from "@sponsee/db/schema";
import { z } from "zod";

export const calendarRouter = createTRPCRouter({
  events: creatorScopedProcedure
    .input(
      z.object({
        start: z.string().datetime().optional(),
        end: z.string().datetime().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { start, end } = input;

      // Deliverables with due dates — scoped through deal ownership
      const delRows = await ctx.db
        .select({
          id: deliverables.id,
          title: deliverables.title,
          dueAt: deliverables.dueAt,
          status: deliverables.status,
          dealId: deliverables.dealId,
          dealTitle: deals.title,
        })
        .from(deliverables)
        .innerJoin(deals, eq(deliverables.dealId, deals.id))
        .where(
          and(eq(deals.creatorId, ctx.creatorId), isNull(deals.deletedAt))
        )
        .orderBy(deliverables.dueAt);

      const deliverableEvents = delRows
        .filter((r) => r.dueAt != null)
        .map((r) => ({
          type: "deliverable" as const,
          id: r.id,
          date: r.dueAt!,
          title: r.title,
          dealId: r.dealId,
          dealTitle: r.dealTitle,
          status: r.status,
        }));

      // Invoices with due dates
      const invRows = await ctx.db
        .select({
          id: invoices.id,
          title: invoices.title,
          number: invoices.number,
          dueAt: invoices.dueAt,
          status: invoices.status,
          amountCents: invoices.amountCents,
          currency: invoices.currency,
        })
        .from(invoices)
        .where(eq(invoices.creatorId, ctx.creatorId))
        .orderBy(invoices.dueAt);

      const invoiceEvents = invRows
        .filter((r) => r.dueAt != null)
        .map((r) => ({
          type: "invoice" as const,
          id: r.id,
          date: r.dueAt!,
          title: r.title || `Invoice #${r.number}`,
          status: r.status,
          amountCents: r.amountCents,
          currency: r.currency,
        }));

      // Deal stage-change milestones
      const dealRows = await ctx.db
        .select({
          id: deals.id,
          title: deals.title,
          stage: deals.stage,
          stageEnteredAt: deals.stageEnteredAt,
          brandName: brands.name,
        })
        .from(deals)
        .leftJoin(brands, eq(deals.brandId, brands.id))
        .where(
          and(eq(deals.creatorId, ctx.creatorId), isNull(deals.deletedAt))
        )
        .orderBy(desc(deals.stageEnteredAt));

      const dealEvents = dealRows
        .filter((r) => r.stageEnteredAt != null)
        .map((r) => ({
          type: "deal_stage" as const,
          id: r.id,
          date: r.stageEnteredAt!,
          title: r.title,
          stage: r.stage,
          brandName: r.brandName,
        }));

      const all = [...deliverableEvents, ...invoiceEvents, ...dealEvents];

      // Optional date-range filter
      const s = start ? new Date(start) : null;
      const e = end ? new Date(end) : null;
      const filtered =
        s || e
          ? all.filter((ev) => {
              const d = new Date(ev.date);
              if (s && d < s) return false;
              if (e && d > e) return false;
              return true;
            })
          : all;

      return filtered.sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );
    }),
});
