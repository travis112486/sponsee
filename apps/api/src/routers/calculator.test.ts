import { describe, it, expect, vi, beforeEach } from "vitest";
import { calculatorRouter } from "./calculator.js";
import { defaultBenchmarkConfig } from "@sponsee/shared";

// ── Module mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
}));

vi.mock("@sponsee/db", () => ({
  db: {
    select: mocks.select,
  },
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function mockDbRows(rows: any[]) {
  mocks.select.mockReturnValue({
    from: vi.fn(() => ({
      orderBy: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve(rows)),
      })),
    })),
  });
}

function mockCtx() {
  return {
    session: null,
    creatorId: null,
    db: {},
  };
}

// ── calculator.compute router tests ─────────────────────────────────────────

describe("calculatorRouter.compute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to defaultBenchmarkConfig when DB has no configs", async () => {
    mockDbRows([]);
    const caller = calculatorRouter.createCaller(mockCtx());

    const result = await caller.compute({
      ccv: 500,
      durationMinutes: 60,
      deliverableType: "ad-read",
    });

    expect(result.floor).toBe(18000);
    expect(result.mid).toBe(31500);
    expect(result.agency).toBe(60000);
  });

  it("falls back to defaultBenchmarkConfig when DB config fails validation", async () => {
    mockDbRows([
      {
        version: 1,
        effectiveDate: new Date("2024-01-01"),
        cpvhBands: { floor: "not-a-number", mid: 1.05, agency: 2.0 },
        adjustments: null,
      },
    ]);

    const caller = calculatorRouter.createCaller(mockCtx());
    const result = await caller.compute({
      ccv: 500,
      durationMinutes: 60,
      deliverableType: "ad-read",
    });

    expect(result.floor).toBe(18000);
    expect(result.mid).toBe(31500);
    expect(result.agency).toBe(60000);
  });

  it("uses the latest valid DB config when present", async () => {
    mockDbRows([
      {
        version: 2,
        effectiveDate: new Date("2025-06-01"),
        cpvhBands: { floor: 0.8, mid: 1.4, agency: 2.5 },
        adjustments: {
          deliverableMultipliers: {
            "ad-read": 1.0,
            segment: 1.25,
            vod: 1.6,
          },
          platformMix: {
            twitch: 1.0,
            youtube: 1.0,
            kick: 1.0,
            tiktok: 1.0,
          },
        },
      },
    ]);

    const caller = calculatorRouter.createCaller(mockCtx());
    const result = await caller.compute({
      ccv: 500,
      durationMinutes: 60,
      deliverableType: "ad-read",
    });

    // With v2 bands: floor=0.8, mid=1.4, agency=2.5
    // 500 * 60 * 0.8 = 24000 cents
    expect(result.floor).toBe(24000);
    expect(result.mid).toBe(42000);
    expect(result.agency).toBe(75000);
  });

  it("applies platform-mix adjustments from DB config", async () => {
    mockDbRows([
      {
        version: 1,
        effectiveDate: new Date("2024-01-01"),
        cpvhBands: { floor: 0.6, mid: 1.05, agency: 2.0 },
        adjustments: {
          deliverableMultipliers: {
            "ad-read": 1.0,
            segment: 1.25,
            vod: 1.6,
          },
          platformMix: {
            twitch: 1.2,
            youtube: 1.0,
          },
        },
      },
    ]);

    const caller = calculatorRouter.createCaller(mockCtx());
    const result = await caller.compute({
      ccv: 500,
      durationMinutes: 60,
      deliverableType: "ad-read",
      platforms: ["twitch"],
    });

    // 500 * 60 * 0.6 * 1.2 = 21600 cents
    expect(result.floor).toBe(21600);
  });

  it("round-trips seed config version and bands correctly", async () => {
    // This test verifies that the default seed config (v1) produces
    // the expected reference outputs for 500 CCV × 60 min ad-read.
    mockDbRows([
      {
        version: defaultBenchmarkConfig.version,
        effectiveDate: new Date(defaultBenchmarkConfig.effectiveDate),
        cpvhBands: defaultBenchmarkConfig.cpvhBands,
        adjustments: {
          deliverableMultipliers: defaultBenchmarkConfig.deliverableMultipliers,
          platformMix: defaultBenchmarkConfig.platformMixAdjustments,
        },
      },
    ]);

    const caller = calculatorRouter.createCaller(mockCtx());
    const result = await caller.compute({
      ccv: 500,
      durationMinutes: 60,
      deliverableType: "ad-read",
    });

    // Reference values from SPO-31: 180/315/600 as dollars = 18000/31500/60000 cents
    expect(result.floor).toBe(18000);
    expect(result.mid).toBe(31500);
    expect(result.agency).toBe(60000);
  });
});
