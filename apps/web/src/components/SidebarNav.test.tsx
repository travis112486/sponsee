// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Sidebar } from "./Navbar";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn() }) }));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { name: "PixelPanda", image: null } }),
}));

vi.mock("@/trpc", () => ({
  trpc: { billing: { getSubscription: { useQuery: vi.fn() } } },
}));

import { trpc } from "@/trpc";

beforeEach(() => {
  (trpc.billing.getSubscription.useQuery as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { plan: "starter", dealSlotLimit: 5, activeDealCount: 1 },
    isLoading: false,
    isError: false,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Sidebar navigation", () => {
  it("exposes the Rate Calculator entry (SPO-53 unhide)", () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    );

    const link = screen.getByRole("link", { name: "Calculator" });
    expect(link).toHaveAttribute("href", "/calculator");
  });

  it("keeps the existing primary destinations alongside it", () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    );

    for (const [label, href] of [
      ["Dashboard", "/"],
      ["Pipeline", "/pipeline"],
      ["Payments", "/payments"],
      ["Calendar", "/calendar"],
      ["Calculator", "/calculator"],
      ["Settings", "/settings"],
    ]) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });
});
