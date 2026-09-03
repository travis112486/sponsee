import { useState } from "react";
import { useParams, useNavigate } from "react-router";
import { trpc } from "@/trpc";
import {
  stageLabels,
  platforms,
  deliverableStatuses,
  benchmarkDeliverableTypes,
  proofKinds,
  proofKindLabels,
  type ProofKind,
} from "@sponsee/shared";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { BenchmarkBand } from "@/components/BenchmarkBand";
import { ContractCard } from "@/components/ContractCard";
import { ContactPicker } from "@/components/ContactPicker";
import { BrandMark, normalizeBrandDomain } from "@/components/shared/BrandMark";
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
  Link2,
  Upload,
  ExternalLink,
  Pencil,
} from "lucide-react";
import QueryError from "@/components/QueryError";
import {
  evidenceFileError,
  evidenceFileErrorMessage,
  uploadToPresignedUrl,
  EVIDENCE_ACCEPT,
} from "@/lib/evidence-upload";

function formatCents(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

// `null` means "no CCV/duration captured yet" — never render that as $0.00
// (SPO-197: that class of lie is exactly what this migration replaces).
function formatCpvh(dollarsPerViewerHour: number | null | undefined) {
  if (dollarsPerViewerHour == null) return "—";
  return `${new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(dollarsPerViewerHour)}/hr`;
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
  const {
    data: deal,
    isLoading,
    isError,
    refetch,
  } = trpc.deals.getById.useQuery({ id: id! }, { enabled: !!id });

  const updateDeal = trpc.deals.update.useMutation({
    onSuccess: () => {
      utils.deals.getById.invalidate({ id: id! });
      utils.deals.list.invalidate();
      toast("Deal updated");
    },
    onError: (err) => toast.error(err.message || "Failed to update deal"),
  });

  const updateBrand = trpc.brand.update.useMutation({
    onSuccess: () => {
      utils.deals.getById.invalidate({ id: id! });
      utils.deals.list.invalidate();
      setEditingField(null);
      setBrandDomainError(null);
    },
    onError: (err) => toast.error(err.message || "Failed to update brand"),
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
      // Deleting a deliverable detaches its proofs (deliverableId → null)
      utils.proof.listByDeal.invalidate({ dealId: id! });
      toast("Deliverable removed");
    },
  });

  const { data: proofs } = trpc.proof.listByDeal.useQuery({ dealId: id! }, { enabled: !!id });

  const addProof = trpc.proof.create.useMutation({
    onSuccess: () => {
      utils.proof.listByDeal.invalidate({ dealId: id! });
      toast("Evidence added");
      // Only clear the form once the server accepts, so a rejected
      // submission doesn't throw away what the user typed.
      setProofUrl("");
      setProofNote("");
      setEvidenceFormId(null);
    },
    onError: (err) => toast(err.message),
  });

  const removeProof = trpc.proof.delete.useMutation({
    onSuccess: () => {
      utils.proof.listByDeal.invalidate({ dealId: id! });
      toast("Evidence removed");
    },
  });

  const createUploadUrl = trpc.storage.createUploadUrl.useMutation();

  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [brandDomainError, setBrandDomainError] = useState<string | null>(null);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [showAddDeliverable, setShowAddDeliverable] = useState(false);
  const [deliverableTitle, setDeliverableTitle] = useState("");
  const [deliverablePlatform, setDeliverablePlatform] = useState<string>("");
  const [deliverableDueAt, setDeliverableDueAt] = useState("");
  const [openStatusId, setOpenStatusId] = useState<string | null>(null);
  const [evidenceFormId, setEvidenceFormId] = useState<string | null>(null);
  const [proofKind, setProofKind] = useState<ProofKind>("clip");
  const [proofUrl, setProofUrl] = useState("");
  const [proofNote, setProofNote] = useState("");
  // Per-deliverable in-flight file upload, for inline progress/status display.
  const [fileUploads, setFileUploads] = useState<
    Record<string, { filename: string; progress: number }>
  >({});

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-pine border-t-transparent" />
      </div>
    );
  }

  if (isError) {
    return <QueryError message="Couldn't load this deal." onRetry={() => refetch()} />;
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
    } else if (field === "ccv") {
      // Clearing the field means "unknown", not zero (SPO-197) — send null,
      // not 0, so the account-level aggregate keeps excluding this deal.
      const num = parseInt(editValue, 10);
      payload.ccv = editValue.trim() && !isNaN(num) && num > 0 ? num : null;
    } else if (field === "sponsoredMinutes") {
      // Whole-hours input, stored as minutes (SPO-197).
      const hours = parseFloat(editValue);
      payload.sponsoredMinutes =
        editValue.trim() && !isNaN(hours) && hours > 0 ? Math.round(hours * 60) : null;
    } else if (field === "notes" || field === "source" || field === "valueNote") {
      payload[field] = editValue || null;
    } else {
      payload[field] = editValue;
    }
    updateDeal.mutate(payload as { id: string });
    setEditingField(null);
  }

  function startBrandDomainEdit() {
    if (!deal?.brand) return;
    setEditingField("brandDomain");
    setEditValue(deal.brand.domain ?? "");
    setBrandDomainError(null);
  }

  function saveBrandDomain() {
    if (!deal?.brand) return;
    const raw = editValue;
    const normalized = normalizeBrandDomain(raw);
    if (raw.trim() && normalized === null) {
      setBrandDomainError("Enter a website like redbull.com");
      return;
    }
    updateBrand.mutate({
      brandId: deal.brand.id,
      domain: raw.trim() ? normalized : null,
    });
  }

  function handleAddEvidence(e: React.FormEvent, deliverableId: string) {
    e.preventDefault();
    if (!id) return;
    const url = proofUrl.trim();
    const note = proofNote.trim();
    if (!url && !note) return;
    addProof.mutate({
      dealId: id,
      deliverableId,
      kind: proofKind,
      url: url || undefined,
      note: note || undefined,
    });
  }

  async function handleEvidenceFile(deliverableId: string, file: File) {
    if (!id) return;

    const error = evidenceFileError(file);
    if (error) {
      toast(evidenceFileErrorMessage(error));
      return;
    }

    setFileUploads((prev) => ({ ...prev, [deliverableId]: { filename: file.name, progress: 0 } }));
    try {
      // 1) Presign a PUT for this exact object (MIME + size are signed in).
      const presigned = await createUploadUrl.mutateAsync({
        dealId: id,
        scope: "proofs",
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });

      // 2) Upload straight from the browser — no round-trip through our API.
      await uploadToPresignedUrl({
        url: presigned.url,
        contentType: file.type,
        body: file,
        onProgress: (fraction) => {
          setFileUploads((prev) =>
            prev[deliverableId]
              ? { ...prev, [deliverableId]: { ...prev[deliverableId], progress: Math.round(fraction * 100) } }
              : prev
          );
        },
      });

      // 3) Record the proof with the key the server signed — it re-checks the
      //    key belongs to this creator + deal before accepting it. addProof
      //    toasts its own failures, so swallow the rejection here.
      await addProof.mutateAsync({
        dealId: id,
        deliverableId,
        kind: "file",
        storageKey: presigned.key,
        mimeType: file.type,
        sizeBytes: file.size,
        originalFilename: file.name,
      }).catch(() => {});
    } catch (err) {
      toast(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setFileUploads((prev) => {
        const next = { ...prev };
        delete next[deliverableId];
        return next;
      });
    }
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
        <div className="flex items-start gap-3">
          <BrandMark brand={deal.brand?.name ?? ""} domain={deal.brand?.domain} size={40} />
          <div>
            <div className="group flex items-center gap-2">
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

              {deal.brand &&
                (editingField === "brandDomain" ? (
                  <span className="flex items-center gap-1">
                    <input
                      value={editValue}
                      onChange={(e) => {
                        setEditValue(e.target.value);
                        setBrandDomainError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          saveBrandDomain();
                        } else if (e.key === "Escape") {
                          setEditingField(null);
                          setBrandDomainError(null);
                        }
                      }}
                      placeholder="brand.com"
                      autoFocus
                      className="w-44 rounded border border-hairline px-2 py-0.5 text-[12px] text-ink outline-none focus:border-pine"
                    />
                    <button
                      onClick={saveBrandDomain}
                      className="text-pine"
                      aria-label="Save website"
                    >
                      <Check className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => {
                        setEditingField(null);
                        setBrandDomainError(null);
                      }}
                      className="text-ink-3"
                      aria-label="Cancel website edit"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ) : deal.brand.domain ? (
                  <>
                    <span className="text-[12px] text-ink-3"> · {deal.brand.domain}</span>
                    <button
                      onClick={startBrandDomainEdit}
                      className="text-ink-3 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                      aria-label="Edit website"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={startBrandDomainEdit}
                    className="text-[12px] text-ink-3 hover:text-ink-2 hover:underline"
                  >
                    Add website
                  </button>
                ))}
            </div>

            {brandDomainError && (
              <p className="mt-1 text-[12px] text-brick">{brandDomainError}</p>
            )}

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
              className="mt-1 cursor-text font-serif text-[22px] text-ink hover:text-ink-2"
            >
              {deal.title}
            </h1>
          )}
          </div>
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
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-ink-3">
                  Avg. CCV
                </p>
                {editingField === "ccv" ? (
                  <div className="mt-0.5 flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="w-24 rounded border border-hairline px-2 py-1 text-[13px] text-ink outline-none focus:border-pine"
                      autoFocus
                    />
                    <button onClick={() => saveEdit("ccv")} className="text-pine">
                      <Check className="h-4 w-4" />
                    </button>
                    <button onClick={() => setEditingField(null)} className="text-ink-3">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <p
                    onClick={() => startEdit("ccv", deal.ccv != null ? String(deal.ccv) : "")}
                    className="mt-0.5 cursor-text text-[13px] text-ink hover:text-ink-2"
                  >
                    {deal.ccv ?? "Click to add"}
                  </p>
                )}
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-ink-3">
                  Sponsored duration
                </p>
                {editingField === "sponsoredMinutes" ? (
                  <div className="mt-0.5 flex items-center gap-2">
                    <input
                      type="number"
                      min={0.25}
                      step="0.25"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="w-24 rounded border border-hairline px-2 py-1 text-[13px] text-ink outline-none focus:border-pine"
                      autoFocus
                    />
                    <span className="text-[12px] text-ink-3">hrs</span>
                    <button onClick={() => saveEdit("sponsoredMinutes")} className="text-pine">
                      <Check className="h-4 w-4" />
                    </button>
                    <button onClick={() => setEditingField(null)} className="text-ink-3">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <p
                    onClick={() =>
                      startEdit(
                        "sponsoredMinutes",
                        deal.sponsoredMinutes != null ? String(deal.sponsoredMinutes / 60) : ""
                      )
                    }
                    className="mt-0.5 cursor-text text-[13px] text-ink hover:text-ink-2"
                  >
                    {deal.sponsoredMinutes != null
                      ? `${(deal.sponsoredMinutes / 60).toFixed(2).replace(/\.?0+$/, "")} hrs`
                      : "Click to add"}
                  </p>
                )}
              </div>
              <DetailRow label="Effective CPVH" value={formatCpvh(deal.effectiveCpvh)} />
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
                {deal.deliverables.map((d) => {
                  const evidence = proofs?.filter((p) => p.deliverableId === d.id) ?? [];
                  const upload = fileUploads[d.id];
                  return (
                  <div
                    key={d.id}
                    className="rounded-lg border border-hairline bg-surface-subtle px-3 py-2"
                  >
                    <div className="flex items-center justify-between">
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

                    {/* Evidence (proof-of-delivery) */}
                    {evidence.length > 0 && (
                      <div className="mt-2 space-y-1 border-t border-hairline pt-2">
                        {evidence.map((p) => (
                          <EvidenceRow
                            key={p.id}
                            proof={p}
                            onRemove={() => {
                              if (confirm("Remove this evidence?")) {
                                removeProof.mutate({ id: p.id });
                              }
                            }}
                          />
                        ))}
                      </div>
                    )}

                    {evidenceFormId === d.id ? (
                      <form
                        onSubmit={(e) => handleAddEvidence(e, d.id)}
                        className="mt-2 space-y-2 border-t border-hairline pt-2"
                      >
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <select
                            value={proofKind}
                            onChange={(e) => setProofKind(e.target.value as ProofKind)}
                            className="rounded-lg border border-hairline bg-surface px-3 py-1.5 text-[12px] text-ink outline-none focus:border-pine"
                          >
                            {proofKinds.filter((k) => k !== "file").map((k) => (
                              <option key={k} value={k}>
                                {proofKindLabels[k]}
                              </option>
                            ))}
                          </select>
                          <input
                            value={proofUrl}
                            onChange={(e) => setProofUrl(e.target.value)}
                            placeholder="https:// link (VOD, clip, screenshot…)"
                            className="sm:col-span-2 rounded-lg border border-hairline bg-surface px-3 py-1.5 text-[12px] text-ink outline-none focus:border-pine"
                          />
                        </div>
                        <input
                          value={proofNote}
                          onChange={(e) => setProofNote(e.target.value)}
                          placeholder="Note (optional — e.g. timestamps, context)"
                          className="w-full rounded-lg border border-hairline bg-surface px-3 py-1.5 text-[12px] text-ink outline-none focus:border-pine"
                        />

                        {/* File evidence: drag a screenshot/PDF, or click to browse */}
                        <div className="relative">
                          <input
                            id={`evidence-file-${d.id}`}
                            type="file"
                            accept={EVIDENCE_ACCEPT}
                            className="sr-only"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleEvidenceFile(d.id, file);
                              e.target.value = "";
                            }}
                          />
                          <label
                            htmlFor={`evidence-file-${d.id}`}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              const file = e.dataTransfer.files?.[0];
                              if (file) handleEvidenceFile(d.id, file);
                            }}
                            className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-hairline bg-surface-subtle px-3 py-3 text-center transition-colors hover:border-pine"
                          >
                            <Upload className="h-4 w-4 text-ink-3" />
                            <span className="text-[12px] text-ink-2">
                              Drop a screenshot or PDF here, or{" "}
                              <span className="font-medium text-pine">browse</span>
                            </span>
                          </label>
                        </div>

                        {upload && (
                          <div className="flex items-center gap-2">
                            <div className="h-1 flex-1 overflow-hidden rounded bg-hairline">
                              <div
                                className="h-full bg-pine transition-all"
                                style={{ width: `${upload.progress}%` }}
                              />
                            </div>
                            <span className="shrink-0 text-[11px] text-ink-3">
                              {upload.filename} · {upload.progress}%
                            </span>
                          </div>
                        )}

                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEvidenceFormId(null)}
                            className="rounded-md border border-hairline px-3 py-1 text-[12px] text-ink-3 hover:bg-surface"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={addProof.isPending || (!proofUrl.trim() && !proofNote.trim())}
                            className="rounded-md bg-pine px-3 py-1 text-[12px] font-medium text-white hover:bg-pine-hover disabled:opacity-50"
                          >
                            Add evidence
                          </button>
                        </div>
                      </form>
                    ) : (
                      <button
                        onClick={() => {
                          setEvidenceFormId(d.id);
                          setProofKind("clip");
                          setProofUrl("");
                          setProofNote("");
                        }}
                        className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-ink-3 hover:text-pine"
                      >
                        <Plus className="h-3 w-3" />
                        Add evidence
                      </button>
                    )}
                  </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-3 text-[13px] text-ink-3">
                No deliverables yet.
              </p>
            )}

            {/* Proofs left behind when their deliverable was deleted */}
            {proofs && proofs.some((p) => !p.deliverableId) && (
              <div className="mt-3">
                <p className="text-[11px] font-medium uppercase tracking-wider text-ink-3">
                  Other evidence
                </p>
                <div className="mt-1.5 space-y-1">
                  {proofs
                    .filter((p) => !p.deliverableId)
                    .map((p) => (
                      <EvidenceRow
                        key={p.id}
                        proof={p}
                        onRemove={() => {
                          if (confirm("Remove this evidence?")) {
                            removeProof.mutate({ id: p.id });
                          }
                        }}
                      />
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* Contract */}
          <ContractCard dealId={deal.id} />
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Contact */}
          <div className="rounded-xl border border-hairline bg-surface p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-ink">Contact</h3>
              {deal.primaryContact && (
                <button
                  onClick={() => setShowContactPicker((s) => !s)}
                  className="flex items-center gap-1 text-[11px] font-medium text-pine hover:text-pine-hover"
                >
                  {showContactPicker ? "Close" : "Change"}
                </button>
              )}
            </div>
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

            {(showContactPicker || !deal.primaryContact) && (
              <div className={deal.primaryContact ? "mt-3" : "mt-1"}>
                <ContactPicker
                  brandId={deal.brand?.id ?? null}
                  selectedId={deal.primaryContactId ?? null}
                  onSelect={(contactId) => {
                    updateDeal.mutate({
                      id: deal.id,
                      primaryContactId: contactId,
                    });
                    setShowContactPicker(false);
                  }}
                />
              </div>
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

type EvidenceProof = {
  id: string;
  kind: string;
  url: string | null;
  note: string | null;
  createdAt: string | Date;
  storageKey: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  originalFilename: string | null;
  signedUrl?: string | null;
};

function EvidenceRow({
  proof,
  onRemove,
}: {
  proof: EvidenceProof;
  onRemove: () => void;
}) {
  const isFile = Boolean(proof.storageKey);
  const signedUrl = proof.signedUrl ?? null;
  const isImage = proof.mimeType?.startsWith("image/") ?? false;
  const isPdf = proof.mimeType === "application/pdf";

  return (
    <div className="flex items-start justify-between gap-2 rounded px-1 py-0.5">
      <div className="flex min-w-0 flex-1 items-start gap-1.5">
        {!isFile && <Link2 className="mt-0.5 h-3 w-3 shrink-0 text-ink-3" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
              {proofKindLabels[proof.kind as ProofKind] ?? proof.kind}
            </span>
            {proof.url ? (
              <a
                href={proof.url}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-[12px] text-pine hover:underline"
              >
                {proof.url.replace(/^https?:\/\//, "")}
              </a>
            ) : isFile ? (
              <span className="truncate text-[12px] text-ink-2">
                {proof.originalFilename ?? "File"}
              </span>
            ) : (
              <span className="text-[12px] text-ink-2">Note</span>
            )}
          </div>

          {isFile && signedUrl && isImage && (
            <a
              href={signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block w-fit"
            >
              <img
                src={signedUrl}
                alt={proof.originalFilename ?? "Evidence"}
                className="max-h-40 w-auto max-w-full rounded-md border border-hairline"
              />
            </a>
          )}

          {isFile && signedUrl && isPdf && (
            <object
              data={signedUrl}
              type="application/pdf"
              className="mt-1 h-64 w-full rounded-md border border-hairline"
            >
              <a
                href={signedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 p-3 text-[13px] text-pine hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open PDF
              </a>
            </object>
          )}

          {isFile && !signedUrl && (
            <p className="mt-0.5 text-[11.5px] text-ink-3">File preview unavailable</p>
          )}

          {proof.note && (
            <p className="mt-0.5 text-[11.5px] leading-4 text-ink-2">{proof.note}</p>
          )}
        </div>
      </div>
      <button onClick={onRemove} className="mt-0.5 shrink-0 text-ink-3 hover:text-brick">
        <Trash2 className="h-3 w-3" />
      </button>
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
