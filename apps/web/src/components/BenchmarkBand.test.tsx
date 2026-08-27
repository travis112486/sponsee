// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { BenchmarkBand } from "./BenchmarkBand.js";

// Reference benchmark for 500 CCV × 60 min ad-read (v1 config)
const REF_500_60_ADREAD = { floor: 18000, mid: 31500, agency: 60000 };

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
    expect(screen.getByText(`Floor ${fmt(18000)}`)).toBeInTheDocument();
    expect(screen.getByText(`Mid ${fmt(31500)}`)).toBeInTheDocument();
    expect(screen.getByText(`Agency ${fmt(60000)}`)).toBeInTheDocument();
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
    render(<BenchmarkBand benchmark={REF_500_60_ADREAD} dealValueCents={20000} />);
    expect(screen.getByText("Floor–mid")).toBeInTheDocument();
  });

  it("classifies exactly at floor as floor–mid", () => {
    render(<BenchmarkBand benchmark={REF_500_60_ADREAD} dealValueCents={18000} />);
    expect(screen.getByText("Floor–mid")).toBeInTheDocument();
  });

  it("classifies mid–agency", () => {
    render(<BenchmarkBand benchmark={REF_500_60_ADREAD} dealValueCents={40000} />);
    expect(screen.getByText("Mid–agency")).toBeInTheDocument();
  });

  it("classifies exactly at mid as mid–agency", () => {
    render(<BenchmarkBand benchmark={REF_500_60_ADREAD} dealValueCents={31500} />);
    expect(screen.getByText("Mid–agency")).toBeInTheDocument();
  });

  it("classifies agency+", () => {
    render(<BenchmarkBand benchmark={REF_500_60_ADREAD} dealValueCents={70000} />);
    expect(screen.getByText("Agency+")).toBeInTheDocument();
  });

  it("classifies exactly at agency as agency+", () => {
    render(<BenchmarkBand benchmark={REF_500_60_ADREAD} dealValueCents={60000} />);
    expect(screen.getByText("Agency+")).toBeInTheDocument();
  });

  it("does NOT falsely classify a $180 deal as agency+", () => {
    // This was the original bug: dealValueCents=18000 vs agency=60000
    render(<BenchmarkBand benchmark={REF_500_60_ADREAD} dealValueCents={18000} />);
    expect(screen.queryByText("Agency+")).not.toBeInTheDocument();
    expect(screen.getByText("Floor–mid")).toBeInTheDocument();
  });
});
