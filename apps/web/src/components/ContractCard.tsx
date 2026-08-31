import { useRef, useState } from "react";
import { trpc } from "@/trpc";
import { contractStatuses, contractStatusLabels, type ContractStatus } from "@sponsee/shared";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ChevronDown,
  ExternalLink,
  FileSignature,
  Link2,
  Pencil,
  Plus,
  Trash2,
  UploadCloud,
} from "lucide-react";

const statusBadge: Record<ContractStatus, string> = {
  draft: "bg-surface text-ink-3 border-hairline",
  sent: "bg-amber-tint text-amber border-amber/20",
  viewed: "bg-blue-50 text-blue-600 border-blue-200",
  signed: "bg-pine-tint text-pine border-pine/20",
};

function isPdfUrl(url: string) {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

export function ContractCard({ dealId }: { dealId: string }) {
  const utils = trpc.useUtils();
  const { data: contract, isLoading } = trpc.contract.getByDeal.useQuery({ dealId });

  const invalidate = () => {
    utils.contract.getByDeal.invalidate({ dealId });
    utils.activity.list.invalidate();
  };

  const upsert = trpc.contract.upsert.useMutation({
    onSuccess: () => {
      invalidate();
      setShowForm(false);
      toast("Contract saved");
    },
    onError: (err) => toast(err.message),
  });

  const updateStatus = trpc.contract.updateStatus.useMutation({
    onSuccess: ({ dealStage }) => {
      invalidate();
      // Marking sent can advance the deal into the contract_sent stage
      utils.deals.getById.invalidate({ id: dealId });
      utils.deals.list.invalidate();
      toast(dealStage === "contract_sent" ? "Contract sent — deal moved to Contract Sent" : "Status updated");
    },
    onError: (err) => toast(err.message),
  });

  const remove = trpc.contract.remove.useMutation({
    onSuccess: () => {
      invalidate();
      toast("Contract removed");
    },
    onError: (err) => toast(err.message),
  });

  const createUploadUrl = trpc.storage.createUploadUrl.useMutation();

  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState<"link" | "text" | "file">("link");
  const [linkValue, setLinkValue] = useState("");
  const [textValue, setTextValue] = useState("");
  const [statusOpen, setStatusOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function openForm() {
    setMode(contract?.storageKey ? "file" : contract?.bodyText && !contract?.fileUrl ? "text" : "link");
    setLinkValue(contract?.fileUrl ?? "");
    setTextValue(contract?.bodyText ?? "");
    setShowForm(true);
  }

  async function uploadFile(file: File) {
    if (file.type !== "application/pdf") {
      toast("Contracts must be uploaded as a PDF");
      return;
    }
    setIsUploading(true);
    try {
      const presigned = await createUploadUrl.mutateAsync({
        dealId,
        scope: "contracts",
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      const res = await fetch(presigned.url, {
        method: "PUT",
        headers: presigned.requiredHeaders,
        body: file,
      });
      if (!res.ok) throw new Error("Upload to storage failed");

      // upsert's own onSuccess/onError (invalidate + toast + close form) fire
      // from here — not caught below, so its errors aren't double-toasted.
      upsert.mutate({
        dealId,
        storageKey: presigned.key,
        sizeBytes: file.size,
        originalFilename: presigned.filename,
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const fileUrl = linkValue.trim();
    const bodyText = textValue.trim();
    if (!fileUrl && !bodyText) return;
    upsert.mutate({
      dealId,
      fileUrl: fileUrl || null,
      bodyText: bodyText || null,
    });
  }

  return (
    <div className="rounded-xl border border-hairline bg-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-ink">Contract</h3>
        <div className="flex items-center gap-3">
          {contract && (
            <div className="relative">
              <button
                onClick={() => setStatusOpen((s) => !s)}
                className={cn(
                  "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                  statusBadge[contract.status as ContractStatus]
                )}
              >
                {contractStatusLabels[contract.status as ContractStatus]}
                <ChevronDown className="h-3 w-3" />
              </button>
              {statusOpen && (
                <div className="absolute right-0 z-10 mt-1 w-32 rounded-lg border border-hairline bg-surface shadow-lg">
                  {contractStatuses.map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        updateStatus.mutate({ dealId, status: s });
                        setStatusOpen(false);
                      }}
                      className={cn(
                        "block w-full px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-surface-subtle",
                        contract.status === s ? "font-semibold text-pine" : "text-ink-2"
                      )}
                    >
                      {contractStatusLabels[s]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {!contract && !showForm && (
            <button
              onClick={openForm}
              className="flex items-center gap-1 text-[12px] font-medium text-pine hover:text-pine-hover"
            >
              <Plus className="h-3.5 w-3.5" />
              Attach
            </button>
          )}
        </div>
      </div>

      {contract?.signedAt && (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-pine">
          <FileSignature className="h-3 w-3" />
          Signed {new Date(contract.signedAt).toLocaleDateString()}
        </p>
      )}

      {isLoading ? (
        <p className="mt-3 text-[13px] text-ink-3">Loading…</p>
      ) : showForm ? (
        <form onSubmit={handleSave} className="mt-3 space-y-2 rounded-lg border border-hairline bg-surface-subtle p-3">
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setMode("link")}
              className={cn(
                "rounded-md px-2 py-1 text-[11px] font-medium",
                mode === "link" ? "bg-pine text-white" : "text-ink-3 hover:bg-surface"
              )}
            >
              Paste link
            </button>
            <button
              type="button"
              onClick={() => setMode("text")}
              className={cn(
                "rounded-md px-2 py-1 text-[11px] font-medium",
                mode === "text" ? "bg-pine text-white" : "text-ink-3 hover:bg-surface"
              )}
            >
              Paste text
            </button>
            <button
              type="button"
              onClick={() => setMode("file")}
              className={cn(
                "rounded-md px-2 py-1 text-[11px] font-medium",
                mode === "file" ? "bg-pine text-white" : "text-ink-3 hover:bg-surface"
              )}
            >
              Upload PDF
            </button>
          </div>

          {mode === "link" ? (
            <input
              value={linkValue}
              onChange={(e) => setLinkValue(e.target.value)}
              placeholder="https://drive.google.com/… or a PDF link"
              className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-pine"
            />
          ) : mode === "text" ? (
            <textarea
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              placeholder="Paste the contract text here"
              className="min-h-[120px] w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-pine"
            />
          ) : (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const file = e.dataTransfer.files[0];
                if (file) void uploadFile(file);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
                isDragging ? "border-pine bg-pine-tint" : "border-hairline bg-surface hover:bg-surface"
              )}
            >
              <UploadCloud className="h-5 w-5 text-ink-3" />
              <p className="text-[12px] text-ink-2">
                {isUploading ? "Uploading…" : "Drag a PDF here, or click to browse"}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadFile(file);
                  e.target.value = "";
                }}
              />
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-md border border-hairline px-3 py-1 text-[12px] text-ink-3 hover:bg-surface"
            >
              Cancel
            </button>
            {mode !== "file" && (
              <button
                type="submit"
                disabled={upsert.isPending || !(linkValue.trim() || textValue.trim())}
                className="rounded-md bg-pine px-3 py-1 text-[12px] font-medium text-white hover:bg-pine-hover disabled:opacity-50"
              >
                Save contract
              </button>
            )}
          </div>
        </form>
      ) : contract ? (
        <div className="mt-3 space-y-3">
          {contract.storageKey &&
            (contract.viewUrl ? (
              <object
                data={contract.viewUrl}
                type="application/pdf"
                className="h-[480px] w-full rounded-lg border border-hairline"
              >
                <a
                  href={contract.viewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 p-3 text-[13px] text-pine hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open contract PDF
                </a>
              </object>
            ) : (
              <p className="rounded-lg border border-hairline bg-surface-subtle p-3 text-[12px] text-ink-3">
                {contract.originalFilename ?? "Contract PDF"} — file viewing is temporarily unavailable.
              </p>
            ))}

          {contract.fileUrl &&
            (isPdfUrl(contract.fileUrl) ? (
              <object
                data={contract.fileUrl}
                type="application/pdf"
                className="h-[480px] w-full rounded-lg border border-hairline"
              >
                <a
                  href={contract.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 p-3 text-[13px] text-pine hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open contract PDF
                </a>
              </object>
            ) : (
              <a
                href={contract.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg border border-hairline bg-surface-subtle px-3 py-2 text-[13px] text-pine hover:underline"
              >
                <Link2 className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{contract.fileUrl}</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              </a>
            ))}

          {contract.bodyText && (
            <div className="max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-hairline bg-surface-subtle p-3 text-[12px] leading-5 text-ink-2">
              {contract.bodyText}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              onClick={openForm}
              className="flex items-center gap-1 text-[12px] text-ink-3 transition-colors hover:text-ink"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
            <button
              onClick={() => {
                if (confirm("Remove this contract from the deal?")) {
                  remove.mutate({ dealId });
                }
              }}
              className="flex items-center gap-1 text-[12px] text-ink-3 transition-colors hover:text-brick"
            >
              <Trash2 className="h-3 w-3" />
              Remove
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-ink-3">
          No contract attached. Paste a link, paste the text, or upload a PDF to track it here.
        </p>
      )}
    </div>
  );
}
