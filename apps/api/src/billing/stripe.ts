import Stripe from "stripe";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error("STRIPE_SECRET_KEY is required");
    }
    _stripe = new Stripe(secretKey, {
      // Managed Payments (enabled on the Sponsee Stripe account) rejects
      // checkout.sessions.create below 2025-03-31.basil (SPO-190). Bumping this
      // moves current_period_end/start off Stripe.Subscription onto each
      // Stripe.SubscriptionItem — see webhook.ts.
      //
      // The `stripe` package is exact-pinned (not `^`) in package.json to match:
      // its `apiVersion` param type is a literal tied to that release's "latest"
      // API version, and that literal has shifted across *minor* releases within
      // v18 (18.0.0 = 2025-03-31.basil, 18.5.0 = 2025-08-27.basil). A caret range
      // can silently resolve to a minor whose literal no longer matches this
      // string, breaking the build on a routine `pnpm install`.
      apiVersion: "2025-03-31.basil",
      typescript: true,
    });
  }
  return _stripe;
}

// Convenience re-export for consumers that don't need lazy init
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    return (getStripe() as any)[prop];
  },
});
