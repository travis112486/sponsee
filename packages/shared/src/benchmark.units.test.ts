import { describe, it, expect } from "vitest";
import { compute } from "./calculator.js";
import { defaultBenchmarkConfig } from "./benchmark.js";

/**
 * Unit pins for the CPVH bands (SPO-82).
 *
 * The band constants are ambiguous on their face — 0.60 reads equally well as
 * "$0.60 per viewer-hour" or "0.60 cents per viewer-minute", and the two differ
 * by 100/60. These tests assert what the pipeline actually charges, in dollars
 * per viewer-hour, so the reading can never drift again without a test failing.
 *
 * The pinned values are today's behavior, NOT the intended band: the defaults
 * were authored as $0.60 / $1.05 / $2.00 per viewer-hour and the formula bills
 * $0.36 / $0.63 / $1.20. SPO-93 owns that discrepancy — when it lands, these
 * expectations change deliberately and in one place.
 */

/** Effective dollars per viewer-hour that `compute()` actually charges. */
function effectiveDollarsPerViewerHour(
  priceCents: number,
  ccv: number,
  durationMinutes: number
): number {
  const viewerHours = ccv * (durationMinutes / 60);
  return priceCents / 100 / viewerHours;
}

describe("CpvhBands units", () => {
  const config = defaultBenchmarkConfig;

  it("bills the documented dollars per viewer-hour for a 1.0x deliverable", () => {
    const { floor, mid, agency } = compute(
      { ccv: 500, durationMinutes: 60, deliverableType: "ad-read" },
      config
    );

    expect(effectiveDollarsPerViewerHour(floor, 500, 60)).toBeCloseTo(0.36, 10);
    expect(effectiveDollarsPerViewerHour(mid, 500, 60)).toBeCloseTo(0.63, 10);
    expect(effectiveDollarsPerViewerHour(agency, 500, 60)).toBeCloseTo(1.2, 10);
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
      ).toBeCloseTo(0.36, 8);
    }
  });

  it("treats a band as cents per viewer-minute, not dollars per viewer-hour", () => {
    // 100 CCV x 60 min = 100 viewer-hours. Under a $/viewer-hour reading the
    // floor would be 100 * $0.60 = $60.00 (6000 cents); the formula charges the
    // cents-per-viewer-minute amount instead. Guards the 100/60 confusion.
    const { floor } = compute(
      { ccv: 100, durationMinutes: 60, deliverableType: "ad-read" },
      config
    );

    expect(floor).toBe(3600); // $36.00, i.e. $0.36/viewer-hour
    expect(floor).not.toBe(6000); // what "$0.60 per viewer-hour" would bill
  });

  it("scales the per-viewer-hour rate by the deliverable multiplier", () => {
    const segment = compute(
      { ccv: 500, durationMinutes: 60, deliverableType: "segment" },
      config
    );
    // segment is 1.25x, so the floor lands at 0.36 * 1.25 = $0.45/viewer-hour
    expect(effectiveDollarsPerViewerHour(segment.floor, 500, 60)).toBeCloseTo(
      0.45,
      10
    );
  });
});
