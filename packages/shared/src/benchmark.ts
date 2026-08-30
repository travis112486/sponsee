// Versioned CPVH benchmark configuration
// Source of truth for the pricing formula bands and adjustments.
// Loaded from DB at runtime so it can be edited without deploy.

/**
 * Band rates for the CPVH pricing formula.
 *
 * UNITS: **dollars per viewer-hour** (CPVH = cost per viewer-*hour*). One
 * concurrent viewer watching one sponsored hour is one viewer-hour, so a band
 * of 0.60 bills $0.60 for 1 CCV × 60 min, or $300 for 500 CCV × 60 min.
 *
 * These are the numbers the product publishes: the marketing site quotes
 * "$0.60–$1.50 per viewer-hour, up to ~$2.00 for agency-repped talent", the
 * mockup's benchmark axis runs 0 → $2.00 in the same unit, and `impliedCpvh()`
 * returns a value on this scale so a quote can be plotted against it directly.
 *
 * Do NOT reinterpret these as a per-minute rate. `compute()` divides minutes by
 * 60 and multiplies by 100 to reach cents; the two conversions are 100/60 apart,
 * and dropping both is what made the shipped calculator quote 60% of the
 * published band (SPO-93).
 */
export interface CpvhBands {
  /** floor rate — 0.60 = $0.60 per viewer-hour */
  floor: number;
  /** mid-market rate — 1.05 = $1.05 per viewer-hour (midpoint of $0.60–$1.50) */
  mid: number;
  /** agency / premium rate — 2.00 = $2.00 per viewer-hour */
  agency: number;
}

export interface BenchmarkConfig {
  version: number;
  effectiveDate: string; // ISO-8601 date
  cpvhBands: CpvhBands;
  /** Multiplier applied per deliverable type key */
  deliverableMultipliers: Record<string, number>;
  /** Optional platform-mix adjustment factors */
  platformMixAdjustments?: Record<string, number>;
}

// Default v1 benchmark — matches the mockup Calculator verbatim.
// Bands are dollars per viewer-hour; see CpvhBands above.
export const defaultBenchmarkConfig: BenchmarkConfig = {
  version: 1,
  effectiveDate: "2024-01-01",
  cpvhBands: {
    floor: 0.6,
    mid: 1.05,
    agency: 2.0,
  },
  deliverableMultipliers: {
    "ad-read": 1.0,
    segment: 1.25,
    vod: 1.6,
  },
  platformMixAdjustments: {
    twitch: 1.0,
    youtube: 1.0,
    kick: 1.0,
    tiktok: 1.0,
  },
};

/** Allowed deliverable type keys in the benchmark config */
export const benchmarkDeliverableTypes = ["ad-read", "segment", "vod"] as const;
export type BenchmarkDeliverableType = (typeof benchmarkDeliverableTypes)[number];

/** Validate that a JSON blob looks like a BenchmarkConfig */
export function validateBenchmarkConfig(
  raw: unknown
): BenchmarkConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  if (
    typeof obj.version !== "number" ||
    typeof obj.effectiveDate !== "string" ||
    typeof obj.cpvhBands !== "object" ||
    obj.cpvhBands === null
  ) {
    return null;
  }

  const bands = obj.cpvhBands as Record<string, unknown>;
  if (
    typeof bands.floor !== "number" ||
    typeof bands.mid !== "number" ||
    typeof bands.agency !== "number"
  ) {
    return null;
  }

  if (
    typeof obj.deliverableMultipliers !== "object" ||
    obj.deliverableMultipliers === null
  ) {
    return null;
  }

  return raw as BenchmarkConfig;
}
