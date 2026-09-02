// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import Dashboard from "./Dashboard";

/* ─────────────────────────────── Harness ──────────────────────────────── */

const navigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => navigate };
});

vi.mock("@/lib/use-creator-identity", () => ({
  useCreatorIdentity: () => ({ name: "Panda", avatarUrl: null, subtitle: "" }),
}));

const invalidate = vi.fn();
const updateDeliverable = vi.fn();

vi.mock("@/trpc", () => ({
  trpc: {
    useUtils: () => ({
      dashboard: { overview: { invalidate } },
      deals: { list: { invalidate } },
      activity: { list: { invalidate } },
    }),
    dashboard: { overview: { useQuery: vi.fn() } },
    activity: { list: { useQuery: vi.fn() } },
    deliverable: { update: { useMutation: vi.fn() } },
  },
}));

import { trpc } from "@/trpc";

const overviewQuery = trpc.dashboard.overview.useQuery as ReturnType<typeof vi.fn>;
const activityQuery = trpc.activity.list.useQuery as ReturnType<typeof vi.fn>;
const deliverableUpdate = trpc.deliverable.update.useMutation as ReturnType<typeof vi.fn>;

/**
 * `now` is fixed so the trailing-12-month buckets, the "days overdue" copy and
 * every relative timestamp are the same on every run. An absolute fixture that
 * drifts past its own boundary is a test that starts failing on a Tuesday.
 */
const NOW = new Date("2026-09-15T12:00:00.000Z");

/** Twelve buckets ending in the current month, exactly as the API emits them. */
function monthly(overrides: Record<string, Partial<Month>> = {}) {
  const out: Month[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(2026, 8 - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    out.push({
      month: key,
      valueCents: 0,
      flatCents: 0,
      bountyCents: 0,
      hybridCents: 0,
      ...overrides[key],
    });
  }
  return out;
}

type Month = {
  month: string;
  valueCents: number;
  flatCents: number;
  bountyCents: number;
  hybridCents: number;
};

const PIPELINE = [
  { stage: "inbound" as const, count: 3, valueCents: 300_00 },
  { stage: "negotiating" as const, count: 2, valueCents: 900_00 },
  { stage: "contract_sent" as const, count: 1, valueCents: 250_00 },
  { stage: "live" as const, count: 2, valueCents: 1_400_00 },
  { stage: "delivered" as const, count: 0, valueCents: 0 },
  { stage: "paid" as const, count: 4, valueCents: 5_000_00 },
];

function overview(over: Record<string, unknown> = {}) {
  return {
    // SPO-239 ships the zone every boundary below was computed in. The client
    // must label months with it rather than re-deriving them from
    // `periodStart`, which is an instant and lands in the wrong civil month
    // for every creator east of UTC.
    timeZone: "UTC",
    revenue: {
      period: "month",
      periodStart: new Date(Date.UTC(2026, 8, 1)),
      periodEnd: new Date(Date.UTC(2026, 9, 1)),
      totalCents: 3_847_00,
      byType: { flat: 2_000_00, bounty: 1_000_00, hybrid: 847_00 },
      monthly: monthly({
        "2026-08": { valueCents: 3_000_00, flatCents: 3_000_00 },
        "2026-09": {
          valueCents: 3_847_00,
          flatCents: 2_000_00,
          bountyCents: 1_000_00,
          hybridCents: 847_00,
        },
      }),
    },
    pipeline: PIPELINE,
    deliverablesDue: [
      {
        id: "del-1",
        title: "Thursday ad read",
        platform: "twitch",
        status: "scheduled",
        dueAt: new Date("2026-09-17T19:00:00.000Z"),
        dueLabel: null,
        progressDone: 1,
        progressTotal: 3,
        dealId: "deal-1",
        dealTitle: "Q4 Campaign",
        brandName: "Voltaic Energy",
      },
    ],
    overdue: {
      count: 2,
      totalCents: 2_400_00,
      mostUrgent: {
        id: "inv-1",
        number: 14,
        title: "October sponsorship",
        amountCents: 1_800_00,
        dueAt: new Date("2026-07-30T00:00:00.000Z"),
        dueAgeDays: 47,
        dealId: "deal-1",
        dealTitle: "Q4 Campaign",
        brandName: "Voltaic Energy",
        chase: {
          mode: "paused",
          nextStep: 3,
          nextActionAt: null,
          pausedReason: "awaiting PO number",
        },
      },
    },
    // Deliberately larger than `overdue.totalCents`: outstanding is every OPEN
    // invoice (late or not), and the Outstanding-card tests pin that the KPI
    // reads this figure, not the overdue subset (SPO-237).
    outstanding: {
      count: 4,
      totalCents: 5_150_00,
    },
    ...over,
  };
}

function mockOverview(data: unknown, extra: Record<string, unknown> = {}) {
  overviewQuery.mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...extra,
  });
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  // Reduced motion makes `useCountUp` snap to its target and framer skip its
  // entrance tweens, so every figure below is the settled value, not a frame
  // somewhere along the way.
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
  );
  mockOverview(overview());
  activityQuery.mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  deliverableUpdate.mockReturnValue({
    mutate: updateDeliverable,
    isPending: false,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/* ───────────────────────── The headline regression ─────────────────────── */

describe("revenue is on the screen at all (SPO-194 headline gap)", () => {
  it("shows the period's revenue as a KPI and as a chart", () => {
    renderDashboard();

    // The eyebrow sits in the card's header row, so two hops up is the card.
    const card = screen.getByText(/^Revenue \(/).parentElement!.parentElement!;
    expect(within(card).getByText("$3,847")).toBeInTheDocument();

    // The chart is the second half of the fix — a KPI alone was never the ask.
    expect(
      screen.getByRole("img", { name: /Revenue by month for the last 12 months/ })
    ).toBeInTheDocument();
  });

  it("labels the revenue card with the period it is actually reporting", () => {
    renderDashboard();
    expect(screen.getByText("Revenue (Sep)")).toBeInTheDocument();
  });

  it("compares against the previous month using the server's own buckets", () => {
    renderDashboard();
    // Aug $3,000 → Sep $3,847 is +28%.
    expect(screen.getByText("▲ 28%")).toBeInTheDocument();
    expect(screen.getByText("vs $3,000 last month")).toBeInTheDocument();
  });

  // ── Creator-local periods (SPO-239) ──────────────────────────────────────
  //
  // `periodStart` is an *instant*, not a civil date. For a creator east of UTC
  // the start of their local September is still August in UTC, so reading the
  // month back out of it in UTC names the wrong month and keys the wrong
  // bucket. The server ships `timeZone` precisely so the client never has to
  // make that inference. Tokyo is UTC+9, the widest common case.
  function tokyoOverview() {
    const o = overview({ timeZone: "Asia/Tokyo" });
    // 2026-09-01T00:00 in Tokyo === 2026-08-31T15:00Z.
    o.revenue.periodStart = new Date("2026-08-31T15:00:00.000Z");
    o.revenue.periodEnd = new Date("2026-09-30T15:00:00.000Z");
    // Distinct July and August totals: comparing against the wrong month shows
    // a wrong number rather than merely dropping the chip.
    const m = o.revenue.monthly as Month[];
    m.find((x) => x.month === "2026-07")!.valueCents = 1_000_00;
    m.find((x) => x.month === "2026-08")!.valueCents = 3_000_00;
    return o;
  }

  it("labels the revenue card in the creator's zone, not UTC", () => {
    mockOverview(tokyoOverview());
    renderDashboard();

    // Reading periodStart as UTC yields "Aug" — the month before the one the
    // card is actually reporting.
    expect(screen.getByText("Revenue (Sep)")).toBeInTheDocument();
    expect(screen.queryByText("Revenue (Aug)")).not.toBeInTheDocument();
  });

  it("picks the previous month's bucket in the creator's zone", () => {
    mockOverview(tokyoOverview());
    renderDashboard();

    // Sep $3,847 vs Aug $3,000 is +28%. A UTC-derived key reads "2026-07" and
    // would compare against July's $1,000, showing +285%.
    expect(screen.getByText("vs $3,000 last month")).toBeInTheDocument();
    expect(screen.queryByText("vs $1,000 last month")).not.toBeInTheDocument();
  });

  it("shows no delta at all when the previous period earned nothing", () => {
    const o = overview();
    (o.revenue.monthly as Month[]).find((m) => m.month === "2026-08")!.valueCents = 0;
    mockOverview(o);
    renderDashboard();

    // A percentage change from zero is undefined — it must not read "+100%".
    expect(screen.queryByText(/▲|▼/)).not.toBeInTheDocument();
    expect(
      screen.getByText("Paid invoices, dated by when the money landed")
    ).toBeInTheDocument();
  });
});

/* ─────────────────────────── Outstanding card ──────────────────────────── */

describe("Outstanding card (SPO-237, all-open total)", () => {
  it("shows the all-open total, not the overdue subset", () => {
    renderDashboard();

    const card = screen.getByText("Outstanding").closest("button")!;
    // The fixture pins overdue ($2,400) as a strict subset of outstanding
    // ($5,150); relabelling `overdue.totalCents` would fail here.
    expect(within(card).getByText("$5,150")).toBeInTheDocument();
    expect(within(card).queryByText("$2,400")).not.toBeInTheDocument();
    expect(within(card).getByText("All open invoices")).toBeInTheDocument();
  });

  it("renders a genuine zero as $0, never the empty affordance", () => {
    // The mirror-image of the CPVH null rule: `outstanding.totalCents` is
    // non-nullable in the contract, so 0 is a real balance. Any coalescing in
    // the wiring (`?? null`) would render "Not enough data yet" and fail here.
    mockOverview(overview({ outstanding: { count: 0, totalCents: 0 } }));
    renderDashboard();

    const card = screen.getByText("Outstanding").closest("button")!;
    expect(within(card).getByText("$0")).toBeInTheDocument();
    expect(within(card).queryByText("Not enough data yet")).not.toBeInTheDocument();
  });

  it("carries no delta chip — the contract has no prior-period window for it", () => {
    renderDashboard();

    const card = screen.getByText("Outstanding").closest("button")!;
    expect(card.querySelector(".rounded-full")).toBeNull();
  });

  it("keeps five cards in a 5/3/2/1 grid with CPVH spanning the 2-col row", () => {
    renderDashboard();

    const grid = screen.getByText("Outstanding").closest(".grid")!;
    for (const cls of ["sm:grid-cols-2", "lg:grid-cols-3", "xl:grid-cols-5"]) {
      expect(grid.className).toContain(cls);
    }
    // The entrance wrapper around the CPVH card carries the span that stops a
    // fifth card from wrapping into a stranded half-width orphan at 2-col.
    const cpvh = screen.getByText("Effective CPVH").closest("button")!;
    expect(cpvh.parentElement!.className).toContain("sm:col-span-2");
    expect(cpvh.parentElement!.className).toContain("lg:col-span-1");
  });
});

/* ─────────────────────────── CPVH truthfulness ─────────────────────────── */

describe("Effective CPVH card (founder-ratified null rule)", () => {
  it("renders the empty affordance and never $0.00", () => {
    renderDashboard();

    const card = screen.getByText("Effective CPVH").closest("button")!;
    expect(within(card).getByText("Not enough data yet")).toBeInTheDocument();
    expect(within(card).queryByText("$0.00")).not.toBeInTheDocument();
    expect(within(card).queryByText(/^\$0/)).not.toBeInTheDocument();
  });

  it("does not print a fabricated benchmark delta next to a value it lacks", () => {
    renderDashboard();
    const card = screen.getByText("Effective CPVH").closest("button")!;
    expect(within(card).queryByText(/midpoint/)).not.toBeInTheDocument();
  });
});

/* ───────────────────────────── Period switching ────────────────────────── */

describe("period control", () => {
  it("asks the API for the new period rather than re-slicing on the client", () => {
    renderDashboard();
    expect(overviewQuery).toHaveBeenCalledWith({ period: "month" });

    fireEvent.click(screen.getByRole("button", { name: "This quarter" }));
    expect(overviewQuery).toHaveBeenLastCalledWith({ period: "quarter" });
  });

  it("marks the active period for assistive tech, not just with colour", () => {
    renderDashboard();
    expect(screen.getByRole("button", { name: "This month" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "This quarter" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });
});

/* ───────────────────────────── Revenue chart ───────────────────────────── */

describe("revenue chart", () => {
  it("exposes the flat/bounty/hybrid split on each bar's accessible name", () => {
    renderDashboard();
    expect(
      screen.getByRole("button", {
        name: "September 2026: $3,847. Flat $2,000, Bounty $1,000, Hybrid $847",
      })
    ).toBeInTheDocument();
  });

  it("opens the split tooltip on keyboard focus, not just hover", () => {
    renderDashboard();
    const bar = screen.getByRole("button", { name: /^September 2026:/ });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.focus(bar);
    const tip = screen.getByRole("tooltip");
    expect(within(tip).getByText("Bounty")).toBeInTheDocument();
    expect(within(tip).getByText("$1,000")).toBeInTheDocument();

    fireEvent.blur(bar);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("mirrors the series into a text equivalent for non-pointer, non-focus reading", () => {
    renderDashboard();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Revenue by month, split by deal type")).toBeInTheDocument();
    const row = within(table).getByRole("row", { name: /September 2026/ });
    expect(within(row).getByText("$847")).toBeInTheDocument();
  });

  it("says there is no revenue rather than drawing twelve empty bars", () => {
    const o = overview();
    o.revenue.monthly = monthly();
    o.revenue.totalCents = 0;
    mockOverview(o);
    renderDashboard();

    expect(screen.getByText("No revenue recorded yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

/* ───────────────────────────── Overdue alert ───────────────────────────── */

describe("overdue alert", () => {
  it("names the invoice, amount, age and chase state instead of a bare count", () => {
    renderDashboard();
    const alert = screen.getByRole("region", { name: "Overdue invoice" });

    expect(alert).toHaveTextContent("$1,800");
    expect(alert).toHaveTextContent("Voltaic Energy");
    expect(alert).toHaveTextContent("47 days overdue");
    expect(alert).toHaveTextContent("Chasing is paused — awaiting PO number.");
    // The other overdue invoices are still accounted for.
    expect(alert).toHaveTextContent("$2,400");
  });

  it("offers two real destinations and invents no send path", () => {
    renderDashboard();
    const alert = screen.getByRole("region", { name: "Overdue invoice" });

    fireEvent.click(within(alert).getByRole("button", { name: /Open the deal/ }));
    expect(navigate).toHaveBeenCalledWith("/pipeline/deal-1");

    fireEvent.click(within(alert).getByRole("button", { name: "Review chase timeline" }));
    expect(navigate).toHaveBeenCalledWith("/payments");

    expect(within(alert).queryByRole("button", { name: /send/i })).not.toBeInTheDocument();
  });

  it("is absent when nothing is overdue", () => {
    mockOverview(overview({ overdue: { count: 0, totalCents: 0, mostUrgent: null } }));
    renderDashboard();
    expect(screen.queryByRole("region", { name: "Overdue invoice" })).not.toBeInTheDocument();
  });
});

/* ────────────────────────── Deliverables checklist ─────────────────────── */

describe("deliverables due this week", () => {
  it("renders the row with platform, brand, progress and a due chip", () => {
    renderDashboard();

    expect(screen.getByText("Thursday ad read")).toBeInTheDocument();
    expect(screen.getByText("(1/3 done)")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Twitch" })).toBeInTheDocument();
    expect(screen.getByText("Voltaic Energy")).toBeInTheDocument();
    // Due Thu 17 Sep, rendered on Tue 15 Sep.
    expect(screen.getByText("Thu")).toBeInTheDocument();
  });

  it("checks a deliverable off through the existing mutation", () => {
    renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Mark Thursday ad read done" }));
    expect(updateDeliverable).toHaveBeenCalledWith({ id: "del-1", status: "done" });
  });

  it("marks the control busy while the write is in flight", () => {
    renderDashboard();
    const box = screen.getByRole("button", { name: "Mark Thursday ad read done" });
    fireEvent.click(box);
    expect(box).toHaveAttribute("aria-busy", "true");
    expect(box).toBeDisabled();
  });

  it("keeps the module visible with a scoped next action when nothing is due", () => {
    mockOverview(overview({ deliverablesDue: [] }));
    renderDashboard();

    expect(screen.getByText("Deliverables due this week")).toBeInTheDocument();
    expect(screen.getByText("Nothing due this week")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open full calendar/ })).toBeInTheDocument();
  });
});

/* ─────────────────────────── Pipeline snapshot ─────────────────────────── */

describe("pipeline snapshot", () => {
  it("shows a value per stage, not just a count", () => {
    renderDashboard();
    expect(screen.getByText("$900")).toBeInTheDocument();
    expect(screen.getByText("$1,400")).toBeInTheDocument();
  });

  it("excludes paid deals from total pipeline — that money is not in flight", () => {
    renderDashboard();
    // 300 + 900 + 250 + 1400 + 0 = 2,850, with the $5,000 paid column left out.
    const total = screen.getByText("Total pipeline").closest("span")!;
    expect(within(total).getByText("$2,850")).toBeInTheDocument();
  });

  it("offers a first action instead of six empty bars on a new account", () => {
    mockOverview(
      overview({
        pipeline: PIPELINE.map((s) => ({ ...s, count: 0, valueCents: 0 })),
      })
    );
    renderDashboard();
    expect(screen.getByText("No deals yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Log your first deal" }));
    expect(navigate).toHaveBeenCalledWith("/pipeline?new=1");
  });
});

/* ───────────────────────────── Recent activity ─────────────────────────── */

describe("recent activity", () => {
  const kinds = ["invoice", "contract", "deliverable", "payment", "inquiry"] as const;
  const events = kinds.map((kind, i) => ({
    id: `a${i}`,
    kind,
    actor: "system",
    payload: { status: "sent", step: i + 1 },
    createdAt: new Date(NOW.getTime() - (i + 1) * 60 * 60 * 1000),
  }));

  it("gives each activity kind its own icon rather than one generic mark", () => {
    activityQuery.mockReturnValue({
      data: events,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    const { container } = renderDashboard();

    const feed = container.querySelector("ul.divide-y")!;
    const icons = [...feed.querySelectorAll("li > span > svg")].map((s) => s.outerHTML);
    expect(icons).toHaveLength(kinds.length);
    // The shipped feed drew the same Mail icon for all nine kinds.
    expect(new Set(icons).size).toBe(kinds.length);
  });

  it("uses relative time, with the exact timestamp still reachable", () => {
    activityQuery.mockReturnValue({
      data: [events[0]],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderDashboard();

    const time = screen.getByText("1h");
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("dateTime", events[0].createdAt.toISOString());
    expect(time).toHaveAttribute("title");
    expect(time.getAttribute("title")).not.toBe("");
  });

  it("fails on its own without taking the rest of the page down", () => {
    activityQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    });
    renderDashboard();

    expect(screen.getByText("Couldn't load recent activity.")).toBeInTheDocument();
    // Revenue — the thing this page exists for — is still on screen.
    expect(screen.getAllByText("$3,847").length).toBeGreaterThan(0);
  });
});

/* ─────────────────────── Page-level loading and error ──────────────────── */

describe("page states", () => {
  it("shows module-shaped skeletons rather than one page spinner", () => {
    mockOverview(undefined, { isLoading: true });
    renderDashboard();

    const region = screen.getByLabelText("Loading your dashboard");
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(region.querySelectorAll(".animate-pulse").length).toBeGreaterThan(5);
  });

  it("mirrors the loaded row's CPVH span in the KPI skeleton so settling doesn't reflow", () => {
    mockOverview(undefined, { isLoading: true });
    renderDashboard();

    const region = screen.getByLabelText("Loading your dashboard");
    const grid = region.querySelector('[class*="xl:grid-cols-5"]')!;
    const tiles = Array.from(grid.children);
    expect(tiles).toHaveLength(5);
    tiles.forEach((tile, i) => {
      // Only the last tile spans at 2-col, exactly like the loaded CPVH card.
      expect(tile.className.includes("sm:col-span-2")).toBe(i === 4);
      expect(tile.className.includes("lg:col-span-1")).toBe(i === 4);
    });
  });

  it("offers a retry when the overview query fails", () => {
    const refetch = vi.fn();
    overviewQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });
    renderDashboard();

    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(refetch).toHaveBeenCalled();
  });
});

/* ──────────────────────────── Greeting header ──────────────────────────── */

describe("greeting", () => {
  it("greets the signed-in creator by name and states what is actually due", () => {
    renderDashboard();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/Panda/);
    expect(screen.getByText(/1 deliverable due this week/)).toBeInTheDocument();
    expect(screen.getByText(/\$2,400 overdue/)).toBeInTheDocument();
  });

  it("routes the primary CTA into the existing new-deal flow", () => {
    renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: /Log a deal/ }));
    expect(navigate).toHaveBeenCalledWith("/pipeline?new=1");
  });
});
