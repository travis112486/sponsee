// Tripwire against uncommitted-design regression (SPO-71 → SPO-98), NOT a style
// spec. Each test renders one of the six approved surfaces and asserts on the
// rendered output — a semantic token (`font-serif`, `line-clamp-2`) or DOM shape —
// so a legitimate restyle (reordering utilities, tweaking a pixel value, extracting
// a shared class) does NOT red this file. A failure means approved styling silently
// left the rendered tree; it is not a license to paste the new class string back
// into the assertion. If an assertion fails only because the code changed, confirm
// with the CTO whether the design actually regressed before editing the test.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";

import { trpc } from "@/trpc";
import LoginPage from "./auth/LoginPage";
import SettingsPage from "./SettingsPage";
import Pipeline from "./Pipeline";
import Dashboard from "./Dashboard";
import Payments from "./Payments";
import CalendarPage from "./CalendarPage";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

vi.mock("@/trpc", () => ({
  trpc: {
    useUtils: () => ({}),
    dashboard: {
      overview: { useQuery: vi.fn() },
    },
    deals: {
      list: { useQuery: vi.fn() },
      cpvhSummary: { useQuery: vi.fn() },
      updateStage: { useMutation: vi.fn() },
      create: { useMutation: vi.fn() },
    },
    deliverable: {
      update: { useMutation: vi.fn() },
    },
    invoice: {
      list: { useQuery: vi.fn() },
      markPaid: { useMutation: vi.fn() },
      create: { useMutation: vi.fn() },
    },
    activity: {
      list: { useQuery: vi.fn() },
    },
    chase: {
      awaitingReview: { useQuery: vi.fn() },
      approve: { useMutation: vi.fn() },
      editAndSend: { useMutation: vi.fn() },
      state: { useQuery: vi.fn() },
      events: { useQuery: vi.fn() },
      pause: { useMutation: vi.fn() },
      resume: { useMutation: vi.fn() },
    },
    calendar: {
      events: { useQuery: vi.fn() },
    },
    brand: {
      list: { useQuery: vi.fn() },
      create: { useMutation: vi.fn() },
    },
    settings: {
      getProfile: { useQuery: vi.fn() },
      getPlatforms: { useQuery: vi.fn() },
      updateProfile: { useMutation: vi.fn() },
    },
  },
}));

const deal = {
  id: "d1",
  title: "Q4 Campaign",
  stage: "inbound",
  valueCents: 50000,
  brand: { name: "Acme" },
  platforms: ["twitch"],
  notes: null,
};

const longTitleDeal = {
  ...deal,
  id: "d2",
  title:
    "Multi-week integrated brand partnership across Twitch, YouTube, TikTok and Kick with custom overlays and community events",
};

const openInvoice = {
  id: "i1",
  number: 1,
  title: "January sponsorship",
  status: "open",
  dueAt: new Date(Date.now() - 86400000),
  issuedAt: new Date(),
  amountCents: 50000,
};

const calendarEvent = {
  type: "deliverable",
  id: "e1",
  date: new Date(),
  title: "Launch stream",
  status: "scheduled",
  dealId: "d1",
};

function mockQuery(fn: unknown, result: unknown) {
  (fn as ReturnType<typeof vi.fn>).mockReturnValue(result);
}

const idleQuery = () => ({
  data: undefined,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
});

const idleMutation = () => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  isPending: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery(trpc.deals.list.useQuery, idleQuery());
  mockQuery(trpc.invoice.list.useQuery, idleQuery());
  mockQuery(trpc.activity.list.useQuery, idleQuery());
  mockQuery(trpc.chase.awaitingReview.useQuery, idleQuery());
  mockQuery(trpc.chase.state.useQuery, idleQuery());
  mockQuery(trpc.chase.events.useQuery, idleQuery());
  mockQuery(trpc.calendar.events.useQuery, idleQuery());
  mockQuery(trpc.brand.list.useQuery, idleQuery());
  mockQuery(trpc.settings.getProfile.useQuery, idleQuery());
  mockQuery(trpc.settings.getPlatforms.useQuery, idleQuery());
  mockQuery(trpc.dashboard.overview.useQuery, idleQuery());
  mockQuery(trpc.deals.cpvhSummary.useQuery, {
    data: { effectiveCpvh: null },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  (trpc.deliverable.update.useMutation as ReturnType<typeof vi.fn>).mockReturnValue(
    idleMutation()
  );

  (trpc.deals.updateStage.useMutation as ReturnType<typeof vi.fn>).mockReturnValue(
    idleMutation()
  );
  (trpc.deals.create.useMutation as ReturnType<typeof vi.fn>).mockReturnValue(
    idleMutation()
  );
  (trpc.invoice.markPaid.useMutation as ReturnType<typeof vi.fn>).mockReturnValue(
    idleMutation()
  );
  (trpc.invoice.create.useMutation as ReturnType<typeof vi.fn>).mockReturnValue(
    idleMutation()
  );
  (trpc.chase.approve.useMutation as ReturnType<typeof vi.fn>).mockReturnValue(
    idleMutation()
  );
  (trpc.chase.editAndSend.useMutation as ReturnType<typeof vi.fn>).mockReturnValue(
    idleMutation()
  );
  (trpc.chase.pause.useMutation as ReturnType<typeof vi.fn>).mockReturnValue(
    idleMutation()
  );
  (trpc.chase.resume.useMutation as ReturnType<typeof vi.fn>).mockReturnValue(
    idleMutation()
  );
  (trpc.brand.create.useMutation as ReturnType<typeof vi.fn>).mockReturnValue(
    idleMutation()
  );
  (trpc.settings.updateProfile.useMutation as ReturnType<typeof vi.fn>).mockReturnValue(
    idleMutation()
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SPO-71 visual parity safeguards", () => {
  it("keeps the approved Login editorial heading", () => {
    render(<LoginPage />);

    const heading = screen.getByRole("heading", {
      level: 1,
      name: "Sign in to Sponsee",
    });
    expect(heading).toHaveClass("font-serif");

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send magic link" })
    ).toBeInTheDocument();
  });

  it("keeps Settings grouped in a bounded surface with responsive tabs", () => {
    // Router context needed since SettingsPage reads the OAuth-return params
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );

    const heading = screen.getByRole("heading", { level: 2, name: "Settings" });
    expect(heading).toHaveClass("font-serif");

    for (const label of [
      "Profile",
      "Platforms",
      "Payout rails",
      "Chase templates",
      "Billing",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("wraps a long Pipeline deal title across two lines instead of truncating", () => {
    mockQuery(trpc.deals.list.useQuery, {
      data: [longTitleDeal],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(
      <MemoryRouter>
        <Pipeline />
      </MemoryRouter>
    );

    const title = screen.getByText(longTitleDeal.title);
    expect(title).toHaveClass("line-clamp-2");
    expect(title).not.toHaveClass("truncate");
  });

  // DELIBERATE UPDATE (SPO-194). This previously asserted `font-serif` on a
  // hand-rolled `KpiCard <p>`. SPO-193 landed the approved mockup's shared
  // `StatCard`, whose figure is sans-serif tabular numerals, and SPO-194's
  // accepted plan builds the KPI row on it. So the old assertion described the
  // pre-foundation dashboard, not a regression away from the approved design.
  // What is worth guarding now is that the Dashboard still renders the *shared*
  // card rather than a local copy that drifts from Payments.
  it("renders Dashboard KPI figures through the shared StatCard treatment", () => {
    // `useCountUp` tweens on rAF, which jsdom never drives. Reduced motion makes
    // it snap to the target so the assertion reads the settled figure.
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    );
    mockQuery(trpc.dashboard.overview.useQuery, {
      data: {
        revenue: {
          period: "month",
          periodStart: new Date(Date.UTC(2026, 0, 1)),
          periodEnd: new Date(Date.UTC(2026, 1, 1)),
          totalCents: 0,
          byType: { flat: 0, bounty: 0, hybrid: 0 },
          monthly: [],
        },
        pipeline: [
          { stage: "inbound", count: 1, valueCents: 50000 },
          { stage: "negotiating", count: 0, valueCents: 0 },
          { stage: "contract_sent", count: 0, valueCents: 0 },
          { stage: "live", count: 0, valueCents: 0 },
          { stage: "delivered", count: 0, valueCents: 0 },
          { stage: "paid", count: 0, valueCents: 0 },
        ],
        deliverablesDue: [],
        overdue: { count: 0, totalCents: 0, mostUrgent: null },
        outstanding: { count: 0, totalCents: 0 },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    const card = screen.getByText("Active deals").closest("button")!;
    const value = within(card).getByText("1");
    // `tnum` is the token that keeps money and counts from jittering as they
    // tween; a hand-rolled replacement card would lose it.
    expect(value).toHaveClass("tnum");
    expect(value.className).not.toMatch(
      /text-(?:slate|gray|zinc|neutral|stone|red|blue|purple|green)-\d/
    );
  });

  it("renders Payments money totals at the serif scale and surfaces chase details", () => {
    mockQuery(trpc.invoice.list.useQuery, {
      data: [openInvoice],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(
      <MemoryRouter>
        <Payments />
      </MemoryRouter>
    );

    const card = screen.getByText("Total outstanding").closest("div")!;
    const value = within(card).getByText("$500");
    expect(value).toHaveClass("font-serif");

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByText("Chase sequence")).toBeInTheDocument();
  });

  it.each([
    ["loading", { isLoading: true, isError: false, data: undefined }],
    ["error", { isLoading: false, isError: true, data: undefined }],
    ["empty", { isLoading: false, isError: false, data: [] }],
    ["loaded", { isLoading: false, isError: false, data: [calendarEvent] }],
  ])(
    "uses the editorial page-title treatment in the %s Calendar state",
    (_name, result) => {
      mockQuery(trpc.calendar.events.useQuery, { ...result, refetch: vi.fn() });

      render(
        <MemoryRouter>
          <CalendarPage />
        </MemoryRouter>
      );

      const heading = screen.getByRole("heading", { level: 2, name: "Calendar" });
      expect(heading).toHaveClass("font-serif");
    }
  );
});
