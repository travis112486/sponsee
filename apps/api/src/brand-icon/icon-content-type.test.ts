import { describe, it, expect } from "vitest";
import { isAllowedIconContentType } from "./icon-content-type.js";

describe("isAllowedIconContentType", () => {
  it("allows the raster types real favicon hosts and unavatar actually send", () => {
    for (const type of [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "image/avif",
      "image/x-icon",
      "image/vnd.microsoft.icon",
    ]) {
      expect(isAllowedIconContentType(type)).toBe(true);
    }
  });

  it("is case-insensitive and tolerates a charset/parameter suffix", () => {
    expect(isAllowedIconContentType("IMAGE/PNG")).toBe(true);
    expect(isAllowedIconContentType("image/png; charset=binary")).toBe(true);
  });

  it("rejects image/svg+xml — PR #123 F1, stored XSS on the app origin", () => {
    expect(isAllowedIconContentType("image/svg+xml")).toBe(false);
  });

  it("rejects non-image types like an HTML error page", () => {
    expect(isAllowedIconContentType("text/html")).toBe(false);
  });

  it("treats an absent Content-Type as allowed — callers default it to image/x-icon themselves", () => {
    expect(isAllowedIconContentType(null)).toBe(true);
    expect(isAllowedIconContentType(undefined)).toBe(true);
  });
});
