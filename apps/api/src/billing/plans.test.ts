import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getPriceId, getTierFromPriceId, planPriceEnvKeys } from "./plans.js";

/**
 * SPO-188. `STRIPE_PRICE_STARTER` shipped into both the test and live Infisical
 * environments as three space-separated price IDs — the starter, creator and
 * pro IDs, pasted together out of a provisioning script's output. The Render
 * service happened to hold a clean value, so nothing on staging ever noticed;
 * the corruption sat in the vault waiting for the production API host that
 * SPO-188 is gated on to read it.
 *
 * That value would not have failed loudly. `getPriceId("starter")` handed the
 * 92-character blob to Stripe, so the $19 entry tier — the plan most new
 * creators pick — 500s on the upgrade click while creator and pro work fine.
 * Worse is the reverse direction: `getTierFromPriceId` compares the real price
 * on the subscription against that blob, never matches, and falls back to the
 * `tier` metadata stamped once at checkout and never rewritten when a creator
 * changes plan in the Stripe customer portal. A portal downgrade to Starter
 * would have kept billing correctly at $19 while the app kept granting the old
 * tier's deal slots indefinitely.
 *
 * The guard is on `getPriceId` rather than on the reverse lookup on purpose:
 * the checkout path can afford to throw, and the webhook path cannot. Throwing
 * inside a webhook handler returns a 500 to Stripe, which parks the delivery in
 * a retry queue for days rather than surfacing the misconfiguration.
 */
describe("getPriceId price ID validation", () => {
  const envKeys = Object.values(planPriceEnvKeys);
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("returns a well-formed price ID", () => {
    process.env.STRIPE_PRICE_STARTER = "price_1UAdNmPfJRGqdXSIWwyIXmYh";
    expect(getPriceId("starter")).toBe("price_1UAdNmPfJRGqdXSIWwyIXmYh");
  });

  it("throws when the env var is missing", () => {
    delete process.env.STRIPE_PRICE_STARTER;
    expect(() => getPriceId("starter")).toThrow(/Missing STRIPE_PRICE_STARTER/);
  });

  // The exact corrupted value found in Infisical `prod`, verbatim.
  it("rejects several price IDs collapsed into one variable", () => {
    process.env.STRIPE_PRICE_STARTER =
      "price_1UAdNmPfJRGqdXSIWwyIXmYh price_1UAdNmPfJRGqdXSIUFRKedPA price_1UAdNnPfJRGqdXSII64dwELj";
    expect(() => getPriceId("starter")).toThrow(/not a valid Stripe price ID/);
  });

  it.each([
    ["surrounding whitespace", " price_1UAdNmPfJRGqdXSIWwyIXmYh "],
    ["a trailing newline", "price_1UAdNmPfJRGqdXSIWwyIXmYh\n"],
    ["a product ID", "prod_TXKq9pWvQ2mHbA"],
    ["a lookup key", "sponsee_starter_monthly"],
    ["a shell-quoted value", '"price_1UAdNmPfJRGqdXSIWwyIXmYh"'],
    ["the prefix alone", "price_"],
  ])("rejects %s", (_label, value) => {
    process.env.STRIPE_PRICE_STARTER = value;
    expect(() => getPriceId("starter")).toThrow(/not a valid Stripe price ID/);
  });

  /**
   * The price vars sit alongside the secret keys in the same vault path and the
   * same Render environment block, so a slipped paste can put a credential
   * here. The message goes to logs; it must describe the shape and not the
   * value. Deliberately not spelled with a real key prefix — a literal that
   * looks like one trips GitHub push protection.
   */
  it("does not echo the offending value into the error message", () => {
    const sentinel = "CREDENTIALSHAPEDVALUE";
    process.env.STRIPE_PRICE_STARTER = sentinel;
    expect(() => getPriceId("starter")).toThrow(/not a valid Stripe price ID/);
    expect(() => getPriceId("starter")).not.toThrow(new RegExp(sentinel));
  });

  it("guards every tier, not just starter", () => {
    for (const tier of ["starter", "creator", "pro"] as const) {
      process.env[planPriceEnvKeys[tier]] = "price_a price_b";
      expect(() => getPriceId(tier)).toThrow(/not a valid Stripe price ID/);
    }
  });
});

describe("getTierFromPriceId under a corrupted env", () => {
  /**
   * Documents the silent half of the failure — the reason the guard above
   * exists rather than a change here. With the blob in place the real Starter
   * price no longer resolves to a tier, and the caller in `webhook.ts` is left
   * with stale checkout metadata.
   */
  it("stops recognising the starter price", () => {
    const starter = "price_1UAdNmPfJRGqdXSIWwyIXmYh";
    const saved = process.env.STRIPE_PRICE_STARTER;

    process.env.STRIPE_PRICE_STARTER = starter;
    expect(getTierFromPriceId(starter)).toBe("starter");

    process.env.STRIPE_PRICE_STARTER = `${starter} price_1UAdNmPfJRGqdXSIUFRKedPA`;
    expect(getTierFromPriceId(starter)).toBeNull();

    if (saved === undefined) delete process.env.STRIPE_PRICE_STARTER;
    else process.env.STRIPE_PRICE_STARTER = saved;
  });
});
