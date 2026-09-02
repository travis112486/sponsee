import { describe, it, expect } from "vitest";
import {
  isValidTimeZone,
  listTimeZones,
  normalizeTimeZone,
  UTC_TIME_ZONE,
} from "./timezone.js";

describe("normalizeTimeZone", () => {
  it("accepts region/city zones", () => {
    for (const zone of [
      "America/New_York",
      "America/Los_Angeles",
      "Europe/London",
      "Australia/Sydney",
      "Pacific/Auckland",
      "America/Argentina/Buenos_Aires",
    ]) {
      expect(normalizeTimeZone(zone)).toBe(zone);
    }
  });

  it("accepts UTC even though supportedValuesOf omits it", () => {
    expect(Intl.supportedValuesOf("timeZone")).not.toContain("UTC");
    expect(normalizeTimeZone("UTC")).toBe(UTC_TIME_ZONE);
  });

  it("accepts DST-free region zones — the zone genuinely has no DST", () => {
    // Not the same failure as "EST": someone in Phoenix or Tokyo is correct to
    // be on a fixed offset, and rejecting them would be a new bug.
    expect(normalizeTimeZone("America/Phoenix")).toBe("America/Phoenix");
    expect(normalizeTimeZone("Asia/Tokyo")).toBe("Asia/Tokyo");
  });

  it("rejects the free text a creator can type today (SPO-246 failure mode 1)", () => {
    // Each of these used to save successfully and then degrade to UTC.
    for (const bad of [
      "Eastern",
      "Pacific Time",
      "GMT-5",
      "UTC-5",
      "America/New York",
      "",
      "   ",
    ]) {
      expect(normalizeTimeZone(bad)).toBeNull();
    }
  });

  it("rejects fixed-offset aliases that Intl accepts (SPO-246 failure mode 2)", () => {
    for (const alias of [
      "EST",
      "MST",
      "HST",
      "EST5EDT",
      "CST6CDT",
      "MST7MDT",
      "PST8PDT",
      "GMT",
      "Etc/GMT+5",
      "Etc/UTC",
      "CET",
      "Zulu",
    ]) {
      // Guard the premise: these are exactly the inputs plain Intl waves through.
      expect(() => new Intl.DateTimeFormat("en-US", { timeZone: alias })).not.toThrow();
      expect(normalizeTimeZone(alias)).toBeNull();
    }
  });

  it("rejecting 'EST' matters — it misfiles a New York creator's DST months", () => {
    // The concrete regression from the issue: an invoice paid at 04:30Z on
    // 1 Jul 2026 is a July payment in New York and a June payment under EST.
    const paidAt = new Date("2026-07-01T04:30:00Z");
    const monthIn = (zone: string) =>
      new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "long" }).format(paidAt);

    expect(monthIn("America/New_York")).toBe("July");
    expect(monthIn("EST")).toBe("June");
    expect(normalizeTimeZone("EST")).toBeNull();
  });

  it("trims surrounding whitespace rather than failing on it", () => {
    expect(normalizeTimeZone("  Europe/London ")).toBe("Europe/London");
    // Prove the premise: untrimmed, Intl rejects it outright.
    expect(() => new Intl.DateTimeFormat("en-US", { timeZone: "Europe/London " })).toThrow();
  });

  it("accepts region/city link names whose canonical form is supported", () => {
    // The browser's ICU and the server's ICU disagree about which of
    // Kolkata/Calcutta is canonical; both must save.
    expect(normalizeTimeZone("Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(normalizeTimeZone("Asia/Calcutta")).toBe("Asia/Calcutta");
    expect(normalizeTimeZone("US/Eastern")).toBe("US/Eastern");
  });

  it("the link escape hatch cannot readmit a fixed-offset abbreviation", () => {
    // "EST" resolves to the DST-free America/Panama on some ICU builds, which
    // *is* in the canonical set — the region/city shape requirement is what
    // keeps it out.
    const resolved = new Intl.DateTimeFormat("en-US", { timeZone: "EST" }).resolvedOptions()
      .timeZone;
    if (Intl.supportedValuesOf("timeZone").includes(resolved)) {
      // This ICU build canonicalises "EST" onto a real, DST-free region zone,
      // so a canonical-form check on its own would have let it through.
      expect(resolved).not.toBe("EST");
    }
    expect(isValidTimeZone("EST")).toBe(false);
  });
});

describe("listTimeZones", () => {
  it("leads with UTC and contains the common creator zones", () => {
    const zones = listTimeZones();
    expect(zones[0]).toBe(UTC_TIME_ZONE);
    expect(zones).toContain("America/New_York");
    expect(zones).toContain("Europe/London");
    expect(zones.length).toBeGreaterThan(100);
  });

  it("offers nothing the router would reject", () => {
    for (const zone of listTimeZones()) {
      expect(isValidTimeZone(zone), zone).toBe(true);
    }
  });
});
