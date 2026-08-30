import { describe, it, expect } from "vitest";
import { SlidingWindowLimiter } from "./rate-limit.js";

describe("SlidingWindowLimiter", () => {
  it("allows exactly `max` calls inside the window", () => {
    const limiter = new SlidingWindowLimiter(3, 1000);

    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("a", 100).allowed).toBe(true);
    expect(limiter.check("a", 200).allowed).toBe(true);
    expect(limiter.check("a", 300).allowed).toBe(false);
  });

  it("reports the seconds remaining until the window resets", () => {
    const limiter = new SlidingWindowLimiter(1, 10_000);
    limiter.check("a", 0);

    expect(limiter.check("a", 2_500).retryAfter).toBe(8);
  });

  it("lets the caller through again once the window has passed", () => {
    const limiter = new SlidingWindowLimiter(1, 1000);
    limiter.check("a", 0);

    expect(limiter.check("a", 999).allowed).toBe(false);
    expect(limiter.check("a", 1000).allowed).toBe(true);
  });

  it("keys buckets independently", () => {
    const limiter = new SlidingWindowLimiter(1, 1000);
    limiter.check("a", 0);

    expect(limiter.check("b", 0).allowed).toBe(true);
    expect(limiter.check("a", 0).allowed).toBe(false);
  });

  it("does not grow without bound", () => {
    const limiter = new SlidingWindowLimiter(1, 1000);
    for (let i = 0; i < 12_000; i++) limiter.check(`ip-${i}`, 0);

    // Every key is still inside its window, so only the eviction cap bounds the
    // map. Without it an attacker rotating IPs is the memory exhaustion.
    expect(limiter.check("ip-0", 0).allowed).toBe(true);
  });
});
