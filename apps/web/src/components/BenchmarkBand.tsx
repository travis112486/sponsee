/* eslint-disable react-refresh/only-export-components */
import { cn } from "@/lib/utils";

export interface Benchmark {
  floor: number;
  mid: number;
  agency: number;
}

export interface BandPlacement {
  /** Human-readable band the value falls in */
  label: string;
  /** Tailwind background class for the band chip / marker */
  color: string;
  /** True when the value is under the benchmark floor */
  belowFloor: boolean;
}

/**
 * Single source of truth for "which benchmark band does this value sit in".
 * Shared by the deal-form widget and the Calculator screen so the two can
 * never disagree about the same number (SPO-53).
 */
export function bandPlacement(
  valueCents: number,
  { floor, mid, agency }: Benchmark
): BandPlacement {
  if (valueCents >= agency) return { label: "Agency+", color: "bg-pine", belowFloor: false };
  if (valueCents >= mid) return { label: "Mid–agency", color: "bg-denim", belowFloor: false };
  if (valueCents >= floor) return { label: "Floor–mid", color: "bg-amber", belowFloor: false };
  return { label: "Below floor", color: "bg-brick", belowFloor: true };
}

interface BenchmarkBandProps {
  /** Benchmark-suggested range (cents) */
  benchmark: Benchmark;
  /** Actual deal value (cents) */
  dealValueCents: number;
  /** Label shown above the band */
  label?: string;
}

/**
 * Visual indicator showing where a deal's actual value sits
 * relative to the floor / mid / agency benchmark bands.
 */
export function BenchmarkBand({
  benchmark,
  dealValueCents,
  label = "Rate vs benchmark",
}: BenchmarkBandProps) {
  const { floor, mid, agency } = benchmark;

  // Clamp deal value to the visible band range for positioning
  const minVal = floor * 0.5;
  const maxVal = agency * 1.2;
  const clamped = Math.max(minVal, Math.min(dealValueCents, maxVal));
  const pct =
    maxVal > minVal
      ? ((clamped - minVal) / (maxVal - minVal)) * 100
      : 50;

  // Determine which band the deal sits in
  const { label: bandLabel, color: bandColor } = bandPlacement(dealValueCents, benchmark);

  const fmt = (cents: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(cents / 100);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-ink-3">{label}</p>
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white",
            bandColor
          )}
        >
          {bandLabel}
        </span>
      </div>

      {/* Band bar */}
      <div className="relative h-3 w-full rounded-full bg-surface-subtle">
        {/* Floor marker */}
        <div
          className="absolute top-0 h-full w-0.5 bg-ink-3/30"
          style={{ left: `${((floor - minVal) / (maxVal - minVal)) * 100}%` }}
        />
        {/* Mid marker */}
        <div
          className="absolute top-0 h-full w-0.5 bg-ink-3/50"
          style={{ left: `${((mid - minVal) / (maxVal - minVal)) * 100}%` }}
        />
        {/* Agency marker */}
        <div
          className="absolute top-0 h-full w-0.5 bg-ink-3/70"
          style={{
            left: `${((agency - minVal) / (maxVal - minVal)) * 100}%`,
          }}
        />
        {/* Deal value indicator */}
        <div
          className={cn(
            "absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow",
            bandColor
          )}
          style={{ left: `${pct}%` }}
        />
      </div>

      {/* Labels */}
      <div className="flex justify-between text-[10px] text-ink-3">
        <span>Floor {fmt(floor)}</span>
        <span>Mid {fmt(mid)}</span>
        <span>Agency {fmt(agency)}</span>
      </div>

      <p className="text-[11px] text-ink-3">
        Actual deal value: <span className="font-semibold text-ink">{fmt(dealValueCents)}</span>
      </p>
    </div>
  );
}
