/* eslint-disable react-refresh/only-export-components */
import { cn } from "@/lib/utils";

/**
 * Initials for a brand name: first letter of the first two words, or the first
 * two letters of a single word. Exported so a caller can build an `aria-label`
 * or a test assertion without re-deriving the rule.
 */
export function brandInitials(brand: string): string {
  const words = brand.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/**
 * Brand monogram tile — initials on a tinted neutral (ported from the mockup's
 * `DealCard.tsx`).
 *
 * There is no logo image path: the `brands` table has `name`, `category` and
 * `domain` but no logo column, so a logo would be invented data. If brand logos
 * are added later, this is the one component to change.
 */
export function BrandMark({
  brand,
  size = 28,
  className,
}: {
  brand: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md bg-surface-subtle font-semibold text-ink-2 ring-1 ring-inset ring-hairline",
        className
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {brandInitials(brand)}
    </span>
  );
}

export default BrandMark;
