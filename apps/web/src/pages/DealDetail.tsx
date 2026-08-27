import { useState } from "react";
import { useParams, useNavigate } from "react-router";
import { trpc } from "@/trpc";
import { stageLabels, platforms, deliverableStatuses, benchmarkDeliverableTypes } from "@sponsee/shared";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { BenchmarkBand } from "@/components/BenchmarkBand";
import {
  ArrowLeft,
  Check,
  X,
  User,
  FileText,
  ListChecks,
  ChevronDown,
  Plus,
  Trash2,
} from "lucide-react";

function formatCents(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

const statusBadge: Record<string, string> = {
  not_started: "bg-surface text-ink-3 border-hairline",
  scheduled: "bg-amber-tint text-amber border-amber/20",
  in_progress: "bg-blue-50 text-blue-600 border-blue-200",
  done: "bg-pine-tint text-pine border-pine/20",
  missed: "bg-brick-tint text-brick border-brick/20",
  rescheduled: "bg-amber-tint text-amber border-amber/20",
};

const statusLabel: Record<string, string> = {
  not_started: "Not started",
  scheduled: "Scheduled",
  in_progress: "In progress",
  done: "Done",
  missed: "Missed",
  rescheduled: "Rescheduled",
};

export default function DealDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { data: deal, isLoading } = trpc.deals.getById.useQuery(
    { id: id! },
    { enabled: !!id }
  );

  const updateDeal = trpc.deals.update.useMutation({
    onSuccess: () => {
      utils.deals.getById.invalidate({ id: id! });
      utils.deals.list.invalidate();
      toast("Deal updated");
    },
  });

  const createInvoice = trpc.invoice.create.useMutation({
    onSuccess: () => {
      utils.deals.getById.invalidate({ id: id! });
      utils.invoice.list.invalidate();
      toast("Invoice created");
    },
  });

  const createDeliverable = trpc.deliverable.create.useMutation({
    onSuccess: () => {
      utils.deals.getById.invalidate({ id: id! });
      toast("Deliverable added");
    },
  });

  const updateDeliverable = trpc.deliverable.update.useMutation({
    onSuccess: () => {
      utils.deals.getById.invalidate({ id: id! });
    },
  });

  const deleteDeliverable = trpc.deliverable.delete.useMutation({
    onSuccess: () => {
      utils.deals.getById.invalidate({ id: id! });
      toast("Deliverable removed");
    },
  });

  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [showAddDeliverable, setShowAddDeliverable] = useState(false);
  const [deliverableTitle, setDeliverableTitle] = useState("");
  const [deliverablePlatform, setDeliverablePlatform] = useState<string>("");
  const [deliverableDueAt, setDeliverableDueAt] = useState("");
  const [openStatusId, setOpenStatusId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-pine border-t-transparent" />
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="py-24 text-center">
        <p className="text-ink-3">Deal not found</p>
        <button
          onClick={() => navigate("/pipeline")}
          className="mt-4 text-pine hover:underline"
        >
          Back to pipeline
        </button>
      </div>
    );
  }

  function startEdit(field: string, value: string) {
    setEditingField(field);
    setEditValue(value);
  }

  function saveEdit(field: string) {
    if (!id) return;
    const payload: Record<string, unknown> = { id };
    if (field === "valueCents") {
      const num = parseInt(editValue, 10);
      if (!isNaN(num)) payload.valueCents = num * 100;
    } else if (field === "notes" || field === "source" || field === "valueNote") {
      payload[field] = editValue || null;
    } else {
      payload[field] = editValue;
    }
    updateDeal.mutate(payload as { id: string });
    setEditingField(null);
  }

  function handleAddDeliverable(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !deliverableTitle.trim()) return;
    createDeliverable.mutate({
      dealId: id,
      title: deliverableTitle.trim(),
      platform: (deliverablePlatform as typeof platforms[number]) || undefined,
      dueAt: deliverableDueAt ? new Date(deliverableDueAt) : undefined,
      position: (deal?.deliverables?.length ?? 0),
    });
    setDeliverableTitle("");
    setDeliverablePlatform("");
    setDeliverableDueAt("");
    setShowAddDeliverable(false);
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <button
        onClick={() => navigate("/pipeline")}
        className="flex items-center gap-1 text-[13px] text-ink-3 transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Pipeline
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                deal.stage === "inbound" && "bg-ink-3/10 text-ink-2",
                deal.stage === "negotiating" && "bg-amber-tint text-amber",
                deal.stage === "contract_sent" && "bg-pine-tint text-pine",
                deal.stage === "live" && "bg-pine/10 text-pine",
                deal.stage === "delivered" && "bg-blue-50 text-blue-600",
                deal.stage === "paid" && "bg-pine-tint text-pine"
              )}
            >
              {stageLabels[deal.stage]}
            </span>
            <span className="text-[12px] text-ink-3">
              {deal.brand?.name}
            </span>
          </div>

          {editingField === "title" ? (
            <div className="mt-1 flex items-center gap-2">
              <input
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="rounded border border-hairline px-2 py-1 text-[18px] font-semibold text-ink outline-none focus:border-pine"
                autoFocus
              />
              <button onClick={() => saveEdit("title")} className="text-pine">
                <Check className="h-4 w-4" />
              </button>
              <button onClick={() => setEditingField(null)} className="text-ink-3">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <h1
              onClick={() => startEdit("title", deal.title)}
              className="mt-1 cursor-text text-[18px] font-semibold tracking-[-0.01em] text-ink hover:text-ink-2"
            >
              {deal.title}
            </h1>
          )}
        </div>

        <div className="text-right">
          <p className="text-[13px] text-ink-3">Deal value</p>
          {editingField === "valueCents" ? (
            <div className="flex items-center justify-end gap-2">
              <span className="text-[13px] text-ink-3">$</span>
              <input
                type="number"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="w-24 rounded border border-hairline px-2 py-1 text-right text-[15px] font-semibold text-ink outline-none focus:border-pine"
                autoFocus
              />
              <button onClick={() => saveEdit("valueCents")} className="text-pine">
                <Check className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <p
              onClick={() => startEdit("valueCents", String(deal.valueCents / 100))}
              className="cursor-text text-[15px] font-semibold text-ink hover:text-ink-2"
            >
              {formatCents(deal.valueCents)}
            </p>
          )}
        </div>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="space-y-4 lg:col-span-2">
          {/* Details card */}
          <div className="rounded-xl border border-hairline bg-surface p-4">
            <h3 className="text-[13px] font-semibold text-ink">Deal details</h3>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <DetailRow label="Type" value={deal.type} />
              <DetailRow label="Source" value={deal.source ?? "—"} />
              <DetailRow label="Payment terms" value={deal.paymentTerms ?? "—"} />
              <DetailRow
                label="Platforms"
                value={deal.platforms?.join(", ") ?? "—"}
              />
              <div className="col-span-2">
                <p className="text-[11px] font-medium uppercase tracking-wider text-ink-3">
                  Notes
                </p>
                {editingField === "notes" ? (
                  <div className="mt-1 flex items-start gap-2">
                    <textarea
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="min-h-[80px] w-full rounded border border-hairline px-2 py-1 text-[13px] text-ink outline-none focus:border-pine"
                      autoFocus
                    />
                    <div className="flex flex-col gap-1">
                      <button onClick={() => saveEdit("notes")} className="text-pine">
                        <Check className="h-4 w-4" />
                      </button>
                      <button onClick={() => setEditingField(null)} className="text-ink-3">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <p
                    onClick={() => startEdit("notes", deal.notes ?? "")}
                    className="mt-1 cursor-text text-[13px] leading-5 text-ink-2 hover:text-ink"
                  >
                    {deal.notes || "No notes yet. Click to add."}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Deliverables */}
          <div className="rounded-xl border border-hairline bg-surface p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-ink">Deliverables</h3>
              <button
                onClick={() => setShowAddDeliverable((s) => !s)}
                className="flex items-center gap-1 text-[12px] font-medium text-pine hover:text-pine-hover"
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </button>
            </div>

            {showAddDeliverable && (
              <form onSubmit={handleAddDeliverable} className="mt-3 space-y-2 rounded-lg border border-hairline bg-surface-subtle p-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <input
                    value={deliverableTitle}
                    onChange={(e) => setDeliverableTitle(e.target.value)}
                    placeholder="Deliverable title"
                    className="rounded-lg border border-hairline bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-pine"
                  />
                  <select
                    value={deliverablePlatform}
                    onChange={(e) => setDeliverablePlatform(e.target.value)}
                    className="rounded-lg border border-hairline bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-pine"
                  >
                    <option value="">Platform</option>
                    {platforms.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={deliverableDueAt}
                    onChange={(e) => setDeliverableDueAt(e.target.value)}
                    className="rounded-lg border border-hairline bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-pine"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAddDeliverable(false)}
                    className="rounded-md border border-hairline px-3 py-1 text-[12px] text-ink-3 hover:bg-surface"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createDeliverable.isPending || !deliverableTitle.trim()}
                    className="rounded-md bg-pine px-3 py-1 text-[12px] font-medium text-white hover:bg-pine-hover disabled:opacity-50"
                  >
                    Add deliverable
                  </button>
                </div>
              </form>
            )}

            {deal.deliverables && deal.deliverables.length > 0 ? (
              <div className="mt-3 space-y-2">
                {deal.deliverables.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between rounded-lg border border-hairline bg-surface-subtle px-3 py-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <ListChecks className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                      <span className="text-[13px] text-ink truncate">{d.title}</span>
                      {d.platform && (
                        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                          {d.platform}
                        </span>
                      )}
                      {d.dueAt && (
                        <span className="shrink-0 text-[10px] text-ink-3">
                          Due {new Date(d.dueAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <button
                          onClick={() => setOpenStatusId(openStatusId === d.id ? null : d.id)}
                          className={cn(
                            "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                            statusBadge[d.status]
                          )}
                        >
                          {statusLabel[d.status]}
                          <ChevronDown className="h-3 w-3" />
                        </button>
                        {openStatusId === d.id && (
                          <div className="absolute right-0 z-10 mt-1 w-36 rounded-lg border border-hairline bg-surface shadow-lg">
                            {deliverableStatuses.map((s) => (
                              <button
                                key={s}
                                onClick={() => {
                                  updateDeliverable.mutate({ id: d.id, status: s });
                                  setOpenStatusId(null);
                                }}
                                className={cn(
                                  "block w-full px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-surface-subtle",
                                  d.status === s ? "font-semibold text-pine" : "text-ink-2"
                                )}
                              >
                                {statusLabel[s]}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          if (confirm("Remove this deliverable?")) {
                            deleteDeliverable.mutate({ id: d.id });
                          }
                        }}
                        className="text-ink-3 hover:text-brick"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-[13px] text-ink-3">
                No deliverables yet.
              </p>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Contact */}
          <div className="rounded-xl border border-hairline bg-surface p-4">
            <h3 className="text-[13px] font-semibold text-ink">Contact</h3>
            {deal.primaryContact ? (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2">
                  <User className="h-3.5 w-3.5 text-ink-3" />
                  <span className="text-[13px] text-ink">
                    {deal.primaryContact.name}
                  </span>
                </div>
                <p className="pl-5 text-[12px] text-ink-3">
                  {deal.primaryContact.email}
                </p>
                {deal.primaryContact.role && (
                  <p className="pl-5 text-[12px] text-ink-3">
                    {deal.primaryContact.role}
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-3 text-[13px] text-ink-3">
                No primary contact set.
              </p>
            )}
          </div>

          {/* CPVH Helper */}
          <div className="rounded-xl border border-hairline bg-surface p-4">
            <h3 className="text-[13px] font-semibold text-ink">CPVH Pricing</h3>
            <CPVHHelper dealValueCents={deal.valueCents} />
          </div>

          {/* Actions */}
          <div className="rounded-xl border border-hairline bg-surface p-4">
            <h3 className="text-[13px] font-semibold text-ink">Actions</h3>
            <div className="mt-3 space-y-2">
              <button
                onClick={() => {
                  if (!deal) return;
                  createInvoice.mutate({
                    dealId: deal.id,
                    contactId: deal.primaryContactId ?? undefined,
                    title: `${deal.title} — Invoice`,
                    amountCents: deal.valueCents,
                    currency: deal.currency,
                    terms: deal.paymentTerms ?? "net_30",
                  });
                }}
                className="flex w-full items-center gap-2 rounded-lg border border-hairline px-3 py-2 text-[13px] text-ink-2 transition-colors hover:bg-surface-subtle hover:text-ink"
              >
                <FileText className="h-3.5 w-3.5" />
                Generate invoice
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wider text-ink-3">
        {label}
      </p>
      <p className="mt-0.5 text-[13px] text-ink">{value}</p>
    </div>
  );
}

function CPVHHelper({ dealValueCents }: { dealValueCents: number }) {
  const [ccv, setCcv] = useState(500);
  const [durationMin, setDurationMin] = useState(60);
  const [deliverableType, setDeliverableType] =
    useState<(typeof benchmarkDeliverableTypes)[number]>("ad-read");

  const { data: benchmark } = trpc.calculator.compute.useQuery({
    ccv,
    durationMinutes: durationMin,
    deliverableType,
  });

  return (
    <div className="mt-3 space-y-3">
      <div>
        <label className="text-[11px] font-medium text-ink-3">Avg CCV</label>
        <input
          type="number"
          value={ccv}
          onChange={(e) => setCcv(Number(e.target.value))}
          className="mt-0.5 w-full rounded border border-hairline px-2 py-1 text-[13px] text-ink outline-none focus:border-pine"
        />
      </div>
      <div>
        <label className="text-[11px] font-medium text-ink-3">Duration (min)</label>
        <input
          type="number"
          value={durationMin}
          onChange={(e) => setDurationMin(Number(e.target.value))}
          className="mt-0.5 w-full rounded border border-hairline px-2 py-1 text-[13px] text-ink outline-none focus:border-pine"
        />
      </div>
      <div>
        <label className="text-[11px] font-medium text-ink-3">Deliverable type</label>
        <select
          value={deliverableType}
          onChange={(e) =>
            setDeliverableType(e.target.value as (typeof benchmarkDeliverableTypes)[number])
          }
          className="mt-0.5 w-full rounded border border-hairline px-2 py-1 text-[13px] text-ink outline-none focus:border-pine"
        >
          <option value="ad-read">Ad read (1.0x)</option>
          <option value="segment">Segment (1.25x)</option>
          <option value="vod">VOD (1.6x)</option>
        </select>
      </div>

      {benchmark && (
        <>
          <div className="rounded-lg bg-surface-subtle p-2">
            <p className="text-[11px] text-ink-3">Suggested range</p>
            <p className="mt-0.5 text-[13px] font-semibold text-ink">
              {formatCents(benchmark.floor)} – {formatCents(benchmark.agency)}
            </p>
            <p className="text-[12px] text-pine">Midpoint: {formatCents(benchmark.mid)}</p>
          </div>
          <BenchmarkBand benchmark={benchmark} dealValueCents={dealValueCents} />
        </>
      )}
    </div>
  );
}
