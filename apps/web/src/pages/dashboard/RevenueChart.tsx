import { useState } from "react";
import { TrendingUp } from "lucide-react";

import { motion, DURATION, EASE, STAGGER, prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { formatAxisCents, formatCents, monthLabels } from "./format";

export interface RevenueMonth {
  /** `YYYY-MM`, UTC, as bucketed by `dashboard.overview`. */
  month: string;
  valueCents: number;
  flatCents: number;
  bountyCents: number;
  hybridCents: number;
}

const W = 640;
const H = 232;
const PAD_L = 44;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 26;
const CHART_H = H - PAD_T - PAD_B;
const CHART_W = W - PAD_L - PAD_R;

/**
 * Round a maximum up to a readable axis ceiling (1, 2 or 5 × a power of ten) so
 * the gridline labels are `$1K / $2K / $3K / $4K` rather than `$3,847`.
 */
function niceCeiling(maxCents: number): number {
  if (maxCents <= 0) return 0;
  const magnitude = Math.pow(10, Math.floor(Math.log10(maxCents)));
  const normalized = maxCents / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

type Split = { label: string; cents: number };

function splitOf(m: RevenueMonth): Split[] {
  return [
    { label: "Flat", cents: m.flatCents },
    { label: "Bounty", cents: m.bountyCents },
    { label: "Hybrid", cents: m.hybridCents },
  ];
}

/**
 * Untyped remainder: an invoice whose deal was hard-deleted still counts toward
 * the month total but cannot be attributed to flat/bounty/hybrid. Surfacing it
 * keeps the tooltip's parts summing to its own total instead of quietly
 * disagreeing with the headline number.
 */
function untypedOf(m: RevenueMonth): number {
  return m.valueCents - m.flatCents - m.bountyCents - m.hybridCents;
}

/**
 * Revenue by month — the module the founder flagged as the single biggest gap
 * on the shipped dashboard, which never showed a creator their revenue at all.
 *
 * Hand-rolled SVG rather than a charting library, following the SPO-193
 * precedent set by `Sparkline` (see that file for the bundle rationale). Bars
 * are focusable so the flat/bounty/hybrid split is reachable by keyboard, and
 * the same series is mirrored into a visually-hidden table so it is readable
 * without pointer *or* focus.
 */
export function RevenueChart({
  months,
  className,
}: {
  months: RevenueMonth[];
  className?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const reduced = prefersReducedMotion();

  const total = months.reduce((s, m) => s + m.valueCents, 0);
  const max = niceCeiling(Math.max(...months.map((m) => m.valueCents), 0));
  const barSlot = months.length > 0 ? CHART_W / months.length : CHART_W;

  const header = (
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="text-[14px] font-semibold text-ink">Revenue by month</h3>
      <span className="text-[11px] text-ink-3">Last 12 months · paid invoices</span>
    </div>
  );

  // A flat baseline of twelve zero-height bars reads as a broken chart, not as
  // "you have not been paid yet". Say the latter.
  if (total === 0) {
    return (
      <section
        className={cn(
          "rounded-xl border border-hairline bg-surface p-5 shadow-warm",
          className
        )}
      >
        {header}
        <div className="mt-6 flex flex-col items-center justify-center gap-2 py-10 text-center">
          <TrendingUp className="h-5 w-5 text-ink-3" aria-hidden />
          <p className="text-[13px] font-medium text-ink-2">No revenue recorded yet</p>
          <p className="max-w-[38ch] text-[12px] text-ink-3">
            This chart fills in as invoices are marked paid. Revenue is dated by
            when the money landed, not when you sent the invoice.
          </p>
        </div>
      </section>
    );
  }

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));

  return (
    <section
      className={cn(
        "rounded-xl border border-hairline bg-surface p-5 shadow-warm",
        className
      )}
    >
      {header}

      <div className="relative mt-3">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={`Revenue by month for the last 12 months, totalling ${formatCents(total)}. The full series follows as a table.`}
        >
          {ticks.map((t) => {
            const y = PAD_T + CHART_H - (max === 0 ? 0 : (t / max) * CHART_H);
            return (
              <g key={t}>
                <line
                  x1={PAD_L}
                  x2={W - PAD_R}
                  y1={y}
                  y2={y}
                  className="stroke-hairline"
                  strokeWidth={1}
                />
                <text
                  x={PAD_L - 8}
                  y={y + 3}
                  textAnchor="end"
                  fontSize={10}
                  className="fill-ink-3 font-mono"
                >
                  {formatAxisCents(t)}
                </text>
              </g>
            );
          })}

          {months.map((m, i) => {
            const h = max === 0 ? 0 : (m.valueCents / max) * CHART_H;
            const slotX = PAD_L + i * barSlot;
            const barW = barSlot * 0.56;
            const barX = slotX + barSlot * 0.22;
            const isCurrent = i === months.length - 1;
            const isActive = active === i;
            const { short, long } = monthLabels(m.month);
            const parts = [...splitOf(m), { label: "Other", cents: untypedOf(m) }]
              .filter((p) => p.cents > 0)
              .map((p) => `${p.label} ${formatCents(p.cents)}`)
              .join(", ");

            return (
              <g
                key={m.month}
                tabIndex={0}
                role="button"
                aria-label={
                  m.valueCents === 0
                    ? `${long}: no revenue`
                    : `${long}: ${formatCents(m.valueCents)}${parts ? `. ${parts}` : ""}`
                }
                className="cursor-pointer outline-none [&:focus-visible>rect:first-child]:stroke-pine"
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              >
                {/* Full-height hit area: hovering the gap above a short bar
                    should still open that month's tooltip. */}
                <rect
                  x={slotX}
                  y={PAD_T}
                  width={barSlot}
                  height={CHART_H}
                  rx={4}
                  fill="transparent"
                  strokeWidth={1.5}
                />
                <motion.rect
                  x={barX}
                  width={barW}
                  rx={4}
                  className="fill-pine"
                  fillOpacity={isCurrent || isActive ? 1 : 0.55}
                  initial={
                    reduced
                      ? false
                      : { y: PAD_T + CHART_H, height: 0 }
                  }
                  animate={{ y: PAD_T + CHART_H - h, height: h }}
                  transition={{
                    duration: DURATION.grow,
                    delay: reduced ? 0 : i * STAGGER.tight,
                    ease: EASE,
                  }}
                />
                <text
                  x={slotX + barSlot / 2}
                  y={H - 8}
                  textAnchor="middle"
                  fontSize={10}
                  className={cn("font-mono", isActive ? "fill-ink" : "fill-ink-3")}
                >
                  {short}
                </text>
              </g>
            );
          })}
        </svg>

        {active !== null && (
          <div
            role="tooltip"
            className="pointer-events-none absolute top-0 z-10 w-44 -translate-x-1/2 rounded-lg border border-hairline bg-surface p-2.5 shadow-warm-md"
            style={{
              left: `${((PAD_L + active * barSlot + barSlot / 2) / W) * 100}%`,
            }}
          >
            <p className="flex justify-between gap-3 text-[12px] font-semibold text-ink">
              {monthLabels(months[active].month).long}
              <span className="tnum font-mono">
                {formatCents(months[active].valueCents)}
              </span>
            </p>
            {splitOf(months[active]).map((p) => (
              <p
                key={p.label}
                className="mt-0.5 flex justify-between gap-3 text-[11px] text-ink-3"
              >
                {p.label}
                <span className="tnum font-mono">{formatCents(p.cents)}</span>
              </p>
            ))}
            {untypedOf(months[active]) > 0 && (
              <p className="mt-0.5 flex justify-between gap-3 text-[11px] text-ink-3">
                Other
                <span className="tnum font-mono">
                  {formatCents(untypedOf(months[active]))}
                </span>
              </p>
            )}
          </div>
        )}
      </div>

      {/* Text equivalent. `sr-only` rather than `aria-hidden` on the SVG: the
          chart keeps its own summary label, and this gives the exact numbers to
          anyone who cannot hover or tab through twelve bars. */}
      <table className="sr-only">
        <caption>Revenue by month, split by deal type</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Total</th>
            <th scope="col">Flat</th>
            <th scope="col">Bounty</th>
            <th scope="col">Hybrid</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month}>
              <th scope="row">{monthLabels(m.month).long}</th>
              <td>{formatCents(m.valueCents)}</td>
              <td>{formatCents(m.flatCents)}</td>
              <td>{formatCents(m.bountyCents)}</td>
              <td>{formatCents(m.hybridCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default RevenueChart;
