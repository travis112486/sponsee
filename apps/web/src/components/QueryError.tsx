import { AlertTriangle, RotateCcw } from "lucide-react";

export default function QueryError({
  message,
  onRetry,
}: {
  message?: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
      <AlertTriangle className="h-5 w-5 text-brick" />
      <p className="text-[13px] text-ink-2">
        {message || "Something went wrong loading this page."}
      </p>
      <button
        onClick={onRetry}
        className="mt-1 flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:bg-surface-subtle"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Retry
      </button>
    </div>
  );
}
