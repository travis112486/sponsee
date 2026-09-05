import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/trpc";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  AlertCircle,
  CheckCircle2,
  FileText,
} from "lucide-react";
import QueryError from "@/components/QueryError";
import { Skeleton } from "@/components/Skeleton";
// Status copy has one owner. StatusChip already keys `deliverableLabels` off
// the shared union, so the calendar borrows the words rather than restating
// them — this page having no label map at all is what let SPO-414 delete the
// scheduled/rescheduled distinction without failing anything.
import { deliverableLabels } from "@/components/shared/StatusChip";
import { deliverableStatusColors, deliverableStatusDot } from "@/lib/deliverable-status";
import type { DeliverableStatus } from "@sponsee/shared";

/* ── helpers ─────────────────────────────────────────────────────── */

const WEEK_DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatMonthYear(d: Date) {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function formatShortDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatCents(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/* ── status styling ──────────────────────────────────────────────── */

type CalendarEventType = "deliverable" | "invoice" | "deal_stage";

interface CalendarEvent {
  type: CalendarEventType;
  id: string;
  date: Date;
  title: string;
  status?: string;
  dealId?: string;
  dealTitle?: string;
  stage?: string;
  brandName?: string | null;
  amountCents?: number;
  currency?: string;
}

// All six statuses, not the three that happened to be common. An incomplete
// legend is part of what let this page ship status as colour alone.
const legendItems = (
  ["done", "in_progress", "scheduled", "rescheduled", "missed", "not_started"] as const
).map((status) => ({
  label: deliverableLabels[status],
  dot: deliverableStatusDot[status],
}));

/* ── sub-components ──────────────────────────────────────────────── */

function CalendarSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-32" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-8 w-8 rounded-lg" />
        </div>
      </div>
      <div className="grid grid-cols-7 gap-px rounded-xl border border-hairline bg-hairline overflow-hidden">
        {WEEK_DAYS.map((d) => (
          <div key={d} className="bg-surface-subtle px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            {d}
          </div>
        ))}
        {Array.from({ length: 35 }).map((_, i) => (
          <div key={i} className="bg-surface min-h-[100px] p-2">
            <Skeleton className="h-4 w-5" />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <CalendarDays className="h-8 w-8 text-ink-3" />
      <h3 className="mt-3 text-[15px] font-semibold text-ink">No calendar events</h3>
      <p className="mt-1 max-w-xs text-[13px] text-ink-3">
        Deliverable due dates and deal milestones will appear here once you add deals to your pipeline.
      </p>
    </div>
  );
}

/* ── main page ───────────────────────────────────────────────────── */

export default function CalendarPage() {
  const navigate = useNavigate();
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));

  const {
    data: rawEvents,
    isLoading,
    isError,
    refetch,
  } = trpc.calendar.events.useQuery({});

  const events: CalendarEvent[] = useMemo(() => {
    if (!rawEvents) return [];
    return rawEvents.map((e) => ({
      ...e,
      date: new Date(e.date),
    }));
  }, [rawEvents]);

  const goToPrevMonth = useCallback(() => {
    setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  }, []);

  const goToNextMonth = useCallback(() => {
    setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));
  }, []);

  const goToToday = useCallback(() => {
    setCurrentMonth(startOfMonth(new Date()));
  }, []);

  /* Build the month grid */
  const gridDays = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    const startDayOfWeek = start.getDay(); // 0 = Sunday
    const daysInMonth = end.getDate();

    const days: Array<{
      date: Date;
      isCurrentMonth: boolean;
      events: CalendarEvent[];
      isToday: boolean;
    }> = [];

    // Previous month padding
    const prevMonthEnd = new Date(start.getFullYear(), start.getMonth(), 0);
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const d = new Date(prevMonthEnd);
      d.setDate(prevMonthEnd.getDate() - i);
      days.push({ date: d, isCurrentMonth: false, events: [], isToday: isSameDay(d, new Date()) });
    }

    // Current month
    for (let i = 1; i <= daysInMonth; i++) {
      const d = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), i);
      const dayEvents = events.filter((e) => isSameDay(e.date, d));
      days.push({ date: d, isCurrentMonth: true, events: dayEvents, isToday: isSameDay(d, new Date()) });
    }

    // Next month padding to fill 6 rows (42 cells) or at least complete the last week
    const remaining = (7 - (days.length % 7)) % 7;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(end.getFullYear(), end.getMonth() + 1, i);
      days.push({ date: d, isCurrentMonth: false, events: [], isToday: isSameDay(d, new Date()) });
    }

    return days;
  }, [currentMonth, events]);

  /* Upcoming sidebar data */
  const upcoming = useMemo(() => {
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const upcomingDeliverables = events
      .filter((e): e is CalendarEvent & { type: "deliverable"; status: DeliverableStatus } =>
        e.type === "deliverable" && e.date >= now && e.date <= thirtyDaysFromNow && e.status !== "done"
      )
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .slice(0, 8);

    const overdueInvoices = events
      .filter((e): e is CalendarEvent & { type: "invoice" } =>
        e.type === "invoice" && e.date < now && e.status === "open"
      )
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    return { upcomingDeliverables, overdueInvoices };
  }, [events]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1200px]">
        <div className="mb-6">
          <h2 className="font-serif text-[19px] text-ink">Calendar</h2>
          <p className="mt-0.5 text-[13px] text-ink-3">Deliverable deadlines</p>
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
          <CalendarSkeleton />
          <div className="space-y-4">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-[1200px]">
        <div className="mb-6">
          <h2 className="font-serif text-[19px] text-ink">Calendar</h2>
          <p className="mt-0.5 text-[13px] text-ink-3">Deliverable deadlines</p>
        </div>
        <QueryError onRetry={refetch} />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="mx-auto max-w-[1200px]">
        <div className="mb-6">
          <h2 className="font-serif text-[19px] text-ink">Calendar</h2>
          <p className="mt-0.5 text-[13px] text-ink-3">Deliverable deadlines</p>
        </div>
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px]">
      {/* Header */}
      <div className="mb-6">
        <h2 className="font-serif text-[19px] text-ink">Calendar</h2>
        <p className="mt-0.5 text-[13px] text-ink-3">
          Deliverable deadlines — {formatMonthYear(currentMonth)}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        {/* ── Calendar grid ── */}
        <div className="space-y-3">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={goToPrevMonth}
                aria-label="Previous month"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-hairline text-ink-2 transition-colors hover:bg-surface-subtle"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={goToToday}
                className="rounded-lg border border-hairline px-3 py-1.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:bg-surface-subtle"
              >
                Today
              </button>
              <button
                onClick={goToNextMonth}
                aria-label="Next month"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-hairline text-ink-2 transition-colors hover:bg-surface-subtle"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <span className="ml-1 text-[14px] font-semibold text-ink">
                {formatMonthYear(currentMonth)}
              </span>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {legendItems.map((item) => (
                <div key={item.label} className="flex items-center gap-1.5">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", item.dot)} />
                  <span className="text-[11px] text-ink-3">{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Grid */}
          <div
            className="grid grid-cols-7 gap-px rounded-xl border border-hairline bg-hairline overflow-hidden"
            role="grid"
            aria-label={`Calendar for ${formatMonthYear(currentMonth)}`}
          >
            {/* Day headers */}
            {WEEK_DAYS.map((day) => (
              <div
                key={day}
                className="bg-surface-subtle px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-ink-3"
                role="columnheader"
              >
                {day}
              </div>
            ))}

            {/* Cells */}
            {gridDays.map((day, idx) => {
              const deliverables = day.events.filter((e) => e.type === "deliverable");
              const hasEvents = deliverables.length > 0;

              return (
                <div
                  key={idx}
                  role="gridcell"
                  aria-label={day.date.toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                  className={cn(
                    "bg-surface min-h-[100px] p-1.5 sm:p-2 transition-colors",
                    day.isCurrentMonth ? "text-ink" : "text-ink-3/60 bg-surface-subtle/50",
                    day.isToday && "ring-1 ring-inset ring-pine bg-pine-tint/30"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        "text-[13px] font-medium",
                        day.isToday && "flex h-6 w-6 items-center justify-center rounded-full bg-pine text-white"
                      )}
                    >
                      {day.date.getDate()}
                    </span>
                  </div>

                  {hasEvents && (
                    <div className="mt-1.5 space-y-1">
                      {deliverables.slice(0, 3).map((ev) => {
                        const status = ev.status as DeliverableStatus;
                        const statusLabel =
                          deliverableLabels[status] || deliverableLabels.not_started;
                        // A month cell has no room for a visible status word, so
                        // the chip's non-colour cue is its dashed border and the
                        // status rides in the accessible name and the tooltip.
                        const detail = `${ev.title}${ev.dealTitle ? ` — ${ev.dealTitle}` : ""} · ${statusLabel}`;
                        return (
                          <button
                            key={ev.id}
                            onClick={() => {
                              if (ev.dealId) navigate(`/pipeline/${ev.dealId}`);
                            }}
                            className={cn(
                              "flex w-full items-center gap-1 rounded border px-1.5 py-0.5 text-left text-[11px] font-medium transition-opacity hover:opacity-80",
                              deliverableStatusColors[status] || deliverableStatusColors.not_started
                            )}
                            title={detail}
                            aria-label={detail}
                          >
                            <span
                              className={cn(
                                "h-1.5 w-1.5 shrink-0 rounded-full",
                                deliverableStatusDot[status] || deliverableStatusDot.not_started
                              )}
                            />
                            <span className="truncate">{ev.title}</span>
                          </button>
                        );
                      })}
                      {deliverables.length > 3 && (
                        <p className="px-1.5 text-[10px] text-ink-3">
                          +{deliverables.length - 3} more
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Upcoming sidebar ── */}
        <aside className="space-y-5">
          {/* Upcoming deliverables */}
          <div className="rounded-xl border border-hairline bg-surface p-4">
            <h3 className="text-[13px] font-semibold text-ink">Upcoming</h3>

            {upcoming.upcomingDeliverables.length === 0 ? (
              <p className="mt-3 text-[12.5px] text-ink-3">No upcoming deliverables</p>
            ) : (
              <div className="mt-3 space-y-3">
                {upcoming.upcomingDeliverables.map((ev) => {
                  const status = ev.status as DeliverableStatus;
                  const isSoon =
                    ev.date.getTime() - new Date().getTime() < 3 * 24 * 60 * 60 * 1000;
                  return (
                    <button
                      key={ev.id}
                      onClick={() => {
                        if (ev.dealId) navigate(`/pipeline/${ev.dealId}`);
                      }}
                      className="flex w-full items-start gap-2.5 text-left transition-opacity hover:opacity-80"
                    >
                      <span
                        className={cn(
                          "mt-0.5 h-2 w-2 shrink-0 rounded-full",
                          deliverableStatusDot[status] || deliverableStatusDot.not_started
                        )}
                      />
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-medium text-ink truncate">{ev.title}</p>
                        <p className="text-[11px] text-ink-3 truncate">
                          {ev.dealTitle || "Unknown deal"}
                        </p>
                        <p
                          className={cn(
                            "text-[11px]",
                            isSoon ? "text-brick font-medium" : "text-ink-3"
                          )}
                        >
                          Due {formatShortDate(ev.date)}
                          {" · "}
                          {/* The status in words. Until now the dot beside this
                              row was the only place status appeared at all. */}
                          <span className="text-ink-3">
                            {deliverableLabels[status] ||
                              deliverableLabels.not_started}
                          </span>
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Overdue invoices */}
          {upcoming.overdueInvoices.length > 0 && (
            <div className="rounded-xl border border-brick/20 bg-brick-tint/40 p-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-brick" />
                <h3 className="text-[13px] font-semibold text-brick">
                  {upcoming.overdueInvoices.length} overdue invoice
                  {upcoming.overdueInvoices.length > 1 ? "s" : ""}
                </h3>
              </div>
              <div className="mt-3 space-y-3">
                {upcoming.overdueInvoices.map((inv) => (
                  <button
                    key={inv.id}
                    onClick={() => navigate("/payments")}
                    className="flex w-full items-start gap-2 text-left transition-opacity hover:opacity-80"
                  >
                    <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brick" />
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-medium text-ink truncate">
                        {inv.title || `Invoice`}
                      </p>
                      <p className="text-[11px] text-ink-3">
                        {inv.brandName || "Unknown brand"} ·{" "}
                        {inv.amountCents !== undefined ? formatCents(inv.amountCents) : ""}
                        {" · "}
                        {Math.floor(
                          (new Date().getTime() - inv.date.getTime()) / (1000 * 60 * 60 * 24)
                        )}{" "}
                        days overdue
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Deal stages this month */}
          <div className="rounded-xl border border-hairline bg-surface p-4">
            <h3 className="text-[13px] font-semibold text-ink">Deal milestones</h3>
            {(() => {
              const monthStages = events
                .filter(
                  (e): e is CalendarEvent & { type: "deal_stage" } =>
                    e.type === "deal_stage" &&
                    e.date.getMonth() === currentMonth.getMonth() &&
                    e.date.getFullYear() === currentMonth.getFullYear()
                )
                .sort((a, b) => b.date.getTime() - a.date.getTime())
                .slice(0, 6);

              if (monthStages.length === 0) {
                return (
                  <p className="mt-3 text-[12.5px] text-ink-3">No stage changes this month</p>
                );
              }

              return (
                <div className="mt-3 space-y-2.5">
                  {monthStages.map((ev) => (
                    <button
                      key={ev.id}
                      onClick={() => navigate(`/pipeline/${ev.id}`)}
                      className="flex w-full items-start gap-2 text-left transition-opacity hover:opacity-80"
                    >
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pine" />
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-medium text-ink truncate">{ev.title}</p>
                        <p className="text-[11px] text-ink-3">
                          Moved to {ev.stage} · {formatShortDate(ev.date)}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        </aside>
      </div>
    </div>
  );
}
