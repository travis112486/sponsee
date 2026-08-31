// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import CreatorAvatar from "./CreatorAvatar";
import { Sidebar, Topbar } from "./Navbar";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  Toaster: () => null,
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "u1", name: "PixelPanda", email: "p@example.com", image: null },
    signOut: vi.fn(),
  }),
}));

vi.mock("@/trpc", () => ({
  trpc: {
    billing: { getSubscription: { useQuery: vi.fn() } },
    settings: { getProfile: { useQuery: vi.fn() }, getPlatforms: { useQuery: vi.fn() } },
    deals: { list: { useQuery: () => ({ data: [] }) } },
    invoice: { list: { useQuery: () => ({ data: [] }) } },
    // Topbar reads this for the notification bell (SPO-153); an empty feed
    // keeps these avatar tests focused on identity resolution.
    activity: { list: { useQuery: () => ({ data: [] }) } },
  },
}));

import { trpc } from "@/trpc";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function mockIdentity({
  profile,
  platforms,
}: {
  profile?: Record<string, unknown> | null;
  platforms?: unknown[];
}) {
  asMock(trpc.settings.getProfile.useQuery).mockReturnValue({ data: profile ?? null });
  asMock(trpc.settings.getPlatforms.useQuery).mockReturnValue({ data: platforms ?? [] });
}

beforeEach(() => {
  asMock(trpc.billing.getSubscription.useQuery).mockReturnValue({
    data: { plan: "starter", dealSlotLimit: 5, activeDealCount: 1 },
  });
  mockIdentity({});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CreatorAvatar", () => {
  it("renders the image when a src resolves", () => {
    render(<CreatorAvatar src="https://cdn.example.com/a.png" name="PixelPanda" alt="PixelPanda" />);
    expect(screen.getByAltText("PixelPanda")).toHaveAttribute(
      "src",
      "https://cdn.example.com/a.png"
    );
  });

  it("renders a generated initial when there is no src", () => {
    const { container } = render(<CreatorAvatar src={null} name="PixelPanda" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("P");
  });

  it("falls back to the initial when a synced platform avatar 404s", () => {
    const { container } = render(
      <CreatorAvatar src="https://static-cdn.jtvnw.net/gone.png" name="PixelPanda" alt="PixelPanda" />
    );

    fireEvent.error(screen.getByAltText("PixelPanda"));

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("P");
  });
});

describe("Sidebar identity chip", () => {
  function renderSidebar() {
    return render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    );
  }

  it("shows the synced platform avatar, not the PixelPanda mockup asset", () => {
    mockIdentity({
      platforms: [
        { platform: "twitch", ccv: 900, handle: "pixelpanda", avatarUrl: "https://static-cdn.jtvnw.net/real.png" },
      ],
    });
    const { container } = renderSidebar();

    const img = container.querySelector("img:not([alt='Sponsee'])") as HTMLImageElement;
    expect(img.src).toBe("https://static-cdn.jtvnw.net/real.png");
  });

  it("shows a generated initial — never /pixelpanda-avatar.png — when nothing resolves", () => {
    const { container } = renderSidebar();

    const srcs = [...container.querySelectorAll("img")].map((i) => i.getAttribute("src"));
    expect(srcs).not.toContain("/pixelpanda-avatar.png");
    expect(screen.getByText("P")).toBeInTheDocument();
  });

  it("replaces the hardcoded 'Creator' subtitle with the primary platform and handle", () => {
    mockIdentity({
      platforms: [
        { platform: "kick", ccv: 30, handle: "sidekick" },
        { platform: "twitch", ccv: 900, handle: "pixelpanda" },
      ],
    });
    renderSidebar();

    expect(screen.getByText("Twitch · @pixelpanda")).toBeInTheDocument();
    expect(screen.queryByText("Creator")).not.toBeInTheDocument();
  });

  it("drops the subtitle entirely when no platform has a handle", () => {
    renderSidebar();
    expect(screen.queryByText("Creator")).not.toBeInTheDocument();
    expect(screen.getByText("PixelPanda")).toBeInTheDocument();
  });

  it("prefers the Settings profile avatar and display name over platform data", () => {
    mockIdentity({
      profile: { displayName: "Panda Prime", avatarUrl: "https://cdn.example.com/mine.png" },
      platforms: [{ platform: "twitch", ccv: 900, avatarUrl: "https://static-cdn.jtvnw.net/real.png" }],
    });
    const { container } = renderSidebar();

    const img = container.querySelector("img:not([alt='Sponsee'])") as HTMLImageElement;
    expect(img.src).toBe("https://cdn.example.com/mine.png");
    expect(screen.getByText("Panda Prime")).toBeInTheDocument();
  });
});

describe("Topbar account avatar", () => {
  it("uses the same resolved avatar as the sidebar", () => {
    mockIdentity({
      platforms: [{ platform: "twitch", ccv: 900, avatarUrl: "https://static-cdn.jtvnw.net/real.png" }],
    });
    render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>
    );

    const img = screen
      .getByRole("button", { name: "Account menu" })
      .querySelector("img") as HTMLImageElement;
    expect(img.src).toBe("https://static-cdn.jtvnw.net/real.png");
  });

  it("shows the generated initial instead of the mockup avatar when nothing resolves", () => {
    render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>
    );

    const button = screen.getByRole("button", { name: "Account menu" });
    expect(button.querySelector("img")).toBeNull();
    expect(button).toHaveTextContent("P");
  });
});
