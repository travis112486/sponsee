// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatCount, useCountUp } from "./useCountUp";

// Deterministic rAF driver — the hook's whole behaviour lives in the frame loop,
// so real timers would make these tests both slow and flaky.
let frames: Array<(t: number) => void> = [];
let now = 0;

function tick(ms: number) {
  now += ms;
  const due = frames;
  frames = [];
  act(() => {
    due.forEach((cb) => cb(now));
  });
}

function Probe({ target, duration }: { target: number; duration?: number }) {
  const value = useCountUp(target, duration);
  return <span data-testid="v">{value.toFixed(2)}</span>;
}

const read = () => Number(screen.getByTestId("v").textContent);

beforeEach(() => {
  frames = [];
  now = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false }))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useCountUp", () => {
  it("starts at zero and settles exactly on the target", () => {
    render(<Probe target={100} duration={100} />);
    expect(read()).toBe(0);

    tick(0);
    expect(read()).toBe(0);

    tick(50);
    expect(read()).toBeGreaterThan(0);
    expect(read()).toBeLessThan(100);

    tick(50);
    expect(read()).toBe(100);
  });

  it("tweens from the value already on screen when the target moves", () => {
    // The mockup restarted every tween from 0. With live tRPC data a refetch
    // would slam the card back to zero and re-run the whole count. Guard: the
    // first frame after a target change must not drop below what was displayed.
    const { rerender } = render(<Probe target={100} duration={100} />);
    tick(0);
    tick(100);
    expect(read()).toBe(100);

    rerender(<Probe target={200} duration={100} />);
    tick(0);
    expect(read()).toBe(100);
    tick(1);
    expect(read()).toBeGreaterThanOrEqual(100);
    expect(read()).toBeLessThan(120); // still near the start of the new tween
  });

  it("snaps straight to the target under prefers-reduced-motion", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true }))
    );
    render(<Probe target={4200} duration={100} />);
    expect(read()).toBe(4200);
    expect(frames).toHaveLength(0);
  });

  it("does not schedule a frame when the target is already displayed", () => {
    render(<Probe target={0} duration={100} />);
    expect(read()).toBe(0);
    expect(frames).toHaveLength(0);
  });
});

describe("formatCount", () => {
  it("groups thousands and rounds to whole units by default", () => {
    expect(formatCount(12499.7)).toBe("12,500");
  });

  it("prefixes a dollar sign without dividing", () => {
    expect(formatCount(12400, { currency: true })).toBe("$12,400");
  });

  it("honours a decimal count", () => {
    expect(formatCount(3.14159, { decimals: 2 })).toBe("3.14");
    expect(formatCount(1234.5, { currency: true, decimals: 2 })).toBe("$1,234.50");
  });
});
