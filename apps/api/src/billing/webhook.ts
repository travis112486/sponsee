import type { Hono } from "hono";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { stripe } from "./stripe.js";
import { getTierFromPriceId, toPlanTier } from "./plans.js";
import { toSubscriptionStatus } from "./entitlements.js";
import type { PlanTier } from "@sponsee/shared";

/**
 * Read the signing secret per request, never at module scope.
 *
 * `apps/api/src/index.ts` imports the app statically, and ESM hoists that
 * import above the `dotenv.config()` call underneath it. A module-scope read
 * therefore lands before `.env` is loaded and every webhook 500s under
 * `pnpm dev` — exactly the loop the Stripe CLI instructions in `.env.example`
 * ask developers to run. `stripe.ts` and `plans.ts` already read env lazily for
 * the same reason (SPO-87 HIGH-2).
 */
function getWebhookSecret(): string | undefined {
  return process.env.STRIPE_WEBHOOK_SECRET;
}

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
 * Read the current period end off the subscription.
 *
 * As of API version 2025-03-31.basil, `current_period_end` no longer exists on
 * Stripe.Subscription — it moved to each Stripe.SubscriptionItem (SPO-190). A
 * subscription always has at least one item, but read defensively: a null here
 * must not become a thrown error in a webhook handler.
 */
function currentPeriodEndFromSubscription(subscription: Stripe.Subscription): Date | null {
  const seconds = subscription.items?.data?.[0]?.current_period_end;
  return typeof seconds === "number" ? new Date(seconds * 1000) : null;
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
    // Still a 200 upstream — a retry cannot resolve a creator that isn't there,
    // and a permanent 500 would only park the event in Stripe's retry queue for
    // days. Log at error level with the identifiers needed to reconcile by hand:
    // a paying customer with no creator row is a billing discrepancy, not noise.
    const customerId =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer?.id;
    console.error(
      "[stripe webhook] Dropping event — no creator matches subscription",
      subscription.id,
      "customer",
      customerId ?? "(none)",
      "status",
      subscription.status
    );
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
      currentPeriodEnd: currentPeriodEndFromSubscription(subscription),
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

/**
 * Handle a `customer.subscription.*` event by re-reading the subscription from
 * Stripe instead of trusting the payload that arrived.
 *
 * Stripe does not guarantee delivery order and retries failed deliveries for
 * days. Written straight through, a delayed `customer.subscription.updated`
 * carrying `active` that lands after `customer.subscription.deleted` would
 * permanently resurrect a canceled subscription's entitlements. Re-fetching
 * makes every event in this family converge on Stripe's current truth, so a
 * late or duplicated arrival is a harmless no-op rather than a downgrade that
 * silently reverses itself (SPO-87 MEDIUM-1). The invoice branch below has
 * always worked this way; this brings the subscription branch in line.
 */
async function handleSubscriptionEvent(event: Stripe.Event) {
  const fromEvent = event.data.object as Stripe.Subscription;

  let subscription: Stripe.Subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(fromEvent.id);
  } catch (err) {
    // A cancellation we cannot confirm still has to land: the event payload can
    // only move a creator *down* to canceled here, which is the safe direction.
    // For created/updated we rethrow so Stripe retries, rather than let an
    // unverified "active" through on the strength of a payload we could not
    // check.
    if (event.type !== "customer.subscription.deleted") throw err;
    console.warn(
      "[stripe webhook] Could not re-fetch canceled subscription, using event payload:",
      fromEvent.id
    );
    subscription = fromEvent;
  }

  // Metadata is our primary creator pointer. A subscription created outside our
  // checkout flow (or one whose metadata was never set) still has to resolve,
  // so carry the event's copy across when the fresh one lacks it.
  if (!subscription.metadata?.creatorId && fromEvent.metadata?.creatorId) {
    subscription.metadata = { ...subscription.metadata, ...fromEvent.metadata };
  }

  await updateCreatorFromSubscription(subscription);
}

export function registerStripeWebhook(app: Hono) {
  app.post("/api/webhooks/stripe", async (c) => {
    const payload = await c.req.text();
    const signature = c.req.header("stripe-signature") || "";
    const webhookSecret = getWebhookSecret();

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
          await handleSubscriptionEvent(event);
          break;
        }
        case "invoice.payment_failed":
        case "invoice.payment_succeeded": {
          // The webhook endpoint (we_1UAdAeB1QieISYczbZ91rjhS) is pinned at
          // 2025-02-24.acacia independently of the SDK's apiVersion above, so the
          // *delivered* payload stays acacia-shaped: `subscription` sits at the
          // top level, not on basil's `invoice.parent.subscription_details`. Cast
          // past the (now basil) SDK type rather than the runtime field (SPO-190)
          // — read `invoice.parent...` instead only if the endpoint's own pin is
          // ever bumped to match.
          const invoice = event.data.object as Stripe.Invoice & {
            subscription?: string | Stripe.Subscription | null;
          };
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
