import { useEffect, useRef, useState } from "react";

import { COUNT_UP_MS, prefersReducedMotion } from "@/lib/motion";

/**
 * Count-up tween for stat values and totals (SPO-193, ported from the approved
 * mockup's `hooks/useCountUp.ts`).
 *
 * Two deliberate differences from the mockup, both because this hook now reads
 * live tRPC data rather than a static fixture:
 *
 * 1. The tween starts from the value currently on screen, not from 0. On first
 *    mount that is 0, so the mockup's behaviour is preserved — but when a query
 *    refetches and the number moves from $12,400 to $12,900, it counts the last
 *    $500 instead of slamming back to zero and re-running the whole card.
 * 2. It honours `prefers-reduced-motion` by snapping straight to the target.
 *
 * The mockup's third `decimals` argument was a no-op (it only sat in the effect
 * dependency array); formatting lives in `formatCount` instead.
 */
export function useCountUp(target: number, duration: number = COUNT_UP_MS): number {
  // Sampled once on mount: an OS-level motion preference does not change
  // mid-session in practice, and reading it lazily keeps the snap path out of
  // the effect (a synchronous setState there would cascade renders).
  const [reduced] = useState(prefersReducedMotion);
  const [value, setValue] = useState(0);
  // Read inside the rAF loop so a re-render mid-tween cannot restart from a
  // stale origin, and so React state is never a tween dependency.
  const displayed = useRef(0);
  const skip = reduced || duration <= 0;

  useEffect(() => {
    if (skip) return;

    const from = displayed.current;
    if (from === target) return;

    let raf = 0;
    let start: number | null = null;

    const step = (ts: number) => {
      if (start === null) start = ts;
      const t = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + (target - from) * eased;
      displayed.current = next;
      setValue(next);
      if (t < 1) raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, skip]);

  return skip ? target : value;
}

/**
 * Format a (possibly mid-tween, possibly fractional) count for display.
 * `currency` prefixes `$`; it does not divide — pass dollars, not cents.
 */
export function formatCount(
  value: number,
  opts: { currency?: boolean; decimals?: number } = {}
): string {
  const { currency = false, decimals = 0 } = opts;
  const formatted = value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return currency ? `$${formatted}` : formatted;
}
