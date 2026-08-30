import { describe, it, expect } from "vitest";
import { compute, impliedCpvh } from "./calculator.js";
import { defaultBenchmarkConfig } from "./benchmark.js";

describe("calculator.compute", () => {
  const config = defaultBenchmarkConfig;

  // All monetary values in the calculator are in **cents**; bands are dollars
  // per viewer-hour. 500 CCV × 60 min = 500 viewer-hours, so for ad-read (1.0×):
  //   floor = round(500 * 0.6  * 100 * 1.0) =  30000 cents = $300
  //   mid   = round(500 * 1.05 * 100 * 1.0) =  52500 cents = $525
  //   agency= round(500 * 2.0  * 100 * 1.0) = 100000 cents = $1000

  it("returns correct cents for ad-read (500 CCV, 60 min, 1.0x)", () => {
    const result = compute(
      { ccv: 500, durationMinutes: 60, deliverableType: "ad-read" },
      config
    );
    expect(result.floor).toBe(30000); // $300
    expect(result.mid).toBe(52500); // $525
    expect(result.agency).toBe(100000); // $1000
  });

  it("returns correct cents for segment (500 CCV, 60 min, 1.25x)", () => {
    const result = compute(
      { ccv: 500, durationMinutes: 60, deliverableType: "segment" },
      config
    );
    expect(result.floor).toBe(37500); // $375
    expect(result.mid).toBe(65625); // $656.25 → 65625 cents
    expect(result.agency).toBe(125000); // $1250
  });

  it("returns correct cents for vod (500 CCV, 60 min, 1.6x)", () => {
    const result = compute(
      { ccv: 500, durationMinutes: 60, deliverableType: "vod" },
      config
    );
    expect(result.floor).toBe(48000); // $480
    expect(result.mid).toBe(84000); // $840
    expect(result.agency).toBe(160000); // $1600
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
    expect(result.floor).toBe(30000);
    expect(result.mid).toBe(52500);
    expect(result.agency).toBe(100000);
  });
});

describe("calculator.impliedCpvh", () => {
  it("computes correct implied rate", () => {
    // $525 for 500 viewers * 60 minutes = 500 viewer-hours
    // $525 / 500 = $1.05 per viewer-hour — exactly the mid band
    expect(impliedCpvh(52500, 500, 60)).toBeCloseTo(1.05, 10);
  });

  it("returns 0 for invalid inputs", () => {
    expect(impliedCpvh(10000, 0, 60)).toBe(0);
    expect(impliedCpvh(10000, 500, 0)).toBe(0);
    expect(impliedCpvh(0, 500, 60)).toBe(0);
  });
});
