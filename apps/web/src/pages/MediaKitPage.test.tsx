// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MediaKitPage } from "./MediaKitPage";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { email: "creator@example.com" } }) }));
vi.mock("@/trpc", () => ({
  trpc: {
    useUtils: vi.fn(() => ({ mediaKit: { get: { invalidate: vi.fn() } } })),
    mediaKit: {
      get: { useQuery: vi.fn() },
      update: { useMutation: vi.fn() },
      offering: { create: { useMutation: vi.fn() }, update: { useMutation: vi.fn() }, reorder: { useMutation: vi.fn() }, delete: { useMutation: vi.fn() } },
      example: { create: { useMutation: vi.fn() }, update: { useMutation: vi.fn() }, reorder: { useMutation: vi.fn() }, delete: { useMutation: vi.fn() } },
    },
    settings: { updateProfile: { useMutation: vi.fn() } },
  },
}));

import { trpc } from "@/trpc";

const mock = (value: unknown) => value as ReturnType<typeof vi.fn>;
const kit = {
  id: "kit-1",
  creator: { id: "creator-1", displayName: "Pixel Panda", pronouns: "they/them", category: "Gaming", avatarUrl: null },
  platforms: [{ platform: "twitch", handle: "pixelpanda", channelUrl: "https://twitch.tv/pixelpanda", followers: 12000, ccv: 850, scheduleLabel: "Tue / Thu", lastSyncedAt: "2026-09-01T00:00:00.000Z", provenance: "creator_platforms" as const }],
  headline: "Live gaming, built for brands",
  bio: "A focused gaming community.",
  accentColor: null,
  offerings: [{ id: "offer-1", title: "Stream integration", description: "A natural live read", priceCents: 29000, currency: "USD", position: 0 }, { id: "offer-2", title: "Shorts package", description: null, priceCents: 19000, currency: "USD", position: 1 }],
  examples: [{ id: "example-1", title: "Brand launch stream", url: "https://example.com/case-study", position: 0 }],
  cpvhGuidance: { floor: 6000, mid: 10500, agency: 20000, provenance: "shared-benchmark" as const },
};

beforeEach(() => {
  mock(trpc.mediaKit.get.useQuery).mockReturnValue({ data: kit, isLoading: false, isError: false, refetch: vi.fn() });
  for (const mutation of [trpc.mediaKit.update.useMutation, trpc.mediaKit.offering.create.useMutation, trpc.mediaKit.offering.update.useMutation, trpc.mediaKit.offering.reorder.useMutation, trpc.mediaKit.offering.delete.useMutation, trpc.mediaKit.example.create.useMutation, trpc.mediaKit.example.update.useMutation, trpc.mediaKit.example.reorder.useMutation, trpc.mediaKit.example.delete.useMutation, trpc.settings.updateProfile.useMutation]) {
    mock(mutation).mockReturnValue({ mutate: vi.fn(), isPending: false });
  }
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("MediaKitPage", () => {
  it("renders creator data, live provenance, and ordered editable children", () => {
    render(<MediaKitPage />);
    expect(screen.getByRole("heading", { name: "Proposal Creator" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Pixel Panda")).toBeInTheDocument();
    expect(screen.getByText(/synced from connected channels/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Stream integration")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Brand launch stream")).toBeInTheDocument();
    expect(screen.getByText(/CPVH guidance · shared benchmark/)).toBeInTheDocument();
  });

  it("previews the kit and creates a local PDF download", () => {
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:proposal");
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<MediaKitPage />);
    fireEvent.click(screen.getByRole("button", { name: "Preview proposal" }));
    expect(screen.getByRole("dialog", { name: "Proposal preview" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Download PDF" })[1]);
    expect(createUrl).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    createUrl.mockRestore();
    click.mockRestore();
  });

  it("persists an edited child while retaining its server position", () => {
    const mutate = vi.fn();
    mock(trpc.mediaKit.offering.update.useMutation).mockReturnValue({ mutate, isPending: false });
    render(<MediaKitPage />);
    const title = screen.getByDisplayValue("Stream integration");
    fireEvent.change(title, { target: { value: "Homepage integration" } });
    fireEvent.blur(title);
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ id: "offer-1", title: "Homepage integration", position: 0 }));
  });

  it("reorders offerings through the creator-scoped mutation", () => {
    const mutate = vi.fn();
    mock(trpc.mediaKit.offering.reorder.useMutation).mockReturnValue({ mutate, isPending: false });
    render(<MediaKitPage />);
    fireEvent.click(screen.getByRole("button", { name: "Move Stream integration down" }));
    expect(mutate).toHaveBeenCalledWith({ ids: ["offer-2", "offer-1"] });
  });

  it("offers recovery when the creator kit cannot load", () => {
    mock(trpc.mediaKit.get.useQuery).mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() });
    render(<MediaKitPage />);
    expect(screen.getByText("Couldn't load your proposal creator.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
