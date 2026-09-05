// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { DeliverableStatus } from "@sponsee/shared";
import CalendarPage from "./CalendarPage";
import { deliverableLabels } from "@/components/shared/StatusChip";
import {
  deliverableStatusColors,
  deliverableStatusDot,
} from "@/lib/deliverable-status";

// SPO-414 shipped a palette sweep that remapped `rescheduled` onto amber,
// making it byte-identical to `scheduled` in both maps below. Nothing failed:
// this page had no test at all, so an information channel could be deleted for
// free. These are the pins that make that impossible a second time.

const ALL_STATUSES: DeliverableStatus[] = [
  "not_started",
  "scheduled",
  "in_progress",
  "done",
  "missed",
  "rescheduled",
];

/* ── the maps, as data ───────────────────────────────────────────── */

describe("calendar deliverable status maps", () => {
  it("covers every DeliverableStatus the shared type allows", () => {
    // Guards the reverse direction too: a status added to @sponsee/shared and
    // not to ALL_STATUSES would leave the distinctness checks below scanning a
    // stale set while still passing.
    for (const map of [deliverableLabels, deliverableStatusColors, deliverableStatusDot]) {
      expect(Object.keys(map).sort()).toEqual([...ALL_STATUSES].sort());
    }
  });

  it("names every status in words, not only in colour", () => {
    for (const status of ALL_STATUSES) {
      expect(deliverableLabels[status], status).toBeTruthy();
    }
    expect(new Set(Object.values(deliverableLabels)).size).toBe(ALL_STATUSES.length);
  });

  it("gives every status a visually distinct chip and dot", () => {
    // The assertion SPO-414's first round would have failed: `scheduled` and
    // `rescheduled` both resolved to "bg-amber-tint text-amber border-amber/20".
    for (const [name, map] of [
      ["chip", deliverableStatusColors],
      ["dot", deliverableStatusDot],
    ] as const) {
      const treatments = ALL_STATUSES.map((s) => map[s]);
      expect(new Set(treatments).size, `${name}: ${treatments.join(" | ")}`).toBe(
        ALL_STATUSES.length
      );
    }
  });

  it("separates the two amber statuses on a non-colour channel", () => {
    // Sharing a hue is allowed — DESIGN.md budgets one accent and three signal
    // colours, which does not stretch to six statuses — but only if something
    // other than hue tells them apart, or a reader with a colour-vision
    // deficiency loses the distinction entirely (WCAG 1.4.1).
    const scheduled = deliverableStatusColors.scheduled;
    const rescheduled = deliverableStatusColors.rescheduled;
    expect(rescheduled).toContain("amber");
    expect(scheduled).toContain("amber");
    expect(rescheduled).toContain("border-dashed");
    expect(scheduled).not.toContain("border-dashed");

    // Same for the dot: solid fill vs hollow ring.
    expect(deliverableStatusDot.scheduled).toBe("bg-amber");
    expect(deliverableStatusDot.rescheduled).toContain("ring-amber");
    expect(deliverableStatusDot.rescheduled).not.toBe(deliverableStatusDot.scheduled);
  });

  it("uses no stock Tailwind hue-scale class", () => {
    // Narrow local echo of scripts/stock-palette.guard.test.ts, so a regression
    // here reds the page's own suite and not just the repo-wide guard.
    const stock = /-(?:blue|purple|violet|indigo|sky|amber|yellow|gray|slate)-\d+\b/;
    for (const map of [deliverableStatusColors, deliverableStatusDot]) {
      for (const [status, value] of Object.entries(map)) {
        expect(value, `${status}: ${value}`).not.toMatch(stock);
      }
    }
  });
});

/* ── the render ──────────────────────────────────────────────────── */

// A distinct map entry is worth nothing if the page never puts the label on
// screen. These assertions are against the DOM, not the map.

function isoDaysFromNow(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

const events = [
  {
    type: "deliverable" as const,
    id: "d-sched",
    date: isoDaysFromNow(2),
    title: "Sponsored segment",
    status: "scheduled",
    dealId: "deal-1",
    dealTitle: "Acme Q4",
  },
  {
    type: "deliverable" as const,
    id: "d-resched",
    date: isoDaysFromNow(3),
    title: "Twitter thread",
    status: "rescheduled",
    dealId: "deal-2",
    dealTitle: "Globex Launch",
  },
];

const queryResult: {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} = { data: events, isLoading: false, isError: false, refetch: vi.fn() };

vi.mock("@/trpc", () => ({
  trpc: {
    calendar: { events: { useQuery: () => queryResult } },
  },
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <CalendarPage />
    </MemoryRouter>
  );
}

afterEach(cleanup);

describe("CalendarPage renders status in words", () => {
  it("labels each upcoming deliverable with its status", () => {
    renderPage();
    const upcoming = screen.getByText("Upcoming").closest("div") as HTMLElement;

    // Before SPO-414 round 2 the sidebar row was dot + title + deal + due date,
    // and the dot was the only status channel on the entire page.
    expect(within(upcoming).getByText(/Sponsored segment/)).toBeInTheDocument();
    expect(within(upcoming).getByText("Scheduled")).toBeInTheDocument();
    expect(within(upcoming).getByText("Rescheduled")).toBeInTheDocument();
  });

  it("puts the status in each month-grid chip's accessible name", () => {
    renderPage();
    // The chip is 11px in a 7-column grid with no room for a status word, so
    // the label rides in the accessible name instead. `Rescheduled` must be
    // reachable without seeing the dashed border.
    expect(
      screen.getByRole("button", { name: /Twitter thread — Globex Launch · Rescheduled/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Sponsored segment — Acme Q4 · Scheduled/ })
    ).toBeInTheDocument();
  });

  it("legends all six statuses, not the three that were common", () => {
    renderPage();
    for (const status of ALL_STATUSES) {
      expect(
        screen.getAllByText(deliverableLabels[status]).length,
        deliverableLabels[status]
      ).toBeGreaterThan(0);
    }
  });
});
