// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import RailsPanel from "./RailsPanel";

const mockInvalidate = vi.fn();
const mockRefetch = vi.fn();
let mockQueryReturn: {
  data?: {
    paypalLink: string | null;
    wiseText: string | null;
    bankText: string | null;
  };
  isLoading: boolean;
  isError: boolean;
  refetch: typeof mockRefetch;
} = { data: undefined, isLoading: false, isError: false, refetch: mockRefetch };

const mockUpdateReturn = { mutate: vi.fn(), isPending: false };

vi.mock("@/trpc", () => ({
  trpc: {
    useUtils: () => ({
      settings: {
        getRails: {
          invalidate: mockInvalidate,
        },
      },
    }),
    settings: {
      getRails: {
        useQuery: () => mockQueryReturn,
      },
      updateRails: {
        useMutation: () => mockUpdateReturn,
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

describe("RailsPanel", () => {
  it("shows loading spinner while fetching", () => {
    setQueryState({ isLoading: true, isError: false, data: undefined });
    const { container } = render(<RailsPanel />);
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("shows error state with retry button on query failure", () => {
    setQueryState({ isLoading: false, isError: true, data: undefined });
    render(<RailsPanel />);
    expect(screen.getByText("Couldn't load your payout rails.")).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("renders rails form with populated data", () => {
    setQueryState({
      isLoading: false,
      isError: false,
      data: {
        paypalLink: "https://paypal.me/alex",
        wiseText: "alex@example.com",
        bankText: "Routing: 123456789",
      },
    });
    render(<RailsPanel />);
    expect(screen.getByDisplayValue("https://paypal.me/alex")).toBeInTheDocument();
    expect(screen.getByDisplayValue("alex@example.com")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Routing: 123456789")).toBeInTheDocument();
  });

  it("has accessible label-input pairs for all form fields", () => {
    setQueryState({
      isLoading: false,
      isError: false,
      data: { paypalLink: null, wiseText: null, bankText: null },
    });
    render(<RailsPanel />);

    const paypalInput = screen.getByLabelText("PayPal link");
    expect(paypalInput).toBeInTheDocument();
    expect(paypalInput.tagName.toLowerCase()).toBe("input");

    const wiseInput = screen.getByLabelText("Wise details");
    expect(wiseInput).toBeInTheDocument();
    expect(wiseInput.tagName.toLowerCase()).toBe("textarea");

    const bankInput = screen.getByLabelText("Bank transfer details");
    expect(bankInput).toBeInTheDocument();
    expect(bankInput.tagName.toLowerCase()).toBe("textarea");
  });
});
