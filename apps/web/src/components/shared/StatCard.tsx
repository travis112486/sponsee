/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { ArrowUpRight } from "lucide-react";

import { Sparkline } from "@/components/shared/Sparkline";
import { formatCount, useCountUp } from "@/hooks/useCountUp";
import { motion, entrance } from "@/lib/motion";
import { cn } from "@/lib/utils";

const deltaChip = cva(
  "rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4",
  {
    variants: {
      tone: {
        neutral: "bg-ink/[.06] text-ink-2",
        accent: "bg-pine-tint text-pine",
        amber: "bg-amber-tint text-amber",
        danger: "bg-brick-tint text-brick",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
);

export interface DeltaChip {
  text: string;
  tone?: NonNullable<VariantProps<typeof deltaChip>["tone"]>;
}

export interface StatCardProps {
  /** Small uppercase label above the figure, e.g. "Revenue". */
  eyebrow: string;
  /**
   * The figure itself, already in display units — pass dollars, not cents. The
   * card tweens it; it does not format currency beyond an optional `$` prefix.
   *
   * `null` means "this number does not exist yet" and renders `emptyLabel`
   * instead of a figure. It is deliberately not the same as `0`: a KPI whose
   * inputs are missing must never render `$0.00`, because a creator cannot tell
   * that apart from having genuinely earned nothing. Founder-ratified on the
   * SPO-45 decision card and carried into SPO-194.
   */
  value: number | null;
  currency?: boolean;
  decimals?: number;
  /** Shown in place of the figure when `value` is `null`. */
  emptyLabel?: string;
  /** Period-over-period chip, e.g. `{ text: "+12%", tone: "accent" }`. */
  delta?: DeltaChip;
  /** One line of context under the figure, e.g. "3 invoices". */
  context?: string;
  /** Trend series for the inline sparkline. Needs at least two points. */
  sparkline?: number[];
  /** Extra content rendered below the context row (e.g. a benchmark mini-band). */
  extra?: ReactNode;
  /** Makes the card a button and shows the hover affordance. */
  onClick?: () => void;
  /** Position in the KPI row; drives the entrance stagger. */
  index?: number;
  className?: string;
}

/**
 * KPI card with count-up, delta chip and optional sparkline (ported from the
 * mockup's `components/shared/StatCard.tsx`).
 *
 * Props are plain display primitives rather than a mock-data row, so a screen
 * maps its tRPC result onto the card and the card stays data-shape agnostic.
 */
export function StatCard({
  eyebrow,
  value,
  currency = false,
  decimals = 0,
  emptyLabel = "Not enough data yet",
  delta,
  context,
  sparkline,
  extra,
  onClick,
  index = 0,
  className,
}: StatCardProps) {
  // Hooks cannot be conditional, so the tween always runs; its output is simply
  // not rendered in the empty state.
  const animated = useCountUp(value ?? 0);
  const empty = value === null;
  const Tag = onClick ? "button" : "div";

  return (
    <motion.div {...entrance(index)} className={className}>
      <Tag
        {...(onClick ? { type: "button" as const, onClick } : {})}
        className={cn(
          "group flex h-full w-full flex-col rounded-xl border border-hairline bg-surface p-5 text-left shadow-warm transition-all duration-150",
          onClick &&
            "hover:-translate-y-px hover:shadow-warm-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine/30"
        )}
      >
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
            {eyebrow}
          </span>
          {onClick && (
            <ArrowUpRight className="h-3.5 w-3.5 text-ink-3 opacity-0 transition-all duration-150 group-hover:translate-x-0.5 group-hover:opacity-100" />
          )}
        </div>

        <div className="mt-2 flex items-baseline gap-2">
          {empty ? (
            // Sized to sit on the same baseline as a figure so a row of cards
            // does not jump when one of them has no data.
            <span className="text-[15px] font-medium leading-[34px] text-ink-3">
              {emptyLabel}
            </span>
          ) : (
            <span className="tnum text-[26px] font-semibold tracking-[-0.02em] text-ink">
              {formatCount(animated, { currency, decimals })}
            </span>
          )}
          {/* A delta describes a change in the figure, so it is meaningless
              without one. */}
          {delta && !empty && (
            <span className={deltaChip({ tone: delta.tone })}>{delta.text}</span>
          )}
        </div>

        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          {context && <span className="text-[11px] leading-4 text-ink-3">{context}</span>}
          {sparkline && !empty && <Sparkline points={sparkline} />}
        </div>

        {extra}
      </Tag>
    </motion.div>
  );
}

export { deltaChip as statCardDeltaVariants };
export default StatCard;
