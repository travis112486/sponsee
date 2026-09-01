import { z } from "zod";
import { createTRPCRouter, creatorScopedProcedure } from "../trpc.js";
import { and, eq, isNull, isNotNull, gte, lt, ne } from "drizzle-orm";
import {
  deals,
  brands,
  invoices,
  deliverables,
  invoiceChaseState,
} from "@sponsee/db/schema";
import { dealStages } from "@sponsee/shared";

const DAY_MS = 24 * 60 * 60 * 1000;

type DealType = "flat" | "bounty" | "hybrid";

// ── Period helpers (all UTC; creator-local timezone is a later refinement) ──

function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function startOfUtcQuarter(d: Date): Date {
  const m = Math.floor(d.getUTCMonth() / 3) * 3;
  return new Date(Date.UTC(d.getUTCFullYear(), m, 1));
}

function startOfUtcYear(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
}

function addMonthsUtc(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()));
}

// Monday-based week (ISO 8601): day 0 = Sun, so days-since-Monday = (day + 6) % 7.
function startOfUtcWeek(d: Date): Date {
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - sinceMonday));
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function periodBounds(
  period: "month" | "quarter" | "ytd",
  now: Date
): { start: Date; end: Date } {
  if (period === "month") {
    const start = startOfUtcMonth(now);
    return { start, end: addMonthsUtc(start, 1) };
  }
  if (period === "quarter") {
    const start = startOfUtcQuarter(now);
    return { start, end: addMonthsUtc(start, 3) };
  }
  // YTD: Jan 1 through `now` (revenue is attributed to a recorded paid date,
  // so there is never a paidAt in the future to exclude).
  return { start: startOfUtcYear(now), end: new Date(now) };
}

export const dashboardRouter = createTRPCRouter({
  overview: creatorScopedProcedure
    .input(
      z
        .object({
          period: z.enum(["month", "quarter", "ytd"]).default("month"),
          // Injectable for deterministic tests and end-of-day reconciliation;
          // defaults to server time. Accepted as an ISO datetime string so the
          // boundary math is always explicit UTC.
          now: z.string().datetime().optional(),
        })
        .default({})
    )
    .query(async ({ ctx, input }) => {
      const now = input.now ? new Date(input.now) : new Date();
      const period = input.period;

      // ── Revenue (paid invoices, attributed by paidAt, split by deal type) ──
      // A paid invoice with no paidAt is not revenue: without a recorded paid
      // date there is no truthful period to attribute it to. Orphaned invoices
      // (deal hard-deleted → dealId null) still count toward totals, but cannot
      // be typed, so they are absent from the flat/bounty/hybrid split.
      const paidRows = await ctx.db
        .select({
          amountCents: invoices.amountCents,
          paidAt: invoices.paidAt,
          dealType: deals.type,
        })
        .from(invoices)
        .leftJoin(deals, eq(invoices.dealId, deals.id))
        .where(and(eq(invoices.creatorId, ctx.creatorId), eq(invoices.status, "paid")));

      const attributed = paidRows
        .filter((r): r is { amountCents: number; paidAt: Date; dealType: DealType | null } => r.paidAt != null);

      const { start: periodStart, end: periodEnd } = periodBounds(period, now);

      const byType = { flat: 0, bounty: 0, hybrid: 0 };
      let totalCents = 0;
      for (const row of attributed) {
        if (row.paidAt >= periodStart && row.paidAt < periodEnd) {
          totalCents += row.amountCents;
          if (row.dealType === "flat") byType.flat += row.amountCents;
          else if (row.dealType === "bounty") byType.bounty += row.amountCents;
          else if (row.dealType === "hybrid") byType.hybrid += row.amountCents;
        }
      }

      // Trailing-12-month series (stable chart shape), split by deal type.
      const seriesStart = addMonthsUtc(startOfUtcMonth(now), -11);
      const buckets = new Map<string, { valueCents: number; flatCents: number; bountyCents: number; hybridCents: number }>();
      for (let i = 0; i < 12; i++) {
        buckets.set(monthKey(addMonthsUtc(seriesStart, i)), {
          valueCents: 0,
          flatCents: 0,
          bountyCents: 0,
          hybridCents: 0,
        });
      }
      for (const row of attributed) {
        const bucket = buckets.get(monthKey(startOfUtcMonth(row.paidAt)));
        if (!bucket) continue;
        bucket.valueCents += row.amountCents;
        if (row.dealType === "flat") bucket.flatCents += row.amountCents;
        else if (row.dealType === "bounty") bucket.bountyCents += row.amountCents;
        else if (row.dealType === "hybrid") bucket.hybridCents += row.amountCents;
      }
      const monthly = [...buckets.entries()].map(([month, b]) => ({
        month,
        valueCents: b.valueCents,
        flatCents: b.flatCents,
        bountyCents: b.bountyCents,
        hybridCents: b.hybridCents,
      }));

      // ── Pipeline stage counts + values (all six stages, zero-filled) ──
      const dealRows = await ctx.db
        .select({ stage: deals.stage, valueCents: deals.valueCents })
        .from(deals)
        .where(and(eq(deals.creatorId, ctx.creatorId), isNull(deals.deletedAt)));

      const stageAgg = new Map<string, { count: number; valueCents: number }>();
      for (const row of dealRows) {
        const agg = stageAgg.get(row.stage) ?? { count: 0, valueCents: 0 };
        agg.count += 1;
        agg.valueCents += row.valueCents;
        stageAgg.set(row.stage, agg);
      }
      const pipeline = dealStages.map((stage) => {
        const agg = stageAgg.get(stage);
        return {
          stage,
          count: agg?.count ?? 0,
          valueCents: agg?.valueCents ?? 0,
        };
      });

      // ── Deliverables due this week (creator-wide, scoped through deals) ──
      const weekStart = startOfUtcWeek(now);
      const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS);
      const delRows = await ctx.db
        .select({
          id: deliverables.id,
          title: deliverables.title,
          platform: deliverables.platform,
          status: deliverables.status,
          dueAt: deliverables.dueAt,
          dueLabel: deliverables.dueLabel,
          progressDone: deliverables.progressDone,
          progressTotal: deliverables.progressTotal,
          position: deliverables.position,
          dealId: deals.id,
          dealTitle: deals.title,
          brandName: brands.name,
        })
        .from(deliverables)
        .innerJoin(deals, eq(deliverables.dealId, deals.id))
        .leftJoin(brands, eq(deals.brandId, brands.id))
        .where(
          and(
            eq(deals.creatorId, ctx.creatorId),
            isNull(deals.deletedAt),
            isNotNull(deliverables.dueAt),
            gte(deliverables.dueAt, weekStart),
            lt(deliverables.dueAt, weekEnd),
            ne(deliverables.status, "done")
          )
        )
        .orderBy(deliverables.dueAt, deliverables.position);

      const deliverablesDue = delRows.map((r) => ({
        id: r.id,
        title: r.title,
        platform: r.platform,
        status: r.status,
        dueAt: r.dueAt,
        dueLabel: r.dueLabel,
        progressDone: r.progressDone,
        progressTotal: r.progressTotal,
        dealId: r.dealId,
        dealTitle: r.dealTitle,
        brandName: r.brandName,
      }));

      // ── Overdue open invoices, ordered by due date (most urgent first) ──
      const overdueRows = await ctx.db
        .select({
          id: invoices.id,
          number: invoices.number,
          title: invoices.title,
          amountCents: invoices.amountCents,
          dueAt: invoices.dueAt,
          dealId: deals.id,
          dealTitle: deals.title,
          brandName: brands.name,
          chase: invoiceChaseState,
        })
        .from(invoices)
        .leftJoin(deals, eq(invoices.dealId, deals.id))
        .leftJoin(brands, eq(deals.brandId, brands.id))
        .leftJoin(invoiceChaseState, eq(invoiceChaseState.invoiceId, invoices.id))
        .where(
          and(
            eq(invoices.creatorId, ctx.creatorId),
            eq(invoices.status, "open"),
            isNotNull(invoices.dueAt),
            lt(invoices.dueAt, now)
          )
        )
        .orderBy(invoices.dueAt);

      const overdueTotalCents = overdueRows.reduce((sum, r) => sum + r.amountCents, 0);

      const mostUrgentRow = overdueRows[0] ?? null;
      const mostUrgent = mostUrgentRow && mostUrgentRow.dueAt
        ? {
            id: mostUrgentRow.id,
            number: mostUrgentRow.number,
            title: mostUrgentRow.title,
            amountCents: mostUrgentRow.amountCents,
            dueAt: mostUrgentRow.dueAt,
            dueAgeDays: Math.floor((now.getTime() - mostUrgentRow.dueAt.getTime()) / DAY_MS),
            dealId: mostUrgentRow.dealId,
            dealTitle: mostUrgentRow.dealTitle,
            brandName: mostUrgentRow.brandName,
            chase: mostUrgentRow.chase
              ? {
                  mode: mostUrgentRow.chase.mode,
                  nextStep: mostUrgentRow.chase.nextStep,
                  nextActionAt: mostUrgentRow.chase.nextActionAt,
                  pausedReason: mostUrgentRow.chase.pausedReason,
                }
              : null,
          }
        : null;

      return {
        revenue: {
          period,
          periodStart,
          periodEnd,
          totalCents,
          byType,
          monthly,
        },
        pipeline,
        deliverablesDue,
        overdue: {
          count: overdueRows.length,
          totalCents: overdueTotalCents,
          mostUrgent,
        },
      };
    }),
});
