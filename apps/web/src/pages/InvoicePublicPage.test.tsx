// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import InvoicePublicPage from "./InvoicePublicPage";

const publicViewMock = vi.fn();

vi.mock("@/trpc", () => ({
  trpc: {
    invoice: {
      publicView: {
        useQuery: ({ token }: { token: string }) => publicViewMock(token),
      },
    },
  },
}));

const invoiceData = {
  invoiceNumber: 12,
  title: "Sponsorship invoice",
  milestoneNote: null,
  amountCents: 450000,
  currency: "USD",
  terms: "net_30",
  issuedAt: "2026-09-02T00:00:00.000Z",
  dueAt: "2026-10-02T00:00:00.000Z",
  railsSnapshot: {
    displayName: "Nightshade Media",
    paypalLink: "https://paypal.me/nightshade",
    wiseText: "Wise: nightshade@wise.example",
    bankText: "Acme Bank / 000-1234",
    replyToEmail: null,
  },
  creatorDisplayName: "Nightshade Media",
  creatorEmail: null,
  paid: false,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/i/sometoken"]}>
      <Routes>
        <Route path="/i/:token" element={<InvoicePublicPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("InvoicePublicPage — creator contact line (SPO-428)", () => {
  it("renders the creator email as a from-sub line when one resolves", () => {
    publicViewMock.mockReturnValue({
      data: { ...invoiceData, creatorEmail: "kaya@nightshade.example" },
      isLoading: false,
      isError: false,
    });
    const { container } = renderPage();

    const email = screen.getByText("kaya@nightshade.example");
    expect(email).toHaveClass("from-sub");
    // Subtitle + email line.
    expect(container.querySelectorAll(".from-sub")).toHaveLength(2);
  });

  it("omits the contact line element entirely when no email resolves", () => {
    publicViewMock.mockReturnValue({
      data: { ...invoiceData, creatorEmail: null },
      isLoading: false,
      isError: false,
    });
    const { container } = renderPage();

    // The element is absent, not merely empty — the base subtitle is the only
    // from-sub line, and no email text is rendered.
    expect(screen.queryByText(/kaya@nightshade\.example/)).not.toBeInTheDocument();
    expect(screen.getByText("Invoice for sponsorship services")).toBeInTheDocument();
    expect(container.querySelectorAll(".from-sub")).toHaveLength(1);
  });
});
