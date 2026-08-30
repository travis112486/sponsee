import { useState } from "react";
import { trpc } from "@/trpc";
import {
  contractStatuses,
  contractStatusLabels,
  contractFileMimeTypes,
  type ContractStatus,
} from "@sponsee/shared";
import { cn } from "@/lib/utils";
import { putToPresignedUrl } from "@/lib/upload";
import { toast } from "sonner";
import { ChevronDown, ExternalLink, FileSignature, Link2, Pencil, Plus, Trash2, Upload } from "lucide-react";

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

  const requestUpload = trpc.storage.requestUpload.useMutation();
  const confirmUpload = trpc.contract.confirmUpload.useMutation({
    onSuccess: () => {
      invalidate();
      setShowForm(false);
      toast("Contract uploaded");
    },
    onError: (err) => toast(err.message),
  });

  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState<"link" | "text" | "upload">("link");
  const [linkValue, setLinkValue] = useState("");
  const [textValue, setTextValue] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  function openForm() {
    setMode(contract?.bodyText && !contract?.fileUrl ? "text" : "link");
    setLinkValue(contract?.fileUrl ?? "");
    setTextValue(contract?.bodyText ?? "");
    setShowForm(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "upload") {
      if (!file) return;
      setUploading(true);
      try {
        const { uploadUrl, key } = await requestUpload.mutateAsync({
          purpose: "contract",
          dealId,
          mimeType: file.type,
          sizeBytes: file.size,
        });
        const uploaded = await putToPresignedUrl(file, uploadUrl, key);
        await confirmUpload.mutateAsync({
          dealId,
          key: uploaded.key,
          mimeType: uploaded.mimeType,
          sizeBytes: uploaded.sizeBytes,
        });
        setFile(null);
      } catch (err) {
        toast(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
      }
      return;
    }

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
              onClick={() => setMode("upload")}
              className={cn(
                "rounded-md px-2 py-1 text-[11px] font-medium",
                mode === "upload" ? "bg-pine text-white" : "text-ink-3 hover:bg-surface"
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
            <div className="space-y-2">
              <input
                type="file"
                accept={contractFileMimeTypes.join(",")}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-pine file:mr-2 file:rounded file:border-0 file:bg-surface file:px-2 file:py-1 file:text-[11px] file:text-ink-2"
              />
              <p className="flex items-center gap-1 text-[11px] text-ink-3">
                <Upload className="h-3 w-3" />
                Uploaded PDFs are stored privately and viewable in-platform.
              </p>
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
            <button
              type="submit"
              disabled={
                uploading ||
                (mode === "upload"
                  ? !file
                  : upsert.isPending || !(linkValue.trim() || textValue.trim()))
              }
              className="rounded-md bg-pine px-3 py-1 text-[12px] font-medium text-white hover:bg-pine-hover disabled:opacity-50"
            >
              {uploading ? "Uploading…" : mode === "upload" ? "Upload PDF" : "Save contract"}
            </button>
          </div>
        </form>
      ) : contract ? (
        <div className="mt-3 space-y-3">
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
          No contract attached. Paste a link or the contract text to track it here.
        </p>
      )}
    </div>
  );
}
