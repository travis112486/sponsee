import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import {
  Files,
  HardDrive,
  Trash2,
  Eye,
  ExternalLink,
  FileText,
  Image as ImageIcon,
} from "lucide-react";
import { planLabels, planPricesCents, planStorageCapGiB, planTiers, type PlanTier } from "@sponsee/shared";
import { trpc } from "@/trpc";
import { serverErrorMessage } from "@/lib/trpc-error";
import { formatBytes, fileTypeLabel } from "@/lib/file-format";
import QueryError from "@/components/QueryError";
import { Skeleton, SkeletonRow } from "@/components/Skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type CreatorFile = {
  id: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  originalFilename: string | null;
  originDealId: string | null;
  originDealTitle: string | null;
  originDealDeletedAt: string | Date | null;
  scope: "evidence" | "contract";
  createdAt: string | Date;
};

function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

function isPdf(mimeType: string): boolean {
  return mimeType === "application/pdf";
}

function displayName(file: CreatorFile): string {
  return file.originalFilename ?? file.storageKey.split("/").pop() ?? "File";
}

function dealDeleted(file: CreatorFile): boolean {
  return file.originDealId === null || file.originDealDeletedAt !== null;
}

function UsageMeter({
  usedBytes,
  capBytes,
  planTier,
}: {
  usedBytes: number;
  capBytes: number;
  planTier: PlanTier;
}) {
  const pct = capBytes > 0 ? Math.min(100, (usedBytes / capBytes) * 100) : 0;
  const idx = planTiers.indexOf(planTier);
  const nextTier: PlanTier | null = idx >= 0 && idx < planTiers.length - 1 ? planTiers[idx + 1] : null;

  return (
    <div className="rounded-xl border border-hairline bg-surface p-5 shadow-warm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-ink-3" />
          <h3 className="text-[13px] font-semibold text-ink">Storage</h3>
        </div>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          {planLabels[planTier]} plan
        </span>
      </div>

      <div className="mt-3">
        <p className="text-[22px] font-semibold tracking-[-0.01em] text-ink">
          {formatBytes(usedBytes)}
          <span className="text-[13px] font-normal text-ink-3"> of {planStorageCapGiB[planTier]} GB</span>
        </p>
        <Progress value={pct} className="mt-2 h-2" aria-label={`Storage used: ${Math.round(pct)}%`} />
      </div>

      {nextTier && pct >= 80 && (
        <p className="mt-3 text-[12.5px] leading-5 text-ink-2">
          You&rsquo;re at {Math.round(pct)}% of your {planLabels[planTier]} storage. The{" "}
          {planLabels[nextTier]} plan raises your cap to {planStorageCapGiB[nextTier]} GB for $
          {(planPricesCents[nextTier] / 100).toFixed(0)}/mo.
        </p>
      )}
    </div>
  );
}

function FilesEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-hairline bg-surface py-14 text-center shadow-warm">
      <Files className="h-6 w-6 text-ink-3" />
      <p className="text-[13px] font-medium text-ink-2">No files yet</p>
      <p className="max-w-[320px] text-[12.5px] leading-5 text-ink-3">
        Files you attach to a deal — contracts and evidence — show up here. They&rsquo;re kept until
        you delete them.
      </p>
    </div>
  );
}

function PreviewDialog({
  file,
  url,
  loading,
  onClose,
}: {
  file: CreatorFile | null;
  url: string | null;
  loading: boolean;
  onClose: () => void;
}) {
  const open = file !== null;
  const name = file ? displayName(file) : "";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>
            {file ? `${fileTypeLabel(file.mimeType)} · ${formatBytes(file.sizeBytes)}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[160px]">
          {loading && (
            <div className="flex h-64 items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-pine border-t-transparent" />
            </div>
          )}
          {!loading && file && url && isImage(file.mimeType) && (
            <img src={url} alt={name} className="max-h-[60vh] w-full rounded-md border border-hairline object-contain" />
          )}
          {!loading && file && url && isPdf(file.mimeType) && (
            <object data={url} type="application/pdf" className="h-[60vh] w-full rounded-md border border-hairline">
              <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 p-3 text-[13px] text-pine hover:underline">
                <ExternalLink className="h-3.5 w-3.5" />
                Open {fileTypeLabel(file.mimeType)}
              </a>
            </object>
          )}
          {!loading && file && !url && (
            <p className="flex h-64 items-center justify-center text-[12.5px] text-ink-3">
              Preview unavailable — open the file in a new tab instead.
            </p>
          )}
        </div>

        {!loading && file && url && (
          <DialogFooter>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[12.5px] font-medium text-pine hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open in new tab
            </a>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  file,
  pending,
  onConfirm,
  onClose,
}: {
  file: CreatorFile | null;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const open = file !== null;
  const name = file ? displayName(file) : "";
  const stillAttached = file ? !dealDeleted(file) : false;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete file?</DialogTitle>
          <DialogDescription>
            This permanently deletes <span className="font-medium text-ink">&ldquo;{name}&rdquo;</span>.
          </DialogDescription>
        </DialogHeader>

        {stillAttached && file?.originDealTitle && (
          <p className="rounded-lg border border-amber/30 bg-amber-tint/30 p-3 text-[12.5px] leading-5 text-amber">
            This file is still attached to <span className="font-medium">{file.originDealTitle}</span>.
            Deleting it will remove it from that deal&rsquo;s evidence.
          </p>
        )}

        <DialogFooter>
          <button
            onClick={onClose}
            disabled={pending}
            className="rounded-lg border border-hairline px-3 py-1.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:bg-surface-subtle disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className="flex items-center gap-1.5 rounded-lg bg-brick px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-brick/90 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {pending ? "Deleting…" : "Delete file"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FileRow({
  file,
  onPreview,
  onDelete,
}: {
  file: CreatorFile;
  onPreview: () => void;
  onDelete: () => void;
}) {
  const deleted = dealDeleted(file);
  const name = displayName(file);

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-hairline bg-surface-subtle">
        {isImage(file.mimeType) ? (
          <ImageIcon className="h-4 w-4 text-ink-3" />
        ) : isPdf(file.mimeType) ? (
          <FileText className="h-4 w-4 text-ink-3" />
        ) : (
          <Files className="h-4 w-4 text-ink-3" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink">{name}</p>
        <p className="truncate text-[11.5px] text-ink-3">
          {fileTypeLabel(file.mimeType)} · {formatBytes(file.sizeBytes)} ·{" "}
          {new Date(file.createdAt).toLocaleDateString()} ·{" "}
          {file.scope === "contract" ? "Contract" : "Evidence"}
        </p>
      </div>

      <div className="hidden min-w-0 max-w-[240px] shrink-0 sm:block">
        {deleted ? (
          <p className="truncate text-[12px] text-ink-3">
            {file.originDealTitle ?? "Deleted deal"} <span className="italic">(deal deleted)</span>
          </p>
        ) : file.originDealId ? (
          <Link
            to={`/pipeline/${file.originDealId}`}
            className="block truncate text-[12px] text-pine hover:underline"
          >
            {file.originDealTitle ?? "Deal"}
          </Link>
        ) : (
          <p className="truncate text-[12px] text-ink-3">{file.originDealTitle ?? "—"}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={onPreview}
          aria-label={`Preview ${name}`}
          className="rounded-lg p-2 text-ink-3 transition-colors hover:bg-surface-subtle hover:text-ink"
        >
          <Eye className="h-4 w-4" />
        </button>
        <button
          onClick={onDelete}
          aria-label={`Delete ${name}`}
          className="rounded-lg p-2 text-ink-3 transition-colors hover:bg-surface-subtle hover:text-brick"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

export default function FilesPage() {
  const utils = trpc.useUtils();
  const usageQuery = trpc.storage.usage.useQuery();
  const listQuery = trpc.storage.list.useQuery();
  const fileUrl = trpc.storage.fileUrl.useMutation({
    onError: (err) => toast.error(serverErrorMessage(err, "Couldn't load the file preview.")),
  });

  const [previewFile, setPreviewFile] = useState<CreatorFile | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CreatorFile | null>(null);

  const deleteFile = trpc.storage.deleteFile.useMutation({
    onSuccess: () => {
      utils.storage.list.invalidate();
      utils.storage.usage.invalidate();
      setDeleteTarget(null);
      toast("File deleted");
    },
    onError: (err) => toast.error(serverErrorMessage(err, "Couldn't delete the file. Please try again.")),
  });

  async function openPreview(file: CreatorFile) {
    setPreviewFile(file);
    setPreviewUrl(null);
    try {
      const { url } = await fileUrl.mutateAsync({ storageKey: file.storageKey });
      setPreviewUrl(url);
    } catch {
      // mutateAsync already toasted via onError; leave url null to render the fallback.
    }
  }

  function closePreview() {
    setPreviewFile(null);
    setPreviewUrl(null);
    fileUrl.reset();
  }

  if (usageQuery.isError || listQuery.isError) {
    return (
      <QueryError
        message="Couldn't load your files."
        onRetry={() => {
          usageQuery.refetch();
          listQuery.refetch();
        }}
      />
    );
  }

  const files = listQuery.data?.files ?? [];
  const loading = usageQuery.isLoading || listQuery.isLoading;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-serif text-[22px] tracking-[-0.01em] text-ink">Files</h2>
        <p className="mt-1 text-[13px] text-ink-3">
          Every contract and piece of evidence you&rsquo;ve uploaded, kept until you delete it.
        </p>
      </div>

      {usageQuery.isLoading ? (
        <Skeleton className="h-[120px] w-full" />
      ) : usageQuery.data ? (
        <UsageMeter
          usedBytes={usageQuery.data.usedBytes}
          capBytes={usageQuery.data.capBytes}
          planTier={usageQuery.data.planTier}
        />
      ) : null}

      <div className="overflow-hidden rounded-xl border border-hairline bg-surface shadow-warm">
        {loading ? (
          <div className="space-y-0 px-4 py-3" role="status" aria-busy="true" aria-label="Loading your files">
            <SkeletonRow columns={4} />
            <SkeletonRow columns={4} />
            <SkeletonRow columns={4} />
          </div>
        ) : files.length === 0 ? (
          <FilesEmptyState />
        ) : (
          <ul className="divide-y divide-hairline">
            {files.map((file) => (
              <FileRow
                key={file.id}
                file={file}
                onPreview={() => openPreview(file)}
                onDelete={() => setDeleteTarget(file)}
              />
            ))}
          </ul>
        )}
      </div>

      <PreviewDialog
        file={previewFile}
        url={previewUrl}
        loading={fileUrl.isPending}
        onClose={closePreview}
      />

      <DeleteDialog
        file={deleteTarget}
        pending={deleteFile.isPending}
        onConfirm={() => deleteTarget && deleteFile.mutate({ storageKey: deleteTarget.storageKey })}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
