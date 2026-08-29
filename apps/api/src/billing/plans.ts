import type { PlanTier } from "@sponsee/shared";
import { planTiers } from "@sponsee/shared";

export const planPriceEnvKeys: Record<PlanTier, string> = {
  starter: "STRIPE_PRICE_STARTER",
  creator: "STRIPE_PRICE_CREATOR",
  pro: "STRIPE_PRICE_PRO",
};

export function getPriceId(tier: PlanTier): string {
  const envKey = planPriceEnvKeys[tier];
  const priceId = process.env[envKey];
  if (!priceId) {
    throw new Error(`Missing ${envKey} environment variable`);
  }
  return priceId;
}

/**
 * Reverse lookup: Stripe price ID → plan tier.
 *
 * The price on the subscription is the authoritative record of what the creator
 * is actually paying for. Metadata can be stale or absent — a plan change made
 * through the Stripe customer portal swaps the price but never rewrites the
 * metadata we set at checkout time. Read env on every call so tests (and
 * rotated price IDs) are picked up without a module reload.
 */
export function getTierFromPriceId(priceId: string | null | undefined): PlanTier | null {
  if (!priceId) return null;
  for (const tier of planTiers) {
    if (process.env[planPriceEnvKeys[tier]] === priceId) {
      return tier;
    }
  }
  return null;
}

export function toPlanTier(value: string | null | undefined): PlanTier | null {
  return planTiers.includes(value as PlanTier) ? (value as PlanTier) : null;
}

export const planLabels: Record<PlanTier, string> = {
  starter: "Starter",
  creator: "Creator",
  pro: "Pro",
};
