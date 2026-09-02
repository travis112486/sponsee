import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
  AlarmClock,
  ArrowRight,
  Banknote,
  CalendarDays,
  CheckCircle2,
  Eye,
  FileText,
  Inbox,
  Loader2,
  MoveRight,
  Plus,
  StickyNote,
  RefreshCw,
  Send,
} from "lucide-react";
import { stageLabels, type DealStage, type Platform } from "@sponsee/shared";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@sponsee/api/routers";

import { trpc } from "@/trpc";
import QueryError from "@/components/QueryError";
import { Skeleton } from "@/components/Skeleton";
import { StatCard } from "@/components/shared/StatCard";
import { StatusChip } from "@/components/shared/StatusChip";
import { BrandMark } from "@/components/shared/BrandMark";
import { PlatformDot } from "@/components/shared/PlatformDot";
import { describeActivity } from "@/lib/activity-label";
import { useCreatorIdentity } from "@/lib/use-creator-identity";
import { motion, DURATION, EASE, STAGGER, entrance, prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { RevenueChart } from "./dashboard/RevenueChart";
import {
  addMonthsToKey,
  formatCents,
  formatDueChip,
  formatExactTime,
  formatRelativeTime,
  zonedMonthKey,
  zonedMonthShort,
} from "./dashboard/format";

type Period = "month" | "quarter";

/**
 * The `dashboard.overview` payload, inferred from the router rather than
 * re-declared here. A hand-written mirror is how the client/server schema
 * parity traps happen: the section components below would keep compiling
 * against a shape the API no longer returns.
 *
 * Type-only import — erased at build, so this adds no runtime dependency from
 * the web bundle onto `@sponsee/api`.
 */
type Overview = inferRouterOutputs<AppRouter>["dashboard"]["overview"];

/* ─────────────────────────── Period comparison ─────────────────────────── */

/**
 * Previous-period revenue, summed out of the server's own trailing-12-month
 * buckets.
 *
 * This is a rollup of authoritative data, not a second definition of revenue:
 * the buckets are calendar months attributed by `paidAt` on the API, and the
 * previous calendar month / quarter is exactly a subset of them. Returns `null`
 * when the comparison window falls outside the twelve buckets, so the card
 * shows no delta rather than an invented one.
 *
 * Keyed in the creator's zone (SPO-239): the buckets are creator-local months,
 * so a UTC-derived key silently selects the wrong one for every creator east of
 * UTC — comparing September against July and reporting the result as "last
 * month".
 */
function previousPeriodCents(
  revenue: Overview["revenue"],
  timeZone: string
): number | null {
  const span = revenue.period === "quarter" ? 3 : 1;
  const byKey = new Map(revenue.monthly.map((m) => [m.month, m.valueCents]));
  const currentKey = zonedMonthKey(new Date(revenue.periodStart), timeZone);

  let sum = 0;
  for (let i = span; i >= 1; i--) {
    const cents = byKey.get(addMonthsToKey(currentKey, -i));
    if (cents === undefined) return null;
    sum += cents;
  }
  return sum;
}

function revenueDelta(revenue: Overview["revenue"], timeZone: string) {
  const prev = previousPeriodCents(revenue, timeZone);
  // A percentage change from zero is undefined, not "+100%".
  if (prev === null || prev === 0) return undefined;
  const pct = Math.round(((revenue.totalCents - prev) / prev) * 100);
  if (pct === 0) return { text: "flat", tone: "neutral" as const, prev };
  return {
    text: `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}%`,
    tone: (pct > 0 ? "accent" : "danger") as "accent" | "danger",
    prev,
  };
}

/* ───────────────────────────── Section: greeting ───────────────────────── */

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function Greeting({
  name,
  subline,
  period,
  onPeriodChange,
}: {
  name: string | null;
  subline: string;
  period: Period;
  onPeriodChange: (p: Period) => void;
}) {
  const navigate = useNavigate();
  const reduced = prefersReducedMotion();
  const words = `${greetingFor(new Date().getHours())}${name ? `, ${name}` : ""}`.split(
    " "
  );

  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h2 className="font-serif text-[28px] leading-tight text-ink sm:text-[34px]">
          {words.map((w, i) => (
            <span
              key={`${w}-${i}`}
              className="inline-block overflow-hidden pb-1 align-bottom"
            >
              <motion.span
                className="inline-block"
                initial={reduced ? false : { y: 14, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{
                  duration: DURATION.entrance,
                  delay: reduced ? 0 : i * STAGGER.tight,
                  ease: EASE,
                }}
              >
                {w}
                {i < words.length - 1 ? " " : ""}
              </motion.span>
            </span>
          ))}
        </h2>
        <p className="mt-1 text-[13px] text-ink-2">{subline}</p>
      </div>

      <motion.div className="flex items-center gap-3" {...entrance(0, { delay: 0.12 })}>
        <div
          role="group"
          aria-label="Reporting period"
          className="flex rounded-lg border border-hairline bg-surface p-0.5"
        >
          {(["month", "quarter"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPeriodChange(p)}
              aria-pressed={period === p}
              className={cn(
                "rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-pine/40",
                period === p ? "bg-pine text-white" : "text-ink-2 hover:text-ink"
              )}
            >
              {p === "month" ? "This month" : "This quarter"}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => navigate("/pipeline?new=1")}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-pine px-3.5 text-[13px] font-medium text-white transition-all duration-150 hover:bg-pine-hover active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-pine/40 focus-visible:ring-offset-2"
        >
          <Plus className="h-4 w-4" aria-hidden /> Log a deal
        </button>
      </motion.div>
    </header>
  );
}

/* ─────────────────────────── Section: overdue alert ────────────────────── */

function describeChase(chase: NonNullable<Overview["overdue"]["mostUrgent"]>["chase"], now: Date) {
  if (!chase) return "No chase sequence has started on this invoice yet.";
  if (chase.mode === "paused") {
    return chase.pausedReason
      ? `Chasing is paused — ${chase.pausedReason}.`
      : "Chasing is paused.";
  }
  if (chase.mode === "completed") return "The chase sequence has run out of steps.";
  if (chase.nextActionAt) {
    const at = new Date(chase.nextActionAt);
    return at.getTime() > now.getTime()
      ? `Chase step ${chase.nextStep} goes out ${formatExactTime(at)}.`
      : `Chase step ${chase.nextStep} is queued to send.`;
  }
  return `Chasing is armed at step ${chase.nextStep}.`;
}

function OverdueAlert({
  invoice,
  count,
  totalCents,
  now,
}: {
  invoice: NonNullable<Overview["overdue"]["mostUrgent"]>;
  count: number;
  totalCents: number;
  now: Date;
}) {
  const navigate = useNavigate();
  const who = invoice.brandName ?? invoice.dealTitle ?? invoice.title ?? "an unnamed invoice";
  const days = Math.max(invoice.dueAgeDays, 0);

  return (
    <motion.section
      aria-label="Overdue invoice"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brick/20 border-l-[3px] border-l-brick bg-brick-tint/50 px-4 py-3"
      {...entrance(0, { delay: 0.08, y: -8 })}
    >
      <div className="flex min-w-0 items-start gap-2.5 text-[13.5px] text-ink">
        <AlarmClock className="mt-0.5 h-4 w-4 shrink-0 text-brick" aria-hidden />
        <p className="min-w-0">
          <strong className="font-semibold">
            <span className="tnum font-mono">{formatCents(invoice.amountCents)}</span> from{" "}
            {who} is {days} {days === 1 ? "day" : "days"} overdue
            {invoice.number ? ` (${invoice.number})` : ""}.
          </strong>{" "}
          <span className="text-ink-2">{describeChase(invoice.chase, now)}</span>
          {count > 1 && (
            <span className="text-ink-2">
              {" "}
              {count - 1} other overdue {count - 1 === 1 ? "invoice" : "invoices"} —{" "}
              <span className="tnum font-mono">{formatCents(totalCents)}</span> at risk in
              total.
            </span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {invoice.dealId && (
          <button
            type="button"
            onClick={() => navigate(`/pipeline/${invoice.dealId}`)}
            className="flex h-8 items-center gap-1 rounded-lg px-3 text-[12.5px] font-medium text-ink-2 transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-pine/40"
          >
            Open the deal <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={() => navigate("/payments")}
          className="h-8 rounded-lg border border-hairline bg-surface px-3 text-[12.5px] font-medium text-ink transition-all duration-150 hover:border-ink-3/40 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-pine/40"
        >
          Review chase timeline
        </button>
      </div>
    </motion.section>
  );
}

/* ────────────────────────────── Section: KPI row ───────────────────────── */

function KpiRow({ overview, now }: { overview: Overview; now: Date }) {
  const navigate = useNavigate();
  const { revenue, pipeline, deliverablesDue, outstanding, timeZone } = overview;

  const isMonth = revenue.period === "month";
  // The creator's zone, not UTC and not the browser's: `periodStart` is the
  // instant their local month began, so any other zone can name the month
  // before the one this card is reporting (SPO-239).
  const periodName = zonedMonthShort(new Date(revenue.periodStart), timeZone);
  const delta = revenueDelta(revenue, timeZone);
  const spark = revenue.monthly.slice(-6).map((m) => m.valueCents / 100);

  const stageCount = (s: DealStage) =>
    pipeline.find((p) => p.stage === s)?.count ?? 0;
  const activeDeals = pipeline
    .filter((p) => p.stage !== "paid")
    .reduce((s, p) => s + p.count, 0);
  const activeContext =
    [
      stageCount("negotiating") && `${stageCount("negotiating")} negotiating`,
      stageCount("live") && `${stageCount("live")} live`,
    ]
      .filter(Boolean)
      .join(", ") || "nothing in flight";

  const nextDue = deliverablesDue[0];

  // ── Pending API integration ────────────────────────────────────────────
  //  · SPO-197 landed `deals.cpvhSummary` on the API, but wiring it into this
  //    screen is a separate owned lane (SPO-235 follow-up). Until that merges
  //    the card renders its founder-ratified `null` state — which is also what
  //    a creator with no CCV/duration on any deal sees, so this is the real
  //    empty state and not a placeholder.
  const effectiveCpvh: number | null = null;

  return (
    // Five cards: 5/3/2/1 columns (SPO-237). At the 2-col range CPVH spans the
    // full last row so the fifth card is a deliberate wide card, not a stranded
    // half-width orphan; 3-col ends 3 + 2, which is a short row, not an orphan.
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <StatCard
        index={0}
        eyebrow={`Revenue (${isMonth ? periodName : "this quarter"})`}
        value={revenue.totalCents / 100}
        currency
        delta={delta && { text: delta.text, tone: delta.tone }}
        context={
          delta
            ? `vs ${formatCents(delta.prev)} ${isMonth ? "last month" : "last quarter"}`
            : "Paid invoices, dated by when the money landed"
        }
        sparkline={spark.length >= 2 ? spark : undefined}
      />
      {/* Every OPEN invoice regardless of due date — a strict superset of the
          overdue alert below, so it is not `overdue.totalCents`. `0` is a real
          balance and renders as money; only `null` (which the contract cannot
          send here) would mean "unknown". No delta: the contract exposes no
          prior-period window for this figure (SPO-237). */}
      <StatCard
        index={1}
        eyebrow="Outstanding"
        value={outstanding.totalCents / 100}
        currency
        context="All open invoices"
        onClick={() => navigate("/payments")}
      />
      <StatCard
        index={2}
        eyebrow="Active deals"
        value={activeDeals}
        context={activeContext}
        onClick={() => navigate("/pipeline")}
      />
      <StatCard
        index={3}
        eyebrow="Due this week"
        value={deliverablesDue.length}
        delta={{ text: "deliverables", tone: "neutral" }}
        context={
          nextDue
            ? `next: ${formatDueChip(nextDue.dueAt, nextDue.dueLabel, now)} · ${nextDue.title}`
            : "nothing due before Monday"
        }
        onClick={() => navigate("/calendar")}
      />
      <StatCard
        index={4}
        className="sm:col-span-2 lg:col-span-1"
        eyebrow="Effective CPVH"
        value={effectiveCpvh}
        currency
        decimals={2}
        emptyLabel="Not enough data yet"
        context="Add concurrent viewers and sponsored minutes to a deal"
        onClick={() => navigate("/calculator")}
      />
    </div>
  );
}

/* ──────────────────────── Section: deliverables due ────────────────────── */

function DeliverablesCard({
  items,
  now,
  className,
}: {
  items: Overview["deliverablesDue"];
  now: Date;
  className?: string;
}) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const markDone = trpc.deliverable.update.useMutation({
    onSuccess: () => {
      // The checked row leaves this list (the API excludes `done`), and the
      // "Due this week" KPI counts the same rows, so both come from one refetch.
      utils.dashboard.overview.invalidate();
      utils.deals.list.invalidate();
      utils.activity.list.invalidate();
      toast.success("Marked done");
    },
    onError: (err) => toast.error(err.message || "Couldn't update that deliverable."),
    onSettled: () => setPendingId(null),
  });

  return (
    <section
      className={cn(
        "rounded-xl border border-hairline bg-surface p-5 shadow-warm",
        className
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[14px] font-semibold text-ink">Deliverables due this week</h3>
        <span className="text-[11px] text-ink-3">
          {items.length === 0
            ? "all clear"
            : `${items.length} open`}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-1 py-8 text-center">
          <CheckCircle2 className="h-5 w-5 text-ink-3" aria-hidden />
          <p className="text-[13px] font-medium text-ink-2">Nothing due this week</p>
          <p className="text-[12px] text-ink-3">
            Deliverables with a due date between Monday and Sunday land here.
          </p>
        </div>
      ) : (
        <ul className="mt-3 space-y-0.5">
          {items.map((d, i) => {
            const isPending = pendingId === d.id;
            return (
              <motion.li
                key={d.id}
                className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-surface-subtle"
                {...entrance(i, { stagger: STAGGER.tight, delay: 0.1, y: 0 })}
              >
                <button
                  type="button"
                  onClick={() => {
                    setPendingId(d.id);
                    markDone.mutate({ id: d.id, status: "done" });
                  }}
                  disabled={isPending}
                  aria-label={`Mark ${d.title} done`}
                  aria-busy={isPending}
                  className={cn(
                    "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border border-ink-3/50 bg-surface transition-colors duration-150",
                    "hover:border-pine focus:outline-none focus-visible:ring-2 focus-visible:ring-pine/40 focus-visible:ring-offset-1",
                    isPending && "cursor-wait opacity-60"
                  )}
                >
                  {isPending && (
                    <Loader2 className="h-3 w-3 animate-spin text-ink-3" aria-hidden />
                  )}
                </button>

                {d.platform && <PlatformDot platform={d.platform as Platform} />}

                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                  {d.title}
                  {d.progressTotal != null && d.progressTotal > 0 && (
                    <span className="ml-1.5 text-[11px] text-ink-3">
                      ({d.progressDone ?? 0}/{d.progressTotal} done)
                    </span>
                  )}
                </span>

                {d.brandName && (
                  <span className="hidden shrink-0 items-center gap-1.5 text-[12.5px] text-ink-2 sm:flex">
                    <BrandMark brand={d.brandName} size={20} />
                    {d.brandName}
                  </span>
                )}

                <StatusChip
                  tone="quiet"
                  label={formatDueChip(d.dueAt, d.dueLabel, now)}
                  className="shrink-0 font-mono"
                />
              </motion.li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={() => navigate("/calendar")}
        className="mt-3 flex items-center gap-1 text-[12.5px] font-medium text-pine transition-colors hover:text-pine-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-pine/40"
      >
        Open full calendar <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </button>
    </section>
  );
}

/* ────────────────────── Section: pipeline snapshot ─────────────────────── */

const stageDot: Record<DealStage, string> = {
  inbound: "bg-ink-3",
  negotiating: "bg-amber",
  contract_sent: "bg-ink",
  live: "bg-pine",
  delivered: "bg-ink-2",
  paid: "bg-pine",
};

function PipelineSnapshot({
  pipeline,
  className,
}: {
  pipeline: Overview["pipeline"];
  className?: string;
}) {
  const navigate = useNavigate();
  const reduced = prefersReducedMotion();
  const max = Math.max(...pipeline.map((s) => s.valueCents), 0);
  // "Total pipeline" is money still in flight, so a paid deal is no longer in
  // it — that is what makes this different from lifetime revenue.
  const total = pipeline
    .filter((s) => s.stage !== "paid")
    .reduce((s, p) => s + p.valueCents, 0);
  const isEmpty = pipeline.every((s) => s.count === 0);

  return (
    <section
      className={cn(
        "flex flex-col rounded-xl border border-hairline bg-surface p-5 shadow-warm",
        className
      )}
    >
      <h3 className="text-[14px] font-semibold text-ink">Pipeline snapshot</h3>

      {isEmpty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 py-8 text-center">
          <Inbox className="h-5 w-5 text-ink-3" aria-hidden />
          <p className="text-[13px] font-medium text-ink-2">No deals yet</p>
          <button
            type="button"
            onClick={() => navigate("/pipeline?new=1")}
            className="mt-1 text-[12.5px] font-medium text-pine hover:text-pine-hover"
          >
            Log your first deal
          </button>
        </div>
      ) : (
        <ul className="mt-3 flex-1 space-y-2.5">
          {pipeline.map((s, i) => (
            <li key={s.stage} className="flex items-center gap-2.5">
              <span
                className={cn("h-2 w-2 shrink-0 rounded-full", stageDot[s.stage])}
                aria-hidden
              />
              <span className="w-28 shrink-0 text-[12.5px] text-ink-2">
                {stageLabels[s.stage]} <span className="text-ink-3">· {s.count}</span>
              </span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-hairline/60">
                <motion.span
                  className="block h-full rounded-full bg-pine/70"
                  style={{ transformOrigin: "left" }}
                  initial={reduced ? false : { scaleX: 0 }}
                  animate={{ scaleX: max === 0 ? 0 : s.valueCents / max }}
                  transition={{
                    duration: DURATION.grow,
                    delay: reduced ? 0 : i * STAGGER.tight,
                    ease: EASE,
                  }}
                />
              </span>
              <span className="tnum w-16 shrink-0 text-right font-mono text-[12px] font-medium text-ink">
                {formatCents(s.valueCents)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-hairline pt-3">
        <span className="text-[12.5px] text-ink-2">
          Total pipeline{" "}
          <span className="tnum font-mono font-semibold text-ink">
            {formatCents(total)}
          </span>
        </span>
        <button
          type="button"
          onClick={() => navigate("/pipeline")}
          className="flex items-center gap-1 text-[12.5px] font-medium text-pine transition-colors hover:text-pine-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-pine/40"
        >
          Open board <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </section>
  );
}

/* ────────────────────────── Section: recent activity ───────────────────── */

/**
 * One icon per `activity_kind`. Keyed as a total record off the DB enum, so
 * adding a tenth kind reds this file instead of silently falling back to the
 * single generic Mail icon the shipped feed used for all nine.
 */
const activityIcon = {
  invoice: FileText,
  contract: Eye,
  deliverable: CheckCircle2,
  payment: Banknote,
  inquiry: Inbox,
  stage_change: MoveRight,
  chase_sent: Send,
  note: StickyNote,
  platform_sync: RefreshCw,
} as const;

type ActivityKind = keyof typeof activityIcon;

function ActivityCard({
  events,
  isLoading,
  isError,
  onRetry,
  now,
}: {
  events: { id: string; kind: string; actor: string; payload: unknown; createdAt: Date | string }[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  now: Date;
}) {
  return (
    <section className="rounded-xl border border-hairline bg-surface p-5 shadow-warm">
      <h3 className="flex items-center gap-2 text-[14px] font-semibold text-ink">
        <CalendarDays className="h-4 w-4 text-ink-3" aria-hidden /> Recent activity
      </h3>

      {isLoading ? (
        <div className="mt-2 space-y-3 pt-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-7 w-7 rounded-full" />
              <Skeleton className="h-3 flex-1" />
              <Skeleton className="h-3 w-10" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="flex items-center justify-between gap-3 pt-3">
          <p className="text-[13px] text-ink-2">Couldn't load recent activity.</p>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg border border-hairline px-2.5 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:bg-surface-subtle"
          >
            Retry
          </button>
        </div>
      ) : events.length === 0 ? (
        <p className="pt-3 text-[13px] text-ink-3">
          Nothing has happened yet. Chases, payments and signed contracts show up here.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-hairline">
          {events.map((e, i) => {
            const Icon = activityIcon[e.kind as ActivityKind] ?? FileText;
            return (
              <motion.li
                key={e.id}
                className="flex items-center gap-3 py-2.5"
                {...entrance(i, { stagger: STAGGER.tight, delay: 0.1, y: 0 })}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-subtle">
                  <Icon className="h-3.5 w-3.5 text-ink-2" aria-hidden />
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">
                  {describeActivity(e.actor, e.payload)}
                </span>
                <time
                  dateTime={new Date(e.createdAt).toISOString()}
                  title={formatExactTime(e.createdAt)}
                  className="shrink-0 font-mono text-[11px] text-ink-3"
                >
                  {formatRelativeTime(e.createdAt, now)}
                </time>
              </motion.li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ──────────────────────────────── Loading ──────────────────────────────── */

function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading your dashboard">
      <div className="flex items-end justify-between gap-4">
        <div>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="mt-2 h-3 w-80" />
        </div>
        <Skeleton className="h-9 w-56" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={cn(
              "rounded-xl border border-hairline bg-surface p-5",
              // Mirrors the loaded row's CPVH span so settling doesn't reflow.
              i === 4 && "sm:col-span-2 lg:col-span-1"
            )}
          >
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-7 w-28" />
            <Skeleton className="mt-3 h-3 w-32" />
          </div>
        ))}
      </div>
      <Skeleton className="h-[300px] w-full rounded-xl" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Skeleton className="h-64 w-full rounded-xl lg:col-span-7" />
        <Skeleton className="h-64 w-full rounded-xl lg:col-span-5" />
      </div>
    </div>
  );
}

/* ───────────────────────────────── Page ────────────────────────────────── */

export default function Dashboard() {
  const [period, setPeriod] = useState<Period>("month");
  const { name } = useCreatorIdentity();

  const overviewQuery = trpc.dashboard.overview.useQuery({ period });
  const activityQuery = trpc.activity.list.useQuery({ limit: 8 });

  // One clock for the whole render pass, so the due chips, the relative
  // timestamps and the overdue copy cannot disagree by a tick.
  const now = new Date();

  if (overviewQuery.isLoading) return <DashboardSkeleton />;

  if (overviewQuery.isError || !overviewQuery.data) {
    return (
      <QueryError
        message="Couldn't load your dashboard."
        onRetry={() => overviewQuery.refetch()}
      />
    );
  }

  const overview = overviewQuery.data;
  const { revenue, pipeline, deliverablesDue, overdue } = overview;

  const dateLine = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const dueLine =
    deliverablesDue.length === 0
      ? "nothing due this week"
      : `${deliverablesDue.length} deliverable${deliverablesDue.length === 1 ? "" : "s"} due this week`;
  const moneyLine =
    overdue.count > 0
      ? ` · ${formatCents(overdue.totalCents)} overdue`
      : revenue.totalCents > 0
        ? ` · ${formatCents(revenue.totalCents)} in ${period === "month" ? "this month" : "this quarter"}`
        : "";

  return (
    <div className="space-y-4">
      <Greeting
        name={name}
        subline={`${dateLine} · ${dueLine}${moneyLine}`}
        period={period}
        onPeriodChange={setPeriod}
      />

      {/* Money at risk reads before operational detail (P-01). */}
      {overdue.mostUrgent && (
        <OverdueAlert
          invoice={overdue.mostUrgent}
          count={overdue.count}
          totalCents={overdue.totalCents}
          now={now}
        />
      )}

      <KpiRow overview={overview} now={now} />

      <RevenueChart months={revenue.monthly} />

      {/* 7/5 on desktop, stacked below it — the checklist is the wider read. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <DeliverablesCard
          items={deliverablesDue}
          now={now}
          className="lg:col-span-7"
        />
        <PipelineSnapshot pipeline={pipeline} className="lg:col-span-5" />
      </div>

      <ActivityCard
        events={activityQuery.data ?? []}
        isLoading={activityQuery.isLoading}
        isError={activityQuery.isError}
        onRetry={() => activityQuery.refetch()}
        now={now}
      />
    </div>
  );
}
