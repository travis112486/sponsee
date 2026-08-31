// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
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
const deal = {
  id: "d1",
  title: "Q4 Campaign",
  stage: "inbound",
  valueCents: 50000,
  brand: { name: "Acme" },
  platforms: ["twitch"],
  notes: null,
};

vi.mock("@/trpc", () => ({
  trpc: {
    useUtils: () => ({
      deals: { list: { invalidate } },
      brand: { list: { invalidate } },
    }),
    deals: {
      list: {
        useQuery: () => ({ data: [deal], isLoading: false, isError: false, refetch: vi.fn() }),
      },
      updateStage: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      create: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    brand: {
      list: {
        useQuery: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
      },
      create: {
        useMutation: () => ({ mutateAsync: vi.fn().mockResolvedValue({ id: "b1" }) }),
      },
    },
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
