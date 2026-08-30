// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import DealDetail from "./DealDetail";
import { ContractCard } from "@/components/ContractCard";

vi.mock("@/trpc", () => ({
  trpc: {
    useUtils: () => ({
      deals: { getById: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } },
      invoice: { list: { invalidate: vi.fn() } },
      proof: { listByDeal: { invalidate: vi.fn() } },
      contract: { getByDeal: { invalidate: vi.fn() } },
      activity: { list: { invalidate: vi.fn() } },
    }),
    deals: {
      getById: { useQuery: vi.fn() },
      update: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
    },
    invoice: { create: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) } },
    deliverable: {
      create: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
      update: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
      delete: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
    },
    proof: {
      listByDeal: { useQuery: vi.fn() },
      create: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
      delete: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
    },
    contract: {
      getByDeal: { useQuery: vi.fn() },
      upsert: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
      updateStatus: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
      remove: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
    },
    calculator: { compute: { useQuery: vi.fn() } },
  },
}));

import { trpc } from "@/trpc";

const deal = {
  id: "d1",
  title: "Q4 Campaign",
  stage: "inbound",
  valueCents: 50000,
  type: "sponsorship",
  source: null,
  paymentTerms: "net_30",
  platforms: ["twitch"],
  notes: null,
  currency: "usd",
  primaryContactId: null,
  primaryContact: null,
  brand: { name: "Acme" },
  deliverables: [
    {
      id: "del1",
      title: "Twitch stream",
      platform: "twitch",
      status: "scheduled",
      dueAt: null,
      position: 0,
    },
  ],
};

function mockQuery(useQuery: Mock, data: unknown) {
  useQuery.mockReturnValue({ data, isLoading: false, isError: false, refetch: vi.fn() });
}

beforeEach(() => {
  mockQuery(trpc.deals.getById.useQuery as Mock, deal);
  mockQuery(trpc.proof.listByDeal.useQuery as Mock, []);
  mockQuery(trpc.contract.getByDeal.useQuery as Mock, null);
  mockQuery(trpc.calculator.compute.useQuery as Mock, null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderDealDetail() {
  return render(
    <MemoryRouter initialEntries={["/deals/d1"]}>
      <Routes>
        <Route path="/deals/:id" element={<DealDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("DealDetail evidence form", () => {
  it("keeps the evidence form open with the typed kind, URL, and note when proof.create is rejected", () => {
    (trpc.proof.create.useMutation as Mock).mockImplementation((opts) => ({
      mutate: vi.fn(() => opts.onError?.(new Error("Proof URL must be an https:// URL"))),
      isPending: false,
    }));

    renderDealDetail();

    fireEvent.click(screen.getByRole("button", { name: "Add evidence" }));

    fireEvent.change(
      screen.getByPlaceholderText("https:// link (VOD, clip, screenshot…)"),
      { target: { value: "https://youtube.com/watch?v=abc123" } }
    );
    fireEvent.change(
      screen.getByPlaceholderText("Note (optional — e.g. timestamps, context)"),
      { target: { value: "timestamp 1:23" } }
    );
    fireEvent.change(screen.getByDisplayValue("Clip"), { target: { value: "vod" } });

    fireEvent.submit(
      screen.getByPlaceholderText("https:// link (VOD, clip, screenshot…)").closest("form")!
    );

    expect(
      screen.getByPlaceholderText("https:// link (VOD, clip, screenshot…)")
    ).toHaveValue("https://youtube.com/watch?v=abc123");
    expect(
      screen.getByPlaceholderText("Note (optional — e.g. timestamps, context)")
    ).toHaveValue("timestamp 1:23");
    expect(screen.getByDisplayValue("VOD")).toBeInTheDocument();
  });
});

describe("ContractCard form", () => {
  it("keeps the contract form open with the pasted link when contract.upsert is rejected", () => {
    (trpc.contract.upsert.useMutation as Mock).mockImplementation((opts) => ({
      mutate: vi.fn(() => opts.onError?.(new Error("Contract link must be an https:// URL"))),
      isPending: false,
    }));

    render(<ContractCard dealId="d1" />);

    fireEvent.click(screen.getByRole("button", { name: "Attach" }));

    fireEvent.change(screen.getByPlaceholderText("https://drive.google.com/… or a PDF link"), {
      target: { value: "https://drive.google.com/file/abc" },
    });

    fireEvent.submit(
      screen.getByPlaceholderText("https://drive.google.com/… or a PDF link").closest("form")!
    );

    expect(screen.getByPlaceholderText("https://drive.google.com/… or a PDF link")).toHaveValue(
      "https://drive.google.com/file/abc"
    );
  });
});
