import { cn } from "@/lib/utils";

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-surface-subtle", className)}
      {...props}
    />
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border border-hairline bg-surface p-4", className)}>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="mt-3 h-8 w-2/3" />
      <Skeleton className="mt-2 h-3 w-1/2" />
    </div>
  );
}

export function SkeletonKpi() {
  return (
    <div className="rounded-xl border border-hairline bg-surface p-3">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-2 h-6 w-16" />
      <Skeleton className="mt-1 h-3 w-24" />
    </div>
  );
}

export function SkeletonRow({ columns = 4 }: { columns?: number }) {
  return (
    <div className="flex items-center gap-3 py-3">
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton key={i} className="h-4 flex-1" style={{ flex: i === 0 ? 2 : 1 }} />
      ))}
    </div>
  );
}
