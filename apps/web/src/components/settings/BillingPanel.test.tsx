// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { subscriptionStatuses, liveStatuses } from "@sponsee/shared";
import BillingPanel from "./BillingPanel";

const mockRefetch = vi.fn();
let mockQueryReturn: {
  data?: {
    plan: "starter" | "creator" | "pro";
    status: string | null;
    currentPeriodEnd: string | null;
    dealSlotLimit: number;
    activeDealCount: number;
  };
  isLoading: boolean;
  isError: boolean;
  refetch: typeof mockRefetch;
} = { data: undefined, isLoading: false, isError: false, refetch: mockRefetch };

const mockCheckoutReturn = { mutate: vi.fn(), isPending: false };
const mockPortalReturn = { mutate: vi.fn(), isPending: false };

vi.mock("@/trpc", () => ({
  trpc: {
    billing: {
      getSubscription: {
        useQuery: () => mockQueryReturn,
      },
      createCheckoutSession: {
        useMutation: () => mockCheckoutReturn,
      },
      createPortalSession: {
        useMutation: () => mockPortalReturn,
      },
    },
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setQueryState(state: Partial<typeof mockQueryReturn>) {
  mockQueryReturn = { ...mockQueryReturn, ...state };
}

describe("BillingPanel", () => {
  it("shows loading spinner while fetching", () => {
    setQueryState({ isLoading: true, isError: false, data: undefined });
    const { container } = render(<BillingPanel />);
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("shows error state with retry button on query failure", () => {
    setQueryState({ isLoading: false, isError: true, data: undefined });
    render(<BillingPanel />);
    expect(screen.getByText("Couldn't load your subscription.")).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("renders subscription info and plan cards", () => {
    setQueryState({
      isLoading: false,
      isError: false,
      data: {
        plan: "creator",
        status: "active",
        currentPeriodEnd: "2026-09-28T00:00:00Z",
        dealSlotLimit: 15,
        activeDealCount: 7,
      },
    });
    render(<BillingPanel />);
    expect(screen.getByText(/Creator plan/)).toBeInTheDocument();
    expect(screen.getByText("Active", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("7 / 15")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Manage subscription/ })).toBeInTheDocument();
  });

  it("shows free plan when no subscription exists", () => {
    setQueryState({
      isLoading: false,
      isError: false,
      data: {
        plan: "starter",
        status: null,
        currentPeriodEnd: null,
        dealSlotLimit: 3,
        activeDealCount: 0,
      },
    });
    render(<BillingPanel />);
    expect(screen.getByText(/Starter plan/)).toBeInTheDocument();
    expect(screen.getByText("Free")).toBeInTheDocument();
  });
});

/**
 * SPO-120. The panel used to re-derive "is this subscription live" from a
 * hand-copied status list and now calls the same `hasLiveSubscription` the API
 * guards checkout with. These drive off `liveStatuses` itself, so a status added
 * to the shared list is automatically covered here instead of quietly going
 * untested — which is how `paused` slipped through until SPO-97.
 *
 * The assertion is about affordances, not the list: for a live subscription the
 * only route is the portal, because `createCheckoutSession` answers a fresh
 * checkout with a 409. An "Upgrade to …" button on a live subscription is a
 * button whose sole outcome is an error toast.
 */
const deadStatuses = subscriptionStatuses.filter(
  (status) => !(liveStatuses as readonly string[]).includes(status)
);

function renderWithStatus(status: string | null) {
  setQueryState({
    isLoading: false,
    isError: false,
    data: {
      plan: "creator",
      status,
      currentPeriodEnd: null,
      dealSlotLimit: 15,
      activeDealCount: 2,
    },
  });
  render(<BillingPanel />);
}

describe("BillingPanel checkout affordances", () => {
  it.each(liveStatuses)("routes %s to the portal and offers no fresh checkout", (status) => {
    renderWithStatus(status);

    expect(screen.getByRole("button", { name: /Manage subscription/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Upgrade to/ })).not.toBeInTheDocument();
  });

  it.each(deadStatuses)("offers checkout for %s, which has no live subscription", (status) => {
    renderWithStatus(status);

    expect(screen.getAllByRole("button", { name: /Upgrade to/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Manage subscription/ })).not.toBeInTheDocument();
  });

  it("offers checkout when no subscription exists at all", () => {
    renderWithStatus(null);

    expect(screen.getAllByRole("button", { name: /Upgrade to/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Manage subscription/ })).not.toBeInTheDocument();
  });

  // Literals, deliberately not `liveStatuses`. Everything above follows whatever
  // the shared list says, which covers a status *added* to it but cannot catch
  // one *removed*: drop `paused` and the panel and the it.each move together and
  // agree on the wrong answer — the assertion re-derives the bug it is meant to
  // find. Verified by deleting `paused` from the shared list, which reds the API
  // guards and left this file green until these cases existed.
  //
  // Same list as the API's `pins the statuses each predicate answers for`, on
  // purpose: two independent statements of the contract that has money behind
  // it, one on the guard and one on the affordance.
  it.each(["active", "trialing", "past_due", "unpaid", "paused"])(
    "keeps %s on the portal route (pinned, not derived from the shared list)",
    (status) => {
      renderWithStatus(status);

      expect(screen.getByRole("button", { name: /Manage subscription/ })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Upgrade to/ })).not.toBeInTheDocument();
    }
  );
});

/**
 * The other hand-copied status list in this file is the `statusBadge` switch,
 * which SPO-97 also had to edit by hand to teach it `paused`. A switch can't be
 * collapsed into a shared list the way the predicates were — each arm is real
 * copy and real styling — so the guard here is a test rather than a refactor.
 *
 * The claim is narrow on purpose: a *live* subscription must never render as
 * "Free". That badge means "you have no subscription", so on a `past_due` or
 * `paused` creator it contradicts both the portal button next to it and the
 * charge on their statement. Drives off `liveStatuses`, so a live status added
 * to the shared list reds here until the switch grows an arm for it.
 *
 * `incomplete` and `incomplete_expired` deliberately fall through to "Free" and
 * are excluded rather than fixed: their first payment never succeeded, they
 * grant nothing, and the affordance they get — an Upgrade button — is the
 * correct recovery path, so "Free" is what the creator actually has.
 */
describe("BillingPanel status badge", () => {
  it.each(liveStatuses)("never labels live status %s as Free", (status) => {
    renderWithStatus(status);

    expect(screen.queryByText("Free")).not.toBeInTheDocument();
  });

  it("labels a missing subscription as Free", () => {
    renderWithStatus(null);

    expect(screen.getByText("Free")).toBeInTheDocument();
  });
});
