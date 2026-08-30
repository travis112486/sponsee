/**
 * Subscription status vocabulary, shared by the API's billing guards and the
 * billing UI.
 *
 * ── Which source is authoritative (SPO-120) ─────────────────────────────────
 *
 * Two different questions, two different owners:
 *
 *   - **This module owns the TypeScript vocabulary.** The `SubscriptionStatus`
 *     union, the `paidStatuses` / `liveStatuses` subsets, and the predicates
 *     that read them. Anything asking "does this status grant entitlements" or
 *     "is a subscription still live" imports from here. No caller restates a
 *     status list — that is the whole point of this file.
 *   - **`subscriptionStatusEnum` in `@sponsee/db/schema` owns the DDL.** It is
 *     the Postgres type that physically constrains `creators.subscription_status`
 *     and the migration ledger behind it. A status this module knows about but
 *     the enum doesn't is a value the database will reject on write.
 *
 * `apps/api/src/billing/subscription-status.parity.test.ts` fails if the two
 * disagree. That test lives in `apps/api` because it is the only package that
 * depends on both.
 *
 * The import direction is deliberate: `packages/shared` does not depend on
 * `packages/db`. This package is a leaf with no runtime dependencies and the
 * browser bundle pulls it in; taking on drizzle and `pg` to spell eight strings
 * would be the wrong trade, and `pnpm deploy --prod` prunes the Render
 * pre-deploy migrator against `@sponsee/db`'s dependency list, which is not a
 * thing to perturb for a constant.
 */
export const subscriptionStatuses = [
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "trialing",
  "paused",
] as const;

export type SubscriptionStatus = (typeof subscriptionStatuses)[number];

/**
 * Statuses that grant paid entitlements.
 *
 * `satisfies` is load-bearing on these subsets: it keeps the literal tuple type
 * while making a status that isn't in `subscriptionStatuses` a compile error,
 * so a typo here reds the build instead of silently never matching.
 */
export const paidStatuses = [
  "active",
  "trialing",
] as const satisfies readonly SubscriptionStatus[];

/**
 * Statuses where a subscription object still exists on the Stripe customer.
 *
 * A different question from `paidStatuses`, which asks whether to grant paid
 * entitlements. A `past_due` or `unpaid` subscription grants nothing, but it is
 * still live and still billable — opening a second Checkout against it
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
export const liveStatuses = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
] as const satisfies readonly SubscriptionStatus[];

export function isPaidSubscription(status: SubscriptionStatus | null | undefined): boolean {
  return status != null && (paidStatuses as readonly SubscriptionStatus[]).includes(status);
}

export function hasLiveSubscription(status: SubscriptionStatus | null | undefined): boolean {
  return status != null && (liveStatuses as readonly SubscriptionStatus[]).includes(status);
}
