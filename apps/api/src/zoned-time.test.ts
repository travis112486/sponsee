import { describe, it, expect } from "vitest";
import {
  addZonedDays,
  addZonedMonths,
  formatMonthKey,
  getZonedParts,
  isValidTimeZone,
  resolveTimeZone,
  startOfZonedDay,
  startOfZonedMonth,
  startOfZonedQuarter,
  startOfZonedWeek,
  startOfZonedYear,
  zonedMonthKey,
  zonedWallClockToUtc,
} from "./zoned-time.js";

const NY = "America/New_York";
const SYDNEY = "Australia/Sydney";
const KATHMANDU = "Asia/Kathmandu"; // UTC+05:45, no DST — catches offsets assumed whole-hour

describe("getZonedParts", () => {
  it("reads the local civil clock, not the UTC one", () => {
    expect(getZonedParts(new Date("2026-03-01T01:30:00Z"), NY)).toEqual({
      year: 2026,
      month: 2,
      day: 28,
      hour: 20,
      minute: 30,
      second: 0,
    });
  });

  it("reports midnight as hour 0, never hour 24", () => {
    expect(getZonedParts(new Date("2026-03-01T05:00:00Z"), NY).hour).toBe(0);
  });

  it("handles a sub-hour offset", () => {
    const p = getZonedParts(new Date("2026-03-01T00:00:00Z"), KATHMANDU);
    expect({ month: p.month, day: p.day, hour: p.hour, minute: p.minute }).toEqual({
      month: 3,
      day: 1,
      hour: 5,
      minute: 45,
    });
  });
});

describe("zonedWallClockToUtc", () => {
  it("round-trips a wall clock through the instant it names", () => {
    for (const [tz, iso] of [
      [NY, "2026-07-04T12:34:56Z"],
      [SYDNEY, "2026-07-04T12:34:56Z"],
      [KATHMANDU, "2026-11-22T03:00:00Z"],
      ["UTC", "2026-01-01T00:00:00Z"],
    ] as const) {
      const parts = getZonedParts(new Date(iso), tz);
      expect(zonedWallClockToUtc(parts, tz)).toEqual(new Date(iso));
    }
  });

  it("resolves a wall clock skipped by spring-forward to the first instant after the gap", () => {
    // 2026-03-08 02:30 does not exist in New York; the clock jumps 02:00 → 03:00.
    const resolved = zonedWallClockToUtc(
      { year: 2026, month: 3, day: 8, hour: 2, minute: 30 },
      NY
    );
    expect(resolved.toISOString()).toBe("2026-03-08T07:30:00.000Z");
    expect(getZonedParts(resolved, NY).hour).toBe(3);
  });

  it("resolves an ambiguous fall-back wall clock to the earlier instant", () => {
    // 2026-11-01 01:30 happens twice in New York: 05:30Z (EDT) then 06:30Z (EST).
    expect(
      zonedWallClockToUtc({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, NY).toISOString()
    ).toBe("2026-11-01T05:30:00.000Z");
  });
});

describe("start-of-period helpers", () => {
  it("anchors the day/month/quarter/year to local midnight", () => {
    const mar18 = new Date("2026-03-18T12:00:00Z");
    expect(startOfZonedDay(mar18, NY).toISOString()).toBe("2026-03-18T04:00:00.000Z");
    expect(startOfZonedMonth(mar18, NY).toISOString()).toBe("2026-03-01T05:00:00.000Z");
    expect(startOfZonedQuarter(mar18, NY).toISOString()).toBe("2026-01-01T05:00:00.000Z");
    expect(startOfZonedYear(mar18, NY).toISOString()).toBe("2026-01-01T05:00:00.000Z");
  });

  it("uses the offset at the boundary, not the offset at the input instant", () => {
    // March 18 is EDT (UTC-4) but March 1 is still EST (UTC-5). Reusing the
    // input's offset would put the month start an hour early.
    expect(startOfZonedMonth(new Date("2026-03-18T12:00:00Z"), NY).toISOString()).toBe(
      "2026-03-01T05:00:00.000Z"
    );
    // Symmetrically, from inside EST looking at a quarter that ends in EDT.
    expect(startOfZonedQuarter(new Date("2026-02-10T12:00:00Z"), NY).toISOString()).toBe(
      "2026-01-01T05:00:00.000Z"
    );
  });

  it("crosses a year boundary correctly for a zone ahead of UTC", () => {
    expect(startOfZonedYear(new Date("2026-03-18T12:00:00Z"), SYDNEY).toISOString()).toBe(
      "2025-12-31T13:00:00.000Z"
    );
  });

  it("uses the local instant even when the local date differs from the UTC date", () => {
    // 2026-03-01T01:30Z is Feb 28 in New York, so its month starts Feb 1.
    expect(startOfZonedMonth(new Date("2026-03-01T01:30:00Z"), NY).toISOString()).toBe(
      "2026-02-01T05:00:00.000Z"
    );
  });
});

describe("startOfZonedWeek", () => {
  it("anchors to Monday 00:00 local", () => {
    // Wed 2026-03-18 08:00 ET → Mon 2026-03-16 00:00 ET.
    expect(startOfZonedWeek(new Date("2026-03-18T12:00:00Z"), NY).toISOString()).toBe(
      "2026-03-16T04:00:00.000Z"
    );
  });

  it("treats a Sunday-evening-local instant as the end of the current week, not the next", () => {
    // 2026-03-23T00:00Z is Sun Mar 22, 8pm ET. UTC would call it Monday.
    expect(startOfZonedWeek(new Date("2026-03-23T00:00:00Z"), NY).toISOString()).toBe(
      "2026-03-16T04:00:00.000Z"
    );
  });

  it("keeps the week 7 calendar days wide across a DST transition", () => {
    const start = startOfZonedWeek(new Date("2026-03-04T12:00:00Z"), NY);
    const end = addZonedDays(start, 7, NY);
    expect(start.toISOString()).toBe("2026-03-02T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-09T04:00:00.000Z");
    // 167 hours, not 168 — the hour the US skipped on Mar 8.
    expect(end.getTime() - start.getTime()).toBe(167 * 60 * 60 * 1000);
  });

  it("gains an hour across a fall-back week", () => {
    const start = startOfZonedWeek(new Date("2026-10-28T12:00:00Z"), NY);
    const end = addZonedDays(start, 7, NY);
    expect(end.getTime() - start.getTime()).toBe(169 * 60 * 60 * 1000);
  });
});

describe("addZonedMonths", () => {
  it("closes a month at the next month's local midnight", () => {
    const marStart = startOfZonedMonth(new Date("2026-03-18T12:00:00Z"), NY);
    expect(addZonedMonths(marStart, 1, NY).toISOString()).toBe("2026-04-01T04:00:00.000Z");
    expect(addZonedMonths(marStart, -11, NY).toISOString()).toBe("2025-04-01T04:00:00.000Z");
  });

  it("crosses the year boundary in both directions", () => {
    const janStart = startOfZonedMonth(new Date("2026-01-15T12:00:00Z"), NY);
    expect(addZonedMonths(janStart, -1, NY).toISOString()).toBe("2025-12-01T05:00:00.000Z");
    expect(addZonedMonths(janStart, 12, NY).toISOString()).toBe("2027-01-01T05:00:00.000Z");
  });
});

describe("month keys", () => {
  it("keys by the local calendar month", () => {
    expect(zonedMonthKey(new Date("2026-03-01T01:30:00Z"), NY)).toBe("2026-02");
    expect(zonedMonthKey(new Date("2026-03-01T01:30:00Z"), "UTC")).toBe("2026-03");
    expect(zonedMonthKey(new Date("2025-12-31T14:30:00Z"), SYDNEY)).toBe("2026-01");
  });

  it("normalizes month overflow and underflow", () => {
    expect(formatMonthKey(2026, 0)).toBe("2025-12");
    expect(formatMonthKey(2026, -10)).toBe("2025-02");
    expect(formatMonthKey(2026, 13)).toBe("2027-01");
  });
});

describe("resolveTimeZone", () => {
  it("passes a valid zone through", () => {
    expect(resolveTimeZone(NY)).toBe(NY);
    expect(isValidTimeZone(NY)).toBe(true);
  });

  it("falls back to UTC for a missing or unusable zone", () => {
    expect(resolveTimeZone(null)).toBe("UTC");
    expect(resolveTimeZone("")).toBe("UTC");
    expect(resolveTimeZone("Not/AZone")).toBe("UTC");
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });
});
