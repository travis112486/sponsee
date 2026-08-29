import type { PlanTier } from "@sponsee/shared";
import { planDealSlots } from "@sponsee/shared";
import type { SubscriptionStatus } from "@sponsee/db/schema";
import { subscriptionStatusEnum } from "@sponsee/db/schema";

const paidStatuses: SubscriptionStatus[] = ["active", "trialing"];

export function isPaidSubscription(status: SubscriptionStatus | null): boolean {
  return status != null && paidStatuses.includes(status);
}

/**
 * Coerce a raw Stripe subscription status into our enum.
 *
 * Stripe can send statuses our `subscription_status` enum doesn't carry (e.g.
 * `paused`). Writing one straight through would blow up the INSERT, return 500,
 * and put the event into Stripe's retry loop forever. Unknown statuses collapse
 * to null, which `isPaidSubscription` treats as unpaid — the safe direction.
 */
export function toSubscriptionStatus(value: string | null | undefined): SubscriptionStatus | null {
  if (!value) return null;
  return subscriptionStatusEnum.enumValues.includes(value as SubscriptionStatus)
    ? (value as SubscriptionStatus)
    : null;
}

export function getDealSlotLimit(plan: PlanTier, subscriptionStatus: SubscriptionStatus | null): number {
  // If subscription is not paid, they stay on starter limits regardless of plan column
  if (!isPaidSubscription(subscriptionStatus)) {
    return planDealSlots.starter;
  }
  return planDealSlots[plan];
}

export function canCreateDeal(
  plan: PlanTier,
  subscriptionStatus: SubscriptionStatus | null,
  currentDealCount: number
): boolean {
  const limit = getDealSlotLimit(plan, subscriptionStatus);
  return currentDealCount < limit;
}
