import { trpc } from "@/trpc";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { stageLabels, dealStages } from "@sponsee/shared";
import { cn } from "@/lib/utils";
import {
  KanbanSquare,
  Wallet,
  AlertCircle,
  TrendingUp,
  ArrowRight,
  Mail,
} from "lucide-react";
import { useNavigate } from "react-router";
import QueryError from "@/components/QueryError";

function formatCents(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

type ActivityPayload = {
  step?: number;
  status?: string;
  action?: string;
  reason?: string;
};

function describeActivity(actor: string, payload: unknown): string {
  const p = (payload ?? {}) as ActivityPayload;
  const step = p.step !== undefined ? `step ${p.step}` : "chase";

  if (p.action === "pause") return `Chase paused${p.reason ? ` (${p.reason})` : ""}`;
  if (p.action === "resume") return "Chase resumed";
  if (p.action === "approve") return `Chase ${step} approved and sent`;
  if (p.action === "edit_and_send") return `Chase ${step} edited and sent`;

  switch (p.status) {
    case "awaiting_review":
      return `Chase ${step} ready for review`;
    case "sent":
      return `Chase ${step} sent`;
    case "bounced":
      return `Chase ${step} bounced`;
    case "failed":
      return `Chase ${step} failed to send`;
    case "complained":
      return `Spam complaint on chase ${step}`;
    default:
      return actor === "system" ? "Chase activity" : "Chase updated";
  }
}

export default function Dashboard() {
  const navigate = useNavigate();
  useDocumentTitle("Dashboard");
  const {
    data: deals,
    isLoading: dealsLoading,
    isError: dealsError,
    refetch: refetchDeals,
  } = trpc.deals.list.useQuery();
  const {
    data: invoices,
    isLoading: invoicesLoading,
    isError: invoicesError,
    refetch: refetchInvoices,
  } = trpc.invoice.list.useQuery();
  const {
    data: activity,
    isLoading: activityLoading,
    isError: activityError,
  } = trpc.activity.list.useQuery({ limit: 8 });

  if (dealsLoading || invoicesLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-pine border-t-transparent" />
      </div>
    );
  }

  if (dealsError || invoicesError) {
    return (
      <QueryError
        message="Couldn't load your dashboard."
        onRetry={() => {
          if (dealsError) refetchDeals();
          if (invoicesError) refetchInvoices();
        }}
      />
    );
  }

  const activeDeals = deals?.filter((d) => d.stage !== "paid") ?? [];
  const pipelineValue = activeDeals.reduce((s, d) => s + d.valueCents, 0);

  const openInvoices = invoices?.filter((i) => i.status === "open") ?? [];
  const overdueInvoices = openInvoices.filter(
    (i) => i.dueAt && new Date(i.dueAt) < new Date()
  );
  const outstanding = openInvoices.reduce((s, i) => s + i.amountCents, 0);

  const stageCounts = Object.fromEntries(
    dealStages.map((s) => [
      s,
      deals?.filter((d) => d.stage === s).length ?? 0,
    ])
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-[19px] text-ink">Dashboard</h2>
        <p className="text-[13px] text-ink-3">
          Overview of your sponsorship business
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={KanbanSquare}
          label="Active deals"
          value={String(activeDeals.length)}
          sub={`${deals?.length ?? 0} total`}
          onClick={() => navigate("/pipeline")}
        />
        <KpiCard
          icon={TrendingUp}
          label="Pipeline value"
          value={formatCents(pipelineValue)}
          sub="Weighted forecast"
          onClick={() => navigate("/pipeline")}
        />
        <KpiCard
          icon={Wallet}
          label="Outstanding"
          value={formatCents(outstanding)}
          sub={`${openInvoices.length} open invoices`}
          onClick={() => navigate("/payments")}
        />
        <KpiCard
          icon={AlertCircle}
          label="Overdue"
          value={String(overdueInvoices.length)}
          sub="Needs attention"
          accent="text-brick"
          onClick={() => navigate("/payments")}
        />
      </div>

      {/* Stage breakdown */}
      <div className="rounded-xl border border-hairline bg-surface p-4">
        <h3 className="text-[13px] font-semibold text-ink">Pipeline stages</h3>
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {dealStages.map((stage) => (
            <button
              key={stage}
              onClick={() => navigate("/pipeline")}
              className="rounded-lg border border-hairline bg-surface-subtle p-2 text-left transition-colors hover:border-pine/30"
            >
              <p className="text-[11px] font-medium uppercase tracking-wider text-ink-3">
                {stageLabels[stage]}
              </p>
              <p className="mt-1 text-[18px] font-semibold text-ink">
                {stageCounts[stage]}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Recent deals */}
      <div className="rounded-xl border border-hairline bg-surface p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-ink">Recent deals</h3>
          <button
            onClick={() => navigate("/pipeline")}
            className="flex items-center gap-1 text-[12px] font-medium text-pine hover:text-pine-hover"
          >
            View all
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
        {activeDeals.length > 0 ? (
          <div className="mt-3 space-y-2">
            {activeDeals.slice(0, 5).map((deal) => (
              <div
                key={deal.id}
                role="button"
                tabIndex={0}
                aria-label={`Open ${deal.title} — ${deal.brand?.name ?? "Unknown brand"}`}
                onClick={() => navigate(`/pipeline/${deal.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate(`/pipeline/${deal.id}`);
                  }
                }}
                className="flex cursor-pointer items-center justify-between rounded-lg border border-hairline bg-surface-subtle px-3 py-2 transition-colors hover:border-pine/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-pine focus-visible:ring-offset-1"
              >
                <div>
                  <p className="text-[13px] font-medium text-ink">{deal.title}</p>
                  <p className="text-[11px] text-ink-3">
                    {deal.brand?.name} · {stageLabels[deal.stage]}
                  </p>
                </div>
                <p className="text-[13px] font-semibold text-ink">
                  {formatCents(deal.valueCents)}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-[13px] text-ink-3">No active deals yet.</p>
        )}
      </div>

      {/* Recent activity — newest first (D-010) */}
      <div className="rounded-xl border border-hairline bg-surface p-4">
        <h3 className="text-[13px] font-semibold text-ink">Recent activity</h3>
        {activityLoading ? (
          <div className="mt-3 flex h-16 items-center justify-center">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-pine border-t-transparent" />
          </div>
        ) : activityError ? (
          <p className="mt-3 text-[13px] text-ink-3">Couldn't load recent activity.</p>
        ) : activity && activity.length > 0 ? (
          <div className="mt-3 space-y-1">
            {activity.map((event) => (
              <div key={event.id} className="flex items-center gap-2.5 rounded-lg px-1 py-1.5">
                <Mail className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                <p className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">
                  {describeActivity(event.actor, event.payload)}
                </p>
                <span className="shrink-0 text-[11px] text-ink-3">
                  {new Date(event.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-[13px] text-ink-3">No activity yet.</p>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub: string;
  accent?: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl border border-hairline bg-surface p-3 text-left transition-colors hover:border-pine/30"
    >
      <div className="flex items-center gap-1.5">
        <Icon className={cn("h-3.5 w-3.5", accent ?? "text-ink-3")} />
        <span className="text-[11px] font-medium uppercase tracking-wider text-ink-3">
          {label}
        </span>
      </div>
      <p className={cn("mt-1 text-[18px] font-semibold", accent ?? "text-ink")}>
        {value}
      </p>
      <p className="text-[11px] text-ink-3">{sub}</p>
    </button>
  );
}
