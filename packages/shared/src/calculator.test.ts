import { describe, it, expect } from "vitest";
import { compute, impliedCpvh } from "./calculator.js";
import { defaultBenchmarkConfig } from "./benchmark.js";

describe("calculator.compute", () => {
  const config = defaultBenchmarkConfig;

  // All monetary values in the calculator are in **cents**.
  // For 500 CCV × 60 min, ad-read (1.0×):
  //   floor = round(500 * 60 * 0.6  * 1.0) = 18000 cents = $180
  //   mid   = round(500 * 60 * 1.05 * 1.0) = 31500 cents = $315
  //   agency= round(500 * 60 * 2.0  * 1.0) = 60000 cents = $600

  it("returns correct cents for ad-read (500 CCV, 60 min, 1.0x)", () => {
    const result = compute(
      { ccv: 500, durationMinutes: 60, deliverableType: "ad-read" },
      config
    );
    expect(result.floor).toBe(18000); // $180
    expect(result.mid).toBe(31500); // $315
    expect(result.agency).toBe(60000); // $600
  });

  it("returns correct cents for segment (500 CCV, 60 min, 1.25x)", () => {
    const result = compute(
      { ccv: 500, durationMinutes: 60, deliverableType: "segment" },
      config
    );
    expect(result.floor).toBe(22500); // $225
    expect(result.mid).toBe(39375); // $393.75 → 39375 cents
    expect(result.agency).toBe(75000); // $750
  });

  it("returns correct cents for vod (500 CCV, 60 min, 1.6x)", () => {
    const result = compute(
      { ccv: 500, durationMinutes: 60, deliverableType: "vod" },
      config
    );
    expect(result.floor).toBe(28800); // $288
    expect(result.mid).toBe(50400); // $504
    expect(result.agency).toBe(96000); // $960
  });

  it("returns zero for non-positive inputs", () => {
    expect(
      compute({ ccv: 0, durationMinutes: 60, deliverableType: "ad-read" }, config)
    ).toEqual({ floor: 0, mid: 0, agency: 0 });
    expect(
      compute({ ccv: 500, durationMinutes: 0, deliverableType: "ad-read" }, config)
    ).toEqual({ floor: 0, mid: 0, agency: 0 });
    expect(
      compute(
        { ccv: -100, durationMinutes: 60, deliverableType: "ad-read" },
        config
      )
    ).toEqual({ floor: 0, mid: 0, agency: 0 });
  });

  it("scales linearly with CCV", () => {
    const base = compute(
      { ccv: 500, durationMinutes: 60, deliverableType: "ad-read" },
      config
    );
    const doubled = compute(
      { ccv: 1000, durationMinutes: 60, deliverableType: "ad-read" },
      config
    );
    expect(doubled.floor).toBe(base.floor * 2);
    expect(doubled.mid).toBe(base.mid * 2);
    expect(doubled.agency).toBe(base.agency * 2);
  });

  it("scales linearly with duration", () => {
    const base = compute(
      { ccv: 500, durationMinutes: 60, deliverableType: "ad-read" },
      config
    );
    const doubled = compute(
      { ccv: 500, durationMinutes: 120, deliverableType: "ad-read" },
      config
    );
    expect(doubled.floor).toBe(base.floor * 2);
    expect(doubled.mid).toBe(base.mid * 2);
    expect(doubled.agency).toBe(base.agency * 2);
  });

  it("applies platform-mix adjustment when provided", () => {
    const adjustedConfig = {
      ...config,
      platformMixAdjustments: { twitch: 1.2, youtube: 0.9 },
    };
    const twitchOnly = compute(
      {
        ccv: 500,
        durationMinutes: 60,
        deliverableType: "ad-read",
        platforms: ["twitch"],
      },
      adjustedConfig
    );
    const base = compute(
      { ccv: 500, durationMinutes: 60, deliverableType: "ad-read" },
      config
    );
    expect(twitchOnly.floor).toBe(Math.round(base.floor * 1.2));
  });

  it("falls back to multiplier 1.0 for unknown deliverable type", () => {
    const result = compute(
      // @ts-expect-error testing unknown type
      { ccv: 500, durationMinutes: 60, deliverableType: "unknown" },
      config
    );
    expect(result.floor).toBe(18000);
    expect(result.mid).toBe(31500);
    expect(result.agency).toBe(60000);
  });
});

describe("calculator.impliedCpvh", () => {
  it("computes correct implied rate", () => {
    // $315 for 500 viewers * 60 minutes = 30,000 viewer-minutes
    // $315 / 30,000 = $0.0105 per viewer-minute
    expect(impliedCpvh(31500, 500, 60)).toBeCloseTo(0.0105, 4);
  });

  it("returns 0 for invalid inputs", () => {
    expect(impliedCpvh(10000, 0, 60)).toBe(0);
    expect(impliedCpvh(10000, 500, 0)).toBe(0);
    expect(impliedCpvh(0, 500, 60)).toBe(0);
  });
});
