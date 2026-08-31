// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { CommandPalette, Topbar } from "./Navbar";
import { resolveTopbarPage } from "@/lib/route-titles";

const toastSpy = vi.fn();
vi.mock("sonner", () => ({ toast: (...args: unknown[]) => toastSpy(...args) }));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "u1", name: "Pixel Panda", email: "p@example.com" },
    isLoading: false,
    isAuthenticated: true,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

const activityData = vi.fn(() => [] as unknown[]);
const invoiceData = vi.fn(() => [] as unknown[]);

vi.mock("@/trpc", () => ({
  trpc: {
    deals: {
      list: {
        useQuery: () => ({ data: [], isLoading: false, isError: false }),
      },
    },
    invoice: {
      list: {
        useQuery: () => ({ data: invoiceData(), isLoading: false, isError: false }),
      },
    },
    activity: {
      list: {
        useQuery: () => ({ data: activityData(), isLoading: false, isError: false }),
      },
    },
    // Topbar reads these via useCreatorIdentity (SPO-154). The hook treats
    // undefined data as "not resolved yet" and falls back to the auth user, so
    // these tests exercise the same no-avatar path they did before.
    settings: {
      getProfile: {
        useQuery: () => ({ data: undefined, isLoading: false, isError: false }),
      },
      getPlatforms: {
        useQuery: () => ({ data: undefined, isLoading: false, isError: false }),
      },
    },
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Node 22 exposes an unavailable experimental `localStorage` global that shadows
// jsdom's, so stub a real one rather than depend on the environment.
function installMemoryStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
}

beforeEach(() => {
  installMemoryStorage();
  activityData.mockReturnValue([]);
  invoiceData.mockReturnValue([]);
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

function renderTopbar() {
  return render(
    <MemoryRouter>
      <Topbar />
    </MemoryRouter>
  );
}

describe("Topbar has no fake Go Live control (SPO-152 regression)", () => {
  it("renders no Go Live button", () => {
    renderTopbar();

    expect(screen.queryByRole("button", { name: /go live/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/go live/i)).not.toBeInTheDocument();
  });

  it("no topbar control claims a live/offline state Sponsee never queried", () => {
    renderTopbar();

    for (const button of screen.getAllByRole("button")) {
      fireEvent.click(button);
    }

    expect(toastSpy).not.toHaveBeenCalledWith(expect.stringMatching(/live/i));
  });
});

describe("Topbar notification bell (SPO-153)", () => {
  it("shows no unread dot when there is nothing to notify about", () => {
    renderTopbar();

    expect(screen.queryByTestId("notifications-unread-dot")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Notifications")).toBeInTheDocument();
  });

  it("still reports zero new in the panel when the list is empty", () => {
    renderTopbar();

    fireEvent.click(screen.getByLabelText("Notifications"));
    expect(screen.getByText("Notifications · 0 new")).toBeInTheDocument();
    expect(screen.getByText("No notifications yet")).toBeInTheDocument();
  });

  it("shows the dot and lists real overdue invoices", () => {
    invoiceData.mockReturnValue([
      {
        id: "i1",
        number: 12,
        status: "open",
        dueAt: "2020-01-01T00:00:00.000Z",
        createdAt: "2019-12-01T00:00:00.000Z",
      },
    ]);
    renderTopbar();

    expect(screen.getByTestId("notifications-unread-dot")).toBeInTheDocument();
    expect(screen.getByLabelText("Notifications, 1 unread")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Notifications, 1 unread"));
    expect(screen.getByText("Invoice #12 is overdue")).toBeInTheDocument();
  });

  it("clears the dot once the panel has been opened, and keeps it clear across remounts", () => {
    activityData.mockReturnValue([
      {
        id: "a1",
        actor: "system",
        entityType: "invoice",
        entityId: "inv-1",
        payload: { status: "sent", step: 2 },
        createdAt: "2020-05-05T00:00:00.000Z",
      },
    ]);
    renderTopbar();

    fireEvent.click(screen.getByLabelText("Notifications, 1 unread"));
    expect(screen.getByText("Chase step 2 sent")).toBeInTheDocument();
    expect(screen.getByText("Notifications · 0 new")).toBeInTheDocument();
    expect(screen.queryByTestId("notifications-unread-dot")).not.toBeInTheDocument();

    cleanup();
    renderTopbar();
    expect(screen.queryByTestId("notifications-unread-dot")).not.toBeInTheDocument();
  });

  it("re-raises the dot when a newer event arrives after the last read", () => {
    activityData.mockReturnValue([
      {
        id: "a1",
        actor: "system",
        entityType: "invoice",
        entityId: "inv-1",
        payload: { status: "sent", step: 1 },
        createdAt: "2020-05-05T00:00:00.000Z",
      },
    ]);
    renderTopbar();
    fireEvent.click(screen.getByLabelText("Notifications, 1 unread"));
    expect(screen.queryByTestId("notifications-unread-dot")).not.toBeInTheDocument();
    cleanup();

    // A newer event lands while the bell is closed.
    activityData.mockReturnValue([
      {
        id: "a2",
        actor: "system",
        entityType: "invoice",
        entityId: "inv-1",
        payload: { status: "bounced", step: 2 },
        createdAt: "2999-01-01T00:00:00.000Z",
      },
    ]);
    renderTopbar();
    expect(screen.getByTestId("notifications-unread-dot")).toBeInTheDocument();
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
