import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { createTRPCRouter, creatorScopedProcedure } from "../trpc.js";
import * as schema from "@sponsee/db/schema";
import { stripe } from "./stripe.js";
import { getPriceId } from "./plans.js";
import { getDealSlotLimit } from "./entitlements.js";
import { countActiveDeals } from "./gate.js";
import type { PlanTier } from "@sponsee/shared";

const webURL = process.env.WEB_URL || "http://localhost:3000";

export const billingRouter = createTRPCRouter({
  // Single canonical source for plan + deal-slot usage — the sidebar and the
  // billing settings panel both read this so they can never disagree (SPO-42 D-004).
  getSubscription: creatorScopedProcedure.query(async ({ ctx }) => {
    const [creator] = await ctx.db
      .select({
        plan: schema.creators.plan,
        stripeCustomerId: schema.creators.stripeCustomerId,
        stripeSubscriptionId: schema.creators.stripeSubscriptionId,
        subscriptionStatus: schema.creators.subscriptionStatus,
        currentPeriodEnd: schema.creators.currentPeriodEnd,
      })
      .from(schema.creators)
      .where(eq(schema.creators.id, ctx.creatorId));

    const plan = creator?.plan ?? "starter";
    const status = creator?.subscriptionStatus ?? null;

    const activeDealCount = await countActiveDeals(ctx.db, ctx.creatorId);

    return {
      plan,
      status,
      currentPeriodEnd: creator?.currentPeriodEnd ?? null,
      stripeCustomerId: creator?.stripeCustomerId ?? null,
      stripeSubscriptionId: creator?.stripeSubscriptionId ?? null,
      dealSlotLimit: getDealSlotLimit(plan as PlanTier, status),
      activeDealCount,
    };
  }),

  createCheckoutSession: creatorScopedProcedure
    .input(
      z.object({
        tier: z.enum(["starter", "creator", "pro"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const tier = input.tier as PlanTier;
      const priceId = getPriceId(tier);

      const [creator] = await ctx.db
        .select({
          stripeCustomerId: schema.creators.stripeCustomerId,
        })
        .from(schema.creators)
        .where(eq(schema.creators.id, ctx.creatorId));

      let customerId = creator?.stripeCustomerId;

      if (!customerId) {
        const user = ctx.session.user;
        const customer = await stripe.customers.create({
          email: user.email,
          name: user.name || undefined,
          metadata: { creatorId: ctx.creatorId },
        });
        customerId = customer.id;

        await ctx.db
          .update(schema.creators)
          .set({ stripeCustomerId: customerId })
          .where(eq(schema.creators.id, ctx.creatorId));
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        success_url: `${webURL}/settings?tab=billing&result=success`,
        cancel_url: `${webURL}/settings?tab=billing&result=cancel`,
        subscription_data: {
          // `tier` must be on the subscription too, not just the session: the
          // subscription is what every later webhook carries, and without it a
          // paid creator's `plan` column would never leave its default.
          metadata: { creatorId: ctx.creatorId, tier },
        },
        metadata: { creatorId: ctx.creatorId, tier },
      });

      if (!session.url) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create checkout session",
        });
      }

      return { url: session.url };
    }),

  createPortalSession: creatorScopedProcedure.mutation(async ({ ctx }) => {
    const [creator] = await ctx.db
      .select({ stripeCustomerId: schema.creators.stripeCustomerId })
      .from(schema.creators)
      .where(eq(schema.creators.id, ctx.creatorId));

    if (!creator?.stripeCustomerId) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "No Stripe customer found",
      });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: creator.stripeCustomerId,
      return_url: `${webURL}/settings?tab=billing`,
    });

    return { url: session.url };
  }),
});
