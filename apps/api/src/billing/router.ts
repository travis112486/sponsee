import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { createTRPCRouter, creatorScopedProcedure } from "../trpc.js";
import * as schema from "@sponsee/db/schema";
import { stripe } from "./stripe.js";
import { getPriceId } from "./plans.js";
import { getDealSlotLimit, hasLiveSubscription } from "./entitlements.js";
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
        subscriptionStatus: schema.creators.subscriptionStatus,
        currentPeriodEnd: schema.creators.currentPeriodEnd,
      })
      .from(schema.creators)
      .where(eq(schema.creators.id, ctx.creatorId));

    const plan = creator?.plan ?? "starter";
    const status = creator?.subscriptionStatus ?? null;

    const activeDealCount = await countActiveDeals(ctx.db, ctx.creatorId);

    // Deliberately no `stripeCustomerId` / `stripeSubscriptionId`: the browser
    // has no use for them (plan changes go through `createPortalSession`, which
    // resolves the customer server-side) and shipping them to the client only
    // widens what a stolen session or an XSS payload can read.
    return {
      plan,
      status,
      currentPeriodEnd: creator?.currentPeriodEnd ?? null,
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
          subscriptionStatus: schema.creators.subscriptionStatus,
        })
        .from(schema.creators)
        .where(eq(schema.creators.id, ctx.creatorId));

      // A subscription-mode Checkout session bills a *new* subscription; Stripe
      // never cancels the old one. Letting an existing subscriber through here
      // is how a Pro creator "switching" to Creator ends up paying $39 + $29 at
      // the same time, with `plan` tracking whichever webhook happened to land
      // last. Plan changes belong in the customer portal, which swaps the price
      // on the one subscription and prorates it; a lapsed card is fixed there
      // too (SPO-87 HIGH-1).
      if (hasLiveSubscription(creator?.subscriptionStatus ?? null)) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "You already have a subscription. Use Manage subscription to change plans or update your payment method — starting a new checkout would bill you for both.",
        });
      }

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
