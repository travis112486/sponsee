import { useMemo, useState, type ElementType } from "react";
import { motion } from "framer-motion";
import { AlertCircle, ArrowRight, CalendarCheck, CheckSquare2, CircleDollarSign, FileSignature, FileText, Mail, MessageCircle, Plus } from "lucide-react";
import { useNavigate } from "react-router";
import { dealStages, stageLabels, type DealType, type Platform } from "@sponsee/shared";

import QueryError from "@/components/QueryError";
import { BrandMark } from "@/components/shared/BrandMark";
import { PlatformDot } from "@/components/shared/PlatformDot";
import { StatCard } from "@/components/shared/StatCard";
import { StatusChip } from "@/components/shared/StatusChip";
import { entrance, grow, STAGGER } from "@/lib/motion";
import { describeActivity } from "@/lib/activity-label";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc";

const DAY = 86_400_000;
const REVENUE_TYPES: DealType[] = ["flat", "bounty", "hybrid"];
const REVENUE_COLORS: Record<DealType, string> = { flat: "fill-pine", bounty: "fill-amber", hybrid: "fill-brick" };

function formatCents(cents: number, decimals = 0) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(cents / 100);
}

function greeting(now = new Date()) {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function relativeTime(value: Date | string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function dueCopy(value: Date | string) {
  const days = Math.ceil((new Date(value).getTime() - Date.now()) / DAY);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days}d`;
}

function activityIcon(entityType: string): { icon: ElementType; label: string } {
  switch (entityType) {
    case "invoice": return { icon: FileText, label: "Invoice activity" };
    case "contract": return { icon: FileSignature, label: "Contract activity" };
    case "deliverable": return { icon: CheckSquare2, label: "Deliverable activity" };
    case "payment": return { icon: CircleDollarSign, label: "Payment activity" };
    case "inquiry": return { icon: MessageCircle, label: "Inquiry activity" };
    default: return { icon: Mail, label: "Sponsorship activity" };
  }
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [range, setRange] = useState<"month" | "quarter">("quarter");
  const dealsQuery = trpc.deals.list.useQuery();
  const invoicesQuery = trpc.invoice.list.useQuery();
  const activityQuery = trpc.activity.list.useQuery({ limit: 8 });
  const calendarQuery = trpc.calendar.events.useQuery({});
  const updateDeliverable = trpc.deliverable.update.useMutation();

  const deals = dealsQuery.data ?? [];
  const invoices = invoicesQuery.data ?? [];
  const activity = activityQuery.data ?? [];
  const activeDeals = deals.filter((deal) => deal.stage !== "paid");
  const dealById = useMemo(() => new Map(deals.map((deal) => [deal.id, deal])), [deals]);
  const openInvoices = invoices.filter((invoice) => invoice.status === "open");
  const paidInvoices = invoices.filter((invoice) => invoice.status === "paid" && invoice.paidAt);
  const revenueCents = paidInvoices.reduce((sum, invoice) => sum + invoice.amountCents, 0);
  const outstandingCents = openInvoices.reduce((sum, invoice) => sum + invoice.amountCents, 0);
  const pipelineValueCents = activeDeals.reduce((sum, deal) => sum + deal.valueCents, 0);
  const overdueInvoices = openInvoices.filter((invoice) => invoice.dueAt && new Date(invoice.dueAt).getTime() < Date.now()).sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime());
  const deliverablesDue = (calendarQuery.data ?? [])
    .filter((event) => event.type === "deliverable" && event.status !== "done")
    .filter((event) => { const due = new Date(event.date).getTime(); return due >= Date.now() - DAY && due <= Date.now() + 7 * DAY; })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const revenueMonths = useMemo(() => {
    const count = range === "month" ? 3 : 6;
    const now = new Date();
    return Array.from({ length: count }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (count - 1 - index), 1);
      const breakdown = { flat: 0, bounty: 0, hybrid: 0 } satisfies Record<DealType, number>;
      for (const invoice of paidInvoices) {
        const paidAt = new Date(invoice.paidAt!);
        if (paidAt.getFullYear() !== date.getFullYear() || paidAt.getMonth() !== date.getMonth()) continue;
        const type = dealById.get(invoice.dealId ?? "")?.type ?? "flat";
        breakdown[type] += invoice.amountCents;
      }
      return { label: date.toLocaleDateString("en-US", { month: "short" }), breakdown, total: REVENUE_TYPES.reduce((sum, type) => sum + breakdown[type], 0) };
    });
  }, [paidInvoices, dealById, range]);

  if (dealsQuery.isLoading || invoicesQuery.isLoading) return <div className="flex h-64 items-center justify-center" role="status" aria-label="Loading dashboard"><div className="h-6 w-6 animate-spin rounded-full border-2 border-pine border-t-transparent" /></div>;
  if (dealsQuery.isError || invoicesQuery.isError) return <QueryError message="Couldn't load your dashboard." onRetry={() => { if (dealsQuery.isError) dealsQuery.refetch(); if (invoicesQuery.isError) invoicesQuery.refetch(); }} />;

  const revenueTrend = revenueMonths.map((month) => month.total / 100);
  return (
    <div className="space-y-6 pb-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 aria-label={greeting()} className="font-serif text-[30px] leading-tight text-ink">{greeting().split(" ").map((word, index) => <motion.span key={word} aria-hidden {...entrance(index, { stagger: STAGGER.tight, y: 6 })} className="mr-2 inline-block">{word}</motion.span>)}</h1>
          <p className="mt-1 text-[13px] text-ink-3">Here’s what needs your attention across sponsorships.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-hairline bg-surface p-0.5" aria-label="Dashboard period">{(["month", "quarter"] as const).map((option) => <button key={option} type="button" aria-pressed={range === option} onClick={() => setRange(option)} className={cn("min-h-11 rounded-md px-3 py-1.5 text-[11px] font-semibold capitalize transition-colors", range === option ? "bg-ink text-paper" : "text-ink-3 hover:text-ink")}>{option}</button>)}</div>
          <button type="button" onClick={() => navigate("/pipeline?new=1")} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-pine px-3 py-2 text-[12px] font-semibold text-white shadow-warm hover:bg-pine-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine/30"><Plus className="h-3.5 w-3.5" /> Log a deal</button>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Sponsorship KPIs">
        <StatCard eyebrow="Revenue" value={revenueCents / 100} currency context={`${paidInvoices.length} paid invoice${paidInvoices.length === 1 ? "" : "s"}`} sparkline={revenueTrend.length > 1 ? revenueTrend : undefined} onClick={() => navigate("/payments")} index={0} />
        <StatCard eyebrow="Active deals" value={activeDeals.length} context={`${deals.length} total deals`} onClick={() => navigate("/pipeline")} index={1} />
        <StatCard eyebrow="Due this week" value={deliverablesDue.length} context="Deliverables to complete" onClick={() => navigate("/calendar")} index={2} />
        <StatCard eyebrow="Outstanding" value={outstandingCents / 100} currency context={`${openInvoices.length} open invoice${openInvoices.length === 1 ? "" : "s"}`} onClick={() => navigate("/payments")} index={3} />
        <motion.div {...entrance(4)}><div className="flex h-full min-h-[126px] flex-col rounded-xl border border-hairline bg-surface p-5 shadow-warm"><span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">Effective CPVH</span><span className="mt-3 font-serif text-[18px] text-ink">Not enough data yet</span><span className="mt-auto pt-2 text-[11px] leading-4 text-ink-3">Add CCV and sponsored minutes to a deal.</span></div></motion.div>
      </section>

      {overdueInvoices.length > 0 && <OverdueAlert invoice={overdueInvoices[0]} onReview={() => navigate("/payments")} onViewAll={() => navigate("/payments")} />}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]"><RevenueChart months={revenueMonths} /><DeliverablesPanel deliverables={deliverablesDue} deals={dealById} loading={calendarQuery.isLoading} error={calendarQuery.isError} onCheck={(id) => updateDeliverable.mutate({ id, status: "done" })} /></div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]"><PipelineSnapshot deals={deals} total={pipelineValueCents} onOpen={() => navigate("/pipeline")} onDeal={(id) => navigate(`/pipeline/${id}`)} /><ActivityPanel activity={activity} loading={activityQuery.isLoading} error={activityQuery.isError} /></div>
    </div>
  );
}

function RevenueChart({ months }: { months: Array<{ label: string; total: number; breakdown: Record<DealType, number> }> }) {
  const max = Math.max(1, ...months.map((month) => month.total));
  return <section className="rounded-xl border border-hairline bg-surface p-5 shadow-warm" aria-labelledby="revenue-heading">
    <div className="flex items-start justify-between gap-4"><div><h2 id="revenue-heading" className="font-serif text-[18px] text-ink">Revenue by month</h2><p className="mt-0.5 text-[11px] text-ink-3">Paid invoices only</p></div><div className="flex flex-wrap justify-end gap-3 text-[10px] text-ink-3">{REVENUE_TYPES.map((type) => <span key={type} className="flex items-center gap-1 capitalize"><span className={cn("h-1.5 w-1.5 rounded-full", type === "flat" ? "bg-pine" : type === "bounty" ? "bg-amber" : "bg-brick")} />{type}</span>)}</div></div>
    {months.every((month) => month.total === 0) ? <div className="flex h-[220px] flex-col items-center justify-center text-center"><CircleDollarSign className="h-7 w-7 text-ink-3" /><p className="mt-2 text-[13px] font-medium text-ink">Revenue appears when invoices are paid</p><p className="mt-1 text-[11px] text-ink-3">Open invoices stay out of this chart.</p></div> : <svg viewBox="0 0 600 240" className="mt-4 h-[220px] w-full overflow-visible" role="img" aria-label="Monthly paid revenue chart">{[0, 1, 2, 3].map((line) => <line key={line} x1="24" x2="586" y1={20 + line * 55} y2={20 + line * 55} className="stroke-hairline" strokeDasharray="3 4" />)}{months.map((month, index) => { const x = 48 + index * (520 / Math.max(1, months.length)); let consumed = 0; const label = `${month.label}: ${formatCents(month.total)} total; ${REVENUE_TYPES.map((type) => `${type} ${formatCents(month.breakdown[type])}`).join("; ")}`; return <g key={`${month.label}-${index}`} role="img" aria-label={label}><title>{label}</title>{REVENUE_TYPES.map((type) => { const height = (month.breakdown[type] / max) * 165; consumed += height; return <motion.rect key={type} x={x} y={195 - consumed} width="42" height={height} rx="3" className={REVENUE_COLORS[type]} {...grow("y", index * 0.04)} />; })}<text x={x + 21} y="220" textAnchor="middle" className="fill-ink-3 text-[11px]">{month.label}</text></g>; })}</svg>}
  </section>;
}

type DueItem = { id: string; dealId?: string; dealTitle?: string; title: string; date: Date | string };
type DealSummary = { brand?: { name: string } | null; platforms?: Platform[] | null };
function DeliverablesPanel({ deliverables, deals, loading, error, onCheck }: { deliverables: DueItem[]; deals: Map<string, DealSummary>; loading: boolean; error: boolean; onCheck: (id: string) => void }) {
  return <section className="rounded-xl border border-hairline bg-surface p-5 shadow-warm" aria-labelledby="deliverables-heading"><div className="flex items-center justify-between"><div><h2 id="deliverables-heading" className="font-serif text-[18px] text-ink">Due this week</h2><p className="mt-0.5 text-[11px] text-ink-3">Deliverables across active deals</p></div><CalendarCheck className="h-4 w-4 text-pine" /></div>{loading ? <p className="mt-6 text-[12px] text-ink-3">Loading deliverables…</p> : error ? <p className="mt-6 text-[12px] text-brick">Couldn’t load deliverables.</p> : deliverables.length === 0 ? <div className="flex min-h-[210px] flex-col items-center justify-center text-center"><CheckSquare2 className="h-7 w-7 text-pine" /><p className="mt-2 text-[13px] font-medium text-ink">Nothing due this week</p><p className="mt-1 text-[11px] text-ink-3">Your checklist is clear.</p></div> : <div className="mt-4 divide-y divide-hairline">{deliverables.map((item) => { const deal = item.dealId ? deals.get(item.dealId) : undefined; const brand = deal?.brand?.name ?? item.dealTitle ?? "Sponsorship"; const platform = deal?.platforms?.[0]; const due = dueCopy(item.date); return <div key={item.id} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0"><label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center"><input type="checkbox" aria-label={`Mark ${item.title} complete`} onChange={() => onCheck(item.id)} className="h-4 w-4 rounded border-hairline accent-pine" /></label><BrandMark brand={brand} size={30} /><div className="min-w-0 flex-1"><p className="truncate text-[12.5px] font-medium text-ink">{item.title}</p><p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-ink-3">{platform && <PlatformDot platform={platform} />}{brand}</p></div><StatusChip tone={due.includes("overdue") ? "danger" : due === "Due today" ? "amber" : "quiet"} label={due} /></div>; })}</div>}</section>;
}

function PipelineSnapshot({ deals, total, onOpen, onDeal }: { deals: Array<{ id: string; title: string; stage: (typeof dealStages)[number]; valueCents: number; brand?: { name: string } | null }>; total: number; onOpen: () => void; onDeal: (id: string) => void }) {
  const max = Math.max(1, ...dealStages.map((stage) => deals.filter((deal) => deal.stage === stage).reduce((sum, deal) => sum + deal.valueCents, 0)));
  return <section className="rounded-xl border border-hairline bg-surface p-5 shadow-warm" aria-labelledby="pipeline-heading"><div className="flex items-start justify-between"><div><h2 id="pipeline-heading" className="font-serif text-[18px] text-ink">Pipeline snapshot</h2><p className="mt-0.5 text-[11px] text-ink-3">{formatCents(total)} active pipeline</p></div><button type="button" onClick={onOpen} className="inline-flex items-center gap-1 text-[11px] font-semibold text-pine hover:text-pine-hover">Open pipeline <ArrowRight className="h-3 w-3" /></button></div><div className="mt-5 space-y-3">{dealStages.map((stage) => { const rows = deals.filter((deal) => deal.stage === stage); const value = rows.reduce((sum, deal) => sum + deal.valueCents, 0); return <button key={stage} type="button" onClick={onOpen} className="block w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine/30"><span className="flex items-center justify-between text-[11px]"><span className="font-medium text-ink-2">{stageLabels[stage]} <span className="text-ink-3">{rows.length}</span></span><span className="tnum font-semibold text-ink">{formatCents(value)}</span></span><span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-surface-subtle"><motion.span className="block h-full rounded-full bg-pine" {...grow("x")} style={{ width: `${(value / max) * 100}%` }} /></span></button>; })}</div>{deals.filter((deal) => deal.stage !== "paid").slice(0, 3).length > 0 && <div className="mt-5 border-t border-hairline pt-4"><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">Recent deals</p>{deals.filter((deal) => deal.stage !== "paid").slice(0, 3).map((deal) => <button key={deal.id} type="button" aria-label={`Open ${deal.title} — ${deal.brand?.name ?? "Unknown brand"}`} onClick={() => onDeal(deal.id)} className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine/30"><span className="min-w-0"><span className="block truncate text-[12px] font-medium text-ink">{deal.title}</span><span className="block text-[10.5px] text-ink-3">{deal.brand?.name ?? "Unknown brand"}</span></span><span className="tnum text-[11px] font-semibold text-ink">{formatCents(deal.valueCents)}</span></button>)}</div>}</section>;
}

function OverdueAlert({ invoice, onReview, onViewAll }: { invoice: { title?: string | null; number?: number; amountCents: number; dueAt?: Date | null }; onReview: () => void; onViewAll: () => void }) {
  const age = invoice.dueAt ? Math.max(1, Math.ceil((Date.now() - new Date(invoice.dueAt).getTime()) / DAY)) : 0;
  return <motion.section {...entrance(0)} className="flex flex-col gap-4 rounded-xl border border-brick/20 bg-brick-tint/50 p-4 sm:flex-row sm:items-center" aria-label="Overdue payment alert"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-brick"><AlertCircle className="h-4 w-4" /></span><div className="min-w-0 flex-1"><h2 className="truncate text-[13px] font-semibold text-ink">{invoice.title || `Invoice #${invoice.number ?? ""}`}</h2><p className="mt-0.5 text-[12px] text-ink-2"><strong className="tnum text-brick">{formatCents(invoice.amountCents)}</strong> · {age} day{age === 1 ? "" : "s"} overdue · Automatic chase active</p></div><div className="flex gap-2"><button type="button" onClick={onReview} className="rounded-lg bg-brick px-3 py-2 text-[11px] font-semibold text-white">Review invoice</button><button type="button" onClick={onViewAll} className="rounded-lg border border-brick/25 bg-surface px-3 py-2 text-[11px] font-semibold text-brick">View all</button></div></motion.section>;
}

function ActivityPanel({ activity, loading, error }: { activity: Array<{ id: string; actor: string; entityType: string; payload: unknown; createdAt: Date | string }>; loading: boolean; error: boolean }) {
  return <section className="rounded-xl border border-hairline bg-surface p-5 shadow-warm" aria-labelledby="activity-heading"><h2 id="activity-heading" className="font-serif text-[18px] text-ink">Recent activity</h2><p className="mt-0.5 text-[11px] text-ink-3">Newest updates across your business</p>{loading ? <p className="mt-6 text-[12px] text-ink-3">Loading activity…</p> : error ? <p className="mt-6 text-[12px] text-brick">Couldn’t load recent activity.</p> : activity.length === 0 ? <p className="mt-6 text-[12px] text-ink-3">No activity yet.</p> : <div className="mt-4 divide-y divide-hairline">{activity.map((event, index) => { const { icon: Icon, label } = activityIcon(event.entityType); return <motion.div key={event.id} {...entrance(index, { stagger: STAGGER.tight })} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"><span aria-label={label} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-subtle text-ink-2"><Icon className="h-3.5 w-3.5" /></span><p className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{describeActivity(event.actor, event.payload)}</p><time className="shrink-0 text-[10.5px] text-ink-3" dateTime={new Date(event.createdAt).toISOString()}>{relativeTime(event.createdAt)}</time></motion.div>; })}</div>}</section>;
}
