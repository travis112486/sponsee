import type { PlanTier } from "@sponsee/shared";
import { planDealSlots } from "@sponsee/shared";
import type { SubscriptionStatus } from "@sponsee/db/schema";

const paidStatuses: SubscriptionStatus[] = ["active", "trialing"];

export function isPaidSubscription(status: SubscriptionStatus | null): boolean {
  return status != null && paidStatuses.includes(status);
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
