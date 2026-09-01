import { describe, expect, it } from "vitest";

import {
  formatAxisCents,
  formatCents,
  formatDueChip,
  formatRelativeTime,
  monthLabels,
} from "./format";

// Literals throughout, not values re-derived from the functions under test —
// a formatter test that computes its own expectation only proves the code runs.

describe("formatCents", () => {
  it("renders whole dollars", () => {
    expect(formatCents(384_700)).toBe("$3,847");
    expect(formatCents(0)).toBe("$0");
    expect(formatCents(99)).toBe("$1"); // rounds, never shows a bare cent count
  });
});

describe("formatAxisCents", () => {
  it("keeps a bare zero and compacts thousands", () => {
    expect(formatAxisCents(0)).toBe("0");
    expect(formatAxisCents(50_000)).toBe("$500");
    expect(formatAxisCents(400_000)).toBe("$4K");
    expect(formatAxisCents(150_000)).toBe("$1.5K");
  });
});

describe("monthLabels", () => {
  it("reads the key as UTC so it cannot slip a month west of Greenwich", () => {
    expect(monthLabels("2026-01")).toEqual({ short: "Jan", long: "January 2026" });
    expect(monthLabels("2026-12")).toEqual({ short: "Dec", long: "December 2026" });
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-09-15T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("walks the scale from seconds to a date", () => {
    expect(formatRelativeTime(ago(30_000), now)).toBe("just now");
    expect(formatRelativeTime(ago(4 * 60_000), now)).toBe("4m");
    expect(formatRelativeTime(ago(3 * 3_600_000), now)).toBe("3h");
    expect(formatRelativeTime(ago(2 * 86_400_000), now)).toBe("2d");
    expect(formatRelativeTime(ago(30 * 86_400_000), now)).toMatch(/Aug 16/);
  });

  it("never prints a negative age when the server clock runs ahead", () => {
    expect(formatRelativeTime(new Date(now.getTime() + 60_000), now)).toBe("just now");
  });

  it("accepts the ISO string a non-superjson payload would carry", () => {
    expect(formatRelativeTime("2026-09-15T09:00:00.000Z", now)).toBe("3h");
  });
});

describe("formatDueChip", () => {
  // Local midday, so the day-boundary maths cannot be tipped by the runner's
  // timezone offset.
  const now = new Date(2026, 8, 15, 12, 0, 0);
  const day = (n: number) => new Date(2026, 8, 15 + n, 19, 0, 0);

  it("prefers the creator's own label when they wrote one", () => {
    expect(formatDueChip(day(2), "Thu 7pm", now)).toBe("Thu 7pm");
  });

  it("names the near days and falls back to a weekday", () => {
    expect(formatDueChip(day(0), null, now)).toBe("Today");
    expect(formatDueChip(day(1), null, now)).toBe("Tomorrow");
    expect(formatDueChip(day(2), null, now)).toBe("Thu");
  });

  it("says overdue rather than naming a day already gone", () => {
    expect(formatDueChip(day(-1), null, now)).toBe("Overdue");
  });

  it("stays total when the row somehow has no date", () => {
    expect(formatDueChip(null, null, now)).toBe("No date");
  });
});
