// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

import { MotionProvider } from "./MotionProvider";
import { motion, draw, entrance, grow } from "@/lib/motion";

/**
 * SPO-241 moved the app off framer's `motion` and onto its `m`, whose behaviour
 * comes from the feature bundle MotionProvider loads rather than from the import
 * itself. That trade is only safe while the chosen bundle (`domAnimation`) still
 * covers every kind of animation the product uses — and "covers" fails silently:
 * an `m` element missing a feature renders its markup perfectly and simply never
 * animates. No other test in the suite asserts on animated values, so nothing
 * would notice.
 *
 * These cover the three animation shapes SPO-193's helpers produce, end to end
 * through the real provider: opacity/transform on HTML, `pathLength` on an SVG
 * path (the Sparkline), and SVG geometry (the RevenueChart bars). If someone
 * downgrades the feature bundle to shave the `motion-*` chunk, or a framer
 * upgrade repackages what `domAnimation` includes, these go red instead of the
 * animations quietly dying.
 *
 * The `without MotionProvider` case at the bottom is the control that keeps the
 * rest honest — it pins the failure mode being guarded against, so a settled-state
 * assertion can't start passing for a reason unrelated to the provider working.
 */

afterEach(cleanup);

/** Instant transitions so the settled frame is reached without faking timers. */
const INSTANT = { duration: 0 };

describe("MotionProvider", () => {
  it("animates opacity and transform on an HTML element (entrance())", async () => {
    const { getByTestId } = render(
      <MotionProvider>
        <motion.div data-testid="card" {...entrance(0)} transition={INSTANT} />
      </MotionProvider>
    );

    // entrance() runs opacity 0 -> 1 and y 12 -> 0.
    await waitFor(() => {
      expect(getByTestId("card").style.opacity).toBe("1");
    });
    expect(getByTestId("card").style.transform).not.toMatch(/translateY\(12/);
  });

  it("animates pathLength on an SVG path (draw() — the Sparkline)", async () => {
    const { getByTestId } = render(
      <MotionProvider>
        <svg>
          <motion.path
            data-testid="line"
            d="M0,0 L10,10"
            fill="none"
            {...draw(0)}
            transition={INSTANT}
          />
        </svg>
      </MotionProvider>
    );

    // framer expresses pathLength as a normalised stroke-dasharray: draw()'s
    // initial pathLength 0 renders "0 1" and the settled pathLength 1 renders
    // "1 1". Assert the settled value specifically — merely asserting a
    // dasharray *exists* passes even with the feature bundle stripped out,
    // because the unanimated initial state sets one too.
    await waitFor(() => {
      expect(getByTestId("line").getAttribute("stroke-dasharray")).toBe("1 1");
    });
  });

  it("animates SVG geometry (the RevenueChart bars)", async () => {
    const { getByTestId } = render(
      <MotionProvider>
        <svg>
          <motion.rect
            data-testid="bar"
            x={0}
            width={10}
            initial={{ y: 100, height: 0 }}
            animate={{ y: 40, height: 60 }}
            transition={INSTANT}
          />
        </svg>
      </MotionProvider>
    );

    const bar = () => getByTestId("bar");

    // `height` lands on the SVG attribute, px-suffixed.
    await waitFor(() => {
      expect(bar().getAttribute("height")).toBe("60px");
    });

    // `y`, though, does NOT: framer treats y as a transform even on an SVG
    // element, so the bar is positioned by translateY over `transform-box:
    // fill-box` rather than by the `y` attribute. Worth pinning — a reader of
    // RevenueChart reasonably expects `animate={{ y }}` to move the `y` attr,
    // and would be debugging the wrong thing when it doesn't.
    expect(bar().getAttribute("y")).toBeNull();
    expect(bar().style.transform).toContain("translateY(40px)");
  });

  it("animates scale via grow() (BenchmarkBand and progress bands)", async () => {
    const { getByTestId } = render(
      <MotionProvider>
        <motion.div data-testid="band" {...grow("x", 0)} transition={INSTANT} />
      </MotionProvider>
    );

    // grow("x") runs scaleX 0 -> 1; framer writes the settled identity as
    // `transform: none` rather than `scaleX(1)`.
    await waitFor(() => {
      expect(getByTestId("band").style.transform).toBe("none");
    });
    expect(getByTestId("band").style.transformOrigin).toBe("left");
  });

  it("leaves elements at their initial values without the provider", async () => {
    // The control. `m` outside a LazyMotion has no features, so it applies
    // `initial` and never animates — an invisible card, not a missing one. This
    // is exactly what a wrong/absent feature bundle looks like in production,
    // and it is why the assertions above are written against settled values.
    const { getByTestId } = render(
      <motion.div data-testid="card" {...entrance(0)} transition={INSTANT} />
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(getByTestId("card").style.opacity).toBe("0");
  });
});
