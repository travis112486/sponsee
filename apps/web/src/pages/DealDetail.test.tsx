// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Route, Routes } from "react-router";
import DealDetail from "./DealDetail";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

const updateDeal = vi.fn();

const contact = {
  id: "c1",
  brandId: "b1",
  name: "Jane Buyer",
  email: "jane@example.com",
  role: "Sponsorships",
};

function makeDeal(overrides: Partial<typeof deal> = {}) {
  return { ...deal, ...overrides };
}

const deal = {
  id: "d1",
  title: "Q4 Campaign",
  stage: "inbound",
  type: "flat",
  valueCents: 50000,
  currency: "USD",
  paymentTerms: "net_30",
  platforms: ["twitch"],
  source: null,
  notes: null,
  primaryContactId: null as string | null,
  primaryContact: null as typeof contact | null,
  brand: { id: "b1", name: "Acme" },
  deliverables: [],
};

let dealFixture: ReturnType<typeof makeDeal> = deal;
let contactsFixture: typeof contact[] = [contact];

vi.mock("@/trpc", () => ({
  trpc: {
    useUtils: () => ({
      deals: { getById: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } },
      invoice: { list: { invalidate: vi.fn() } },
      brand: { contacts: { invalidate: vi.fn() } },
      proof: { listByDeal: { invalidate: vi.fn() } },
      contract: { getByDeal: { invalidate: vi.fn() } },
      activity: { list: { invalidate: vi.fn() } },
    }),
    deals: {
      getById: {
        useQuery: () => ({ data: dealFixture, isLoading: false, isError: false, refetch: vi.fn() }),
      },
      update: {
        useMutation: () => ({ mutate: updateDeal, isPending: false }),
      },
    },
    invoice: {
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    deliverable: {
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    proof: {
      listByDeal: {
        useQuery: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
      },
      create: { useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }) },
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    storage: {
      createUploadUrl: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
    contract: {
      getByDeal: {
        useQuery: () => ({ data: null, isLoading: false, isError: false, refetch: vi.fn() }),
      },
      upsert: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      updateStatus: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      remove: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    calculator: {
      compute: {
        useQuery: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
      },
    },
    brand: {
      contacts: {
        useQuery: () => ({ data: contactsFixture, isLoading: false, isError: false, refetch: vi.fn() }),
      },
      addContact: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

beforeEach(() => {
  dealFixture = makeDeal();
  contactsFixture = [contact];
  updateDeal.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderDealDetail() {
  return render(
    <MemoryRouter initialEntries={["/pipeline/d1"]}>
      <Routes>
        <Route path="/pipeline/:id" element={<DealDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("DealDetail contact card (SPO-298)", () => {
  it("turns the empty state into an action, not a dead sentence", () => {
    renderDealDetail();

    expect(screen.getByText("No primary contact set.")).toBeInTheDocument();
    // The dead end is now actionable: a picker and an "Add contact" affordance.
    expect(screen.getByLabelText("Primary contact")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add contact" })).toBeInTheDocument();
  });

  it("renders the primary contact's name, email and role", () => {
    dealFixture = makeDeal({ primaryContactId: "c1", primaryContact: contact });
    renderDealDetail();

    expect(screen.getByText("Jane Buyer")).toBeInTheDocument();
    expect(screen.getByText("jane@example.com")).toBeInTheDocument();
    expect(screen.getByText("Sponsorships")).toBeInTheDocument();
  });

  it("changing the primary contact writes deals.update with primaryContactId", () => {
    dealFixture = makeDeal({ primaryContactId: "c1", primaryContact: contact });
    renderDealDetail();

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    // ContactPicker's select opens; re-selecting the contact triggers update.
    fireEvent.change(screen.getByLabelText("Primary contact"), {
      target: { value: "c1" },
    });

    expect(updateDeal).toHaveBeenCalledWith(
      expect.objectContaining({ id: "d1", primaryContactId: "c1" })
    );
  });
});
