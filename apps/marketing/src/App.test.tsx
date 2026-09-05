import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";

describe("waitlist CTA focus handoff", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false }))
    );
    Object.defineProperty(window, "onscrollend", {
      configurable: true,
      value: null,
    });
    Element.prototype.scrollIntoView = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, "onscrollend");
  });

  it("does not move focus before a normal-motion smooth scroll ends", async () => {
    await act(async () => root.render(<App />));
    const cta = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Join the waitlist"
    )!;
    const waitlist = document.getElementById("waitlist")!;
    vi.spyOn(waitlist, "getBoundingClientRect").mockReturnValue({
      bottom: 10_800,
      height: 800,
      left: 0,
      right: 390,
      top: 10_000,
      width: 390,
      x: 0,
      y: 10_000,
      toJSON: () => ({}),
    });
    cta.focus();

    cta.click();
    act(() => vi.advanceTimersByTime(1_000));

    expect(document.activeElement).toBe(cta);

    window.dispatchEvent(new Event("scrollend"));

    expect(document.activeElement).toBe(document.getElementById("email"));
  });
});
