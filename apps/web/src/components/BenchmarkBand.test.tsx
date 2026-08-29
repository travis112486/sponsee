// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { compute, defaultBenchmarkConfig } from "@sponsee/shared";
import { BenchmarkBand, bandPlacement } from "./BenchmarkBand.js";

// Reference benchmark for 500 CCV x 60 min ad-read, derived from the shared
// calculator rather than hardcoded so a band-unit change (SPO-93) can never
// leave this fixture quietly describing a price the product no longer quotes.
// v1 config: 500 viewer-hours at $0.60 / $1.05 / $2.00 = $300 / $525 / $1000.
const REF_500_60_ADREAD = compute(
  { ccv: 500, durationMinutes: 60, deliverableType: "ad-read" },
  defaultBenchmarkConfig
);

function fmt(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

afterEach(() => {
  cleanup();
});

describe("BenchmarkBand display", () => {
  it("renders the label", () => {
    render(
      <BenchmarkBand
        benchmark={REF_500_60_ADREAD}
        dealValueCents={25000}
        label="Test label"
      />
    );
    expect(screen.getByText("Test label")).toBeInTheDocument();
  });

  it("formats band labels as currency", () => {
    render(<BenchmarkBand benchmark={REF_500_60_ADREAD} dealValueCents={25000} />);
    expect(
      screen.getByText(`Floor ${fmt(REF_500_60_ADREAD.floor)}`)
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Mid ${fmt(REF_500_60_ADREAD.mid)}`)
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Agency ${fmt(REF_500_60_ADREAD.agency)}`)
    ).toBeInTheDocument();
  });

  it("shows actual deal value formatted", () => {
    render(<BenchmarkBand benchmark={REF_500_60_ADREAD} dealValueCents={25000} />);
    expect(screen.getByText(fmt(25000))).toBeInTheDocument();
  });
});

describe("BenchmarkBand classification using dealValueCents", () => {
  it("classifies below floor", () => {
    render(<BenchmarkBand benchmark={REF_500_60_ADREAD} dealValueCents={5000} />);
    expect(screen.getByText("Below floor")).toBeInTheDocument();
  });

  it("classifies floor–mid", () => {
    render(<BenchmarkBand benchmark={REF_500_60_ADREAD} dealValueCents={40000} />);
    expect(screen.getByText("Floor–mid")).toBeInTheDocument();
  });

  it("classifies exactly at floor as floor–mid", () => {
    render(
      <BenchmarkBand
        benchmark={REF_500_60_ADREAD}
        dealValueCents={REF_500_60_ADREAD.floor}
      />
    );
    expect(screen.getByText("Floor–mid")).toBeInTheDocument();
  });

  it("classifies mid–agency", () => {
    render(<BenchmarkBand benchmark={REF_500_60_ADREAD} dealValueCents={70000} />);
    expect(screen.getByText("Mid–agency")).toBeInTheDocument();
  });

  it("classifies exactly at mid as mid–agency", () => {
    render(
      <BenchmarkBand
        benchmark={REF_500_60_ADREAD}
        dealValueCents={REF_500_60_ADREAD.mid}
      />
    );
    expect(screen.getByText("Mid–agency")).toBeInTheDocument();
  });

  it("classifies agency+", () => {
    render(<BenchmarkBand benchmark={REF_500_60_ADREAD} dealValueCents={120000} />);
    expect(screen.getByText("Agency+")).toBeInTheDocument();
  });

  it("classifies exactly at agency as agency+", () => {
    render(
      <BenchmarkBand
        benchmark={REF_500_60_ADREAD}
        dealValueCents={REF_500_60_ADREAD.agency}
      />
    );
    expect(screen.getByText("Agency+")).toBeInTheDocument();
  });

  it("does NOT falsely classify a floor-priced deal as agency+", () => {
    // This was the original bug: a deal at the floor price was compared against
    // the wrong number and read as agency-tier.
    render(
      <BenchmarkBand
        benchmark={REF_500_60_ADREAD}
        dealValueCents={REF_500_60_ADREAD.floor}
      />
    );
    expect(screen.queryByText("Agency+")).not.toBeInTheDocument();
    expect(screen.getByText("Floor–mid")).toBeInTheDocument();
  });
});

// The Calculator screen (SPO-53) reuses this helper so its per-deal band chips
// can never drift from the band the deal form draws.
describe("bandPlacement", () => {
  // Boundaries are derived from the same reference benchmark, not hardcoded, so
  // a band-unit change (SPO-93) moves the expectations with the product instead
  // of leaving this table asserting prices we no longer quote.
  const { floor, mid, agency } = REF_500_60_ADREAD;

  it.each([
    [Math.round(floor / 3), "Below floor", true],
    [floor - 1, "Below floor", true],
    [floor, "Floor–mid", false],
    [mid - 1, "Floor–mid", false],
    [mid, "Mid–agency", false],
    [agency - 1, "Mid–agency", false],
    [agency, "Agency+", false],
    [agency + 30000, "Agency+", false],
  ])("places %i cents as %s", (valueCents, label, belowFloor) => {
    const placement = bandPlacement(valueCents as number, REF_500_60_ADREAD);
    expect(placement.label).toBe(label);
    expect(placement.belowFloor).toBe(belowFloor);
  });

  it("agrees with what the rendered band shows", () => {
    render(<BenchmarkBand benchmark={REF_500_60_ADREAD} dealValueCents={40000} />);
    expect(
      screen.getByText(bandPlacement(40000, REF_500_60_ADREAD).label)
    ).toBeInTheDocument();
  });
});
