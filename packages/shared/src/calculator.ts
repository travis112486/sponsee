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

/** A deal's CPVH inputs (SPO-197). `ccv`/`sponsoredMinutes` are nullable — a
 * deal logged before the creator knows their CCV has neither. */
export interface DealCpvhInputs {
  valueCents: number;
  ccv: number | null | undefined;
  sponsoredMinutes: number | null | undefined;
}

/**
 * Per-deal effective CPVH, or `null` when the deal doesn't have both inputs.
 *
 * `impliedCpvh` returns `0` for missing/invalid inputs because it has no
 * concept of "unset" — that 0 is not a real rate and must never reach the UI
 * as one (SPO-197). This wraps it with the null check the deal model needs:
 * absent CCV/duration is "no data yet", not "$0.00".
 */
export function dealEffectiveCpvh(deal: DealCpvhInputs): number | null {
  const { ccv, sponsoredMinutes, valueCents } = deal;
  if (ccv == null || sponsoredMinutes == null) return null;
  if (ccv <= 0 || sponsoredMinutes <= 0) return null;
  return impliedCpvh(valueCents, ccv, sponsoredMinutes);
}

/**
 * Account-level effective CPVH across deals, weighted by viewer-hours:
 * `sum(valueCents) / sum(viewerHours)` over deals that have both CCV and
 * duration. This is deliberately NOT the mean of each deal's
 * {@link dealEffectiveCpvh} — averaging per-deal rates directly gives a tiny
 * deal the same influence as a large one, which over-weights it. Returns
 * `null` when no deal has both inputs, for the same "no data ≠ $0.00" reason
 * as {@link dealEffectiveCpvh}.
 */
export function accountEffectiveCpvh(
  deals: readonly DealCpvhInputs[]
): number | null {
  let totalValueCents = 0;
  let totalViewerHours = 0;

  for (const deal of deals) {
    const { ccv, sponsoredMinutes, valueCents } = deal;
    if (ccv == null || sponsoredMinutes == null) continue;
    if (ccv <= 0 || sponsoredMinutes <= 0) continue;

    totalValueCents += valueCents;
    totalViewerHours += viewerHoursOf(ccv, sponsoredMinutes);
  }

  if (totalViewerHours <= 0) return null;
  return totalValueCents / 100 / totalViewerHours;
}
