// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import NotFound from "./NotFound";

afterEach(() => {
  cleanup();
});

describe("NotFound", () => {
  it("renders the 404 message and a link back home", () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>
    );
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.getByText("Page not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to dashboard/i })).toHaveAttribute("href", "/");
  });

  it("sets a descriptive document title", () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>
    );
    expect(document.title).toBe("Not found · Sponsee");
  });
});
