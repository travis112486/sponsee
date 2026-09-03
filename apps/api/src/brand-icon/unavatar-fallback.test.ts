import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchUnavatarFallback, unavatarUrl } from "./unavatar-fallback.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: Response) {
  const fn = vi.fn(() => Promise.resolve(response));
  vi.stubGlobal("fetch", fn);
  return fn;
}

function imageResponse(bytes: number[], contentType = "image/png") {
  return new Response(new Uint8Array(bytes), { status: 200, headers: { "Content-Type": contentType } });
}

describe("unavatarUrl", () => {
  it("builds a fallback=false URL with the domain encoded", () => {
    expect(unavatarUrl("redbull.com")).toBe("https://unavatar.io/redbull.com?fallback=false");
  });
});

describe("fetchUnavatarFallback", () => {
  it("returns a hit for a 200 image response and requests fallback=false", async () => {
    const fn = stubFetch(imageResponse([1, 2, 3]));
    const result = await fetchUnavatarFallback("redbull.com", { timeoutMs: 1000, maxBytes: 1024 });

    expect(result.outcome).toBe("hit");
    expect(result.contentType).toBe("image/png");
    expect(result.body?.equals(Buffer.from([1, 2, 3]))).toBe(true);
    expect(fn.mock.calls[0][0]).toBe("https://unavatar.io/redbull.com?fallback=false");
  });

  it("treats a 200 image/svg+xml response as a miss (stored-XSS guard, PR #123 F1)", async () => {
    stubFetch(imageResponse([1, 2, 3], "image/svg+xml"));
    const result = await fetchUnavatarFallback("evil-brand.example", { timeoutMs: 1000, maxBytes: 1024 });
    expect(result.outcome).toBe("miss");
  });

  it("treats a 404 (unknown domain, empty body) as a miss", async () => {
    stubFetch(new Response(null, { status: 404 }));
    const result = await fetchUnavatarFallback("nobrand.example", { timeoutMs: 1000, maxBytes: 1024 });
    expect(result.outcome).toBe("miss");
  });

  it("treats a zero-byte 200 body as a miss", async () => {
    stubFetch(new Response(new Uint8Array([]), { status: 200, headers: { "Content-Type": "image/x-icon" } }));
    const result = await fetchUnavatarFallback("empty.example", { timeoutMs: 1000, maxBytes: 1024 });
    expect(result.outcome).toBe("miss");
  });

  it("treats an oversized response as a miss", async () => {
    stubFetch(imageResponse(new Array(2048).fill(1)));
    const result = await fetchUnavatarFallback("big.example", { timeoutMs: 1000, maxBytes: 1024 });
    expect(result.outcome).toBe("miss");
  });

  it("sends x-api-key only when an apiKey is configured", async () => {
    const fn = stubFetch(imageResponse([1]));
    await fetchUnavatarFallback("redbull.com", { timeoutMs: 1000, maxBytes: 1024, apiKey: "pk_test" });
    const headers = fn.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("pk_test");
  });

  it("treats a network error as a miss", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down")))
    );
    const result = await fetchUnavatarFallback("redbull.com", { timeoutMs: 1000, maxBytes: 1024 });
    expect(result.outcome).toBe("miss");
  });
});
