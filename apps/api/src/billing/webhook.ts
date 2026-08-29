import type { Hono } from "hono";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { stripe } from "./stripe.js";
import { getTierFromPriceId, toPlanTier } from "./plans.js";
import { toSubscriptionStatus } from "./entitlements.js";
import type { PlanTier } from "@sponsee/shared";

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * Work out which tier a subscription represents.
 *
 * The price attached to the subscription wins: it is what Stripe actually bills
 * and it is what changes when a creator switches plans in the customer portal.
 * Checkout metadata is only a fallback for the (test-mode) case where price IDs
 * aren't configured — it is written once at checkout and never updated after.
 */
function tierFromSubscription(subscription: Stripe.Subscription): PlanTier | null {
  const priceId = subscription.items?.data?.[0]?.price?.id;
  return getTierFromPriceId(priceId) ?? toPlanTier(subscription.metadata?.tier);
}

/**
 * Find the creator this subscription belongs to.
 *
 * Prefer the metadata we stamped at checkout, but verify the row actually
 * exists — metadata can point at a creator deleted since. Fall back to the
 * stored subscription ID, then the customer ID, so subscriptions created
 * outside our checkout flow (or ones whose metadata was lost) still land.
 */
async function resolveCreatorId(subscription: Stripe.Subscription): Promise<string | null> {
  const metadataId = subscription.metadata?.creatorId;
  if (metadataId) {
    const [row] = await db
      .select({ id: schema.creators.id })
      .from(schema.creators)
      .where(eq(schema.creators.id, metadataId));
    if (row) return row.id;
  }

  const [bySubscription] = await db
    .select({ id: schema.creators.id })
    .from(schema.creators)
    .where(eq(schema.creators.stripeSubscriptionId, subscription.id));
  if (bySubscription) return bySubscription.id;

  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
  if (customerId) {
    const [byCustomer] = await db
      .select({ id: schema.creators.id })
      .from(schema.creators)
      .where(eq(schema.creators.stripeCustomerId, customerId));
    if (byCustomer) return byCustomer.id;
  }

  return null;
}

async function updateCreatorFromSubscription(subscription: Stripe.Subscription) {
  const creatorId = await resolveCreatorId(subscription);
  if (!creatorId) {
    console.warn("[stripe webhook] Could not resolve creator for subscription", subscription.id);
    return;
  }

  const status = toSubscriptionStatus(subscription.status);
  if (subscription.status && !status) {
    console.warn(
      "[stripe webhook] Unmapped subscription status, treating as unpaid:",
      subscription.status
    );
  }

  const planTier = tierFromSubscription(subscription);

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

  const subscriptionId = session.subscription;
  if (!subscriptionId || typeof subscriptionId !== "string") return;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  // The retrieved subscription may not carry our metadata if it was expanded
  // from a session created elsewhere — fall back to the session's own metadata
  // so the very first entitlement write after checkout can't miss.
  if (!subscription.metadata?.creatorId && session.metadata?.creatorId) {
    subscription.metadata = { ...subscription.metadata, ...session.metadata };
  }

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
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
          await updateCreatorFromSubscription(event.data.object as Stripe.Subscription);
          break;
        }
        case "invoice.payment_failed":
        case "invoice.payment_succeeded": {
          const invoice = event.data.object as Stripe.Invoice;
          const subId = invoice.subscription;
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
