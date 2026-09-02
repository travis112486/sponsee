import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { trpc } from "@/trpc";
import {
  stageLabels,
  dealStages,
  platforms,
  type DealStage,
  type DealType,
  type Platform,
} from "@sponsee/shared";
import { cn } from "@/lib/utils";
import { platformBgClasses } from "@/lib/platform-tokens";
import { startOfZonedQuarterMs } from "@/lib/zoned-quarter";
import { formatCount, useCountUp } from "@/hooks/useCountUp";
import { BrandMark } from "@/components/shared/BrandMark";
import { PlatformDots } from "@/components/shared/PlatformDot";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  ChevronRight,
  ChevronLeft,
  DollarSign,
  X,
  CalendarDays,
  AlertTriangle,
  Eye,
  Check,
  Search,
  ArrowUpDown,
} from "lucide-react";
import { toast } from "sonner";
import QueryError from "@/components/QueryError";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

function formatCents(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_DAYS = 14;

const dealTypeLabels: Record<DealType, string> = {
  flat: "Flat",
  bounty: "Bounty",
  hybrid: "Hybrid",
};

const dealTypeBadge: Record<DealType, string> = {
  flat: "bg-ink/[.06] text-ink-2",
  bounty: "bg-amber-tint text-amber",
  hybrid: "bg-pine-tint text-pine",
};

const stageColors: Record<DealStage, string> = {
  inbound: "bg-ink-3/10 text-ink-2",
  negotiating: "bg-amber-tint text-amber",
  contract_sent: "bg-pine-tint text-pine",
  live: "bg-pine/10 text-pine",
  delivered: "bg-ink-2 text-paper",
  paid: "bg-pine-tint text-pine",
};

const stageDotColors: Record<DealStage, string> = {
  inbound: "bg-ink-3",
  negotiating: "bg-amber",
  contract_sent: "bg-pine",
  live: "bg-pine",
  delivered: "bg-ink-2",
  paid: "bg-pine",
};

type SortMode = "value" | "age" | "brand";
const sortLabels: Record<SortMode, string> = {
  value: "Value",
  age: "Days in stage",
  brand: "Brand A–Z",
};

type DeliverableRow = {
  id: string;
  title: string;
  status: string;
  dueAt?: string | Date | null;
  dueLabel?: string | null;
  progressDone?: number | null;
  progressTotal?: number | null;
  position?: number;
};

type InvoiceRow = {
  id: string;
  status: string;
  dueAt?: string | Date | null;
  paidAt?: string | Date | null;
  amountCents: number;
};

type PipelineDeal = {
  id: string;
  title: string;
  stage: DealStage;
  valueCents: number;
  type?: DealType | null;
  currency?: string | null;
  paymentTerms?: string | null;
  valueNote?: string | null;
  stageEnteredAt?: string | Date | null;
  brand?: { name?: string | null } | null;
  platforms?: readonly string[] | null;
  notes?: string | null;
  deliverables?: DeliverableRow[] | null;
  invoices?: InvoiceRow[] | null;
};

function daysInStage(deal: PipelineDeal): number {
  if (!deal.stageEnteredAt) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(deal.stageEnteredAt).getTime()) / DAY_MS));
}

/** First deliverable that still has work left to do, in position order. */
function nextDeliverable(deal: PipelineDeal): DeliverableRow | null {
  return (deal.deliverables ?? []).find((d) => d.status !== "done") ?? null;
}

function deliverableIsDue(d: DeliverableRow): boolean {
  if (d.status === "missed") return true;
  if (d.dueAt) return new Date(d.dueAt).getTime() <= Date.now();
  return false;
}

function deliverableProgress(d: DeliverableRow | null): { done: number; total: number } | null {
  if (!d || !d.progressTotal || d.progressTotal <= 0) return null;
  return { done: d.progressDone ?? 0, total: d.progressTotal };
}

function overdueInvoices(deal: PipelineDeal): InvoiceRow[] {
  const now = Date.now();
  return (deal.invoices ?? []).filter(
    (i) => i.status === "open" && i.dueAt && new Date(i.dueAt).getTime() < now
  );
}

function invoiceDaysOverdue(i: InvoiceRow): number {
  if (!i.dueAt) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(i.dueAt).getTime()) / DAY_MS));
}

function collectedThisQuarter(deals: PipelineDeal[], timeZone: string): number {
  const quarterStart = startOfZonedQuarterMs(new Date(), timeZone);
  let total = 0;
  for (const d of deals) {
    for (const i of d.invoices ?? []) {
      if (i.status === "paid" && i.paidAt && new Date(i.paidAt).getTime() >= quarterStart) {
        total += i.amountCents;
      }
    }
  }
  return total;
}

function useHorizontalScrollEdges<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function update() {
      if (!el) return;
      setAtStart(el.scrollLeft <= 1);
      setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
    }

    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);

  return { ref, atStart, atEnd };
}

/* ------------------------------------------------------------------ */
/*  Drag-and-drop (SPO-52, re-landed for SPO-103)                      */
/* ------------------------------------------------------------------ */

/** Presentational card content — shared by the live card and the drag overlay. */
function DealCardBody({ deal }: { deal: PipelineDeal }) {
  const next = nextDeliverable(deal);
  const nextDue = next ? deliverableIsDue(next) : false;
  const progress = deliverableProgress(next);
  const overdue = overdueInvoices(deal);
  const days = daysInStage(deal);
  const stale = deal.stage !== "paid" && days >= STALE_DAYS;
  const platformList = (deal.platforms ?? []) as readonly Platform[];
  const type = deal.type ?? "flat";

  return (
    <>
      <div className="flex items-start gap-2.5">
        <BrandMark brand={deal.brand?.name ?? "?"} size={30} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-[13px] font-semibold text-ink">
              {deal.brand?.name ?? "Unknown brand"}
            </p>
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-3",
                dealTypeBadge[type]
              )}
            >
              {dealTypeLabels[type]}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-[12px] leading-[18px] text-ink-2">
            {deal.title}
          </p>
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="font-mono text-[13px] font-semibold tabular-nums text-ink">
          {formatCents(deal.valueCents)}
          {deal.valueNote && (
            <span className="ml-1 font-sans text-[10px] font-normal text-ink-3">
              {deal.valueNote}
            </span>
          )}
        </span>
        {platformList.length > 0 && <PlatformDots platforms={platformList} />}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-hairline pt-2">
        {next ? (
          <p
            className={cn(
              "flex min-w-0 items-center gap-1 truncate text-[11px]",
              nextDue ? "font-medium text-amber" : "text-ink-3"
            )}
          >
            <CalendarDays className="h-3 w-3 shrink-0" />
            <span className="truncate">Next: {next.title}</span>
          </p>
        ) : (
          <span className="text-[11px] text-ink-3">No open deliverables</span>
        )}
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-surface-subtle px-1.5 py-0.5 text-[10px] font-medium text-ink-3">
          {stale && <span className="h-1.5 w-1.5 rounded-full bg-amber" title="Stale" />}
          {days}d
        </span>
      </div>

      {progress && (
        <div className="mt-2">
          <Progress value={(progress.done / progress.total) * 100} />
          <p className="mt-1 font-mono text-[10px] tabular-nums text-ink-3">
            {progress.done} / {progress.total}
          </p>
        </div>
      )}

      {overdue.length > 0 && (
        <p className="mt-2 flex items-center gap-1 rounded-md bg-brick-tint px-2 py-1 text-[10.5px] font-medium text-brick">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {overdue.length === 1
            ? `Invoice ${invoiceDaysOverdue(overdue[0])}d overdue`
            : `${overdue.length} invoices overdue`}
        </p>
      )}
    </>
  );
}

/**
 * A stage column that accepts dropped cards. `id` is the stage key, so
 * `over.id` in handleDragEnd is directly the destination stage.
 */
function DroppableStageColumn({
  stage,
  isOver,
  children,
}: {
  stage: DealStage;
  isOver: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: stage });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-[260px] shrink-0 flex-col rounded-xl border transition-colors",
        isOver ? "border-pine bg-pine-tint/40" : "border-hairline bg-surface-subtle"
      )}
    >
      {children}
    </div>
  );
}

/**
 * Draggable deal card. The whole card is the drag handle (the founder's
 * mockup let you grab a card anywhere), while the SPO-25 accessibility
 * contract is preserved: the card itself is not a button, the stretched
 * `Open …` button remains the keyboard/screen-reader path to the deal, and
 * `Move…` remains the non-pointer way to change stage.
 */
function DraggableDealCard({
  deal,
  isMoving,
  onStartMove,
  onCancelMove,
  onMoveTo,
  onOpen,
  onInvoice,
  onMarkDeliverable,
  invoiceDisabled,
}: {
  deal: PipelineDeal;
  isMoving: boolean;
  onStartMove: () => void;
  onCancelMove: () => void;
  onMoveTo: (stage: DealStage) => void;
  onOpen: () => void;
  onInvoice: () => void;
  onMarkDeliverable: () => void;
  invoiceDisabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: deal.id,
    data: { sourceStage: deal.stage },
  });

  // A pointer-up that ends a drag also fires a `click` on the stretched open
  // button. Without this latch, every drop would navigate into the deal.
  const draggedRef = useRef(false);
  useEffect(() => {
    if (isDragging) draggedRef.current = true;
  }, [isDragging]);

  const hasOpenDeliverable = nextDeliverable(deal) !== null;

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      // dnd-kit's attributes set role="button"/tabIndex=0; the card must stay a
      // plain grouping element so the nested open button is the only button.
      role="group"
      tabIndex={-1}
      aria-roledescription="Draggable deal card"
      style={
        transform
          ? { transform: CSS.Translate.toString(transform), zIndex: 50 }
          : undefined
      }
      className={cn(
        "group relative min-h-[118px] cursor-grab touch-manipulation rounded-lg border border-hairline bg-surface p-3 shadow-warm transition-shadow hover:border-pine/30 hover:shadow-warm-md active:cursor-grabbing",
        isDragging && "opacity-40",
        deal.stage === "paid" && "opacity-70"
      )}
    >
      {/* Primary open action — stretched under the card; nested controls sit above it */}
      <button
        type="button"
        aria-label={`Open ${deal.title} — ${deal.brand?.name ?? "Unknown brand"}`}
        onClick={() => {
          if (draggedRef.current) {
            draggedRef.current = false;
            return;
          }
          onOpen();
        }}
        className="absolute inset-0 z-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-pine focus-visible:ring-offset-1"
      />

      {/* Non-interactive card body — clicks pass through to the stretched button */}
      <div className="pointer-events-none relative z-10">
        <DealCardBody deal={deal} />
      </div>

      {/* Hover quick-action bar (open / invoice / mark deliverable) */}
      <div className="pointer-events-none absolute right-2 top-2 z-20 flex items-center gap-0.5 rounded-lg border border-hairline bg-surface p-0.5 opacity-0 shadow-warm-md transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        <button
          type="button"
          title="Open"
          aria-label={`Open ${deal.title}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="flex h-6 w-6 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface-subtle hover:text-ink"
        >
          <Eye className="h-3 w-3" />
        </button>
        <button
          type="button"
          title="Invoice"
          aria-label={`Create invoice for ${deal.title}`}
          disabled={invoiceDisabled}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onInvoice();
          }}
          className="flex h-6 w-6 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface-subtle hover:text-ink disabled:opacity-40"
        >
          <DollarSign className="h-3 w-3" />
        </button>
        <button
          type="button"
          title="Mark deliverable"
          aria-label={`Mark next deliverable done for ${deal.title}`}
          disabled={!hasOpenDeliverable}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onMarkDeliverable();
          }}
          className="flex h-6 w-6 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface-subtle hover:text-ink disabled:opacity-40"
        >
          <Check className="h-3 w-3" />
        </button>
      </div>

      {/* Stage mover — interactive controls above the stretched button */}
      <div className="relative z-20">
        {isMoving ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {dealStages
              .filter((s) => s !== deal.stage)
              .map((s) => (
                <button
                  key={s}
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onMoveTo(s);
                  }}
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                    stageColors[s]
                  )}
                >
                  {stageLabels[s]}
                </button>
              ))}
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onCancelMove();
              }}
              className="rounded px-1.5 py-0.5 text-[10px] text-ink-3 hover:bg-surface-subtle"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onStartMove();
            }}
            className="mt-2 rounded text-[11px] font-medium text-pine opacity-0 transition-opacity hover:text-pine-hover group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-pine focus-visible:ring-offset-1"
          >
            Move…
          </button>
        )}
      </div>
    </div>
  );
}

function StageSum({ valueCents }: { valueCents: number }) {
  const dollars = useCountUp(valueCents / 100, 300);
  return (
    <span className="font-mono text-[11px] font-medium tabular-nums text-ink-3">
      {formatCount(dollars, { currency: true })}
    </span>
  );
}

export default function Pipeline() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const utils = trpc.useUtils();
  const { data: deals, isLoading, isError, refetch } = trpc.deals.list.useQuery();
  const { data: profile } = trpc.settings.getProfile.useQuery();
  // `creators.timezone` is NOT NULL, so this only falls back during the brief
  // window before the profile loads. The value is validated on write (SPO-246)
  // and an unparseable one still degrades to UTC inside startOfZonedQuarterMs.
  const timeZone = profile?.timezone ?? "UTC";

  const [typeFilter, setTypeFilter] = useState<"all" | DealType>("all");
  const [platformFilter, setPlatformFilter] = useState<Platform[]>([]);
  const [brandSearch, setBrandSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("value");

  const createInvoice = trpc.invoice.create.useMutation({
    onSuccess: () => {
      utils.invoice.list.invalidate();
      utils.deals.list.invalidate();
      toast("Invoice created");
    },
    onError: (err) => toast.error(err.message || "Failed to create invoice"),
  });

  const markDeliverable = trpc.deliverable.update.useMutation({
    onSuccess: () => {
      utils.deals.list.invalidate();
      toast("Deliverable marked done");
    },
    onError: (err) => toast.error(err.message || "Failed to update deliverable"),
  });

  // Optimistic so a dropped card lands in its new column immediately rather
  // than snapping back until the round-trip finishes.
  const updateStage = trpc.deals.updateStage.useMutation({
    onMutate: async (vars) => {
      await utils.deals.list.cancel();
      const previousDeals = utils.deals.list.getData();
      utils.deals.list.setData(undefined, (old) =>
        old?.map((d) => (d.id === vars.id ? { ...d, stage: vars.stage } : d))
      );
      return { previousDeals };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousDeals) {
        utils.deals.list.setData(undefined, context.previousDeals);
      }
      toast.error("Couldn't move that deal — put it back where it was");
    },
    onSuccess: () => {
      toast("Deal moved");
    },
    onSettled: () => {
      utils.deals.list.invalidate();
    },
  });

  const [movingDealId, setMovingDealId] = useState<string | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<DealStage | null>(null);

  // Mouse drags start after a 4px nudge so a plain click still opens the deal.
  // Touch waits 180ms so vertical scrolling over a column doesn't grab a card.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } })
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveDragId(String(event.active.id));
    setMovingDealId(null);
  }

  function handleDragOver(event: DragOverEvent) {
    setOverStage(event.over ? (String(event.over.id) as DealStage) : null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveDragId(null);
    setOverStage(null);
    if (!over) return;

    const dealId = String(active.id);
    const nextStage = String(over.id) as DealStage;
    const deal = deals?.find((d) => d.id === dealId);
    if (!deal || deal.stage === nextStage) return;

    updateStage.mutate({ id: dealId, stage: nextStage });
  }

  function handleDragCancel() {
    setActiveDragId(null);
    setOverStage(null);
  }

  function handleInvoice(deal: PipelineDeal) {
    // A deal with a non-void invoice already has a financial record; the quick
    // action would mint a duplicate that can only be voided, never deleted
    // (invoice.create has no delete, and each create burns an invoice number).
    const hasNonVoidInvoice = (deal.invoices ?? []).some((i) => i.status !== "void");
    if (hasNonVoidInvoice) {
      toast("This deal already has an invoice");
      return;
    }
    createInvoice.mutate({
      dealId: deal.id,
      title: `${deal.title} — Invoice`,
      amountCents: deal.valueCents,
      currency: (deal.currency ?? "USD") as "USD",
      terms: (deal.paymentTerms ?? "net_30") as "net_15" | "net_30" | "net_45",
    });
  }

  function handleMarkDeliverable(deal: PipelineDeal) {
    const next = nextDeliverable(deal);
    if (!next) return;
    markDeliverable.mutate({ id: next.id, status: "done" });
  }

  // Sourced from the URL (not local state) so CommandPalette's "New deal"
  // action (?new=1) opens the modal even when Pipeline is already mounted.
  const showNewDeal = searchParams.get("new") === "1";
  const { ref: boardRef, atStart, atEnd } = useHorizontalScrollEdges<HTMLDivElement>();

  function openNewDeal() {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("new", "1");
        return next;
      },
      { replace: true }
    );
  }

  function closeNewDeal() {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("new");
        return next;
      },
      { replace: true }
    );
  }

  function scrollBoardBy(delta: number) {
    boardRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-pine border-t-transparent" />
      </div>
    );
  }

  if (isError) {
    return <QueryError message="Couldn't load your pipeline." onRetry={() => refetch()} />;
  }

  const allDeals = deals ?? [];

  const q = brandSearch.trim().toLowerCase();
  const visibleDeals = allDeals.filter((d) => {
    if (typeFilter !== "all" && (d.type ?? "flat") !== typeFilter) return false;
    if (platformFilter.length > 0) {
      const ps = d.platforms ?? [];
      if (!ps.some((p) => platformFilter.includes(p as Platform))) return false;
    }
    if (q) {
      const brand = (d.brand?.name ?? "").toLowerCase();
      if (!brand.includes(q) && !d.title.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const cmp: Record<SortMode, (a: PipelineDeal, b: PipelineDeal) => number> = {
    value: (a, b) => b.valueCents - a.valueCents,
    age: (a, b) => daysInStage(b) - daysInStage(a),
    brand: (a, b) => (a.brand?.name ?? "").localeCompare(b.brand?.name ?? ""),
  };
  const byStage = Object.fromEntries(
    dealStages.map((s) => [s, [] as PipelineDeal[]])
  ) as Record<DealStage, PipelineDeal[]>;
  for (const d of visibleDeals) byStage[d.stage].push(d);
  for (const s of dealStages) byStage[s].sort(cmp[sort]);

  const activeDeal = activeDragId ? allDeals.find((d) => d.id === activeDragId) ?? null : null;

  const totalPipeline = allDeals.reduce((s, d) => s + d.valueCents, 0);
  const collected = collectedThisQuarter(allDeals, timeZone);

  function clearFilters() {
    setTypeFilter("all");
    setPlatformFilter([]);
    setBrandSearch("");
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-[19px] text-ink">Deal Pipeline</h2>
          <p className="text-[13px] text-ink-3">
            {allDeals.length} deal{allDeals.length === 1 ? "" : "s"} ·{" "}
            <span className="font-mono tabular-nums">{formatCents(totalPipeline)}</span> total
            pipeline ·{" "}
            <span className="font-mono tabular-nums">{formatCents(collected)}</span> collected
            this quarter
          </p>
        </div>
        <button
          onClick={openNewDeal}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-pine px-3 text-[13px] font-medium text-white transition-colors hover:bg-pine-hover"
        >
          <Plus className="h-3.5 w-3.5" />
          New deal
        </button>
      </div>

      {/* Filters + sort */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-3" />
          <input
            value={brandSearch}
            onChange={(e) => setBrandSearch(e.target.value)}
            placeholder="Filter brands…"
            className="h-8 w-[220px] rounded-lg border border-hairline bg-surface pl-8 pr-3 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-pine/50"
          />
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-hairline bg-surface p-0.5">
          {(["all", "flat", "bounty", "hybrid"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[12px] font-medium capitalize transition-colors duration-150",
                typeFilter === t ? "bg-pine-tint text-pine" : "text-ink-2 hover:text-ink"
              )}
            >
              {t === "all" ? "All types" : dealTypeLabels[t]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-hairline bg-surface p-1">
          {platforms.map((p) => {
            const on = platformFilter.includes(p);
            return (
              <button
                key={p}
                type="button"
                title={p}
                aria-pressed={on}
                onClick={() =>
                  setPlatformFilter((f) =>
                    on ? f.filter((x) => x !== p) : [...f, p]
                  )
                }
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-md transition-all duration-150",
                  on ? "bg-pine-tint ring-1 ring-pine/40" : "opacity-50 hover:opacity-100"
                )}
              >
                <span className={cn("h-2 w-2 rounded-full", platformBgClasses[p])} />
              </button>
            );
          })}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger className="flex h-8 items-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 text-[13px] font-medium text-ink transition-colors hover:bg-surface-subtle">
            <ArrowUpDown className="h-3.5 w-3.5 text-ink-3" />
            Sort: {sortLabels[sort]}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={sort}
              onValueChange={(v) => setSort(v as SortMode)}
            >
              {(Object.keys(sortLabels) as SortMode[]).map((m) => (
                <DropdownMenuRadioItem key={m} value={m}>
                  {sortLabels[m]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Empty states */}
      {allDeals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24">
          <img src="/empty-state.svg" alt="" className="h-[180px] w-[240px]" />
          <p className="mt-4 text-[14px] font-medium text-ink">No deals yet</p>
          <button
            onClick={openNewDeal}
            className="mt-3 rounded-lg px-3 py-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-subtle hover:text-ink"
          >
            Create your first deal
          </button>
        </div>
      ) : visibleDeals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24">
          <img src="/empty-state.svg" alt="" className="h-[180px] w-[240px]" />
          <p className="mt-4 text-[14px] font-medium text-ink">
            No deals match these filters
          </p>
          <button
            onClick={clearFilters}
            className="mt-3 rounded-lg px-3 py-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-subtle hover:text-ink"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
        <div className="relative">
          {!atStart && (
            <button
              onClick={() => scrollBoardBy(-280)}
              aria-label="Scroll pipeline stages left"
              className="absolute left-0 top-1/2 z-10 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full border border-hairline bg-surface shadow-warm-md text-ink-2 hover:text-ink"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          {!atEnd && (
            <button
              onClick={() => scrollBoardBy(280)}
              aria-label="Scroll pipeline stages right — more stages available"
              className="absolute right-0 top-1/2 z-10 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full border border-hairline bg-surface shadow-warm-md text-ink-2 hover:text-ink animate-pulse"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
          {!atEnd && (
            <div className="pointer-events-none absolute right-0 top-0 z-[5] h-full w-12 bg-gradient-to-l from-paper to-transparent" />
          )}

          <div
            ref={boardRef}
            role="region"
            aria-label="Pipeline stages — six stages, scroll horizontally or use arrow keys for more"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "ArrowRight") scrollBoardBy(280);
              if (e.key === "ArrowLeft") scrollBoardBy(-280);
            }}
            className="board-scroll flex gap-3 overflow-x-auto pb-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-pine focus-visible:ring-offset-1 rounded-lg"
          >
          {dealStages.map((stage) => {
            const cards = byStage[stage];
            const sum = cards.reduce((s, d) => s + d.valueCents, 0);
            return (
            <DroppableStageColumn key={stage} stage={stage} isOver={overStage === stage}>
              {/* Column header */}
              <div className="flex items-center justify-between px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className={cn("inline-flex h-2 w-2 rounded-full", stageDotColors[stage])} />
                  <span className="text-[13px] font-semibold text-ink">
                    {stageLabels[stage]}
                  </span>
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-3">
                    {cards.length}
                  </span>
                </div>
                <StageSum valueCents={sum} />
              </div>

              {/* Cards */}
              <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
                {cards.map((deal) => (
                  <DraggableDealCard
                    key={deal.id}
                    deal={deal}
                    isMoving={movingDealId === deal.id}
                    onStartMove={() => setMovingDealId(deal.id)}
                    onCancelMove={() => setMovingDealId(null)}
                    onMoveTo={(s) => {
                      updateStage.mutate({ id: deal.id, stage: s });
                      setMovingDealId(null);
                    }}
                    onOpen={() => navigate(`/pipeline/${deal.id}`)}
                    onInvoice={() => handleInvoice(deal)}
                    onMarkDeliverable={() => handleMarkDeliverable(deal)}
                    invoiceDisabled={createInvoice.isPending}
                  />
                ))}
              </div>
            </DroppableStageColumn>
            );
          })}
          </div>
        </div>

        {/* Follows the cursor so the card being dragged stays legible over other columns */}
        <DragOverlay dropAnimation={null}>
          {activeDeal && (
            <div className="group w-[244px] rotate-[1.5deg] cursor-grabbing rounded-lg border border-pine/40 bg-surface p-3 shadow-warm-lg">
              <DealCardBody deal={activeDeal} />
            </div>
          )}
        </DragOverlay>
        </DndContext>
      )}

      {showNewDeal && <NewDealModal onClose={closeNewDeal} />}
    </div>
  );
}

function NewDealModal({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const { data: brands } = trpc.brand.list.useQuery();
  const createBrand = trpc.brand.create.useMutation({
    onSuccess: () => utils.brand.list.invalidate(),
    onError: (err) => toast.error(err.message || "Failed to create brand"),
  });
  const createDeal = trpc.deals.create.useMutation({
    onSuccess: () => {
      utils.deals.list.invalidate();
      toast("Deal created");
      onClose();
    },
    onError: (err) => toast.error(err.message || "Failed to create deal"),
  });

  const [brandMode, setBrandMode] = useState<"select" | "create">("select");
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [newBrandName, setNewBrandName] = useState("");
  const [newBrandCategory, setNewBrandCategory] = useState("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<"flat" | "bounty" | "hybrid">("flat");
  const [valueDollars, setValueDollars] = useState("");
  const [ccv, setCcv] = useState("");
  const [durationHours, setDurationHours] = useState("");
  const [stage, setStage] = useState<DealStage>("inbound");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [paymentTerm, setPaymentTerm] = useState<"net_15" | "net_30" | "net_45">("net_30");
  const [source, setSource] = useState("");
  const [notes, setNotes] = useState("");

  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Focus trap + Escape-to-close (WCAG 2.1 AA). No Radix in the bundle, so this
  // is a minimal manual trap: focus the dialog on open, cycle Tab within it, and
  // restore focus to the previously-focused element on close. Mount-once — does
  // not re-fire on parent refetch.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
    const getFocusable = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));

    dialog.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    dialog.addEventListener("keydown", handleKeyDown);
    return () => {
      dialog.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  function togglePlatform(p: string) {
    setSelectedPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    let brandId = selectedBrandId;

    if (brandMode === "create") {
      if (!newBrandName.trim()) {
        toast("Brand name is required");
        return;
      }
      try {
        const brand = await createBrand.mutateAsync({
          name: newBrandName.trim(),
          category: newBrandCategory.trim() || undefined,
        });
        brandId = brand.id;
      } catch {
        return;
      }
    }

    if (!brandId) {
      toast("Please select or create a brand");
      return;
    }
    if (!title.trim()) {
      toast("Title is required");
      return;
    }

    const valueCents = Math.round(parseFloat(valueDollars || "0") * 100);
    const ccvNum = ccv.trim() ? parseInt(ccv, 10) : undefined;
    const sponsoredMinutes = durationHours.trim()
      ? Math.round(parseFloat(durationHours) * 60)
      : undefined;

    createDeal.mutate({
      brandId,
      title: title.trim(),
      type,
      valueCents,
      ccv: ccvNum,
      sponsoredMinutes,
      stage,
      platforms: selectedPlatforms.length > 0 ? selectedPlatforms as typeof platforms[number][] : undefined,
      paymentTerms: paymentTerm,
      source: source.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-deal-title"
        tabIndex={-1}
        className="relative w-full max-w-lg rounded-xl border border-hairline bg-surface shadow-lg focus:outline-none"
      >
        <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <h3 id="new-deal-title" className="text-[15px] font-semibold text-ink">New deal</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-3 hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          {/* Brand */}
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wider text-ink-3">Brand</label>
            <div className="mt-1.5 flex gap-2">
              <button
                type="button"
                onClick={() => setBrandMode("select")}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors",
                  brandMode === "select" ? "bg-pine text-white" : "bg-surface-subtle text-ink-2 hover:bg-surface"
                )}
              >
                Existing
              </button>
              <button
                type="button"
                onClick={() => setBrandMode("create")}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors",
                  brandMode === "create" ? "bg-pine text-white" : "bg-surface-subtle text-ink-2 hover:bg-surface"
                )}
              >
                New brand
              </button>
            </div>

            {brandMode === "select" ? (
              <select
                value={selectedBrandId}
                onChange={(e) => setSelectedBrandId(e.target.value)}
                className="mt-2 w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-pine"
              >
                <option value="">Select a brand…</option>
                {brands?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="mt-2 space-y-2">
                <input
                  value={newBrandName}
                  onChange={(e) => setNewBrandName(e.target.value)}
                  placeholder="Brand name"
                  className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-pine"
                />
                <input
                  value={newBrandCategory}
                  onChange={(e) => setNewBrandCategory(e.target.value)}
                  placeholder="Category (optional)"
                  className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-pine"
                />
              </div>
            )}
          </div>

          {/* Title */}
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wider text-ink-3">Deal title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Q4 Stream Fuel Campaign"
              className="mt-1.5 w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-pine"
            />
          </div>

          {/* Type + Value */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider text-ink-3">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as typeof type)}
                className="mt-1.5 w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-pine"
              >
                <option value="flat">Flat fee</option>
                <option value="bounty">Bounty / CPA</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider text-ink-3">Value ($)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={valueDollars}
                onChange={(e) => setValueDollars(e.target.value)}
                placeholder="0.00"
                className="mt-1.5 w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-pine"
              />
            </div>
          </div>

          {/* CCV + sponsored duration (SPO-197) — optional, drives Effective CPVH */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider text-ink-3">
                Avg. CCV (optional)
              </label>
              <input
                type="number"
                min={1}
                step="1"
                value={ccv}
                onChange={(e) => setCcv(e.target.value)}
                placeholder="e.g. 500"
                className="mt-1.5 w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-pine"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider text-ink-3">
                Sponsored hours (optional)
              </label>
              <input
                type="number"
                min={0.25}
                step="0.25"
                value={durationHours}
                onChange={(e) => setDurationHours(e.target.value)}
                placeholder="e.g. 2"
                className="mt-1.5 w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-pine"
              />
            </div>
          </div>

          {/* Stage */}
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wider text-ink-3">Stage</label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {dealStages.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStage(s)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                    stage === s
                      ? stageColors[s]
                      : "bg-surface-subtle text-ink-3 hover:bg-surface"
                  )}
                >
                  {stageLabels[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Platforms */}
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wider text-ink-3">Platforms</label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {platforms.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePlatform(p)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-[11px] font-medium capitalize transition-colors",
                    selectedPlatforms.includes(p)
                      ? "border-pine bg-pine-tint text-pine"
                      : "border-hairline bg-surface text-ink-3 hover:bg-surface-subtle"
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Payment terms + Source */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider text-ink-3">Payment terms</label>
              <select
                value={paymentTerm}
                onChange={(e) => setPaymentTerm(e.target.value as typeof paymentTerm)}
                className="mt-1.5 w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-pine"
              >
                <option value="net_15">Net 15</option>
                <option value="net_30">Net 30</option>
                <option value="net_45">Net 45</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider text-ink-3">Source</label>
              <input
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="e.g. Cold outreach"
                className="mt-1.5 w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-pine"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wider text-ink-3">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any details about the deal…"
              rows={3}
              className="mt-1.5 w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-pine"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-hairline px-4 py-2 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-subtle"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createDeal.isPending}
              className="rounded-lg bg-pine px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-pine-hover disabled:opacity-50"
            >
              {createDeal.isPending ? "Creating…" : "Create deal"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
