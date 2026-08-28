import { type ReactNode } from "react";

export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: React.ElementType;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {Icon && <Icon className="h-6 w-6 text-ink-3" aria-hidden="true" />}
      <p className="text-[13px] font-medium text-ink-2">{title}</p>
      {description && (
        <p className="max-w-sm text-[13px] text-ink-3">{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
