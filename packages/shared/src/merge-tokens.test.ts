import { describe, it, expect } from "vitest";
import { renderMergeTokens, validateMergeTokens, hasMergeTokens } from "./merge-tokens.js";

const baseCtx = {
  brandContact: "Sarah",
  brand: "NordVPN",
  dealTitle: "July Sponsorship",
  invoiceId: "INV-0042",
  amount: "$1,250.00",
  dueDate: "Aug 15, 2026",
  daysLate: 7,
  creatorName: "Alex",
};

describe("renderMergeTokens", () => {
  it("replaces all known tokens", () => {
    const template =
      "Hi {brand_contact}, invoice {invoice_id} for {deal_title} from {brand} is {amount} due {due_date} ({days_late} days late). -{creator_name}";
    const result = renderMergeTokens(template, baseCtx);
    expect(result).toBe(
      "Hi Sarah, invoice INV-0042 for July Sponsorship from NordVPN is $1,250.00 due Aug 15, 2026 (7 days late). -Alex"
    );
  });

  it("leaves unknown tokens untouched", () => {
    const template = "Hi {brand_contact}, unknown {foo} here";
    const result = renderMergeTokens(template, baseCtx);
    expect(result).toBe("Hi Sarah, unknown {foo} here");
  });

  it("handles empty template", () => {
    expect(renderMergeTokens("", baseCtx)).toBe("");
  });

  it("handles template with no tokens", () => {
    const template = "Hello world";
    expect(renderMergeTokens(template, baseCtx)).toBe("Hello world");
  });

  it("handles repeated tokens", () => {
    const template = "{brand_contact} {brand_contact}";
    expect(renderMergeTokens(template, baseCtx)).toBe("Sarah Sarah");
  });

  it("leaves token untouched when context value is missing", () => {
    const template = "{brand_contact} {missing_key}";
    // missing_key is not in MergeContext so it stays as literal
    const result = renderMergeTokens(template, { ...baseCtx, brandContact: "Sarah" });
    expect(result).toBe("Sarah {missing_key}");
  });
});

describe("validateMergeTokens", () => {
  it("returns empty array for all-known tokens", () => {
    const template = "Hi {brand_contact}, {amount} for {deal_title}";
    expect(validateMergeTokens(template)).toEqual([]);
  });

  it("returns unknown tokens", () => {
    const template = "Hi {brand_contact}, {foo}, {bar}";
    expect(validateMergeTokens(template)).toEqual(["foo", "bar"]);
  });

  it("returns empty array when no tokens at all", () => {
    expect(validateMergeTokens("plain text")).toEqual([]);
  });

  it("deduplicates unknown tokens", () => {
    const template = "{foo} {foo}";
    expect(validateMergeTokens(template)).toEqual(["foo"]);
  });
});

describe("hasMergeTokens", () => {
  it("returns true when tokens present", () => {
    expect(hasMergeTokens("Hi {brand_contact}")).toBe(true);
  });

  it("returns false when no tokens", () => {
    expect(hasMergeTokens("plain text")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(hasMergeTokens("")).toBe(false);
  });
});
