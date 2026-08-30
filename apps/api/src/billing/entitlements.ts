import type { PlanTier } from "@sponsee/shared";
import { planDealSlots, isPaidSubscription } from "@sponsee/shared";
import type { SubscriptionStatus } from "@sponsee/db/schema";
import { subscriptionStatusEnum } from "@sponsee/db/schema";

/**
 * The status lists and their predicates live in `@sponsee/shared` so the billing
 * UI reads the same answer instead of hand-copying it (SPO-120). Re-exported
 * here because this module is the API's billing vocabulary and every existing
 * caller imports from it; see `packages/shared/src/subscription.ts` for which
 * source is authoritative for what.
 */
export { isPaidSubscription, hasLiveSubscription } from "@sponsee/shared";

/**
 * Coerce a raw Stripe subscription status into our enum.
 *
 * Stripe may add statuses our `subscription_status` enum doesn't carry. Writing
 * one straight through would blow up the UPDATE, return 500, and put the event
 * into Stripe's retry loop forever. Unknown statuses collapse to null, which
 * `isPaidSubscription` treats as unpaid — the safe direction for entitlements.
 *
 * It is the *unsafe* direction for `hasLiveSubscription`, which reads null as
 * "no subscription exists" and lets a second Checkout open. That is why the fix
 * for `paused` was to add it to the enum rather than special-case it here: the
 * enum has to stay an honest list of what Stripe can send, and anything still
 * missing from it keeps the double-bill exposure (SPO-97).
 *
 * This reads `subscriptionStatusEnum` and not `@sponsee/shared`'s list on
 * purpose (SPO-120). The question here is "will this value survive the column?",
 * which the DDL answers; the shared list answers "what does this status mean?".
 * They are asserted equal by subscription-status.parity.test.ts, but if they
 * ever drift, guarding a write with the DDL is the direction that fails safe.
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
