// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import Dashboard from "./Dashboard";

const deal = {
  id: "d1",
  title: "Q4 Campaign",
  stage: "inbound",
  valueCents: 50000,
  brand: { name: "Acme" },
};

vi.mock("@/trpc", () => ({
  trpc: {
    deals: {
      list: {
        useQuery: () => ({ data: [deal], isLoading: false, isError: false, refetch: vi.fn() }),
      },
    },
    invoice: {
      list: {
        useQuery: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
      },
    },
    activity: {
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

describe("Dashboard recent-deals rows", () => {
  it("renders each deal as a native button, not a role=button div", () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    const row = screen.getByRole("button", { name: "Open Q4 Campaign — Acme" });
    expect(row.tagName).toBe("BUTTON");
  });
});
