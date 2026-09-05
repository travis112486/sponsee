// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import InvoicePublicPage from "./InvoicePublicPage";

// SPO-367 gate step 4 (rendered success): the hosted invoice route renders the
// invoice off the allowlisted publicView payload, and a bad/missing token
// renders the "not found" state — never a tenant-data leak. The data shape
// here mirrors exactly what invoice.publicView returns (see the API-side
// acceptance test for the allowlist itself); this test pins the rendering.

type PublicView = {
  invoiceNumber: number;
  title: string | null;
  milestoneNote: string | null;
  amountCents: number;
  currency: string;
  terms: string;
  issuedAt: string | null;
  dueAt: string | null;
  railsSnapshot: {
    displayName: string | null;
    paypalLink: string | null;
    wiseText: string | null;
    bankText: string | null;
  };
  creatorDisplayName: string | null;
  paid: boolean;
};

let publicViewData: PublicView | null = null;
let publicViewIsError = false;

vi.mock("@/trpc", () => ({
  trpc: {
    invoice: {
      publicView: {
        useQuery: () => ({
          data: publicViewData,
          isLoading: false,
          isError: publicViewIsError,
        }),
      },
    },
  },
}));

function renderPage(token: string) {
  return render(
    <MemoryRouter initialEntries={[`/i/${token}`]}>
      <Routes>
        <Route path="/i/:token" element={<InvoicePublicPage />} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  publicViewData = null;
  publicViewIsError = false;
});

describe("InvoicePublicPage — hosted route rendered success (SPO-367 gate)", () => {
  it("renders the invoice from the allowlisted payload, not the not-found state", () => {
    publicViewData = {
      invoiceNumber: 12,
      title: "Sponsorship invoice",
      milestoneNote: "Two sponsored streams delivered in March.",
      amountCents: 450000,
      currency: "USD",
      terms: "net_30",
      issuedAt: "2026-09-02T00:00:00.000Z",
      dueAt: "2026-10-02T00:00:00.000Z",
      railsSnapshot: {
        displayName: "Nightshade Media",
        paypalLink: "paypal.me/nightshade",
        wiseText: "Wise: nightshade@wise.example",
        bankText: null,
      },
      creatorDisplayName: "Nightshade Media",
      paid: false,
    };

    renderPage("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6");

    expect(screen.queryByText("Invoice not found")).not.toBeInTheDocument();
    expect(screen.getByText("Nightshade Media")).toBeInTheDocument();
    expect(screen.getByText("INV-0012")).toBeInTheDocument();
    expect(screen.getByText("$4,500")).toBeInTheDocument();
    expect(screen.getByText("How to pay")).toBeInTheDocument();
  });

  it("renders the not-found state for a token the API rejects", () => {
    publicViewIsError = true;

    renderPage("00000000000000000000000000000000");

    expect(screen.getByText("Invoice not found")).toBeInTheDocument();
    expect(screen.queryByText("How to pay")).not.toBeInTheDocument();
  });
});
