// Versioned CPVH benchmark configuration
// Source of truth for the pricing formula bands and adjustments.
// Loaded from DB at runtime so it can be edited without deploy.

export interface CpvhBands {
  /** floor rate — e.g. 0.60 means $0.006 per viewer-minute */
  floor: number;
  /** mid-market rate — e.g. 1.05 means $0.0105 per viewer-minute */
  mid: number;
  /** agency / premium rate — e.g. 2.0 means $0.02 per viewer-minute */
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
