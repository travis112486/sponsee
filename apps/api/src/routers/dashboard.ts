import { z } from "zod";
import { createTRPCRouter, creatorScopedProcedure } from "../trpc.js";
import { and, eq, isNull, isNotNull, gte, lt, ne } from "drizzle-orm";
import {
  creators,
  deals,
  brands,
  invoices,
  deliverables,
  invoiceChaseState,
} from "@sponsee/db/schema";
import { dealStages } from "@sponsee/shared";
import {
  addZonedMonths,
  formatMonthKey,
  getZonedParts,
  resolveTimeZone,
  startOfZonedMonth,
  startOfZonedMonthOffset,
  startOfZonedQuarter,
  startOfZonedQuarterOffset,
  startOfZonedWeek,
  startOfZonedWeekOffset,
  startOfZonedYear,
  zonedMonthKey,
} from "../zoned-time.js";

const DAY_MS = 24 * 60 * 60 * 1000;

type DealType = "flat" | "bounty" | "hybrid";

// ── Period helpers ──
//
// Every boundary below is a *creator-local* calendar boundary, read from
// `creators.timezone`. Sponsee's creators are US-centric, so UTC runs 4-8 hours
// ahead of their day: an invoice paid 2026-03-01T01:30:00Z is Feb 28 8:30pm in
// New York, and the creator's bank statement says February. Attributing it to
// March is a wrong number on the product's core promise.

function periodBounds(
  period: "month" | "quarter" | "ytd",
  now: Date,
  timeZone: string
): { start: Date; end: Date } {
  // The end is the *next civil period's* start, not the resolved start shifted
  // forward: shifting preserves the start's local time of day, which is 01:00
  // rather than 00:00 whenever a spring-forward opens at midnight, and that
  // overruns the next period's start by the gap width (SPO-251). Deriving both
  // sides from the civil calendar makes `end(P) === start(P+1)` hold by
  // construction, so the half-open filter below cannot double-count.
  if (period === "month") {
    return {
      start: startOfZonedMonth(now, timeZone),
      end: startOfZonedMonthOffset(now, 1, timeZone),
    };
  }
  if (period === "quarter") {
    return {
      start: startOfZonedQuarter(now, timeZone),
      end: startOfZonedQuarterOffset(now, 1, timeZone),
    };
  }
  // YTD: Jan 1 local through `now` (revenue is attributed to a recorded paid
  // date, so there is never a paidAt in the future to exclude).
  return { start: startOfZonedYear(now, timeZone), end: new Date(now) };
}

// The like-for-like comparison window for the revenue delta chip: the *same
// elapsed offset* into the immediately preceding period of the same type.
//
// `totalCents` is always period-to-date — `periodBounds` opens at the period
// start, but a paidAt can never be in the future, so month/quarter revenue is
// implicitly truncated at `now`. To keep the delta honest, the prior window is
// truncated the same way: prior month/quarter end at `now` shifted back one
// month / three months (the YTD branch already did this), never at the prior
// period's full-width end. Comparing 18 days of March against all 28 of
// February would manufacture a fake negative on every creator at a steady pace.
// All boundaries are creator-local, matching `periodBounds`.
function previousPeriodBounds(
  period: "month" | "quarter" | "ytd",
  now: Date,
  timeZone: string
): { start: Date; end: Date } {
  if (period === "month") {
    return {
      start: startOfZonedMonthOffset(now, -1, timeZone),
      end: addZonedMonths(now, -1, timeZone),
    };
  }
  if (period === "quarter") {
    return {
      start: startOfZonedQuarterOffset(now, -1, timeZone),
      end: addZonedMonths(now, -3, timeZone),
    };
  }
  const end = addZonedMonths(now, -12, timeZone);
  return { start: startOfZonedYear(end, timeZone), end };
}

export const dashboardRouter = createTRPCRouter({
  overview: creatorScopedProcedure
    .input(
      z
        .object({
          period: z.enum(["month", "quarter", "ytd"]).default("month"),
          // Injectable for deterministic tests and end-of-day reconciliation;
          // defaults to server time. Accepted as an ISO datetime string, i.e. an
          // unambiguous instant — which calendar day that instant falls on is
          // then decided by the creator's timezone, not by the wire format.
          now: z.string().datetime().optional(),
        })
        .default({})
    )
    .query(async ({ ctx, input }) => {
      const now = input.now ? new Date(input.now) : new Date();
      const period = input.period;

      // Every calendar boundary in this handler is computed in this zone.
      const [creatorRow] = await ctx.db
        .select({ timezone: creators.timezone })
        .from(creators)
        .where(eq(creators.id, ctx.creatorId))
        .limit(1);
      const timeZone = resolveTimeZone(creatorRow?.timezone);

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

      // Belt-and-braces, not load-bearing: migration 0013 (invoices_paid_requires_paid_at)
      // makes status='paid' with paid_at null unrepresentable in the DB. Kept because
      // the Drizzle column type is still nullable.
      const attributed = paidRows
        .filter((r): r is { amountCents: number; paidAt: Date; dealType: DealType | null } => r.paidAt != null);

      const { start: periodStart, end: periodEnd } = periodBounds(period, now, timeZone);

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

      // Prior-period revenue for the delta chip, over the same elapsed offset
      // of the preceding period. `null` (not 0) when that window has no paid
      // invoice at all, so the UI can suppress the chip instead of rendering a
      // fake +100%.
      const { start: prevStart, end: prevEnd } = previousPeriodBounds(period, now, timeZone);
      let previousTotalCents: number | null = null;
      for (const row of attributed) {
        if (row.paidAt >= prevStart && row.paidAt < prevEnd) {
          previousTotalCents = (previousTotalCents ?? 0) + row.amountCents;
        }
      }

      // Trailing-12-month series (stable chart shape), split by deal type.
      // Keys are creator-local calendar months, generated by civil arithmetic so
      // the series never gains or drops a month across a DST transition.
      const nowLocal = getZonedParts(now, timeZone);
      const buckets = new Map<string, { valueCents: number; flatCents: number; bountyCents: number; hybridCents: number }>();
      for (let i = 11; i >= 0; i--) {
        buckets.set(formatMonthKey(nowLocal.year, nowLocal.month - i), {
          valueCents: 0,
          flatCents: 0,
          bountyCents: 0,
          hybridCents: 0,
        });
      }
      for (const row of attributed) {
        const bucket = buckets.get(zonedMonthKey(row.paidAt, timeZone));
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
      // Monday 00:00 creator-local. The end is next Monday's *civil* start, not
      // this week's start shifted by 7 days: a spring-forward week is 167 hours
      // long and a fall-back week is 169, and a week that opens in a midnight
      // gap starts at 01:00 local, which a +7d shift would carry forward
      // (SPO-251).
      const weekStart = startOfZonedWeek(now, timeZone);
      const weekEnd = startOfZonedWeekOffset(now, 1, timeZone);
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

      // ── Outstanding open invoices (every open invoice, regardless of dueAt) ──
      const outstandingRows = await ctx.db
        .select({ amountCents: invoices.amountCents })
        .from(invoices)
        .where(and(eq(invoices.creatorId, ctx.creatorId), eq(invoices.status, "open")));

      const outstandingTotalCents = outstandingRows.reduce((sum, r) => sum + r.amountCents, 0);

      return {
        // The zone every boundary above was computed in. Additive to the
        // SPO-233 contract; the client needs it to label a month truthfully
        // (and to avoid re-deriving a local month from `periodStart`).
        timeZone,
        revenue: {
          period,
          periodStart,
          periodEnd,
          totalCents,
          previousTotalCents,
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
        outstanding: {
          count: outstandingRows.length,
          totalCents: outstandingTotalCents,
        },
      };
    }),
});
