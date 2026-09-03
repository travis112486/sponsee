import { describe, it, expect } from "vitest";
import { normalizeBrandDomain } from "./brand-domain.js";

describe("normalizeBrandDomain", () => {
  it("strips scheme, www, and path", () => {
    expect(normalizeBrandDomain("https://www.redbull.com/energydrink")).toBe("redbull.com");
    expect(normalizeBrandDomain("http://bangenergy.com")).toBe("bangenergy.com");
    expect(normalizeBrandDomain("redbull.com/path?query#hash")).toBe("redbull.com");
  });

  it("lowercases and trims", () => {
    expect(normalizeBrandDomain("  RedBull.com  ")).toBe("redbull.com");
  });

  it("returns null for empty or missing input", () => {
    expect(normalizeBrandDomain("")).toBeNull();
    expect(normalizeBrandDomain(null)).toBeNull();
    expect(normalizeBrandDomain(undefined)).toBeNull();
  });

  it("rejects IPv4 literals", () => {
    expect(normalizeBrandDomain("127.0.0.1")).toBeNull();
    expect(normalizeBrandDomain("http://169.254.169.254/")).toBeNull();
    expect(normalizeBrandDomain("10.0.0.5")).toBeNull();
  });

  it("rejects IPv6 literals and unqualified hosts", () => {
    expect(normalizeBrandDomain("[::1]")).toBeNull();
    expect(normalizeBrandDomain("localhost")).toBeNull();
    expect(normalizeBrandDomain("internal")).toBeNull();
  });

  it("rejects a non-http(s) scheme trick and garbage", () => {
    expect(normalizeBrandDomain("javascript:alert(1)")).toBeNull();
    expect(normalizeBrandDomain("not a domain")).toBeNull();
  });

  it("accepts a subdomain", () => {
    expect(normalizeBrandDomain("shop.redbull.com")).toBe("shop.redbull.com");
  });
});
