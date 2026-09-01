import { platformLabels, type Platform } from "@sponsee/shared";

import { platformBgClasses, platformShortLabels } from "@/lib/platform-tokens";
import { cn } from "@/lib/utils";

/**
 * Platform indicator (ported from the mockup's `components/shared/PlatformDot.tsx`).
 *
 * The mockup knew about three platforms and inlined hex values; our schema has
 * four, so the colour maps live in `@/lib/platform-tokens` keyed off the shared
 * `Platform` union and use configured brand tokens.
 */
export function PlatformDot({
  platform,
  className,
}: {
  platform: Platform;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={platformLabels[platform]}
      title={platformLabels[platform]}
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        platformBgClasses[platform],
        className
      )}
    />
  );
}

/** Row of dots for a deal's `platforms` array. */
export function PlatformDots({
  platforms,
  className,
}: {
  platforms: readonly Platform[];
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {platforms.map((p) => (
        <PlatformDot key={p} platform={p} />
      ))}
    </span>
  );
}

/** Dot + short label chip, for surfaces with room for more than a dot. */
export function PlatformChip({
  platform,
  className,
}: {
  platform: Platform;
  className?: string;
}) {
  return (
    <span
      title={platformLabels[platform]}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-hairline bg-surface-subtle px-1.5 py-0.5 text-[10px] font-semibold text-ink-2",
        className
      )}
    >
      <PlatformDot platform={platform} className="h-1.5 w-1.5" />
      {platformShortLabels[platform]}
    </span>
  );
}

export default PlatformDot;
