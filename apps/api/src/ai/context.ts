import { asc, eq } from "drizzle-orm";
import { compute, defaultBenchmarkConfig } from "@sponsee/shared";
import type { DB } from "@sponsee/db";
import { schema } from "@sponsee/db";
import type { CreatorContext, CpvhGuidance } from "./types.js";

/**
 * Gather the creator's own account data into a plain context object for the
 * prompt layer. Reads only `creators`, `creator_platforms`, `deals`, and
 * `brands` — all scoped to the caller's `creatorId`. No third-party rows and
 * no scraped data ever enter the prompt.
 */
export async function loadCreatorContext(db: DB, creatorId: string): Promise<CreatorContext> {
  const [[creator], platformRows, dealRows, brandRows] = await Promise.all([
    db.select().from(schema.creators).where(eq(schema.creators.id, creatorId)),
    db
      .select()
      .from(schema.creatorPlatforms)
      .where(eq(schema.creatorPlatforms.creatorId, creatorId))
      .orderBy(asc(schema.creatorPlatforms.platform)),
    db
      .select({
        title: schema.deals.title,
        stage: schema.deals.stage,
        valueCents: schema.deals.valueCents,
        brandId: schema.deals.brandId,
        ccv: schema.deals.ccv,
        sponsoredMinutes: schema.deals.sponsoredMinutes,
      })
      .from(schema.deals)
      .where(eq(schema.deals.creatorId, creatorId)),
    db
      .select({ id: schema.brands.id, category: schema.brands.category })
      .from(schema.brands)
      .where(eq(schema.brands.creatorId, creatorId)),
  ]);

  if (!creator) {
    throw new Error(`Creator ${creatorId} not found`);
  }

  const brandCategoryById = new Map(
    brandRows.map((b) => [b.id, b.category]).filter(([, c]) => c != null) as [string, string][],
  );

  const values = dealRows
    .map((d) => d.valueCents)
    .filter((v): v is number => typeof v === "number" && v > 0);

  let cpvhGuidance: CpvhGuidance | null = null;
  const firstPricedDeal = dealRows.find(
    (d) => d.ccv != null && d.sponsoredMinutes != null && d.ccv > 0 && d.sponsoredMinutes > 0,
  );
  if (firstPricedDeal) {
    cpvhGuidance = compute(
      {
        ccv: firstPricedDeal.ccv!,
        durationMinutes: firstPricedDeal.sponsoredMinutes!,
        deliverableType: "ad-read",
      },
      defaultBenchmarkConfig,
    );
  }

  return {
    displayName: creator.displayName,
    pronouns: creator.pronouns,
    category: creator.category,
    platforms: platformRows.map((p) => ({
      platform: p.platform,
      handle: p.handle,
      ccv: p.ccv,
      followers: p.followers,
      scheduleLabel: p.scheduleLabel,
    })),
    dealHistory: {
      total: dealRows.length,
      paid: dealRows.filter((d) => d.stage === "paid").length,
      brandCategories: [...new Set(dealRows.map((d) => brandCategoryById.get(d.brandId)).filter(Boolean))] as string[],
      recentTitles: dealRows.slice(0, 5).map((d) => d.title),
      typicalValueCents:
        values.length > 0 ? { min: Math.min(...values), max: Math.max(...values) } : null,
    },
    cpvhGuidance,
  };
}
