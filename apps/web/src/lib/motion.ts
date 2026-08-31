/**
 * Motion tokens (SPO-193).
 *
 * The approved mockup re-declared `const EASE = [0.22, 1, 0.36, 1]` at the top of
 * Dashboard, Pipeline, CalendarPage and BenchmarkBand, and hand-picked durations
 * and stagger offsets per screen. Porting that verbatim would give three
 * independently-drifting choreographies. This module is the single source of
 * truth instead: every screen imports the same easing curve, the same duration
 * scale and the same entrance/draw/grow helpers.
 *
 * Usage:
 *   import { motion } from "framer-motion";
 *   import { entrance, EASE, DURATION } from "@/lib/motion";
 *
 *   <motion.div {...entrance(index)}>…</motion.div>
 *   <motion.path {...draw(0.4)} />
 */

/**
 * The house easing curve — a fast-out, long-settle cubic bezier. Every animated
 * surface in the product uses this; do not introduce a second curve.
 */
export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Duration scale, in seconds. Named by intent, not by number. */
export const DURATION = {
  /** Hover/press affordances, popover open. */
  fast: 0.18,
  /** Route transitions, layout shifts. */
  base: 0.22,
  /** Card / row entrance. */
  entrance: 0.32,
  /** Bar and band growth on a chart. */
  grow: 0.6,
  /** Sparkline / path draw-on, count-up. */
  draw: 0.8,
} as const;

/** Per-item delay when a list or grid staggers in, in seconds. */
export const STAGGER = {
  /** Dense lists (activity rows, deliverable checklist). */
  tight: 0.04,
  /** KPI cards, stat grids. */
  base: 0.06,
  /** Pipeline columns and other wide, few-item groups. */
  loose: 0.08,
} as const;

/** Vertical offset an entering element rises from, in px. */
export const RISE_PX = 12;

/** Count-up duration in ms — the same 0.8s as `DURATION.draw`, in the unit `useCountUp` takes. */
export const COUNT_UP_MS = DURATION.draw * 1000;

/**
 * True when the user has asked the OS to reduce motion. Guarded for SSR and for
 * jsdom, where `matchMedia` is not implemented by default.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Standard entrance: rise + fade, staggered by position.
 *
 * Spread onto a `motion.*` element. `index` is the item's position in its group;
 * pass 0 (the default) for a standalone element.
 */
export function entrance(
  index = 0,
  opts: { duration?: number; stagger?: number; delay?: number; y?: number } = {}
) {
  const {
    duration = DURATION.entrance,
    stagger = STAGGER.base,
    delay = 0,
    y = RISE_PX,
  } = opts;
  return {
    initial: { opacity: 0, y },
    animate: { opacity: 1, y: 0 },
    transition: { duration, delay: delay + index * stagger, ease: EASE },
  };
}

/**
 * Path draw-on, for sparklines and any other stroked SVG. Spread onto
 * `motion.path` / `motion.circle`; the element needs `fill="none"` and a stroke.
 */
export function draw(delay = 0, duration: number = DURATION.draw) {
  return {
    initial: { pathLength: 0 },
    animate: { pathLength: 1 },
    transition: { duration, delay, ease: EASE },
  };
}

/**
 * Bar / band growth along one axis. `axis: "y"` grows upward from the baseline
 * (revenue bars), `axis: "x"` grows rightward (progress and benchmark bands).
 */
export function grow(
  axis: "x" | "y" = "y",
  delay = 0,
  duration: number = DURATION.grow
) {
  const key = axis === "y" ? "scaleY" : "scaleX";
  return {
    initial: { [key]: 0 },
    animate: { [key]: 1 },
    transition: { duration, delay, ease: EASE },
    style: { transformOrigin: axis === "y" ? "bottom" : "left" } as const,
  };
}
