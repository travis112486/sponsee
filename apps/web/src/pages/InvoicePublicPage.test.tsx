// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@sponsee/api/routers";
import App from "../App";

// SPO-367 gate step 4 (rendered success): the production App route table maps
// `/i/:token` to InvoicePublicPage and renders it from the real publicView JSON
// shape — not a locally-declared route, so deleting or breaking the `/i/:token`
// wiring in App.tsx fails this test. The data is typed as the actual
// `invoice.publicView` output so a future shape change breaks the fixture at
// compile time, not silently at runtime.

type PublicView = inferRouterOutputs<AppRouter>["invoice"]["publicView"];

const VALID_TOKEN = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";

const publicViewFixture: PublicView = {
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

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  publicViewData = null;
  publicViewIsError = false;
});

describe("App `/i/:token` hosted route renders from the publicView JSON (SPO-367 gate)", () => {
  it("renders the invoice through the production App route, not the not-found state", async () => {
    publicViewData = publicViewFixture;

    renderApp(`/i/${VALID_TOKEN}`);

    expect(await screen.findByText("INV-0012")).toBeInTheDocument();
    expect(screen.getByText("Nightshade Media")).toBeInTheDocument();
    expect(screen.getByText("$4,500")).toBeInTheDocument();
    expect(screen.getByText("How to pay")).toBeInTheDocument();
    expect(screen.queryByText("Invoice not found")).not.toBeInTheDocument();
  });

  it("renders the not-found state when the API rejects the token", async () => {
    publicViewIsError = true;

    renderApp("/i/00000000000000000000000000000000");

    expect(await screen.findByText("Invoice not found")).toBeInTheDocument();
    expect(screen.queryByText("How to pay")).not.toBeInTheDocument();
  });
});
