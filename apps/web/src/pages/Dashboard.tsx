import { trpc } from "@/trpc";
import { stageLabels, dealStages } from "@sponsee/shared";
import { cn } from "@/lib/utils";
import {
  KanbanSquare,
  Wallet,
  AlertCircle,
  TrendingUp,
  ArrowRight,
} from "lucide-react";
import { useNavigate } from "react-router";

function formatCents(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { data: deals } = trpc.deals.list.useQuery();
  const { data: invoices } = trpc.invoice.list.useQuery();

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
        <h2 className="text-[15px] font-semibold text-ink">Dashboard</h2>
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
                onClick={() => navigate(`/pipeline/${deal.id}`)}
                className="flex cursor-pointer items-center justify-between rounded-lg border border-hairline bg-surface-subtle px-3 py-2 transition-colors hover:border-pine/30"
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
