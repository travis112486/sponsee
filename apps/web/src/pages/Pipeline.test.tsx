// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import Pipeline from "./Pipeline";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

const invalidate = vi.fn();
const createInvoice = vi.fn();
const updateDeliverable = vi.fn();
const createDeal = vi.fn();
const createBrand = vi.fn().mockResolvedValue({ id: "b1" });
const addContact = vi.fn().mockResolvedValue({ id: "c1" });

const deal = {
  id: "d1",
  title: "Q4 Campaign",
  type: "flat",
  stage: "inbound",
  valueCents: 50000,
  valueNote: "per stream",
  currency: "USD",
  paymentTerms: "net_30",
  stageEnteredAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  brand: { name: "Acme" },
  platforms: ["twitch", "youtube"],
  notes: null,
  deliverables: [
    {
      id: "del1",
      title: "VOD publish",
      status: "not_started",
      dueAt: null,
      dueLabel: null,
      progressDone: 137,
      progressTotal: 200,
      position: 0,
    },
  ],
  invoices: [
    {
      id: "inv1",
      status: "open",
      dueAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      paidAt: null,
      amountCents: 50000,
    },
    {
      id: "inv-paid",
      status: "paid",
      dueAt: null,
      paidAt: new Date().toISOString(),
      amountCents: 25000,
    },
  ],
};

// Deal with no non-void invoice — the only case where the quick-action
// "invoice" button should actually mint a new invoice.
const dealWithoutInvoice = {
  ...deal,
  id: "d2",
  title: "Fresh Campaign",
  invoices: [],
};

let dealsFixture: typeof deal[] = [deal];
let invoicePending = false;
let brandsFixture: { id: string; name: string }[] = [];
let contactsFixture: { id: string; name: string; email: string; role: string | null }[] = [];

vi.mock("@/trpc", () => ({
  trpc: {
    useUtils: () => ({
      deals: { list: { invalidate } },
      brand: { list: { invalidate }, contacts: { invalidate } },
      invoice: { list: { invalidate } },
    }),
    deals: {
      list: {
        useQuery: () => ({ data: dealsFixture, isLoading: false, isError: false, refetch: vi.fn() }),
      },
      updateStage: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      create: {
        useMutation: () => ({ mutate: createDeal, isPending: false }),
      },
    },
    invoice: {
      create: {
        useMutation: () => ({ mutate: createInvoice, isPending: invoicePending }),
      },
    },
    deliverable: {
      update: {
        useMutation: () => ({ mutate: updateDeliverable, isPending: false }),
      },
    },
    settings: {
      getProfile: {
        useQuery: () => ({
          data: { timezone: "UTC" },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
    },
    brand: {
      list: {
        useQuery: () => ({ data: brandsFixture, isLoading: false, isError: false, refetch: vi.fn() }),
      },
      create: {
        useMutation: () => ({ mutateAsync: createBrand }),
      },
      contacts: {
        useQuery: () => ({ data: contactsFixture, isLoading: false, isError: false, refetch: vi.fn() }),
      },
      addContact: {
        useMutation: () => ({ mutate: addContact, mutateAsync: addContact, isPending: false }),
      },
    },
  },
}));

beforeEach(() => {
  // Reduced motion snaps count-ups to target so StageSum needs no rAF in jsdom.
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
  dealsFixture = [deal];
  invoicePending = false;
  brandsFixture = [];
  contactsFixture = [];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function renderPipeline(initialEntry = "/pipeline") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Pipeline />
    </MemoryRouter>
  );
}

describe("Pipeline kanban card accessibility", () => {
  it("exposes the deal open action as a real button, not a role=button div", () => {
    renderPipeline();

    const openButton = screen.getByRole("button", { name: "Open Q4 Campaign — Acme" });
    expect(openButton).toBeInTheDocument();
    // The card itself must not masquerade as a button.
    expect(screen.queryAllByRole("button").every((b) => b.tagName === "BUTTON")).toBe(true);
  });
});

describe("Pipeline deal card content (SPO-195)", () => {
  it("renders the brand mark, deal-type badge, value note and platform dots", () => {
    renderPipeline();

    const card = document.querySelector(
      '[aria-roledescription="Draggable deal card"]'
    ) as HTMLElement;

    // Brand mark renders "AC" initials for single-word "Acme".
    expect(within(card).getByText("AC")).toBeInTheDocument();
    // Deal-type badge (scoped to the card; the filter bar also shows "Flat").
    expect(within(card).getByText("Flat")).toBeInTheDocument();
    // Value note next to the value.
    expect(within(card).getByText("per stream")).toBeInTheDocument();
    // Platform dots: role="img" with Twitch / YouTube labels.
    expect(within(card).getByRole("img", { name: "Twitch" })).toBeInTheDocument();
    expect(within(card).getByRole("img", { name: "YouTube" })).toBeInTheDocument();
    // Raw uppercase platform text is gone.
    expect(within(card).queryByText("TWITCH")).not.toBeInTheDocument();
  });

  it("renders days-in-stage and the next deliverable", () => {
    renderPipeline();
    expect(screen.getByText(/^Next: VOD publish$/)).toBeInTheDocument();
    expect(screen.getByText("2d")).toBeInTheDocument();
  });

  it("renders the deliverable progress bar caption", () => {
    renderPipeline();
    expect(screen.getByText("137 / 200")).toBeInTheDocument();
  });

  it("renders the overdue danger strip for an overdue open invoice", () => {
    renderPipeline();
    expect(screen.getByText(/Invoice 5d overdue/)).toBeInTheDocument();
  });

  it("renders the header totals line", () => {
    renderPipeline();
    const header = screen.getByText((content, el) => {
      return el?.tagName === "P" && content.includes("total pipeline");
    });
    expect(header).toHaveTextContent("1 deal");
    expect(header).toHaveTextContent("$500");
    // Positive control: the paid invoice ($250) must be summed, not just the
    // "collected this quarter" label rendering.
    expect(header).toHaveTextContent("$250 collected this quarter");
  });
});

describe("Pipeline quick actions (SPO-195)", () => {
  it("exposes open, invoice and mark-deliverable buttons", () => {
    renderPipeline();
    expect(screen.getByRole("button", { name: "Create invoice for Q4 Campaign" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark next deliverable done for Q4 Campaign" })).toBeInTheDocument();
  });

  it("marking a deliverable done targets the first non-done deliverable", () => {
    renderPipeline();
    fireEvent.click(screen.getByRole("button", { name: "Mark next deliverable done for Q4 Campaign" }));
    expect(updateDeliverable).toHaveBeenCalledWith(
      expect.objectContaining({ id: "del1", status: "done" })
    );
  });

  it("creating an invoice posts the deal value for a deal with no non-void invoice", () => {
    dealsFixture = [dealWithoutInvoice];
    renderPipeline();
    fireEvent.click(screen.getByRole("button", { name: "Create invoice for Fresh Campaign" }));
    expect(createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        dealId: "d2",
        title: "Fresh Campaign — Invoice",
        amountCents: 50000,
        currency: "USD",
        terms: "net_30",
      })
    );
  });

  it("does not mint a duplicate invoice when the deal already has a non-void one", () => {
    renderPipeline();
    fireEvent.click(screen.getByRole("button", { name: "Create invoice for Q4 Campaign" }));
    expect(createInvoice).not.toHaveBeenCalled();
  });

  it("disables the invoice button while a create is in flight", () => {
    invoicePending = true;
    dealsFixture = [dealWithoutInvoice];
    renderPipeline();
    expect(screen.getByRole("button", { name: "Create invoice for Fresh Campaign" })).toBeDisabled();
  });
});

describe("Pipeline drag-and-drop (SPO-52, re-landed for SPO-103)", () => {
  function getCard() {
    // The draggable wrapper is the card itself, not the stretched open button.
    const card = document.querySelector('[aria-roledescription="Draggable deal card"]');
    if (!card) throw new Error("no draggable deal card rendered");
    return card as HTMLElement;
  }

  it("renders each deal card as a drag source", () => {
    renderPipeline();
    expect(getCard()).toBeInTheDocument();
  });

  it("does not regress the SPO-25 contract: the draggable card is not itself a button", () => {
    renderPipeline();
    // dnd-kit's listener attributes default to role="button"/tabIndex=0; the
    // card must override them so the nested open button stays the only button.
    expect(getCard()).toHaveAttribute("role", "group");
    expect(getCard()).toHaveAttribute("tabindex", "-1");
  });

  it("activates a drag after the pointer moves past the threshold", async () => {
    renderPipeline();
    const card = getCard();

    fireEvent.mouseDown(card, { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(document, { clientX: 40, clientY: 0 });

    // Once a drag is live the source card dims and the overlay clone appears,
    // so the brand name is rendered twice.
    await waitFor(() => {
      expect(screen.getAllByText("Acme").length).toBeGreaterThan(1);
    });

    fireEvent.mouseUp(document);
  });

  it("keeps a plain click on the card as open-the-deal, not a drag", () => {
    renderPipeline();
    const card = getCard();

    fireEvent.mouseDown(card, { clientX: 0, clientY: 0 });
    fireEvent.mouseUp(document, { clientX: 0, clientY: 0 });

    // No movement past the 4px threshold: no overlay clone was created.
    expect(screen.getAllByText("Acme")).toHaveLength(1);
  });
});

describe("NewDealModal accessibility", () => {
  it("renders with dialog semantics and closes on Escape", async () => {
    renderPipeline("/pipeline?new=1");

    const dialog = screen.getByRole("dialog", { name: "New deal" });
    expect(dialog).toHaveAttribute("aria-modal", "true");

    const close = screen.getByRole("button", { name: "Close" });
    expect(close).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});

describe("New deal contact capture (SPO-298)", () => {
  it("creates a contact inline when adding a deal for a new brand", async () => {
    renderPipeline("/pipeline?new=1");

    fireEvent.click(screen.getByRole("button", { name: "New brand" }));
    fireEvent.change(screen.getByPlaceholderText("Brand name"), {
      target: { value: "New Brand" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. Q4 Stream Fuel Campaign"), {
      target: { value: "Q4 Deal" },
    });
    fireEvent.change(screen.getByPlaceholderText("Contact name"), {
      target: { value: "Jane Buyer" },
    });
    fireEvent.change(screen.getByPlaceholderText("Contact email"), {
      target: { value: "jane@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("Role (optional)"), {
      target: { value: "Sponsorships" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create deal" }));

    await waitFor(() => {
      expect(createBrand).toHaveBeenCalledWith({ name: "New Brand", category: undefined });
    });
    await waitFor(() => {
      expect(addContact).toHaveBeenCalledWith({
        brandId: "b1",
        name: "Jane Buyer",
        email: "jane@example.com",
        role: "Sponsorships",
      });
    });
    await waitFor(() => {
      expect(createDeal).toHaveBeenCalledWith(
        expect.objectContaining({ brandId: "b1", primaryContactId: "c1" })
      );
    });
  });

  it("offers a contact picker once an existing brand is selected", () => {
    brandsFixture = [{ id: "b1", name: "Acme" }];
    renderPipeline("/pipeline?new=1");

    fireEvent.change(screen.getByLabelText("Brand"), { target: { value: "b1" } });

    expect(screen.getByLabelText("Primary contact")).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "No primary contact" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add contact" })).toBeInTheDocument();
  });
});
