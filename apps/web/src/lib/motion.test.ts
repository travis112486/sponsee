// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DURATION,
  EASE,
  RISE_PX,
  STAGGER,
  draw,
  entrance,
  grow,
  prefersReducedMotion,
} from "./motion";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("motion tokens", () => {
  // Pinned literals, not derived from the export: the whole point of this
  // module is that the three parity screens share ONE curve. If someone
  // "tunes" the easing, that is a design decision and should red here.
  it("pins the house easing curve", () => {
    expect(EASE).toEqual([0.22, 1, 0.36, 1]);
  });

  it("pins the duration and stagger scales", () => {
    expect(DURATION).toEqual({
      fast: 0.18,
      base: 0.22,
      entrance: 0.32,
      grow: 0.6,
      draw: 0.8,
    });
    expect(STAGGER).toEqual({ tight: 0.04, base: 0.06, loose: 0.08 });
    expect(RISE_PX).toBe(12);
  });
});

describe("entrance", () => {
  it("rises and fades in with the house curve", () => {
    expect(entrance()).toEqual({
      initial: { opacity: 0, y: 12 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.32, delay: 0, ease: EASE },
    });
  });

  it("staggers by index", () => {
    expect(entrance(0).transition.delay).toBe(0);
    expect(entrance(3).transition.delay).toBeCloseTo(0.18, 5);
    expect(entrance(3, { stagger: STAGGER.loose }).transition.delay).toBeCloseTo(0.24, 5);
  });

  it("adds a base delay on top of the stagger", () => {
    expect(entrance(2, { delay: 0.1 }).transition.delay).toBeCloseTo(0.22, 5);
  });
});

describe("draw / grow", () => {
  it("draws a path from zero length", () => {
    const d = draw(0.4);
    expect(d.initial).toEqual({ pathLength: 0 });
    expect(d.animate).toEqual({ pathLength: 1 });
    expect(d.transition).toEqual({ duration: DURATION.draw, delay: 0.4, ease: EASE });
  });

  it("grows bars from the baseline and bands from the left", () => {
    const bar = grow("y");
    expect(bar.initial).toEqual({ scaleY: 0 });
    expect(bar.style.transformOrigin).toBe("bottom");

    const band = grow("x");
    expect(band.initial).toEqual({ scaleX: 0 });
    expect(band.style.transformOrigin).toBe("left");
  });
});

describe("prefersReducedMotion", () => {
  it("is false when matchMedia is unavailable", () => {
    vi.stubGlobal("window", { ...window, matchMedia: undefined });
    expect(prefersReducedMotion()).toBe(false);
  });

  it("reads the reduce query", () => {
    const matchMedia = vi.fn(() => ({ matches: true }));
    vi.stubGlobal("window", { ...window, matchMedia });
    expect(prefersReducedMotion()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
  });
});
