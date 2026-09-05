/**
 * SPO-365 merge review: real-browser geometry check for the bounced/failed
 * delivery reason line. jsdom has no layout engine, so Payments.test.tsx
 * cannot see whether that sentence actually fits — before this file existed,
 * it lived inside the col-span-2 Status column (~1/6 of row width), and at
 * the 1024px floor (Layout's `lg:` sidebar breakpoint) a "col-span-2" is
 * narrow enough that an email address plus a full sentence at text-[11px]
 * wraps across several lines, next to a Resend button that isn't nearly that
 * cramped. The fix moved the reason onto its own full-width line below the
 * row; this test pins that it actually spans the row instead of a column.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { page } from "vitest/browser";
import type { ReactNode } from "react";
import Layout from "@/components/Layout";
import { MotionProvider } from "@/components/MotionProvider";
import Payments from "./Payments";
import "@/index.css";

const noop = vi.fn();
const q = (data: unknown) => ({ data, isLoading: false, isError: false, refetch: noop });

const openInvoice = {
  id: "inv-1",
  number: 1,
  title: "Q4 Campaign",
  status: "open",
  amountCents: 500000,
  currency: "USD",
  dueAt: null,
  issuedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
};

const bouncedDelivery = {
  invoiceId: "inv-1",
  attempt: 1,
  status: "bounced",
  toEmail: "brand-contact-long-address@example-agency.com",
  sentAt: new Date("2026-01-02T00:00:00Z").toISOString(),
  deliveredAt: null,
  openedAt: null,
  bouncedAt: new Date("2026-01-02T01:00:00Z").toISOString(),
};

vi.mock("@/trpc", () => ({
  trpc: {
    useUtils: () => ({
      invoice: { list: { invalidate: noop }, latestDeliveries: { invalidate: noop } },
      chase: { awaitingReview: { invalidate: noop }, state: { invalidate: noop } },
    }),
    invoice: {
      list: { useQuery: () => q([openInvoice]) },
      latestDeliveries: { useQuery: () => q([bouncedDelivery]) },
      markPaid: { useMutation: () => ({ mutate: noop, isPending: false }) },
      send: { useMutation: () => ({ mutate: noop, isPending: false }) },
    },
    chase: {
      awaitingReview: { useQuery: () => q([]) },
      approve: { useMutation: () => ({ mutate: noop, isPending: false }) },
      editAndSend: { useMutation: () => ({ mutate: noop, isPending: false }) },
      state: { useQuery: () => ({ data: { mode: "paused", pausedReason: "hard_bounce" } }) },
      events: { useQuery: () => ({ data: [] }) },
      pause: { useMutation: () => ({ mutate: noop, isPending: false }) },
      resume: { useMutation: () => ({ mutate: noop, isPending: false }) },
    },
    // The app shell (Navbar/Topbar) issues its own queries.
    billing: { getSubscription: { useQuery: () => q({ plan: "starter", status: "active" }) } },
    activity: { list: { useQuery: () => q([]) } },
    settings: { getProfile: { useQuery: () => q({ timezone: "UTC" }) } },
    brand: { list: { useQuery: () => q([]) }, contacts: { useQuery: () => q([]) } },
    deals: { list: { useQuery: () => q([]) } },
  },
  TRPCProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "u1", name: "Creator", email: "creator@example.com" },
    isLoading: false,
    isAuthenticated: true,
    signIn: noop,
    signOut: noop,
  }),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/lib/use-creator-identity", () => ({
  useCreatorIdentity: () => ({ name: "Creator", avatarUrl: null, subtitle: null }),
}));

afterEach(() => cleanup());

async function renderApp() {
  render(
    <MemoryRouter initialEntries={["/payments"]}>
      <MotionProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/payments" element={<Payments />} />
          </Route>
        </Routes>
      </MotionProvider>
    </MemoryRouter>
  );
  await document.fonts.ready;
}

describe("Payments bounced-row geometry (real browser, SPO-365 review)", () => {
  it("gives the bounce reason the full row width at the 1024px floor, not a squeezed column", async () => {
    await page.viewport(1024, 900);
    await renderApp();

    const reason = screen.getByText(/undelivered to brand-contact-long-address@example-agency\.com/i);
    const reasonRect = reason.getBoundingClientRect();

    const statusHeader = screen.getByText("Status");
    const actionsHeader = screen.getByText("Actions");
    // The old placement confined the reason to the Status column
    // (col-span-2, right edge roughly at Actions' left edge). The fix's
    // full-width line must extend well past that boundary.
    const statusColumnRightEdge = statusHeader.getBoundingClientRect().right;
    expect(reasonRect.right).toBeGreaterThan(statusColumnRightEdge + 100);
    expect(reasonRect.right).toBeGreaterThanOrEqual(
      actionsHeader.getBoundingClientRect().right - 20
    );

    // And it must not force the page to scroll horizontally.
    const main = document.querySelector("main") as HTMLElement;
    expect(main.scrollWidth).toBeLessThanOrEqual(main.clientWidth + 1);
  });

  it("keeps Resume disabled with the bounce reason visible on the expanded chase panel", async () => {
    await page.viewport(1024, 900);
    await renderApp();

    fireEvent.click(screen.getByRole("button", { name: /more/i }));

    const resumeButton = screen.getByRole("button", { name: /resume/i });
    expect(resumeButton).toBeDisabled();
    expect(screen.getByText(/email bounced, so reminders would go nowhere/i)).toBeVisible();
  });
});
