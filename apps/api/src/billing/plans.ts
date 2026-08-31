import type { PlanTier } from "@sponsee/shared";
import { planTiers } from "@sponsee/shared";

export const planPriceEnvKeys: Record<PlanTier, string> = {
  starter: "STRIPE_PRICE_STARTER",
  creator: "STRIPE_PRICE_CREATOR",
  pro: "STRIPE_PRICE_PRO",
};

/**
 * A Stripe price ID is `price_` followed by an opaque token.
 *
 * Anchored on both ends so a value carrying more than one ID — or padding, or
 * shell quotes — is rejected. The live and test vaults both shipped
 * `STRIPE_PRICE_STARTER` as three space-separated IDs at one point (SPO-188),
 * pasted from a provisioning script's stdout. Unvalidated, that reaches Stripe
 * as one nonsense price and every Starter upgrade click 500s, while
 * `getTierFromPriceId` stops recognising Starter subscriptions entirely and
 * falls back to checkout metadata that a portal plan change never rewrites.
 *
 * The character class stays wider than any price ID Stripe actually issues
 * (they are alphanumeric after the prefix). Tightening it further would buy
 * nothing — the corruption this exists to catch is whitespace, extra tokens and
 * the wrong prefix — while betting the checkout path on an ID alphabet Stripe
 * is free to change.
 */
const PRICE_ID_PATTERN = /^price_[A-Za-z0-9_]+$/;

export function getPriceId(tier: PlanTier): string {
  const envKey = planPriceEnvKeys[tier];
  const priceId = process.env[envKey];
  if (!priceId) {
    throw new Error(`Missing ${envKey} environment variable`);
  }
  if (!PRICE_ID_PATTERN.test(priceId)) {
    // Deliberately does not echo the value: this throws on a config path that
    // sits next to the secret keys, and the message reaches logs.
    throw new Error(
      `${envKey} is not a valid Stripe price ID (expected a single price_… token, got ${priceId.length} characters)`
    );
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
