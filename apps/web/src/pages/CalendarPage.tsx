import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/trpc";
import { cn } from "@/lib/utils";
import QueryError from "@/components/QueryError";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  FileText,
  CheckSquare,
  KanbanSquare,
} from "lucide-react";

type CalendarEvent = {
  type: "deliverable" | "invoice" | "deal_stage";
  id: string;
  date: Date;
  title: string;
  status?: string;
  dealId?: string;
  dealTitle?: string;
  brandName?: string | null;
  amountCents?: number;
  currency?: string;
  stage?: string;
};

type ViewMode = "month" | "week";

/* ------------------------------------------------------------------ */
/*  Date helpers (native — no extra dependency)                       */
/* ------------------------------------------------------------------ */

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
}

function addDays(d: Date, n: number) {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + n);
  return nd;
}

function startOfWeek(d: Date) {
  const nd = new Date(d);
  const day = nd.getDay();
  nd.setDate(nd.getDate() - day);
  nd.setHours(0, 0, 0, 0);
  return nd;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isSameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function toYMD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthName(d: Date) {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function weekRangeLabel(start: Date, end: Date) {
  const sameMonth = start.getMonth() === end.getMonth();
  const s = start.toLocaleDateString("en-US", {
    month: sameMonth ? undefined : "short",
    day: "numeric",
  });
  const e = end.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${s} – ${e}`;
}

/* ------------------------------------------------------------------ */
/*  Event helpers                                                     */
/* ------------------------------------------------------------------ */

function eventColor(type: CalendarEvent["type"]) {
  switch (type) {
    case "deliverable":
      return "bg-pine";
    case "invoice":
      return "bg-amber";
    case "deal_stage":
      return "bg-ink-3";
  }
}

function eventLabel(type: CalendarEvent["type"]) {
  switch (type) {
    case "deliverable":
      return "Deliverable";
    case "invoice":
      return "Invoice";
    case "deal_stage":
      return "Stage change";
  }
}

function EventIcon({ type }: { type: CalendarEvent["type"] }) {
  switch (type) {
    case "deliverable":
      return <CheckSquare className="h-3.5 w-3.5 text-pine" />;
    case "invoice":
      return <FileText className="h-3.5 w-3.5 text-amber" />;
    case "deal_stage":
      return <KanbanSquare className="h-3.5 w-3.5 text-ink-3" />;
  }
}

/* ------------------------------------------------------------------ */
/*  CalendarPage                                                      */
/* ------------------------------------------------------------------ */

export default function CalendarPage() {
  const navigate = useNavigate();
  const [view, setView] = useState<ViewMode>("month");
  const [cursor, setCursor] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

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

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const key = toYMD(ev.date);
      const arr = map.get(key) ?? [];
      arr.push(ev);
      map.set(key, arr);
    }
    // sort each day's events by type then title
    for (const [, arr] of map) {
      arr.sort((a, b) => {
        const typeOrder =
          (t: CalendarEvent["type"]) =>
            ({ deliverable: 0, invoice: 1, deal_stage: 2 }[t]);
        const ta = typeOrder(a.type);
        const tb = typeOrder(b.type);
        if (ta !== tb) return ta - tb;
        return a.title.localeCompare(b.title);
      });
    }
    return map;
  }, [events]);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const goToday = useCallback(() => setCursor(new Date()), []);

  const goPrev = useCallback(() => {
    if (view === "month") setCursor((c) => addMonths(c, -1));
    else setCursor((c) => addDays(c, -7));
  }, [view]);

  const goNext = useCallback(() => {
    if (view === "month") setCursor((c) => addMonths(c, 1));
    else setCursor((c) => addDays(c, 7));
  }, [view]);

  // Keyboard shortcuts: arrow keys navigate, M/W toggle view
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowUp" && view === "week") {
        e.preventDefault();
        setCursor((c) => addDays(c, -7));
      } else if (e.key === "ArrowDown" && view === "week") {
        e.preventDefault();
        setCursor((c) => addDays(c, 7));
      } else if (e.key.toLowerCase() === "m") {
        setView("month");
      } else if (e.key.toLowerCase() === "w") {
        setView("week");
      }
    },
    [goPrev, goNext, view]
  );

  /* ----------------------- Loading state -------------------------- */
  if (isLoading) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-pine border-t-transparent" />
        <p className="text-[13px] text-ink-3">Loading calendar…</p>
      </div>
    );
  }

  /* ----------------------- Error state ---------------------------- */
  if (isError) {
    return (
      <QueryError
        message="Couldn't load your calendar."
        onRetry={() => refetch()}
      />
    );
  }

  /* ----------------------- Empty state ---------------------------- */
  const isEmpty = events.length === 0;

  const headerLabel =
    view === "month"
      ? monthName(cursor)
      : weekRangeLabel(startOfWeek(cursor), addDays(startOfWeek(cursor), 6));

  return (
    <div className="space-y-4" onKeyDown={onKeyDown} tabIndex={-1}>
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-serif text-[19px] text-ink">Calendar</h2>
          <p className="text-[13px] text-ink-3">
            Deliverables, invoices, and deal milestones
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div
            className="inline-flex rounded-lg border border-hairline bg-surface-subtle p-0.5"
            role="group"
            aria-label="Calendar view"
          >
            <button
              onClick={() => setView("month")}
              className={cn(
                "rounded-md px-3 py-1 text-[13px] font-medium transition-colors",
                view === "month"
                  ? "bg-surface text-ink shadow-sm"
                  : "text-ink-3 hover:text-ink"
              )}
              aria-pressed={view === "month"}
            >
              Month
            </button>
            <button
              onClick={() => setView("week")}
              className={cn(
                "rounded-md px-3 py-1 text-[13px] font-medium transition-colors",
                view === "week"
                  ? "bg-surface text-ink shadow-sm"
                  : "text-ink-3 hover:text-ink"
              )}
              aria-pressed={view === "week"}
            >
              Week
            </button>
          </div>

          {/* Nav */}
          <div className="flex items-center gap-1">
            <button
              onClick={goPrev}
              aria-label="Previous"
              className="rounded-lg p-1.5 text-ink-2 transition-colors hover:bg-surface-subtle"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={goToday}
              className="rounded-lg border border-hairline px-2.5 py-1 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-subtle"
            >
              Today
            </button>
            <button
              onClick={goNext}
              aria-label="Next"
              className="rounded-lg p-1.5 text-ink-2 transition-colors hover:bg-surface-subtle"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Period label */}
      <p
        className="text-[15px] font-semibold text-ink"
        aria-live="polite"
        aria-atomic="true"
      >
        {headerLabel}
      </p>

      {isEmpty ? (
        <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-hairline bg-surface">
          <CalendarIcon className="h-8 w-8 text-ink-3" />
          <p className="text-[13px] text-ink-3">
            No events yet. Add deliverables or invoices to see them here.
          </p>
        </div>
      ) : view === "month" ? (
        <MonthView
          cursor={cursor}
          today={today}
          eventsByDay={eventsByDay}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          onEventClick={(ev) => handleEventClick(navigate, ev)}
        />
      ) : (
        <WeekView
          cursor={cursor}
          today={today}
          eventsByDay={eventsByDay}
          onEventClick={(ev) => handleEventClick(navigate, ev)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Event navigation                                                  */
/* ------------------------------------------------------------------ */

function handleEventClick(navigate: ReturnType<typeof useNavigate>, ev: CalendarEvent) {
  switch (ev.type) {
    case "deliverable":
      if (ev.dealId) navigate(`/pipeline/${ev.dealId}`);
      break;
    case "invoice":
      navigate("/payments");
      break;
    case "deal_stage":
      navigate(`/pipeline/${ev.id}`);
      break;
  }
}

/* ------------------------------------------------------------------ */
/*  MonthView                                                         */
/* ------------------------------------------------------------------ */

function MonthView({
  cursor,
  today,
  eventsByDay,
  selectedDate,
  onSelectDate,
  onEventClick,
}: {
  cursor: Date;
  today: Date;
  eventsByDay: Map<string, CalendarEvent[]>;
  selectedDate: Date | null;
  onSelectDate: (d: Date | null) => void;
  onEventClick: (ev: CalendarEvent) => void;
}) {
  const monthStart = startOfMonth(cursor);
  const start = addDays(monthStart, -monthStart.getDay());

  const weeks: Date[][] = [];
  let day = new Date(start);
  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(day));
      day = addDays(day, 1);
    }
    weeks.push(week);
  }

  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="rounded-xl border border-hairline bg-surface">
      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b border-hairline">
        {weekDays.map((wd) => (
          <div
            key={wd}
            className="py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-ink-3"
          >
            {wd}
          </div>
        ))}
      </div>

      {/* Days */}
      <div role="grid" aria-label="Month calendar">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7" role="row">
            {week.map((d, di) => {
              const inMonth = isSameMonth(d, cursor);
              const isToday = isSameDay(d, today);
              const isSelected = selectedDate ? isSameDay(d, selectedDate) : false;
              const key = toYMD(d);
              const dayEvents = eventsByDay.get(key) ?? [];

              return (
                <button
                  key={di}
                  role="gridcell"
                  aria-label={d.toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                  aria-selected={isSelected}
                  onClick={() => onSelectDate(isSelected ? null : d)}
                  className={cn(
                    "relative flex h-24 flex-col items-start border-r border-b border-hairline p-1.5 text-left transition-colors last:border-r-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-pine focus-visible:ring-inset",
                    inMonth ? "bg-surface" : "bg-surface-subtle",
                    isSelected && "bg-pine-tint/40",
                    !inMonth && "text-ink-3"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-full text-[13px] font-medium",
                      isToday
                        ? "bg-pine text-white"
                        : inMonth
                          ? "text-ink"
                          : "text-ink-3"
                    )}
                  >
                    {d.getDate()}
                  </span>

                  {/* Event dots */}
                  {dayEvents.length > 0 && (
                    <div className="mt-1 flex w-full flex-wrap gap-1">
                      {dayEvents.slice(0, 4).map((ev, i) => (
                        <span
                          key={i}
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            eventColor(ev.type)
                          )}
                          title={`${eventLabel(ev.type)}: ${ev.title}`}
                        />
                      ))}
                      {dayEvents.length > 4 && (
                        <span className="text-[10px] text-ink-3">
                          +{dayEvents.length - 4}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Selected day detail panel */}
      {selectedDate && (
        <DayDetailPanel
          date={selectedDate}
          events={eventsByDay.get(toYMD(selectedDate)) ?? []}
          onClose={() => onSelectDate(null)}
          onEventClick={onEventClick}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  WeekView                                                          */
/* ------------------------------------------------------------------ */

function WeekView({
  cursor,
  today,
  eventsByDay,
  onEventClick,
}: {
  cursor: Date;
  today: Date;
  eventsByDay: Map<string, CalendarEvent[]>;
  onEventClick: (ev: CalendarEvent) => void;
}) {
  const weekStart = startOfWeek(cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="rounded-xl border border-hairline bg-surface">
      {/* Header row */}
      <div className="grid grid-cols-7 border-b border-hairline">
        {days.map((d, i) => {
          const isToday = isSameDay(d, today);
          return (
            <div
              key={i}
              className={cn(
                "border-r border-hairline py-2 text-center last:border-r-0",
                isToday && "bg-pine-tint/20"
              )}
            >
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                {weekDays[i]}
              </p>
              <p
                className={cn(
                  "mt-0.5 text-[15px] font-semibold",
                  isToday ? "text-pine" : "text-ink"
                )}
              >
                {d.getDate()}
              </p>
            </div>
          );
        })}
      </div>

      {/* Event rows */}
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const key = toYMD(d);
          const dayEvents = eventsByDay.get(key) ?? [];
          const isToday = isSameDay(d, today);
          return (
            <div
              key={i}
              className={cn(
                "min-h-[200px] border-r border-hairline p-2 last:border-r-0",
                isToday && "bg-pine-tint/10"
              )}
            >
              {dayEvents.length === 0 ? (
                <p className="pt-4 text-center text-[12px] text-ink-3">No events</p>
              ) : (
                <div className="space-y-1.5">
                  {dayEvents.map((ev) => (
                    <WeekEventCard key={ev.id + ev.type} event={ev} onClick={() => onEventClick(ev)} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  WeekEventCard                                                     */
/* ------------------------------------------------------------------ */

function WeekEventCard({
  event: ev,
  onClick,
}: {
  event: CalendarEvent;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-1.5 rounded-md border border-hairline bg-surface-subtle px-2 py-1.5 text-left transition-colors hover:border-pine/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-pine"
    >
      <EventIcon type={ev.type} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium text-ink">{ev.title}</p>
        <p className="truncate text-[11px] text-ink-3">
          {ev.type === "deliverable" && ev.dealTitle
            ? ev.dealTitle
            : ev.type === "invoice" && ev.amountCents !== undefined
              ? new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: ev.currency || "USD",
                }).format(ev.amountCents / 100)
              : ev.type === "deal_stage" && ev.stage
                ? `Moved to ${ev.stage}`
                : eventLabel(ev.type)}
        </p>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  DayDetailPanel (shown below month grid when a day is selected)   */
/* ------------------------------------------------------------------ */

function DayDetailPanel({
  date,
  events,
  onClose,
  onEventClick,
}: {
  date: Date;
  events: CalendarEvent[];
  onClose: () => void;
  onEventClick: (ev: CalendarEvent) => void;
}) {
  return (
    <div className="border-t border-hairline bg-surface-subtle p-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-ink">
          {date.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </p>
        <button
          onClick={onClose}
          className="rounded-md px-2 py-1 text-[12px] text-ink-3 transition-colors hover:bg-surface"
        >
          Close
        </button>
      </div>
      {events.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3">No events on this day.</p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {events.map((ev) => (
            <button
              key={ev.id + ev.type}
              onClick={() => onEventClick(ev)}
              className="flex w-full items-center gap-2 rounded-lg border border-hairline bg-surface px-3 py-2 text-left transition-colors hover:border-pine/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-pine"
            >
              <EventIcon type={ev.type} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink">{ev.title}</p>
                <p className="text-[12px] text-ink-3">
                  {ev.type === "deliverable" && ev.dealTitle
                    ? `${ev.dealTitle} · ${ev.status ?? "due"}`
                    : ev.type === "invoice" && ev.amountCents !== undefined
                      ? `${new Intl.NumberFormat("en-US", {
                          style: "currency",
                          currency: ev.currency || "USD",
                        }).format(ev.amountCents / 100)} · ${ev.status ?? "due"}`
                      : ev.type === "deal_stage" && ev.stage
                        ? `Stage: ${ev.stage}${ev.brandName ? ` · ${ev.brandName}` : ""}`
                        : eventLabel(ev.type)}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
