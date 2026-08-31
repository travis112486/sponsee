// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";
import SettingsPage from "./SettingsPage";

// The panels each own a pile of trpc queries; this suite is about which panel
// the URL selects, so stub them down to identifiable markers.
vi.mock("@/components/settings/ProfilePanel", () => ({
  default: () => <div>profile-panel</div>,
}));
vi.mock("@/components/settings/PlatformsPanel", () => ({
  default: () => <div>platforms-panel</div>,
}));
vi.mock("@/components/settings/RailsPanel", () => ({
  default: () => <div>rails-panel</div>,
}));
vi.mock("@/components/settings/ChaseTemplatesPanel", () => ({
  default: () => <div>chase-panel</div>,
}));
vi.mock("@/components/settings/BillingPanel", () => ({
  default: () => <div>billing-panel</div>,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="loc">{location.pathname + location.search}</span>;
}

function renderSettings(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/settings"
          element={
            <>
              <SettingsPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe("SettingsPage tab selection (SPO-103)", () => {
  it("defaults to the profile tab with no query params", () => {
    renderSettings("/settings");
    expect(screen.getByText("profile-panel")).toBeInTheDocument();
  });

  it("deep-links into a tab named by ?tab= — the Topbar Profile target", () => {
    renderSettings("/settings?tab=profile");
    expect(screen.getByText("profile-panel")).toBeInTheDocument();
  });

  it("deep-links into billing via ?tab=billing — the sidebar Manage target", () => {
    renderSettings("/settings?tab=billing");
    expect(screen.getByText("billing-panel")).toBeInTheDocument();
    expect(screen.queryByText("profile-panel")).not.toBeInTheDocument();
  });

  it("falls back to profile when ?tab= names something that isn't a tab", () => {
    renderSettings("/settings?tab=nonsense");
    expect(screen.getByText("profile-panel")).toBeInTheDocument();
  });

  it("still lands on platforms after an OAuth round-trip (?connected=)", () => {
    renderSettings("/settings?connected=twitch");
    expect(screen.getByText("platforms-panel")).toBeInTheDocument();
  });

  it("prefers an explicit ?tab= over the OAuth-return default", () => {
    renderSettings("/settings?connected=twitch&tab=rails");
    expect(screen.getByText("rails-panel")).toBeInTheDocument();
  });

  it("writes the tab into the URL when the user clicks one", () => {
    renderSettings("/settings");
    fireEvent.click(screen.getByRole("button", { name: /Chase templates/ }));

    expect(screen.getByText("chase-panel")).toBeInTheDocument();
    expect(screen.getByTestId("loc")).toHaveTextContent("/settings?tab=chase");
  });
});
