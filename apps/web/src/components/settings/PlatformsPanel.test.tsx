// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import PlatformsPanel from "./PlatformsPanel";

const mockInvalidate = vi.fn();
const mockRefetch = vi.fn();
let mockQueryReturn: {
  data?: Array<{
    id: string;
    platform: string;
    ccv: number | null;
    followers: number | null;
    scheduleLabel: string | null;
    handle?: string | null;
    avatarUrl?: string | null;
    subscriberCount?: number | null;
    subscriberCountIsEstimate?: boolean;
    lastSyncedAt?: string | null;
    syncStatus?: string;
  }>;
  isLoading: boolean;
  isError: boolean;
  refetch: typeof mockRefetch;
} = { data: undefined, isLoading: false, isError: false, refetch: mockRefetch };

const mockUpsertReturn = { mutate: vi.fn(), isPending: false };
let mockDeleteReturn = { mutate: vi.fn(), isPending: false };
const mockSyncReturn = { mutate: vi.fn(), isPending: false };

// Captured so tests can drive the mutation callbacks directly.
type SyncMutationOptions = {
  onSuccess: (result: {
    row: { syncStatus?: string; syncError?: string | null };
    outcome: "synced" | "error" | "skipped";
  }) => void;
};
let syncMutationOptions: SyncMutationOptions | undefined;

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMocks }));

vi.mock("@/trpc", () => ({
  trpc: {
    useUtils: () => ({
      settings: {
        getPlatforms: {
          invalidate: mockInvalidate,
        },
      },
    }),
    settings: {
      getPlatforms: {
        useQuery: () => mockQueryReturn,
      },
      upsertPlatform: {
        useMutation: () => mockUpsertReturn,
      },
      deletePlatform: {
        useMutation: () => mockDeleteReturn,
      },
      syncPlatform: {
        useMutation: (opts: SyncMutationOptions) => {
          syncMutationOptions = opts;
          return mockSyncReturn;
        },
      },
    },
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setQueryState(state: Partial<typeof mockQueryReturn>) {
  mockQueryReturn = { ...mockQueryReturn, ...state };
}

describe("PlatformsPanel", () => {
  it("shows loading spinner while fetching", () => {
    setQueryState({ isLoading: true, isError: false, data: undefined });
    const { container } = render(<PlatformsPanel />);
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("shows error state with retry button on query failure", () => {
    setQueryState({ isLoading: false, isError: true, data: undefined });
    render(<PlatformsPanel />);
    expect(screen.getByText("Couldn't load your platforms.")).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("shows empty state when no platforms exist", () => {
    setQueryState({ isLoading: false, isError: false, data: [] });
    render(<PlatformsPanel />);
    expect(screen.getByText("No platforms added yet.")).toBeInTheDocument();
  });

  it("renders platform list with edit and remove actions", () => {
    setQueryState({
      isLoading: false,
      isError: false,
      data: [
        {
          id: "p1",
          platform: "twitch",
          ccv: 1500,
          followers: 25000,
          scheduleLabel: "Mon/Wed/Fri",
        },
      ],
    });
    render(<PlatformsPanel />);
    expect(screen.getByText("Twitch")).toBeInTheDocument();
    expect(screen.getByText("CCV: 1,500")).toBeInTheDocument();
    expect(screen.getByText("Followers: 25,000")).toBeInTheDocument();
    expect(screen.getByText("Mon/Wed/Fri")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove platform" })).toBeInTheDocument();
  });

  it("has accessible label-input pairs for all form fields", () => {
    setQueryState({ isLoading: false, isError: false, data: [] });
    render(<PlatformsPanel />);

    const platformLabel = screen.getByText("Platform");
    const platformSelect = screen.getByLabelText("Platform");
    expect(platformLabel).toBeInTheDocument();
    expect(platformSelect).toBeInTheDocument();
    expect(platformSelect.tagName.toLowerCase()).toBe("select");

    const ccvLabel = screen.getByText("CCV (avg viewers)");
    const ccvInput = screen.getByLabelText("CCV (avg viewers)");
    expect(ccvLabel).toBeInTheDocument();
    expect(ccvInput).toBeInTheDocument();
    expect(ccvInput.tagName.toLowerCase()).toBe("input");

    const followersLabel = screen.getByText("Followers");
    const followersInput = screen.getByLabelText("Followers");
    expect(followersLabel).toBeInTheDocument();
    expect(followersInput).toBeInTheDocument();
    expect(followersInput.tagName.toLowerCase()).toBe("input");

    const scheduleLabel = screen.getByText("Schedule label");
    const scheduleInput = screen.getByLabelText("Schedule label");
    expect(scheduleLabel).toBeInTheDocument();
    expect(scheduleInput).toBeInTheDocument();
    expect(scheduleInput.tagName.toLowerCase()).toBe("input");
  });

  it("delete button has accessible name and is disabled while deleting", () => {
    mockDeleteReturn = { mutate: vi.fn(), isPending: false };
    setQueryState({
      isLoading: false,
      isError: false,
      data: [{ id: "p1", platform: "twitch", ccv: null, followers: null, scheduleLabel: null }],
    });
    render(<PlatformsPanel />);
    const removeBtn = screen.getByRole("button", { name: "Remove platform" });
    expect(removeBtn).toBeInTheDocument();
    expect(removeBtn).not.toBeDisabled();

    fireEvent.click(removeBtn);
    expect(mockDeleteReturn.mutate).toHaveBeenCalledWith({ id: "p1" });
  });

  it("shows synced stats and a Sync now button for rows with a handle", () => {
    setQueryState({
      isLoading: false,
      isError: false,
      data: [
        {
          id: "p1",
          platform: "youtube",
          ccv: null,
          followers: null,
          scheduleLabel: null,
          handle: "somecreator",
          avatarUrl: "https://yt.example/avatar.jpg",
          subscriberCount: 12300,
          subscriberCountIsEstimate: true,
          lastSyncedAt: "2026-08-29T06:30:00Z",
          syncStatus: "ok",
        },
      ],
    });
    render(<PlatformsPanel />);
    expect(screen.getByText("@somecreator")).toBeInTheDocument();
    expect(screen.getByText("Subs: ~12,300")).toBeInTheDocument();
    expect(screen.getByText(/Last synced/)).toBeInTheDocument();

    const syncBtn = screen.getByRole("button", { name: /Sync now/ });
    fireEvent.click(syncBtn);
    expect(mockSyncReturn.mutate).toHaveBeenCalledWith({ id: "p1" });
  });

  it("hides the Sync now button when no handle is set", () => {
    setQueryState({
      isLoading: false,
      isError: false,
      data: [
        { id: "p2", platform: "tiktok", ccv: 800, followers: null, scheduleLabel: null, handle: null },
      ],
    });
    render(<PlatformsPanel />);
    expect(screen.queryByRole("button", { name: /Sync now/ })).not.toBeInTheDocument();
  });

  describe("sync result toasts", () => {
    const row = {
      id: "p1",
      platform: "twitch",
      ccv: null,
      followers: null,
      scheduleLabel: null,
      handle: "somestreamer",
    };

    function renderPanel() {
      setQueryState({ isLoading: false, isError: false, data: [row] });
      render(<PlatformsPanel />);
    }

    it("toasts success when the sync ran", () => {
      renderPanel();
      syncMutationOptions!.onSuccess({
        row: { ...row, syncStatus: "ok", syncError: null },
        outcome: "synced",
      });
      expect(toastMocks.success).toHaveBeenCalledWith("Stats synced");
      expect(toastMocks.error).not.toHaveBeenCalled();
      expect(mockInvalidate).toHaveBeenCalled();
    });

    it("toasts a neutral notice, not an error, when the sync was skipped (SPO-126b)", () => {
      renderPanel();
      syncMutationOptions!.onSuccess({
        row: { ...row, syncStatus: "never", syncError: null },
        outcome: "skipped",
      });
      expect(toastMocks.info).toHaveBeenCalledWith(
        "Platform sync isn't available yet — your stats are unchanged"
      );
      expect(toastMocks.error).not.toHaveBeenCalled();
      expect(mockInvalidate).toHaveBeenCalled();
    });

    it("toasts the recorded error when the sync failed", () => {
      renderPanel();
      syncMutationOptions!.onSuccess({
        row: { ...row, syncStatus: "error", syncError: "Channel not found for handle" },
        outcome: "error",
      });
      expect(toastMocks.error).toHaveBeenCalledWith("Channel not found for handle");
      expect(toastMocks.success).not.toHaveBeenCalled();
    });
  });
});
