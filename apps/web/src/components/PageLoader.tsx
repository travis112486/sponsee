import { Loader2 } from "lucide-react";

export default function PageLoader({ message }: { message?: string }) {
  return (
    <div
      className="flex h-64 flex-col items-center justify-center gap-3"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-6 w-6 animate-spin text-pine" aria-hidden="true" />
      <span className="text-[13px] text-ink-3">
        {message || "Loading…"}
      </span>
    </div>
  );
}
