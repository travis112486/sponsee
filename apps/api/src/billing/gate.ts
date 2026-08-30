import { TRPCError } from "@trpc/server";
import { and, count, eq, isNull, ne, sql } from "drizzle-orm";
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

/**
 * Gate the `paid` → active transition.
 *
 * `countActiveDeals` excludes `paid`, so marking a deal paid frees a slot.
 * Moving it back to an active stage takes one again — and without this check a
 * creator sitting at their limit can park deals in `paid` and reopen them for
 * free, which bypasses the tier limit exactly as an ungated create would.
 *
 * Run this inside `withCreatorSlotLock` so a re-open and a concurrent create
 * contend for the same lock rather than each seeing a pre-write count.
 */
export async function assertSlotForReopen(
  db: DB,
  creatorId: string,
  dealId: string
): Promise<void> {
  const [current] = await db
    .select({ stage: schema.deals.stage })
    .from(schema.deals)
    .where(and(eq(schema.deals.id, dealId), eq(schema.deals.creatorId, creatorId)));

  // Already active — it holds a slot now and will still hold one after. A row
  // that isn't ours falls through here too; the caller's own scoped write is
  // what turns that into a 404.
  if (current?.stage !== "paid") return;

  await assertDealSlotAvailable(db, creatorId);
}

/**
 * Run a slot-consuming write with the creator's slot accounting serialized.
 *
 * `assertDealSlotAvailable` counts, and the caller writes afterwards. Read
 * Committed gives those two statements no relationship whatsoever: two requests
 * that arrive together at limit−1 both count limit−1, both pass, and both
 * insert — the tier's limit is exceeded by exactly the number of racers. This
 * is the race class SPO-68 closed in the chase lane, here solved by taking a row
 * lock on the creator instead of an atomic claim, because the guard is over a
 * COUNT across many rows rather than one row's status column.
 *
 * `SELECT ... FOR UPDATE` on the creator row makes the second transaction block
 * until the first commits, so its count observes the deal the first one just
 * inserted. The creator row is the natural lock subject: it is also where `plan`
 * and `subscription_status` live, so nothing else can move the limit underneath
 * a caller mid-check either.
 *
 * Callers must do their gate check and their write against the `tx` handed to
 * `run` — work done against the outer `db` escapes the lock.
 */
export async function withCreatorSlotLock<T>(
  database: DB,
  creatorId: string,
  run: (tx: DB) => Promise<T>
): Promise<T> {
  return (database as DB).transaction(async (tx) => {
    await tx.execute(
      sql`select ${schema.creators.id} from ${schema.creators} where ${schema.creators.id} = ${creatorId} for update`
    );
    return run(tx as unknown as DB);
  });
}
