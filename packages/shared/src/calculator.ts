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
 * Formula extracted verbatim from the mockup Calculator (DealDetail CPVHHelper):
 *   price = round(ccv * durationMinutes * (bandRate / 100) * multiplier)
 *
 * Where bandRate comes from the benchmark config bands
 * and multiplier comes from the deliverable type.
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

  const floor = Math.round(
    ccv * durationMinutes * (config.cpvhBands.floor / 100) * effectiveMultiplier
  );
  const mid = Math.round(
    ccv * durationMinutes * (config.cpvhBands.mid / 100) * effectiveMultiplier
  );
  const agency = Math.round(
    ccv * durationMinutes * (config.cpvhBands.agency / 100) * effectiveMultiplier
  );

  return { floor, mid, agency };
}

/**
 * Compute the implied CPVH rate (dollars per viewer-minute) for a given deal value.
 * Useful for showing where an actual deal sits vs benchmark bands.
 */
export function impliedCpvh(
  valueCents: number,
  ccv: number,
  durationMinutes: number
): number {
  if (ccv <= 0 || durationMinutes <= 0 || valueCents <= 0) return 0;
  return (valueCents / 100) / (ccv * durationMinutes);
}
