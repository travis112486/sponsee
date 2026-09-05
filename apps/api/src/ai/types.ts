import type { Platform } from "@sponsee/shared";

export const draftSections = ["bio", "audience", "offering", "pitch"] as const;
export type DraftSection = (typeof draftSections)[number];

export interface PlatformReach {
  platform: Platform;
  handle: string | null;
  ccv: number | null;
  followers: number | null;
  scheduleLabel: string | null;
}

export interface DealHistorySummary {
  total: number;
  paid: number;
  brandCategories: string[];
  recentTitles: string[];
  /** Closed [min, max] of the creator's own deal values, in cents. Null when no deal has a value. */
  typicalValueCents: { min: number; max: number } | null;
}

export interface CpvhGuidance {
  floor: number;
  mid: number;
  agency: number;
}

export interface CreatorContext {
  displayName: string;
  pronouns: string | null;
  category: string | null;
  platforms: PlatformReach[];
  dealHistory: DealHistorySummary;
  cpvhGuidance: CpvhGuidance | null;
}

export interface OfferingContext {
  title: string;
  priceCents?: number;
  currency?: string;
}

export interface BrandContext {
  name: string;
  category?: string;
}

/**
 * The full result surface the client renders. `not_configured` lets the UI
 * hide the "Draft with AI" entry point before a founder-provisioned key
 * exists; `error` carries a retryable message. No secret ever leaves the
 * server — `model` is a public model id, not a key.
 */
export type DraftResult =
  | { status: "ok"; text: string; model: string; section: DraftSection }
  | { status: "not_configured" }
  | { status: "error"; message: string };
