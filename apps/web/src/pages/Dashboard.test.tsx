// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import Dashboard from "./Dashboard";

const deal = {
  id: "d1",
  title: "Q4 Campaign",
  stage: "inbound",
  valueCents: 50000,
  brand: { name: "Acme" },
  type: "flat",
  platforms: ["twitch"],
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
    calendar: {
      events: {
        useQuery: vi.fn(),
      },
    },
    deliverable: {
      update: {
        useMutation: vi.fn(),
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
  (trpc.calendar.events.useQuery as ReturnType<typeof vi.fn>).mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  (trpc.deliverable.update.useMutation as ReturnType<typeof vi.fn>).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
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

    expect(screen.getByText("Overdue invoice")).toBeInTheDocument();
    expect(screen.getByText(/\$1,200/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review invoice" })).toBeInTheDocument();
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

describe("Dashboard mockup+ modules", () => {
  it("shows paid revenue by month and deal type without counting open invoices", () => {
    (trpc.invoice.list.useQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [
        { id: "paid", dealId: "d1", status: "paid", paidAt: new Date("2026-08-15T12:00:00Z"), amountCents: 125000, title: "Paid" },
        { id: "open", dealId: "d1", status: "open", paidAt: null, amountCents: 999900, title: "Open" },
      ],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<MemoryRouter><Dashboard /></MemoryRouter>);

    expect(screen.getByText("Revenue by month")).toBeInTheDocument();
    expect(screen.getByLabelText(/Aug: \$1,250 total; flat \$1,250/)).toBeInTheDocument();
    expect(screen.queryByText("$9,999")).not.toBeInTheDocument();
  });

  it("renders all five KPI cards and a truthful CPVH empty state", () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);

    const kpis = within(screen.getByRole("region", { name: "Sponsorship KPIs" }));
    for (const label of ["Revenue", "Active deals", "Due this week", "Outstanding", "Effective CPVH"]) {
      expect(kpis.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("Not enough data yet")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("checks off a deliverable inline through the existing mutation", () => {
    const mutate = vi.fn();
    (trpc.deliverable.update.useMutation as ReturnType<typeof vi.fn>).mockReturnValue({ mutate, isPending: false });
    (trpc.calendar.events.useQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [{ type: "deliverable", id: "del-1", dealId: "d1", dealTitle: "Q4 Campaign", title: "Sponsor read", status: "scheduled", date: new Date(Date.now() + 86400000) }],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    fireEvent.click(screen.getByRole("checkbox", { name: "Mark Sponsor read complete" }));

    expect(mutate).toHaveBeenCalledWith({ id: "del-1", status: "done" });
    expect(screen.getByLabelText("Twitch")).toBeInTheDocument();
  });

  it("uses per-type activity icons and relative time", () => {
    (trpc.activity.list.useQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [{ id: "a1", actor: "system", entityType: "invoice", kind: "invoice_paid", payload: {}, createdAt: new Date(Date.now() - 120000) }],
      isLoading: false,
      isError: false,
    });

    render(<MemoryRouter><Dashboard /></MemoryRouter>);

    expect(screen.getByLabelText("Invoice activity")).toBeInTheDocument();
    expect(screen.getByText("2m ago")).toBeInTheDocument();
  });
});
