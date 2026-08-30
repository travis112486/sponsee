import { describe, it, expect } from "vitest";
import { compute, impliedCpvh, viewerHoursOf } from "./calculator.js";
import { defaultBenchmarkConfig } from "./benchmark.js";

/**
 * Unit pins for the CPVH bands (SPO-93, superseding the SPO-82 pins).
 *
 * The band constants are ambiguous on their face — 0.60 reads equally well as
 * "$0.60 per viewer-hour" or "0.60 cents per viewer-minute", and the two differ
 * by 100/60 = 1.667x. SPO-93 settled it: bands are **dollars per viewer-hour**,
 * matching the type name, the mockup's benchmark axis, and the rate published
 * on the marketing site.
 *
 * These tests assert the effective rate the pipeline actually charges, in
 * dollars per viewer-hour, so the reading can never drift back silently. If one
 * of these fails, do not "fix" the expectation — the formula or the constants
 * have come apart from the published band again.
 */

/** The band Sponsee publicly quotes, in dollars per viewer-hour. */
const PUBLISHED_BAND = { floor: 0.6, mid: 1.05, agency: 2.0 };

/** Effective dollars per viewer-hour that `compute()` actually charges. */
function effectiveDollarsPerViewerHour(
  priceCents: number,
  ccv: number,
  durationMinutes: number
): number {
  return priceCents / 100 / viewerHoursOf(ccv, durationMinutes);
}

describe("CpvhBands units", () => {
  const config = defaultBenchmarkConfig;

  it("ships the published band as its default config", () => {
    expect(config.cpvhBands).toEqual(PUBLISHED_BAND);
  });

  it("bills exactly the published dollars per viewer-hour for a 1.0x deliverable", () => {
    const { floor, mid, agency } = compute(
      { ccv: 500, durationMinutes: 60, deliverableType: "ad-read" },
      config
    );

    expect(effectiveDollarsPerViewerHour(floor, 500, 60)).toBeCloseTo(
      PUBLISHED_BAND.floor,
      10
    );
    expect(effectiveDollarsPerViewerHour(mid, 500, 60)).toBeCloseTo(
      PUBLISHED_BAND.mid,
      10
    );
    expect(effectiveDollarsPerViewerHour(agency, 500, 60)).toBeCloseTo(
      PUBLISHED_BAND.agency,
      10
    );
  });

  it("keeps the same per-viewer-hour rate across CCV and duration", () => {
    const cases: Array<[number, number]> = [
      [120, 30],
      [500, 60],
      [2500, 90],
      [5000, 240],
    ];

    for (const [ccv, durationMinutes] of cases) {
      const { floor } = compute(
        { ccv, durationMinutes, deliverableType: "ad-read" },
        config
      );
      expect(
        effectiveDollarsPerViewerHour(floor, ccv, durationMinutes)
      ).toBeCloseTo(PUBLISHED_BAND.floor, 8);
    }
  });

  it("treats a band as dollars per viewer-hour, not cents per viewer-minute", () => {
    // 100 CCV x 60 min = 100 viewer-hours, so the floor is 100 * $0.60 = $60.00.
    // The pre-SPO-93 formula billed 100 * 60 * 0.60 = 3600 cents ($36.00).
    // Guards the 100/60 confusion in the direction it actually failed.
    const { floor } = compute(
      { ccv: 100, durationMinutes: 60, deliverableType: "ad-read" },
      config
    );

    expect(floor).toBe(6000); // $60.00, i.e. $0.60/viewer-hour
    expect(floor).not.toBe(3600); // what "0.60 cents per viewer-minute" billed
  });

  it("scales the per-viewer-hour rate by the deliverable multiplier", () => {
    const segment = compute(
      { ccv: 500, durationMinutes: 60, deliverableType: "segment" },
      config
    );
    // segment is 1.25x, so the floor lands at 0.60 * 1.25 = $0.75/viewer-hour
    expect(effectiveDollarsPerViewerHour(segment.floor, 500, 60)).toBeCloseTo(
      0.75,
      10
    );
  });

  it("puts impliedCpvh on the same scale as the bands it is compared against", () => {
    // Round-trip: price a deal at each band, then read the rate back out.
    // This is the invariant the Calculator's band indicator depends on.
    for (const band of ["floor", "mid", "agency"] as const) {
      const quote = compute(
        { ccv: 1200, durationMinutes: 45, deliverableType: "ad-read" },
        config
      )[band];
      expect(impliedCpvh(quote, 1200, 45)).toBeCloseTo(
        PUBLISHED_BAND[band],
        6
      );
    }
  });

  it("keeps impliedCpvh inside the published axis for a realistic quote", () => {
    // A mid-band 500 CCV / 1 h ad-read reads back as $1.05 — plottable on the
    // mockup's 0 → $2.00 axis. Under the old per-viewer-minute reading this was
    // $0.0105 and pinned to the far left of the axis for every deal.
    const rate = impliedCpvh(52500, 500, 60);
    expect(rate).toBeGreaterThan(PUBLISHED_BAND.floor);
    expect(rate).toBeLessThan(PUBLISHED_BAND.agency);
  });
});
