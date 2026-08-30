// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { CommandPalette } from "./Navbar";
import { resolveTopbarPage } from "@/lib/route-titles";

vi.mock("@/trpc", () => ({
  trpc: {
    deals: {
      list: {
        useQuery: () => ({ data: [], isLoading: false, isError: false }),
      },
    },
    invoice: {
      list: {
        useQuery: () => ({ data: [], isLoading: false, isError: false }),
      },
    },
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPalette(open: boolean, onClose: () => void) {
  return render(
    <MemoryRouter>
      <CommandPalette open={open} onClose={onClose} />
    </MemoryRouter>
  );
}

describe("CommandPalette keyboard handling", () => {
  it("closes on Escape while open", () => {
    const onClose = vi.fn();
    renderPalette(true, onClose);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT close on ⌘K — the toggle is owned by Topbar (SPO-25 regression)", () => {
    const onClose = vi.fn();
    renderPalette(true, onClose);

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not react to Escape while closed", () => {
    const onClose = vi.fn();
    renderPalette(false, onClose);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Search deals, brands, invoices")).not.toBeInTheDocument();
  });

  it("exposes dialog semantics for screen readers", () => {
    renderPalette(true, vi.fn());

    const dialog = screen.getByRole("dialog", { name: "Search deals, brands, invoices" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });
});

describe("resolveTopbarPage", () => {
  it("resolves static routes to their exact titles", () => {
    expect(resolveTopbarPage("/")).toEqual({ title: "Dashboard" });
    expect(resolveTopbarPage("/pipeline")).toEqual({ title: "Pipeline" });
    expect(resolveTopbarPage("/payments")).toEqual({ title: "Payments" });
  });

  it("resolves dynamic deal routes to Deal with Pipeline crumb, not Dashboard (P-04)", () => {
    expect(resolveTopbarPage("/pipeline/d9e933a7-a7ab-4b46-a39e-56e7bc22f0af")).toEqual({
      title: "Deal",
      crumb: "Pipeline",
    });
  });

  it("falls back to Dashboard for unknown routes", () => {
    expect(resolveTopbarPage("/somewhere-else")).toEqual({ title: "Dashboard" });
  });
});
