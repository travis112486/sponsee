import type { PlanTier } from "@sponsee/shared";
import { planDealSlots } from "@sponsee/shared";
import type { SubscriptionStatus } from "@sponsee/db/schema";
import { subscriptionStatusEnum } from "@sponsee/db/schema";

const paidStatuses: SubscriptionStatus[] = ["active", "trialing"];

export function isPaidSubscription(status: SubscriptionStatus | null): boolean {
  return status != null && paidStatuses.includes(status);
}

/**
 * Statuses where a subscription object still exists on the Stripe customer.
 *
 * A different question from `isPaidSubscription`, which asks whether to grant
 * paid entitlements. A `past_due` or `unpaid` subscription grants nothing, but
 * it is still live and still billable — opening a second Checkout against it
 * double-charges exactly as it would against an `active` one, so the guard on
 * checkout has to ask this question and not the entitlement one (SPO-87 HIGH-1).
 *
 * `incomplete` is deliberately excluded: its first payment never succeeded and
 * Stripe voids it within 23 hours, so a fresh Checkout is the recovery path
 * rather than a double charge.
 *
 * `paused` is included for the same reason as `past_due`: `pause_collection`
 * stops the invoices, not the subscription — it is still attached to the
 * customer and resumes on its own schedule, so a second Checkout stacks a real
 * charge on top of it (SPO-97). It grants no entitlements, hence live but not
 * paid.
 */
const liveStatuses: SubscriptionStatus[] = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
];

export function hasLiveSubscription(status: SubscriptionStatus | null): boolean {
  return status != null && liveStatuses.includes(status);
}

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
