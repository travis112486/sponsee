// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { toast } from "sonner";
import ProfilePanel from "./ProfilePanel";

const mockInvalidate = vi.fn();
const mockRefetch = vi.fn();
let mockQueryReturn: {
  data?: {
    displayName: string;
    pronouns: string | null;
    category: string | null;
    avatarUrl: string | null;
    timezone: string;
    defaultCurrency: string;
  };
  isLoading: boolean;
  isError: boolean;
  refetch: typeof mockRefetch;
} = { data: undefined, isLoading: false, isError: false, refetch: mockRefetch };

const mockUpdateReturn = { mutate: vi.fn(), isPending: false };

/** Options the panel hands to useMutation, so tests can fire onError directly. */
let updateOptions: { onError?: (err: unknown) => void } = {};

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/trpc", () => ({
  trpc: {
    useUtils: () => ({
      settings: {
        getProfile: {
          invalidate: mockInvalidate,
        },
      },
    }),
    settings: {
      getProfile: {
        useQuery: () => mockQueryReturn,
      },
      updateProfile: {
        useMutation: (opts: { onError?: (err: unknown) => void }) => {
          updateOptions = opts;
          return mockUpdateReturn;
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

describe("ProfilePanel", () => {
  it("shows loading spinner while fetching", () => {
    setQueryState({ isLoading: true, isError: false, data: undefined });
    const { container } = render(<ProfilePanel />);
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("shows error state with retry button on query failure", () => {
    setQueryState({ isLoading: false, isError: true, data: undefined });
    render(<ProfilePanel />);
    expect(screen.getByText("Couldn't load your profile.")).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("renders profile form with populated data", () => {
    setQueryState({
      isLoading: false,
      isError: false,
      data: {
        displayName: "Alex Streams",
        pronouns: "they/them",
        category: "Gaming",
        avatarUrl: "https://example.com/avatar.png",
        timezone: "America/Los_Angeles",
        defaultCurrency: "EUR",
      },
    });
    render(<ProfilePanel />);
    expect(screen.getByDisplayValue("Alex Streams")).toBeInTheDocument();
    expect(screen.getByDisplayValue("they/them")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Gaming")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://example.com/avatar.png")).toBeInTheDocument();
    expect(screen.getByDisplayValue("America/Los_Angeles")).toBeInTheDocument();
  });

  it("has accessible label-input pairs for all form fields", () => {
    setQueryState({
      isLoading: false,
      isError: false,
      data: {
        displayName: "",
        pronouns: null,
        category: null,
        avatarUrl: null,
        timezone: "America/New_York",
        defaultCurrency: "USD",
      },
    });
    render(<ProfilePanel />);

    const displayNameInput = screen.getByLabelText("Display name");
    expect(displayNameInput).toBeInTheDocument();
    expect(displayNameInput.tagName.toLowerCase()).toBe("input");

    const pronounsInput = screen.getByLabelText("Pronouns");
    expect(pronounsInput).toBeInTheDocument();
    expect(pronounsInput.tagName.toLowerCase()).toBe("input");

    const categoryInput = screen.getByLabelText("Category / niche");
    expect(categoryInput).toBeInTheDocument();
    expect(categoryInput.tagName.toLowerCase()).toBe("input");

    const avatarInput = screen.getByLabelText("Avatar URL");
    expect(avatarInput).toBeInTheDocument();
    expect(avatarInput.tagName.toLowerCase()).toBe("input");

    const timezoneInput = screen.getByLabelText("Timezone");
    expect(timezoneInput).toBeInTheDocument();
    expect(timezoneInput.tagName.toLowerCase()).toBe("select");

    const currencyInput = screen.getByLabelText("Default currency");
    expect(currencyInput).toBeInTheDocument();
    expect(currencyInput.tagName.toLowerCase()).toBe("select");
  });

  // SPO-246. The field used to be free text, so "Eastern" or "EST" saved
  // cleanly and then silently gave the creator UTC (or DST-free) revenue
  // months. The picker can only emit zones the router accepts.
  describe("timezone picker", () => {
    function renderWithTimezone(timezone: string) {
      setQueryState({
        isLoading: false,
        isError: false,
        data: {
          displayName: "Alex Streams",
          pronouns: null,
          category: null,
          avatarUrl: null,
          timezone,
          defaultCurrency: "USD",
        },
      });
      render(<ProfilePanel />);
      return screen.getByLabelText("Timezone") as HTMLSelectElement;
    }

    it("offers region/city zones and no free-text entry", () => {
      const select = renderWithTimezone("America/New_York");
      const values = [...select.options].map((o) => o.value);

      expect(values).toContain("America/New_York");
      expect(values).toContain("Europe/London");
      expect(values).toContain("UTC");
      expect(values.length).toBeGreaterThan(100);
    });

    it("offers none of the aliases the router rejects", () => {
      const select = renderWithTimezone("America/New_York");
      const values = [...select.options].map((o) => o.value);

      for (const alias of ["EST", "MST", "HST", "EST5EDT", "PST8PDT", "GMT", "Etc/GMT+5"]) {
        expect(values).not.toContain(alias);
      }
    });

    it("selects the creator's saved zone", () => {
      expect(renderWithTimezone("Europe/Berlin").value).toBe("Europe/Berlin");
    });

    it("keeps an unusable legacy value selected and warns instead of silently rewriting it", () => {
      // Without its own option the select would snap to the first entry, and
      // the next save would quietly move the creator to a zone they never
      // chose.
      const select = renderWithTimezone("Eastern");

      expect(select.value).toBe("Eastern");
      expect(screen.getByText(/revenue months are being counted in UTC/i)).toBeInTheDocument();
    });

    it("does not warn about a zone that works", () => {
      renderWithTimezone("America/New_York");
      expect(screen.queryByText(/revenue months are being counted in UTC/i)).toBeNull();
    });
  });

  // SPO-110. The server refine on updateProfile is https-only (SPO-88, 9cca928).
  // If the client schema is looser, an http:// avatar passes inline validation,
  // fires the mutation, and comes back as a raw ZodError in a toast.
  describe("avatarUrl scheme validation", () => {
    function renderWithAvatar(stored: string | null) {
      setQueryState({
        isLoading: false,
        isError: false,
        data: {
          displayName: "Alex Streams",
          pronouns: null,
          category: null,
          avatarUrl: stored,
          timezone: "America/New_York",
          defaultCurrency: "USD",
        },
      });
      render(<ProfilePanel />);
      return screen.getByLabelText("Avatar URL");
    }

    it("rejects an http:// avatar URL inline and never fires the mutation", async () => {
      const avatarInput = renderWithAvatar(null);
      fireEvent.change(avatarInput, {
        target: { value: "http://cdn.example.com/avatar.png" },
      });
      fireEvent.click(screen.getByRole("button", { name: /save profile/i }));

      expect(await screen.findByText("Must be an https:// URL")).toBeInTheDocument();
      expect(mockUpdateReturn.mutate).not.toHaveBeenCalled();
    });

    it("blocks an unrelated edit while a stored http:// avatar is still in the form", async () => {
      renderWithAvatar("http://cdn.example.com/avatar.png");
      fireEvent.change(screen.getByLabelText("Display name"), {
        target: { value: "Alex Renamed" },
      });
      fireEvent.click(screen.getByRole("button", { name: /save profile/i }));

      expect(await screen.findByText("Must be an https:// URL")).toBeInTheDocument();
      expect(mockUpdateReturn.mutate).not.toHaveBeenCalled();
    });

    it("still saves an https:// avatar URL", async () => {
      const avatarInput = renderWithAvatar(null);
      fireEvent.change(avatarInput, {
        target: { value: "https://cdn.example.com/avatar.png" },
      });
      fireEvent.click(screen.getByRole("button", { name: /save profile/i }));

      await waitFor(() => expect(mockUpdateReturn.mutate).toHaveBeenCalledTimes(1));
      expect(mockUpdateReturn.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ avatarUrl: "https://cdn.example.com/avatar.png" })
      );
    });

    it("clears a stored avatar to null when the field is emptied", async () => {
      const avatarInput = renderWithAvatar("https://cdn.example.com/avatar.png");
      fireEvent.change(avatarInput, { target: { value: "" } });
      fireEvent.click(screen.getByRole("button", { name: /save profile/i }));

      await waitFor(() => expect(mockUpdateReturn.mutate).toHaveBeenCalledTimes(1));
      expect(mockUpdateReturn.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ avatarUrl: null })
      );
    });
  });
});

// ── Server-side validation failures (SPO-112) ──────────────────────────────

describe("ProfilePanel server validation errors", () => {
  function renderLoaded() {
    setQueryState({
      isLoading: false,
      isError: false,
      data: {
        displayName: "Alex Streams",
        pronouns: null,
        category: null,
        avatarUrl: "http://example.com/a.png",
        timezone: "America/New_York",
        defaultCurrency: "USD",
      },
    });
    render(<ProfilePanel />);
  }

  /** What the API's errorFormatter puts on the wire for a rejected input. */
  function rejection(fieldErrors: Record<string, string[]>, formErrors: string[] = []) {
    return {
      message: "Avatar URL: Must be an https:// URL",
      data: { zodError: { formErrors, fieldErrors } },
    };
  }

  it("shows a server rejection under the offending field, not in a toast", () => {
    renderLoaded();

    act(() => {
      updateOptions.onError?.(rejection({ avatarUrl: ["Must be an https:// URL"] }));
    });

    expect(screen.getByText("Must be an https:// URL")).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("falls back to a toast when the field has no inline slot", () => {
    renderLoaded();

    act(() => {
      updateOptions.onError?.({
        message: "Pronouns: String must contain at most 64 character(s)",
        data: {
          zodError: {
            formErrors: [],
            fieldErrors: { pronouns: ["String must contain at most 64 character(s)"] },
          },
        },
      });
    });

    expect(toast.error).toHaveBeenCalledWith(
      "Pronouns: String must contain at most 64 character(s)"
    );
  });

  // SPO-246. Timezone decides which month a paid invoice is counted in, so a
  // server rejection has to land on the field rather than in a toast the
  // creator can dismiss without fixing anything.
  it("shows a server timezone rejection under the picker", () => {
    renderLoaded();

    act(() => {
      updateOptions.onError?.({
        message: "Timezone: Pick a region/city timezone",
        data: {
          zodError: {
            formErrors: [],
            fieldErrors: { timezone: ["Pick a region/city timezone"] },
          },
        },
      });
    });

    expect(screen.getByText("Pick a region/city timezone")).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("toasts non-validation errors with the server message", () => {
    renderLoaded();

    act(() => {
      updateOptions.onError?.({ message: "No creator workspace", data: { zodError: null } });
    });

    expect(toast.error).toHaveBeenCalledWith("No creator workspace");
  });

  it("uses the fallback copy when the server sends no message", () => {
    renderLoaded();

    act(() => {
      updateOptions.onError?.({ message: "" });
    });

    expect(toast.error).toHaveBeenCalledWith("Failed to save profile");
  });
});
