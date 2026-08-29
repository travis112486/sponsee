import { TRPCError } from "@trpc/server";
import { and, count, eq, isNull, ne } from "drizzle-orm";
import type { DB } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import type { PlanTier } from "@sponsee/shared";
import { canCreateDeal, getDealSlotLimit } from "./entitlements.js";

export type CreatorEntitlement = {
  plan: PlanTier;
  status: schema.SubscriptionStatus | null;
  dealSlotLimit: number;
  activeDealCount: number;
};

/**
 * Count the deals that consume a slot.
 *
 * "Active" means not soft-deleted and not yet terminal (`paid`). The billing
 * panel, the sidebar meter and the create-time gate all call through here so
 * the number a creator is shown is the same number they are held to.
 */
export async function countActiveDeals(db: DB, creatorId: string): Promise<number> {
  const [row] = await db
    .select({ activeDealCount: count() })
    .from(schema.deals)
    .where(
      and(
        eq(schema.deals.creatorId, creatorId),
        isNull(schema.deals.deletedAt),
        ne(schema.deals.stage, "paid")
      )
    );
  return row?.activeDealCount ?? 0;
}

/** Load the plan, subscription status and slot usage for one creator. */
export async function getCreatorEntitlement(db: DB, creatorId: string): Promise<CreatorEntitlement> {
  const [creator] = await db
    .select({
      plan: schema.creators.plan,
      subscriptionStatus: schema.creators.subscriptionStatus,
    })
    .from(schema.creators)
    .where(eq(schema.creators.id, creatorId));

  const plan = (creator?.plan ?? "starter") as PlanTier;
  const status = creator?.subscriptionStatus ?? null;

  return {
    plan,
    status,
    dealSlotLimit: getDealSlotLimit(plan, status),
    activeDealCount: await countActiveDeals(db, creatorId),
  };
}

/**
 * Plan gate for deal creation.
 *
 * Throws FORBIDDEN when the creator is at their tier's slot limit. An unpaid or
 * past-due subscription falls back to starter limits (see `getDealSlotLimit`),
 * so a lapsed Pro creator keeps read access to everything they already have but
 * cannot open new deals until billing is healthy again.
 */
export async function assertDealSlotAvailable(db: DB, creatorId: string): Promise<void> {
  const { plan, status, dealSlotLimit, activeDealCount } = await getCreatorEntitlement(db, creatorId);

  if (!canCreateDeal(plan, status, activeDealCount)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `You've used all ${dealSlotLimit} active deal slots on your current plan. Upgrade in Settings → Billing, or mark a deal as paid to free a slot.`,
    });
  }
}
