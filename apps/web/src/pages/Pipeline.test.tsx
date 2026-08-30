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
