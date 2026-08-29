// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import Dashboard from "./Dashboard";

const deal = {
  id: "d1",
  title: "Q4 Campaign",
  stage: "inbound",
  valueCents: 50000,
  brand: { name: "Acme" },
};

vi.mock("@/trpc", () => ({
  trpc: {
    deals: {
      list: {
        useQuery: vi.fn(),
      },
    },
    invoice: {
      list: {
        useQuery: vi.fn(),
      },
    },
    activity: {
      list: {
        useQuery: vi.fn(),
      },
    },
  },
}));

import { trpc } from "@/trpc";

beforeEach(() => {
  (trpc.deals.list.useQuery as ReturnType<typeof vi.fn>).mockReturnValue({
    data: [deal],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  (trpc.invoice.list.useQuery as ReturnType<typeof vi.fn>).mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  (trpc.activity.list.useQuery as ReturnType<typeof vi.fn>).mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Dashboard recent-deals rows", () => {
  it("renders each deal as a native button, not a role=button div", () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    const row = screen.getByRole("button", { name: "Open Q4 Campaign — Acme" });
    expect(row.tagName).toBe("BUTTON");
  });
});

describe("Dashboard overdue callout (P-01)", () => {
  it("surfaces money-at-risk when an open invoice is overdue", () => {
    const overdueInvoice = {
      id: "i1",
      status: "open",
      dueAt: new Date(Date.now() - 86400000),
      amountCents: 120000,
      title: "Overdue invoice",
    };
    (trpc.invoice.list.useQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [overdueInvoice],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    expect(screen.getByText("1 overdue invoice")).toBeInTheDocument();
    expect(screen.getByText(/\$1,200 at risk/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review payments" })).toBeInTheDocument();
  });

  it("does not render the callout when nothing is overdue", () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    expect(screen.queryByText(/overdue invoice/)).not.toBeInTheDocument();
    expect(screen.queryByText(/at risk/)).not.toBeInTheDocument();
  });
});
