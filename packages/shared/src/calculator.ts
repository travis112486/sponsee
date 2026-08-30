import type { BenchmarkConfig, BenchmarkDeliverableType } from "./benchmark.js";

export interface ComputeInputs {
  /** Average concurrent viewers */
  ccv: number;
  /** Duration in minutes */
  durationMinutes: number;
  /** Deliverable type key */
  deliverableType: BenchmarkDeliverableType;
  /** Optional platform mix for adjustments (not yet used in v1) */
  platforms?: string[];
}

export interface ComputeResult {
  /** Floor-band suggested price (cents) */
  floor: number;
  /** Mid-band suggested price (cents) */
  mid: number;
  /** Agency-band suggested price (cents) */
  agency: number;
}

/**
 * Pure function: compute CPVH-based suggested pricing.
 *
 * All monetary values in this module are in **cents** to align with the deal
 * model (valueCents) and invoice model (amountCents). Band rates are in
 * **dollars per viewer-hour** — see {@link CpvhBands}.
 *
 * Formula:
 *   viewerHours = ccv * (durationMinutes / 60)
 *   price_cents = round(viewerHours * bandRate * 100 * multiplier)
 *
 * The `* 100` converts the dollars-per-viewer-hour band into cents; the
 * `/ 60` converts the caller's minutes into the hours the band is quoted in.
 * Dropping either one is the SPO-93 bug: the two errors are 100/60 = 1.667x
 * apart, so omitting both at once quoted 60% of the published band.
 */
export function compute(
  inputs: ComputeInputs,
  config: BenchmarkConfig
): ComputeResult {
  const { ccv, durationMinutes, deliverableType } = inputs;

  if (ccv <= 0 || durationMinutes <= 0) {
    return { floor: 0, mid: 0, agency: 0 };
  }

  const multiplier = config.deliverableMultipliers[deliverableType] ?? 1.0;

  // Apply platform-mix adjustment if any platforms are specified
  let platformAdjustment = 1.0;
  if (inputs.platforms && inputs.platforms.length > 0) {
    const adjustments = inputs.platforms
      .map((p) => config.platformMixAdjustments?.[p])
      .filter((v): v is number => typeof v === "number");
    if (adjustments.length > 0) {
      platformAdjustment =
        adjustments.reduce((a, b) => a + b, 0) / adjustments.length;
    }
  }

  const effectiveMultiplier = multiplier * platformAdjustment;

  const viewerHours = viewerHoursOf(ccv, durationMinutes);
  const priceCents = (bandRate: number) =>
    Math.round(viewerHours * bandRate * 100 * effectiveMultiplier);

  return {
    floor: priceCents(config.cpvhBands.floor),
    mid: priceCents(config.cpvhBands.mid),
    agency: priceCents(config.cpvhBands.agency),
  };
}

/** Viewer-hours bought by `ccv` concurrent viewers over `durationMinutes`. */
export function viewerHoursOf(ccv: number, durationMinutes: number): number {
  return ccv * (durationMinutes / 60);
}

/**
 * Compute the implied CPVH rate (**dollars per viewer-hour**) for a given deal
 * value. Useful for showing where an actual deal sits vs benchmark bands.
 *
 * This is the exact inverse of {@link compute} at multiplier 1.0, and is on the
 * same scale as {@link CpvhBands} — a deal priced at the mid band returns the
 * mid band rate. Keep it that way: the Calculator and Dashboard render this
 * number directly against the published $0.60–$2.00 axis (SPO-93).
 */
export function impliedCpvh(
  valueCents: number,
  ccv: number,
  durationMinutes: number
): number {
  if (ccv <= 0 || durationMinutes <= 0 || valueCents <= 0) return 0;
  return valueCents / 100 / viewerHoursOf(ccv, durationMinutes);
}
