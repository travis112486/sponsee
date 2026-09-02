// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { compute, defaultBenchmarkConfig } from "@sponsee/shared";
import Calculator from "./Calculator";

// The Radix Slider/Tooltip primitives call pointer-capture and layout APIs
// jsdom doesn't implement (SPO-193's own primitives.test.tsx stubs the same
// set for the same reason).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  // `useCountUp` only reaches its target via requestAnimationFrame, which
  // jsdom never flushes synchronously. Forcing prefers-reduced-motion snaps
  // it straight to the target so assertions on rendered figures stay
  // deterministic — the tween itself is covered by useCountUp.test.tsx.
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true }))
  );
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/trpc", () => ({
  trpc: {
    calculator: {
      compute: { useQuery: vi.fn() },
      profile: {
        get: { useQuery: vi.fn() },
        save: { useMutation: vi.fn() },
      },
    },
    settings: { getPlatforms: { useQuery: vi.fn() } },
    deals: { list: { useQuery: vi.fn() } },
  },
}));

import { trpc } from "@/trpc";

const computeQuery = trpc.calculator.compute.useQuery as ReturnType<typeof vi.fn>;
const profileGet = trpc.calculator.profile.get.useQuery as ReturnType<typeof vi.fn>;
const profileSave = trpc.calculator.profile.save.useMutation as ReturnType<typeof vi.fn>;
const getPlatforms = trpc.settings.getPlatforms.useQuery as ReturnType<typeof vi.fn>;
const dealsList = trpc.deals.list.useQuery as ReturnType<typeof vi.fn>;

/**
 * The stub the mocked `calculator.compute` query returns. Derived from the real
 * shared calculator at the page's own default inputs (500 CCV × 2h ad-read)
 * rather than hardcoded, so a band-unit change (SPO-93) can never leave this
 * suite green while asserting against a price the product no longer quotes.
 * v1 config: 1000 viewer-hours at $0.60 / $1.05 / $2.00 = $600 / $1,050 / $2,000.
 */
const CALCULATOR_DEFAULTS = {
  ccv: 500,
  durationMinutes: 120,
  deliverableType: "ad-read" as const,
};
const benchmark = compute(CALCULATOR_DEFAULTS, defaultBenchmarkConfig);

/** Same formatting the page uses, so expectations track the rendered string. */
function fmt(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

const mutate = vi.fn();

beforeEach(() => {
  computeQuery.mockReturnValue({
    data: benchmark,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  profileGet.mockReturnValue({ data: null, isLoading: false, isError: false });
  profileSave.mockReturnValue({ mutate, isPending: false });
  getPlatforms.mockReturnValue({ data: [], isLoading: false, isError: false });
  dealsList.mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Calculator pricing source", () => {
  it("prices from calculator.compute rather than local math", () => {
    render(<Calculator />);

    // Headline is the server-computed midpoint, not a locally derived number.
    expect(screen.getByRole("status")).toHaveTextContent(fmt(benchmark.mid));
    expect(screen.getByText(fmt(benchmark.floor))).toBeInTheDocument();
    expect(screen.getByText(fmt(benchmark.agency))).toBeInTheDocument();
  });

  it("sends duration to the shared endpoint in minutes, not hours", () => {
    render(<Calculator />);

    // Defaults are 500 CCV × 2h.
    expect(computeQuery).toHaveBeenCalledWith(
      expect.objectContaining({ ccv: 500, durationMinutes: 120, deliverableType: "ad-read" })
    );
  });

  it("passes selected platforms through so shared mix adjustments apply", () => {
    render(<Calculator />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Twitch" }));

    expect(computeQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ platforms: ["twitch"] })
    );
  });

  it("omits the platforms key entirely when none are selected", () => {
    render(<Calculator />);

    expect(computeQuery).toHaveBeenCalledWith(
      expect.objectContaining({ platforms: undefined })
    );
  });

  it("recomputes when sponsored hours change", () => {
    render(<Calculator />);

    fireEvent.click(screen.getByRole("button", { name: "Increase sponsored hours" }));

    expect(computeQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ durationMinutes: 150 })
    );
  });
});

describe("Calculator quote", () => {
  it("lets the creator override the quote and reset it back to the midpoint", () => {
    render(<Calculator />);

    const midDollars = benchmark.mid / 100;
    const quote = screen.getByLabelText("Your quote");
    expect(quote).toHaveValue(midDollars);

    fireEvent.change(quote, { target: { value: "450" } });
    expect(screen.getByRole("status")).toHaveTextContent("$450");

    fireEvent.click(screen.getByRole("button", { name: "Reset to midpoint" }));
    expect(screen.getByLabelText("Your quote")).toHaveValue(midDollars);
  });

  it("persists a saved scenario through calculator.profile.save", () => {
    render(<Calculator />);

    fireEvent.click(screen.getByRole("button", { name: /Save scenario/ }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const saved = mutate.mock.calls[0][0].inputs;
    expect(saved.scenarios).toHaveLength(1);
    expect(saved.scenarios[0].priceCents).toBe(benchmark.mid);
    expect(saved).toMatchObject({ ccv: 500, hours: 2, deliverableType: "ad-read" });
  });
});

describe("Calculator saved profile", () => {
  it("restores previously saved inputs", () => {
    profileGet.mockReturnValue({
      data: {
        inputs: {
          ccv: 1200,
          hours: 3,
          deliverableType: "vod",
          platforms: ["youtube"],
          scenarios: [],
        },
      },
      isLoading: false,
      isError: false,
    });

    render(<Calculator />);

    expect(computeQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ccv: 1200,
        durationMinutes: 180,
        deliverableType: "vod",
        platforms: ["youtube"],
      })
    );
  });

  it("ignores out-of-range or malformed persisted values", () => {
    profileGet.mockReturnValue({
      data: {
        inputs: {
          ccv: 999999,
          hours: "banana",
          deliverableType: "not-a-type",
          platforms: ["myspace"],
        },
      },
      isLoading: false,
      isError: false,
    });

    render(<Calculator />);

    expect(computeQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ccv: 5000, // clamped to CCV_MAX
        durationMinutes: 120, // fell back to the 2h default
        deliverableType: "ad-read", // rejected unknown type
        platforms: undefined, // rejected unknown platform
      })
    );
  });
});

describe("Calculator CCV presets", () => {
  it("builds quick-set chips from the creator's real connected platforms", () => {
    getPlatforms.mockReturnValue({
      data: [
        { platform: "twitch", ccv: 850 },
        { platform: "youtube", ccv: 300 },
      ],
      isLoading: false,
      isError: false,
    });

    render(<Calculator />);

    expect(screen.getByRole("button", { name: "Twitch 850" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "YouTube 300" })).toBeInTheDocument();
    // Combined chip only appears with more than one platform.
    expect(screen.getByRole("button", { name: "All platforms 1,150" })).toBeInTheDocument();
  });

  it("shows a real empty state instead of mock audience numbers", () => {
    getPlatforms.mockReturnValue({ data: [], isLoading: false, isError: false });

    render(<Calculator />);

    expect(screen.getByText(/Add your channels in Settings/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /All platforms/ })).not.toBeInTheDocument();
  });
});

describe("Calculator states", () => {
  it("surfaces a retryable error when the benchmark call fails", () => {
    const refetch = vi.fn();
    computeQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });

    render(<Calculator />);

    expect(screen.getByText("Couldn't load benchmark pricing.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(refetch).toHaveBeenCalled();
  });

  it("does not render a price while the benchmark is loading", () => {
    computeQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });

    render(<Calculator />);

    expect(screen.queryByText(/Recommended price/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Your quote")).not.toBeInTheDocument();
  });

  it("shows an empty state when the creator has no priced deals", () => {
    render(<Calculator />);

    expect(screen.getByText(/No priced deals yet/)).toBeInTheDocument();
  });
});

describe("Calculator past deals", () => {
  it("places each real deal against the band without inventing viewer-hours", () => {
    dealsList.mockReturnValue({
      data: [
        // Values are placed against the band above, not fixed prices, so the
        // three tiers stay three tiers if the band moves again.
        { id: "d1", title: "Below", valueCents: benchmark.floor - 1, brand: { name: "Acme" } },
        {
          id: "d2",
          title: "Middling",
          valueCents: benchmark.mid + 1,
          brand: { name: "Globex" },
        },
        { id: "d3", title: "Rich", valueCents: benchmark.agency + 1, brand: null },
        { id: "d4", title: "Unpriced", valueCents: 0, brand: null },
      ],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<Calculator />);

    const table = screen.getByRole("table");
    expect(within(table).getByText("Acme — Below")).toBeInTheDocument();
    expect(within(table).getByText("Below floor")).toBeInTheDocument();
    expect(within(table).getByText("Mid–agency")).toBeInTheDocument();
    expect(within(table).getByText("Agency+")).toBeInTheDocument();
    // Deals with no value are excluded rather than shown as $0 "below floor".
    expect(within(table).queryByText(/Unpriced/)).not.toBeInTheDocument();
  });
});

describe("Calculator accessibility", () => {
  it("gives both sliders accessible names and value text", () => {
    render(<Calculator />);

    const ccv = screen.getByRole("slider", { name: "Average concurrent viewers" });
    expect(ccv).toHaveAttribute("aria-valuetext", "500 concurrent viewers");

    const hours = screen.getByRole("slider", { name: "Sponsored hours" });
    expect(hours).toHaveAttribute("aria-valuetext", "2h of sponsored airtime");
  });

  it("moves the CCV slider by keyboard and recomputes against the new value", () => {
    render(<Calculator />);

    const ccv = screen.getByRole("slider", { name: "Average concurrent viewers" });
    fireEvent.keyDown(ccv, { key: "ArrowRight" });

    expect(computeQuery).toHaveBeenLastCalledWith(expect.objectContaining({ ccv: 510 }));
  });

  it("commits the CCV slider's value to the saved profile", () => {
    render(<Calculator />);

    const ccv = screen.getByRole("slider", { name: "Average concurrent viewers" });
    fireEvent.keyDown(ccv, { key: "ArrowRight" });
    fireEvent.keyUp(ccv, { key: "ArrowRight" });

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ inputs: expect.objectContaining({ ccv: 510 }) })
    );
  });

  it("exposes deliverable type as real radios", () => {
    render(<Calculator />);

    const vod = screen.getByRole("radio", { name: "Dedicated VOD" });
    expect(screen.getByRole("radio", { name: "Ad read" })).toBeChecked();

    fireEvent.click(vod);
    expect(vod).toBeChecked();
    expect(computeQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ deliverableType: "vod" })
    );
  });

  it("announces the recommended price in a live region", () => {
    render(<Calculator />);

    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("explains the deliverable-type multiplier on hover/focus", async () => {
    render(<Calculator />);

    const trigger = screen.getByRole("button", { name: "About Deliverable type" });
    fireEvent.focus(trigger);

    expect(
      await screen.findByText(/Deliverable type carries its own multiplier/)
    ).toBeInTheDocument();
  });

  it("explains the platform mix multiplier on hover/focus", async () => {
    render(<Calculator />);

    const trigger = screen.getByRole("button", { name: "About Platforms in this activation" });
    fireEvent.focus(trigger);

    expect(await screen.findByText(/nudge the benchmark rate/)).toBeInTheDocument();
  });

  it("explains the benchmark band on hover/focus", async () => {
    render(<Calculator />);

    const trigger = screen.getByRole("button", { name: "About the benchmark band" });
    fireEvent.focus(trigger);

    expect(await screen.findByText(/walk-away number/)).toBeInTheDocument();
  });

  it("opens the CPVH explainer as a modal dialog and closes it on Escape", () => {
    render(<Calculator />);

    fireEvent.click(screen.getByRole("button", { name: /How CPVH works/ }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("heading", { name: "How CPVH works" })).toBeInTheDocument();
    // Focus is moved into the dialog rather than left on the page behind it.
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
