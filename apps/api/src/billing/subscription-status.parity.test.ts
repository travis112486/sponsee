import { describe, it, expect } from "vitest";
import { subscriptionStatusEnum } from "@sponsee/db/schema";
import {
  subscriptionStatuses,
  paidStatuses,
  liveStatuses,
  isPaidSubscription,
  hasLiveSubscription,
} from "@sponsee/shared";

/**
 * SPO-120. The API's entitlement guards and the billing UI used to keep separate
 * hand-copied copies of the live-status list; SPO-97 had to edit both and left a
 * comment asking future editors to keep them in step. Both now import the one
 * list from `@sponsee/shared`, so that particular drift is a compile-time
 * concern rather than something a test has to watch.
 *
 * What can still drift is the pair that cannot import each other: the TypeScript
 * vocabulary in `@sponsee/shared` and the Postgres DDL enum in `@sponsee/db`.
 * `packages/shared` stays free of a `packages/db` dependency on purpose, so
 * nothing but this test holds the two together — and this is the only package
 * that depends on both.
 *
 * The failure this prevents is not hypothetical. A status Stripe sends that is
 * in the shared list but missing from the enum gets coerced to null on write,
 * and null reads as "no subscription exists" — which is exactly the state that
 * lets a second Checkout open against a live subscription and bill a creator
 * twice (SPO-87 HIGH-1, SPO-97).
 */
describe("subscription status parity", () => {
  it("carries the same statuses in @sponsee/shared and the drizzle enum", () => {
    // Sorted, because the enum's declaration order is DDL-significant (Postgres
    // orders enum values by it) while the shared list's order means nothing.
    // Reordering one should not red this test; adding or dropping a value must.
    expect([...subscriptionStatuses].sort()).toEqual([...subscriptionStatusEnum.enumValues].sort());
  });

  it("declares no duplicate statuses on either side", () => {
    expect(new Set(subscriptionStatuses).size).toBe(subscriptionStatuses.length);
    expect(new Set(subscriptionStatusEnum.enumValues).size).toBe(
      subscriptionStatusEnum.enumValues.length
    );
  });

  // `satisfies readonly SubscriptionStatus[]` already makes a status outside the
  // union a compile error, so the subsets cannot contain a value the union
  // lacks. What it does not constrain is the relationship *between* the two
  // subsets, which is a semantic claim: a subscription we bill for is by
  // definition one that still exists.
  it("treats every paid status as also live", () => {
    for (const status of paidStatuses) {
      expect(hasLiveSubscription(status)).toBe(true);
    }
  });

  // The converse must not hold, or `hasLiveSubscription` has collapsed into
  // `isPaidSubscription` and the checkout guard has stopped asking its own
  // question — the SPO-87 HIGH-1 regression, restated as an invariant.
  it("keeps live strictly broader than paid", () => {
    const liveButUnpaid = liveStatuses.filter((status) => !isPaidSubscription(status));
    expect(liveButUnpaid.length).toBeGreaterThan(0);
    for (const status of liveButUnpaid) {
      expect(hasLiveSubscription(status)).toBe(true);
      expect(isPaidSubscription(status)).toBe(false);
    }
  });

  // Restated as literals rather than derived from the lists under test: a test
  // that maps over `liveStatuses` to assert `hasLiveSubscription` is true would
  // pass no matter what that list said. These are the values themselves.
  it("pins the statuses each predicate answers for", () => {
    expect([...paidStatuses].sort()).toEqual(["active", "trialing"]);
    expect([...liveStatuses].sort()).toEqual(
      ["active", "past_due", "paused", "trialing", "unpaid"].sort()
    );
  });
});
