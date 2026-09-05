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
    connectedAccountId?: string | null;
  }>;
  isLoading: boolean;
  isError: boolean;
  refetch: typeof mockRefetch;
} = { data: undefined, isLoading: false, isError: false, refetch: mockRefetch };

// Both providers configured by default; tests override to prove buttons hide.
let mockConnectProvidersReturn: { data?: { twitch: boolean; kick: boolean } } = {
  data: { twitch: true, kick: true },
};

const mockUpsertReturn = { mutate: vi.fn(), isPending: false };
let mockDeleteReturn = { mutate: vi.fn(), isPending: false };
const mockSyncReturn = { mutate: vi.fn(), isPending: false };
const mockCompleteConnectReturn = { mutate: vi.fn(), isPending: false, variables: undefined };
const mockDisconnectReturn = { mutate: vi.fn(), isPending: false };

// Mutable URL state backing the mocked useSearchParams — set before render to
// simulate returning from the OAuth redirect.
let mockSearchParams = new URLSearchParams();
const mockSetSearchParams = vi.fn();
vi.mock("react-router", () => ({
  useSearchParams: () => [mockSearchParams, mockSetSearchParams],
}));

const linkSocialMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ data: { url: "https://id.example/oauth" }, error: null })
);
vi.mock("@/lib/auth-client", () => ({
  authClient: { linkSocial: linkSocialMock },
}));

// Captured so tests can drive the mutation callbacks directly.
type SyncMutationOptions = {
  onSuccess: (result: {
    row: { syncStatus?: string; syncError?: string | null };
    outcome: "synced" | "error" | "skipped";
  }) => void;
};
let syncMutationOptions: SyncMutationOptions | undefined;

// SPO-142: failure handling lives at the mutation level (not mutate()-level)
// so an unmount can't swallow it — captured here and invoked directly.
type CompleteConnectMutationOptions = {
  onSuccess: (
    result: { row: { syncError?: string | null }; outcome: "synced" | "error" | "skipped" },
    variables: { platform: string; recovery?: boolean }
  ) => void;
  onError: (err: { message?: string }, variables: { platform: string; recovery?: boolean }) => void;
};
let completeConnectMutationOptions: CompleteConnectMutationOptions | undefined;

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
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
      getConnectProviders: {
        useQuery: () => mockConnectProvidersReturn,
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
      completePlatformConnect: {
        useMutation: (opts: CompleteConnectMutationOptions) => {
          completeConnectMutationOptions = opts;
          return mockCompleteConnectReturn;
        },
      },
      disconnectPlatform: {
        useMutation: () => mockDisconnectReturn,
      },
    },
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockSearchParams = new URLSearchParams();
  mockConnectProvidersReturn = { data: { twitch: true, kick: true } };
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

  it("disables the platform select in edit mode and enables it in add mode", () => {
    setQueryState({
      isLoading: false,
      isError: false,
      data: [{ id: "p1", platform: "twitch", ccv: null, followers: null, scheduleLabel: null }],
    });
    render(<PlatformsPanel />);

    // Add mode: the select is the row's identity, so it starts enabled.
    expect(screen.getByLabelText("Platform")).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    // Edit mode: platform is the row's identity — it can't be changed in place.
    expect(screen.getByLabelText("Platform")).toBeDisabled();
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

  describe("OAuth connect (SPO-109)", () => {
    it("offers Connect buttons for Twitch and Kick", () => {
      setQueryState({ isLoading: false, isError: false, data: [] });
      render(<PlatformsPanel />);
      expect(screen.getByRole("button", { name: /Connect Twitch/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Connect Kick/ })).toBeInTheDocument();
    });

    it("hides Connect buttons for providers without credentials, keeping existing connections visible", () => {
      mockConnectProvidersReturn = { data: { twitch: false, kick: false } };
      setQueryState({
        isLoading: false,
        isError: false,
        data: [
          {
            id: "p1",
            platform: "twitch",
            ccv: null,
            followers: null,
            scheduleLabel: null,
            handle: "somestreamer",
            connectedAccountId: "acct-1",
          },
        ],
      });
      render(<PlatformsPanel />);
      // No credentials → no dead-end buttons (Kick), but the already-connected
      // Twitch chip and its Disconnect stay reachable.
      expect(screen.queryByRole("button", { name: /Connect Kick/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Connect Twitch/ })).not.toBeInTheDocument();
      expect(screen.getByText(/Twitch connected/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Disconnect/ })).toBeInTheDocument();
    });

    it("starts the link flow with per-platform callback URLs", async () => {
      setQueryState({ isLoading: false, isError: false, data: [] });
      render(<PlatformsPanel />);
      fireEvent.click(screen.getByRole("button", { name: /Connect Twitch/ }));
      await vi.waitFor(() => expect(linkSocialMock).toHaveBeenCalled());
      expect(linkSocialMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "twitch",
          callbackURL: expect.stringContaining("connected=twitch"),
          errorCallbackURL: expect.stringContaining("connect_error=twitch"),
        })
      );
    });

    it("shows a Connected pill with Disconnect for linked platforms", () => {
      setQueryState({
        isLoading: false,
        isError: false,
        data: [
          {
            id: "p1",
            platform: "twitch",
            ccv: null,
            followers: null,
            scheduleLabel: null,
            handle: "somestreamer",
            connectedAccountId: "acct-1",
          },
        ],
      });
      render(<PlatformsPanel />);
      expect(screen.getByText(/Twitch connected/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Connect Twitch/ })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /Disconnect/ }));
      expect(mockDisconnectReturn.mutate).toHaveBeenCalledWith({ id: "p1" });
    });

    it("shows Sync now for connected rows even without a handle", () => {
      setQueryState({
        isLoading: false,
        isError: false,
        data: [
          {
            id: "p1",
            platform: "twitch",
            ccv: null,
            followers: null,
            scheduleLabel: null,
            handle: null,
            connectedAccountId: "acct-1",
          },
        ],
      });
      render(<PlatformsPanel />);
      expect(screen.getByRole("button", { name: /Sync now/ })).toBeInTheDocument();
    });

    it("finishes the connect when returning with ?connected=, then strips the params", () => {
      mockSearchParams = new URLSearchParams("connected=twitch");
      setQueryState({ isLoading: false, isError: false, data: [] });
      render(<PlatformsPanel />);
      expect(mockCompleteConnectReturn.mutate).toHaveBeenCalledWith({ platform: "twitch" });
      expect(mockSetSearchParams).toHaveBeenCalled();
      const cleaned = mockSetSearchParams.mock.calls[0][0] as URLSearchParams;
      expect(cleaned.has("connected")).toBe(false);
    });

    it("toasts the completion failure from the mutation-level onError so an unmount can't swallow it", () => {
      mockSearchParams = new URLSearchParams("connected=twitch");
      setQueryState({ isLoading: false, isError: false, data: [] });
      render(<PlatformsPanel />);
      completeConnectMutationOptions!.onError(
        { message: "No linked twitch account — the Connect flow didn't finish" },
        { platform: "twitch" }
      );
      expect(toastMocks.error).toHaveBeenCalledWith(
        "No linked twitch account — the Connect flow didn't finish"
      );
    });

    it("surfaces provider errors when returning with ?connect_error=", () => {
      mockSearchParams = new URLSearchParams("connect_error=twitch&error=access_denied");
      setQueryState({ isLoading: false, isError: false, data: [] });
      render(<PlatformsPanel />);
      expect(mockCompleteConnectReturn.mutate).not.toHaveBeenCalled();
      expect(toastMocks.error).toHaveBeenCalledWith(
        expect.stringContaining("Couldn't connect Twitch")
      );
    });

    it("still attempts completion on a state_mismatch error — a replayed callback means the link may have landed", () => {
      mockSearchParams = new URLSearchParams("connect_error=twitch&error=state_mismatch");
      setQueryState({ isLoading: false, isError: false, data: [] });
      render(<PlatformsPanel />);
      // recovery: true tells the server only a freshly written link counts as
      // evidence (SPO-142) — a pre-existing account row must not turn a failed
      // account switch into a success toast.
      expect(mockCompleteConnectReturn.mutate).toHaveBeenCalledWith({
        platform: "twitch",
        recovery: true,
      });
      // The error toast is deferred to the mutation's onError — no toast until
      // the server confirms the link really didn't land.
      expect(toastMocks.error).not.toHaveBeenCalled();
    });

    it("shows the provider's original error when recovery comes back empty-handed", () => {
      mockSearchParams = new URLSearchParams("connect_error=twitch&error=state_mismatch");
      setQueryState({ isLoading: false, isError: false, data: [] });
      render(<PlatformsPanel />);
      completeConnectMutationOptions!.onError(
        { message: "No new twitch link landed — the Connect flow didn't finish" },
        { platform: "twitch", recovery: true }
      );
      // Pinned exactly: the recovery failure must surface the *original*
      // provider error, not the generic completion-failure text.
      expect(toastMocks.error).toHaveBeenCalledTimes(1);
      expect(toastMocks.error).toHaveBeenCalledWith("Couldn't connect Twitch: state mismatch");
    });
  });
});
