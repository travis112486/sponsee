// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation, Outlet } from "react-router";
import { AuthProvider, useAuth } from "./auth";

// Track session state for tests
let mockSession: { user?: { id: string; name: string; email: string; image?: string } } | null = null;
let mockIsPending = false;

vi.mock("./auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: mockSession,
      isPending: mockIsPending,
    }),
    signOut: vi.fn(() => Promise.resolve()),
  },
}));

function CurrentPath() {
  const location = useLocation();
  return <span data-testid="current-path">{location.pathname}</span>;
}

function AuthConsumer() {
  const { user, isLoading, isAuthenticated } = useAuth();
  return (
    <div>
      <span data-testid="loading">{isLoading ? "loading" : "ready"}</span>
      <span data-testid="authenticated">{isAuthenticated ? "yes" : "no"}</span>
      <span data-testid="user">{user?.email ?? "none"}</span>
    </div>
  );
}

describe("AuthProvider + useAuth", () => {
  beforeEach(() => {
    cleanup();
    mockSession = null;
    mockIsPending = false;
  });

  it("shows loading state while session is pending", () => {
    mockIsPending = true;
    mockSession = null;

    render(
      <MemoryRouter>
        <AuthProvider>
          <AuthConsumer />
        </AuthProvider>
      </MemoryRouter>
    );

    expect(screen.getByTestId("loading").textContent).toBe("loading");
    expect(screen.getByTestId("authenticated").textContent).toBe("no");
  });

  it("shows authenticated when session exists", () => {
    mockIsPending = false;
    mockSession = {
      user: { id: "u1", name: "Test User", email: "test@example.com" },
    };

    render(
      <MemoryRouter>
        <AuthProvider>
          <AuthConsumer />
        </AuthProvider>
      </MemoryRouter>
    );

    expect(screen.getByTestId("loading").textContent).toBe("ready");
    expect(screen.getByTestId("authenticated").textContent).toBe("yes");
    expect(screen.getByTestId("user").textContent).toBe("test@example.com");
  });

  it("shows unauthenticated when session is null", () => {
    mockIsPending = false;
    mockSession = null;

    render(
      <MemoryRouter>
        <AuthProvider>
          <AuthConsumer />
        </AuthProvider>
      </MemoryRouter>
    );

    expect(screen.getByTestId("loading").textContent).toBe("ready");
    expect(screen.getByTestId("authenticated").textContent).toBe("no");
    expect(screen.getByTestId("user").textContent).toBe("none");
  });
});

describe("RequireAuth", () => {
  beforeEach(() => {
    cleanup();
    mockSession = null;
    mockIsPending = false;
  });

  it("redirects unauthenticated users to /login", async () => {
    mockSession = null;
    mockIsPending = false;

    const RequireAuth = (await import("../components/RequireAuth")).default;

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<div data-testid="login-page">Login</div>} />
            <Route element={<RequireAuth><Outlet /></RequireAuth>}>
              <Route path="/dashboard" element={<CurrentPath />} />
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("login-page")).toBeDefined();
    });
  });

  it("renders protected content for authenticated users", async () => {
    mockSession = {
      user: { id: "u1", name: "Test User", email: "test@example.com" },
    };
    mockIsPending = false;

    const RequireAuth = (await import("../components/RequireAuth")).default;

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<div data-testid="login-page">Login</div>} />
            <Route element={<RequireAuth><Outlet /></RequireAuth>}>
              <Route path="/dashboard" element={<div data-testid="dashboard">Dashboard</div>} />
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("dashboard")).toBeDefined();
    });
  });
});
