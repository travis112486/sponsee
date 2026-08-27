import type { PlanTier } from "@sponsee/shared";

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

export const planLabels: Record<PlanTier, string> = {
  starter: "Starter",
  creator: "Creator",
  pro: "Pro",
};
