import type { Hono } from "hono";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { stripe } from "./stripe.js";
import type { PlanTier } from "@sponsee/shared";

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

function toPlanTier(tier: string): PlanTier | null {
  if (tier === "starter" || tier === "creator" || tier === "pro") {
    return tier;
  }
  return null;
}

async function updateCreatorFromSubscription(subscription: Stripe.Subscription) {
  const creatorId = subscription.metadata?.creatorId;
  if (!creatorId) {
    console.warn("[stripe webhook] Subscription missing creatorId metadata", subscription.id);
    return;
  }

  const status = subscription.status as schema.SubscriptionStatus;
  const planTier = toPlanTier(subscription.metadata?.tier ?? "");

  await db
    .update(schema.creators)
    .set({
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: status,
      currentPeriodEnd: subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000)
        : null,
      ...(planTier ? { plan: planTier } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.creators.id, creatorId));
}

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  if (session.mode !== "subscription") return;

  const creatorId = session.metadata?.creatorId;
  if (!creatorId) {
    console.warn("[stripe webhook] Checkout session missing creatorId metadata", session.id);
    return;
  }

  const subscriptionId = session.subscription;
  if (!subscriptionId || typeof subscriptionId !== "string") return;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  await updateCreatorFromSubscription(subscription);
}

export function registerStripeWebhook(app: Hono) {
  app.post("/api/webhooks/stripe", async (c) => {
    const payload = await c.req.text();
    const signature = c.req.header("stripe-signature") || "";

    if (!webhookSecret) {
      console.warn("[stripe webhook] STRIPE_WEBHOOK_SECRET not configured — rejecting");
      return c.json({ error: "Webhook secret not configured" }, 500);
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.warn("[stripe webhook] Signature verification failed:", message);
      return c.json({ error: "Invalid signature" }, 400);
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
          break;
        }
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
          await updateCreatorFromSubscription(event.data.object as Stripe.Subscription);
          break;
        }
        case "invoice.payment_failed": {
          const subscription = event.data.object as Stripe.Invoice;
          const subId = subscription.subscription;
          if (subId && typeof subId === "string") {
            const sub = await stripe.subscriptions.retrieve(subId);
            await updateCreatorFromSubscription(sub);
          }
          break;
        }
        default: {
          // unhandled event type — silently accept
          break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[stripe webhook] Handler error:", message);
      return c.json({ error: "Webhook handler failed" }, 500);
    }

    return c.json({ received: true });
  });
}
