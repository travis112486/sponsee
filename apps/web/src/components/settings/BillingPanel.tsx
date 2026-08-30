import { useState } from "react";
import { trpc } from "@/trpc";
import { toast } from "sonner";
import { Loader2, ArrowUpRight, CheckCircle2, AlertCircle } from "lucide-react";
import { planPricesCents, planDealSlots, planLabels } from "@sponsee/shared";
import type { PlanTier } from "@sponsee/shared";
import QueryError from "@/components/QueryError";

const tiers: PlanTier[] = ["starter", "creator", "pro"];

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

function statusBadge(status: string | null) {
  switch (status) {
    case "active":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-pine-tint px-2 py-0.5 text-[12px] font-medium text-pine">
          <CheckCircle2 className="h-3 w-3" /> Active
        </span>
      );
    case "past_due":
    case "unpaid":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-brick-tint px-2 py-0.5 text-[12px] font-medium text-brick">
          <AlertCircle className="h-3 w-3" /> Past due
        </span>
      );
    case "trialing":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-tint px-2 py-0.5 text-[12px] font-medium text-amber">
          <CheckCircle2 className="h-3 w-3" /> Trialing
        </span>
      );
    case "paused":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-tint px-2 py-0.5 text-[12px] font-medium text-amber">
          <AlertCircle className="h-3 w-3" /> Paused
        </span>
      );
    case "canceled":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-hairline px-2 py-0.5 text-[12px] font-medium text-ink-3">
          Canceled
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-hairline px-2 py-0.5 text-[12px] font-medium text-ink-3">
          Free
        </span>
      );
  }
}

export default function BillingPanel() {
  const { data: subscription, isLoading, isError, refetch } = trpc.billing.getSubscription.useQuery();
  const [upgradingTo, setUpgradingTo] = useState<PlanTier | null>(null);

  const checkout = trpc.billing.createCheckoutSession.useMutation({
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (err) => {
      toast.error(err.message || "Failed to start checkout");
      setUpgradingTo(null);
    },
  });

  const portal = trpc.billing.createPortalSession.useMutation({
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (err) => {
      toast.error(err.message || "Failed to open billing portal");
    },
  });

  // A creator who already pays must change plans in the Stripe portal, which
  // swaps the price on their one subscription and prorates it. Sending them back
  // through Checkout would open a *second* subscription on the same customer and
  // bill both at once (SPO-87 HIGH-1) — the API rejects it, and this keeps the
  // UI from offering a path that only ends in an error toast.
  const handlePlanClick = (tier: PlanTier, alreadyPaid: boolean) => {
    if (alreadyPaid) {
      portal.mutate();
      return;
    }
    setUpgradingTo(tier);
    checkout.mutate({ tier });
  };

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-ink-3" />
      </div>
    );
  }

  if (isError) {
    return (
      <QueryError
        message="Couldn't load your subscription."
        onRetry={() => refetch()}
      />
    );
  }

  const currentPlan = subscription?.plan ?? "starter";
  const currentStatus = subscription?.status ?? null;
  const isPaid = currentStatus === "active" || currentStatus === "trialing";
  // `past_due` / `unpaid` / `paused` grant no entitlements but the subscription
  // is still live in Stripe, so the API refuses a fresh checkout for them — it
  // would bill a second subscription alongside the existing one. The portal is
  // where a card gets fixed and a pause gets lifted, so it has to stay reachable
  // or those creators hit a dead end with no way back to paying us (SPO-87
  // HIGH-1, SPO-97). Must stay in step with `liveStatuses` in
  // apps/api/src/billing/entitlements.ts — this list is hand-copied, and the two
  // disagreeing means the UI offers a button whose only outcome is a 409 toast.
  const hasLiveSubscription =
    isPaid ||
    currentStatus === "past_due" ||
    currentStatus === "unpaid" ||
    currentStatus === "paused";
  const dealSlotLimit = subscription?.dealSlotLimit ?? planDealSlots[currentPlan];
  const activeDealCount = subscription?.activeDealCount ?? 0;
  const usagePct = dealSlotLimit > 0 ? Math.min(100, (activeDealCount / dealSlotLimit) * 100) : 0;

  return (
    <div className="space-y-8">
      {/* Current plan card */}
      <div className="rounded-xl border border-hairline bg-surface p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-semibold text-ink">
              {planLabels[currentPlan]} plan
            </h3>
            <p className="mt-0.5 text-[13px] text-ink-3">
              {isPaid
                ? `${formatPrice(planPricesCents[currentPlan])}/mo — billed monthly`
                : `${formatPrice(planPricesCents[currentPlan])}/mo — upgrade to unlock full limits`}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {statusBadge(currentStatus)}
            {subscription?.currentPeriodEnd && (
              <span className="text-[12px] text-ink-3">
                Renews {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>

        {hasLiveSubscription && (
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => portal.mutate()}
              disabled={portal.isPending}
              className="flex h-9 items-center gap-2 rounded-lg border border-hairline bg-surface-subtle px-4 text-[13px] font-medium text-ink transition-colors hover:bg-hairline disabled:opacity-50"
            >
              {portal.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Manage subscription
            </button>
          </div>
        )}
      </div>

      {/* Plan comparison */}
      <div>
        <h4 className="text-[13px] font-semibold text-ink">Choose a plan</h4>
        <p className="mt-1 text-[12.5px] text-ink-3">
          All plans include the full Sponsee feature set. Upgrade for more deal slots.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {tiers.map((tier) => {
            const isCurrent = currentPlan === tier && hasLiveSubscription;
            // Subscription already exists, different tier — a portal plan
            // change, not a new checkout. Covers both directions; a downgrade
            // isn't special.
            const isPlanChange = hasLiveSubscription && tier !== currentPlan;
            const price = planPricesCents[tier];
            const slots = planDealSlots[tier];

            return (
              <div
                key={tier}
                className={`relative rounded-xl border p-4 ${
                  isCurrent
                    ? "border-pine bg-pine-tint"
                    : "border-hairline bg-surface"
                }`}
              >
                {isCurrent && (
                  <span className="absolute -top-2.5 left-3 rounded bg-pine px-1.5 py-0.5 text-[10px] font-semibold text-white uppercase tracking-wide">
                    Current
                  </span>
                )}

                <div className="flex items-baseline gap-1">
                  <span className="text-[18px] font-bold text-ink">
                    {formatPrice(price)}
                  </span>
                  <span className="text-[12px] text-ink-3">/mo</span>
                </div>

                <h5 className="mt-1 text-[14px] font-semibold capitalize text-ink">
                  {planLabels[tier]}
                </h5>

                <ul className="mt-3 space-y-1.5">
                  <li className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-pine" />
                    {slots} active deals
                  </li>
                  <li className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-pine" />
                    Unlimited contacts
                  </li>
                  <li className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-pine" />
                    Full chase automation
                  </li>
                </ul>

                <button
                  onClick={() => handlePlanClick(tier, isPlanChange)}
                  disabled={
                    isCurrent || upgradingTo === tier || checkout.isPending || portal.isPending
                  }
                  className={`mt-4 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-50 ${
                    isCurrent
                      ? "bg-pine text-white cursor-default"
                      : isPlanChange
                      ? "border border-hairline bg-surface-subtle text-ink hover:bg-hairline"
                      : "bg-pine text-white hover:bg-pine-hover"
                  }`}
                >
                  {((upgradingTo === tier && !isPlanChange) ||
                    (isPlanChange && portal.isPending)) && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  {isCurrent
                    ? "Subscribed"
                    : isPlanChange
                    ? "Switch to " + planLabels[tier]
                    : "Upgrade to " + planLabels[tier]}
                  {!isCurrent && !isPlanChange && <ArrowUpRight className="h-3.5 w-3.5" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Usage */}
      <div className="rounded-xl border border-hairline bg-surface p-5">
        <h4 className="text-[13px] font-semibold text-ink">Usage</h4>
        <div className="mt-3">
          <div className="flex items-center justify-between text-[12.5px]">
            <span className="text-ink-2">Active deals</span>
            <span className="font-medium text-ink">
              {activeDealCount} / {dealSlotLimit}
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-hairline">
            <div
              className="h-full rounded-full bg-pine transition-all"
              style={{ width: `${usagePct}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
