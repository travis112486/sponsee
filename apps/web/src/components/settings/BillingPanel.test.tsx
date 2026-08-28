// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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
