import { describe, expect, it } from "vitest";
import { formatInvoiceDate } from "./invoice-date";

describe("InvoicePublicPage calendar dates", () => {
  it("keeps a UTC-midnight invoice date on the stored calendar day in a negative offset", () => {
    const previousTz = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      expect(formatInvoiceDate("2026-10-17T00:00:00Z")).toBe("October 17, 2026");
    } finally {
      if (previousTz === undefined) delete process.env.TZ;
      else process.env.TZ = previousTz;
    }
  });
});
