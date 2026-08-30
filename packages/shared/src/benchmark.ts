// Versioned CPVH benchmark configuration
// Source of truth for the pricing formula bands and adjustments.
// Loaded from DB at runtime so it can be edited without deploy.

/**
 * Band rates for the CPVH pricing formula.
 *
 * UNITS — read before deriving any published number from these values.
 * `compute()` evaluates `price_cents = ccv * durationMinutes * band *
 * multiplier`, so it consumes a band as **cents per viewer-minute**. A band of
 * 0.60 therefore bills $0.006 per viewer-minute, i.e. **$0.36 per viewer-hour**.
 *
 * The v1 defaults below (0.60 / 1.05 / 2.00) were authored as *dollars per
 * viewer-hour* — they mirror the $0.60–$1.50/viewer-hour band (≈$2.00 agency)
 * quoted on the marketing site, and the type is named for cost per viewer-HOUR.
 * The formula does not reproduce that reading: it lands ~40% low. SPO-93 owns
 * the fix and the decision of which side moves. Until it closes, treat the
 * per-viewer-hour figures here as the calculator's real output and do not
 * present these constants as the published band.
 */
export interface CpvhBands {
  /** floor rate — 0.60 = $0.006 per viewer-minute = $0.36 per viewer-hour */
  floor: number;
  /** mid-market rate — 1.05 = $0.0105 per viewer-minute = $0.63 per viewer-hour */
  mid: number;
  /** agency / premium rate — 2.00 = $0.02 per viewer-minute = $1.20 per viewer-hour */
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

// Default v1 benchmark — matches the mockup Calculator verbatim
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
