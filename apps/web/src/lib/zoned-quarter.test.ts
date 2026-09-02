import { describe, it, expect } from "vitest";
import { startOfZonedQuarterMs } from "./zoned-quarter";

describe("startOfZonedQuarterMs", () => {
  it("returns the UTC quarter start for the UTC zone", () => {
    const now = new Date("2026-09-15T12:00:00Z");
    expect(startOfZonedQuarterMs(now, "UTC")).toBe(Date.UTC(2026, 6, 1));
  });

  it("derives the boundary from the creator's zone, not UTC", () => {
    // 2026-07-01 00:00 in Tokyo (UTC+9) is 2026-06-30T15:00:00Z, so a creator
    // reading "July 1" in Tokyo starts Q3 a full nine hours before a UTC clock
    // would — and the previous day on the civil calendar.
    const now = new Date("2026-07-01T12:00:00Z");
    expect(startOfZonedQuarterMs(now, "Asia/Tokyo")).toBe(Date.parse("2026-06-30T15:00:00Z"));
  });

  it("falls back to the UTC quarter when the zone is unparseable", () => {
    const now = new Date("2026-09-15T12:00:00Z");
    expect(startOfZonedQuarterMs(now, "Not/AZone")).toBe(Date.UTC(2026, 6, 1));
  });

  it("picks the correct quarter across the four first months", () => {
    expect(startOfZonedQuarterMs(new Date("2026-01-10T00:00:00Z"), "UTC")).toBe(
      Date.UTC(2026, 0, 1)
    );
    expect(startOfZonedQuarterMs(new Date("2026-04-10T00:00:00Z"), "UTC")).toBe(
      Date.UTC(2026, 3, 1)
    );
    expect(startOfZonedQuarterMs(new Date("2026-07-10T00:00:00Z"), "UTC")).toBe(
      Date.UTC(2026, 6, 1)
    );
    expect(startOfZonedQuarterMs(new Date("2026-10-10T00:00:00Z"), "UTC")).toBe(
      Date.UTC(2026, 9, 1)
    );
  });
});
