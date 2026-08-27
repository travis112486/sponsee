import { useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/trpc";
import { stageLabels, dealStages, type DealStage, platforms } from "@sponsee/shared";
import { cn } from "@/lib/utils";
import {
  Plus,
  ChevronRight,
  DollarSign,
  X,
} from "lucide-react";
import { toast } from "sonner";

function formatCents(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

const stageColors: Record<DealStage, string> = {
  inbound: "bg-ink-3/10 text-ink-2",
  negotiating: "bg-amber-tint text-amber",
  contract_sent: "bg-pine-tint text-pine",
  live: "bg-pine/10 text-pine",
  delivered: "bg-blue-50 text-blue-600",
  paid: "bg-pine-tint text-pine",
};

export default function Pipeline() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { data: deals, isLoading } = trpc.deals.list.useQuery();
  const updateStage = trpc.deals.updateStage.useMutation({
    onSuccess: () => {
      utils.deals.list.invalidate();
      toast("Deal moved");
    },
  });

  const [movingDealId, setMovingDealId] = useState<string | null>(null);
  const [showNewDeal, setShowNewDeal] = useState(false);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-pine border-t-transparent" />
      </div>
    );
  }

  const byStage = Object.fromEntries(
    dealStages.map((s) => [s, deals?.filter((d) => d.stage === s) ?? []])
  ) as Record<DealStage, typeof deals>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Deal Pipeline</h2>
          <p className="text-[13px] text-ink-3">
            {deals?.length ?? 0} active deals
          </p>
        </div>
        <button
          onClick={() => setShowNewDeal(true)}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-pine px-3 text-[13px] font-medium text-white transition-colors hover:bg-pine-hover"
        >
          <Plus className="h-3.5 w-3.5" />
          New deal
        </button>
      </div>

      {/* Board */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {dealStages.map((stage) => (
          <div
            key={stage}
            className="flex w-[260px] shrink-0 flex-col rounded-xl border border-hairline bg-surface-subtle"
          >
            {/* Column header */}
            <div className="flex items-center justify-between px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex h-2 w-2 rounded-full",
                    stage === "inbound" && "bg-ink-3",
                    stage === "negotiating" && "bg-amber",
                    stage === "contract_sent" && "bg-pine",
                    stage === "live" && "bg-pine",
                    stage === "delivered" && "bg-blue-500",
                    stage === "paid" && "bg-pine"
                  )}
                />
                <span className="text-[13px] font-semibold text-ink">
                  {stageLabels[stage]}
                </span>
              </div>
              <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-3">
                {byStage[stage]?.length ?? 0}
              </span>
            </div>

            {/* Cards */}
            <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
              {byStage[stage]?.map((deal) => (
                <div
                  key={deal.id}
                  onClick={() => navigate(`/pipeline/${deal.id}`)}
                  className="group cursor-pointer rounded-lg border border-hairline bg-surface p-3 shadow-warm transition-all hover:border-pine/30 hover:shadow-warm-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-semibold text-ink-2">
                        {deal.brand?.name ?? "Unknown brand"}
                      </p>
                      <p className="mt-0.5 truncate text-[13px] font-medium text-ink">
                        {deal.title}
                      </p>
                    </div>
                    <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>

                  <div className="mt-2 flex items-center gap-3">
                    <div className="flex items-center gap-1 text-[12px] font-medium text-ink-2">
                      <DollarSign className="h-3 w-3 text-ink-3" />
                      {formatCents(deal.valueCents)}
                    </div>
                    {deal.platforms && deal.platforms.length > 0 && (
                      <div className="flex gap-1">
                        {deal.platforms.map((p) => (
                          <span
                            key={p}
                            className={cn(
                              "text-[10px] font-semibold uppercase tracking-wider",
                              p === "twitch" && "text-twitch",
                              p === "youtube" && "text-youtube",
                              p === "kick" && "text-kick",
                              p === "tiktok" && "text-ink-3"
                            )}
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {deal.notes && (
                    <p className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-ink-3">
                      {deal.notes}
                    </p>
                  )}

                  {/* Stage mover */}
                  {movingDealId === deal.id ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {dealStages
                        .filter((s) => s !== deal.stage)
                        .map((s) => (
                          <button
                            key={s}
                            onClick={(e) => {
                              e.stopPropagation();
                              updateStage.mutate({ id: deal.id, stage: s });
                              setMovingDealId(null);
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
                        onClick={(e) => {
                          e.stopPropagation();
                          setMovingDealId(null);
                        }}
                        className="rounded px-1.5 py-0.5 text-[10px] text-ink-3 hover:bg-surface-subtle"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMovingDealId(deal.id);
                      }}
                      className="mt-2 text-[11px] font-medium text-pine opacity-0 transition-opacity hover:text-pine-hover group-hover:opacity-100"
                    >
                      Move…
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {showNewDeal && <NewDealModal onClose={() => setShowNewDeal(false)} />}
    </div>
  );
}

function NewDealModal({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const { data: brands } = trpc.brand.list.useQuery();
  const createBrand = trpc.brand.create.useMutation({
    onSuccess: () => utils.brand.list.invalidate(),
  });
  const createDeal = trpc.deals.create.useMutation({
    onSuccess: () => {
      utils.deals.list.invalidate();
      toast("Deal created");
      onClose();
    },
  });

  const [brandMode, setBrandMode] = useState<"select" | "create">("select");
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [newBrandName, setNewBrandName] = useState("");
  const [newBrandCategory, setNewBrandCategory] = useState("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<"flat" | "bounty" | "hybrid">("flat");
  const [valueDollars, setValueDollars] = useState("");
  const [stage, setStage] = useState<DealStage>("inbound");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [paymentTerm, setPaymentTerm] = useState<"net_15" | "net_30" | "net_45">("net_30");
  const [source, setSource] = useState("");
  const [notes, setNotes] = useState("");

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
      const brand = await createBrand.mutateAsync({
        name: newBrandName.trim(),
        category: newBrandCategory.trim() || undefined,
      });
      brandId = brand.id;
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

    createDeal.mutate({
      brandId,
      title: title.trim(),
      type,
      valueCents,
      stage,
      platforms: selectedPlatforms.length > 0 ? selectedPlatforms as typeof platforms[number][] : undefined,
      paymentTerms: paymentTerm,
      source: source.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-hairline bg-surface shadow-lg">
        <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <h3 className="text-[15px] font-semibold text-ink">New deal</h3>
          <button onClick={onClose} className="text-ink-3 hover:text-ink">
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
