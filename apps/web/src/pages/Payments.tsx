import { useState } from "react";
import { trpc } from "@/trpc";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Plus,
  FileText,
  Clock,
  CheckCircle2,
  Ban,
  ChevronRight,
  Mail,
  Pause,
  Play,
} from "lucide-react";

function formatCents(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function daysDiff(from: Date, to: Date) {
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

const statusConfig: Record<
  string,
  { label: string; icon: React.ElementType; color: string }
> = {
  draft: { label: "Draft", icon: FileText, color: "bg-ink-3/10 text-ink-3" },
  open: { label: "Open", icon: Clock, color: "bg-amber-tint text-amber" },
  paid: { label: "Paid", icon: CheckCircle2, color: "bg-pine-tint text-pine" },
  void: { label: "Void", icon: Ban, color: "bg-ink-3/10 text-ink-3" },
};

export default function Payments() {
  const utils = trpc.useUtils();
  const { data: invoices, isLoading } = trpc.invoice.list.useQuery();
  const markPaid = trpc.invoice.markPaid.useMutation({
    onSuccess: () => {
      utils.invoice.list.invalidate();
      toast("Invoice marked as paid");
    },
  });

  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-pine border-t-transparent" />
      </div>
    );
  }

  const now = new Date();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Payments</h2>
          <p className="text-[13px] text-ink-3">
            {invoices?.length ?? 0} invoices
          </p>
        </div>
        <button
          onClick={() => toast("Create invoice from a deal on the Pipeline page")}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-pine px-3 text-[13px] font-medium text-white transition-colors hover:bg-pine-hover"
        >
          <Plus className="h-3.5 w-3.5" />
          New invoice
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label="Total outstanding"
          value={formatCents(
            invoices
              ?.filter((i) => i.status === "open")
              .reduce((sum, i) => sum + i.amountCents, 0) ?? 0
          )}
          accent="text-amber"
        />
        <StatCard
          label="Overdue"
          value={String(
            invoices?.filter(
              (i) => i.status === "open" && i.dueAt && new Date(i.dueAt) < now
            ).length ?? 0
          )}
          accent="text-brick"
        />
        <StatCard
          label="Paid (YTD)"
          value={formatCents(
            invoices
              ?.filter((i) => i.status === "paid")
              .reduce((sum, i) => sum + i.amountCents, 0) ?? 0
          )}
          accent="text-pine"
        />
      </div>

      {/* Invoice list */}
      <div className="rounded-xl border border-hairline bg-surface">
        <div className="grid grid-cols-12 gap-3 border-b border-hairline px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-ink-3">
          <div className="col-span-3">Invoice</div>
          <div className="col-span-2">Amount</div>
          <div className="col-span-2">Due</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-3">Actions</div>
        </div>

        {invoices && invoices.length > 0 ? (
          invoices.map((inv) => {
            const dueDate = inv.dueAt ? new Date(inv.dueAt) : null;
            const isOverdue =
              inv.status === "open" && dueDate && dueDate < now;
            const daysOverdue = isOverdue && dueDate ? daysDiff(dueDate, now) : 0;
            const status = statusConfig[inv.status] ?? statusConfig.draft;
            const StatusIcon = status.icon;

            return (
              <div
                key={inv.id}
                className="border-b border-hairline last:border-b-0"
              >
                <div className="grid grid-cols-12 items-center gap-3 px-4 py-3">
                  <div className="col-span-3">
                    <p className="text-[13px] font-medium text-ink">
                      {inv.title || `Invoice #${inv.number}`}
                    </p>
                    <p className="text-[11px] text-ink-3">
                      Issued {new Date(inv.issuedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-[13px] font-semibold text-ink">
                      {formatCents(inv.amountCents)}
                    </p>
                  </div>
                  <div className="col-span-2">
                    {dueDate ? (
                      <div className="flex items-center gap-1">
                        <span
                          className={cn(
                            "text-[12px]",
                            isOverdue ? "text-brick font-medium" : "text-ink-2"
                          )}
                        >
                          {dueDate.toLocaleDateString()}
                        </span>
                        {isOverdue && (
                          <span className="rounded bg-brick-tint px-1 py-0.5 text-[10px] font-semibold text-brick">
                            {daysOverdue}d late
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-[12px] text-ink-3">—</span>
                    )}
                  </div>
                  <div className="col-span-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                        status.color
                      )}
                    >
                      <StatusIcon className="h-3 w-3" />
                      {status.label}
                    </span>
                  </div>
                  <div className="col-span-3 flex items-center gap-2">
                    {inv.status === "open" && (
                      <button
                        onClick={() =>
                          markPaid.mutate({ id: inv.id })
                        }
                        className="flex h-7 items-center gap-1 rounded-md border border-pine/30 bg-pine-tint px-2 text-[11px] font-medium text-pine transition-colors hover:bg-pine/10"
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        Mark paid
                      </button>
                    )}
                    <button
                      onClick={() =>
                        setExpandedId(expandedId === inv.id ? null : inv.id)
                      }
                      className="flex h-7 items-center gap-1 rounded-md border border-hairline px-2 text-[11px] text-ink-2 transition-colors hover:bg-surface-subtle"
                    >
                      {expandedId === inv.id ? "Less" : "More"}
                      <ChevronRight
                        className={cn(
                          "h-3 w-3 transition-transform",
                          expandedId === inv.id && "rotate-90"
                        )}
                      />
                    </button>
                  </div>
                </div>

                {/* Expanded chase info */}
                {expandedId === inv.id && inv.status === "open" && (
                  <InvoiceChasePanel invoiceId={inv.id} />
                )}
              </div>
            );
          })
        ) : (
          <div className="px-4 py-8 text-center">
            <p className="text-[13px] text-ink-3">No invoices yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-hairline bg-surface p-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-ink-3">
        {label}
      </p>
      <p className={cn("mt-1 text-[18px] font-semibold", accent)}>{value}</p>
    </div>
  );
}

function InvoiceChasePanel({ invoiceId }: { invoiceId: string }) {
  const { data: state } = trpc.chase.state.useQuery({ invoiceId });
  const { data: events } = trpc.chase.events.useQuery({ invoiceId });
  const pause = trpc.chase.pause.useMutation({
    onSuccess: () => {
      utils.chase.state.invalidate({ invoiceId });
    },
  });
  const resume = trpc.chase.resume.useMutation({
    onSuccess: () => {
      utils.chase.state.invalidate({ invoiceId });
    },
  });
  const utils = trpc.useUtils();

  return (
    <div className="mx-4 mb-3 rounded-lg border border-hairline bg-surface-subtle p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mail className="h-3.5 w-3.5 text-ink-3" />
          <span className="text-[12px] font-medium text-ink">
            Chase sequence
          </span>
          {state && (
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                state.mode === "armed" && "bg-pine-tint text-pine",
                state.mode === "paused" && "bg-amber-tint text-amber",
                state.mode === "completed" && "bg-ink-3/10 text-ink-3"
              )}
            >
              {state.mode}
            </span>
          )}
        </div>
        {state?.mode === "armed" && (
          <button
            onClick={() => pause.mutate({ invoiceId, reason: "Manual pause" })}
            className="flex h-6 items-center gap-1 rounded border border-hairline px-1.5 text-[11px] text-ink-3 hover:bg-surface"
          >
            <Pause className="h-3 w-3" />
            Pause
          </button>
        )}
        {state?.mode === "paused" && (
          <button
            onClick={() => resume.mutate({ invoiceId })}
            className="flex h-6 items-center gap-1 rounded border border-hairline px-1.5 text-[11px] text-pine hover:bg-pine-tint"
          >
            <Play className="h-3 w-3" />
            Resume
          </button>
        )}
      </div>

      {events && events.length > 0 ? (
        <div className="mt-2 space-y-1">
          {events.map((ev) => (
            <div
              key={ev.id}
              className="flex items-center justify-between rounded bg-surface px-2 py-1.5"
            >
              <div>
                <p className="text-[11px] font-medium text-ink">
                  Step {ev.step}: {ev.subjectSnapshot || "Chase email"}
                </p>
                <p className="text-[10px] text-ink-3">
                  {ev.toEmail} · {ev.status}
                </p>
              </div>
              <span className="text-[10px] text-ink-3">
                {new Date(ev.createdAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-ink-3">
          No chase emails sent yet. Next step will trigger automatically when
          overdue.
        </p>
      )}
    </div>
  );
}
