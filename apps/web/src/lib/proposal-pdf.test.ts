// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildProposalPdf } from "./proposal-pdf";
import type { MediaKitViewModel } from "@sponsee/shared";

const latin1 = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

function makeKit(overrides: Partial<MediaKitViewModel> = {}): MediaKitViewModel {
  return {
    id: "kit-1",
    creator: { id: "creator-1", displayName: "Pixel P\u00e4nda", pronouns: null, category: "Gaming", avatarUrl: null },
    platforms: [],
    headline: "Live gaming, built for brands \u2014 2026",
    bio: "A focused gaming community.\nSecond line with caf\u00e9 vibes.",
    accentColor: null,
    offerings: [{ id: "offer-1", title: "Stream int\u00e9gration", description: null, priceCents: 29000, currency: "USD", position: 0 }],
    examples: [{ id: "example-1", title: "Brand launch stream", url: "https://example.com/case-study", position: 0 }],
    cpvhGuidance: null,
    ...overrides,
  };
}

function readXrefOffset(text: string): number {
  const marker = text.indexOf("startxref\n");
  expect(marker).toBeGreaterThan(0);
  const digits = /(\d+)/.exec(text.slice(marker))!;
  return Number(digits[1]);
}

describe("buildProposalPdf", () => {
  it("produces a structurally valid PDF with byte-accurate offsets and stream length", () => {
    const pdf = buildProposalPdf(makeKit());
    const text = latin1(pdf);

    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.endsWith("%%EOF\n")).toBe(true);

    const xrefKeyword = text.indexOf("xref\n");
    expect(xrefKeyword).toBeGreaterThan(0);
    expect(readXrefOffset(text)).toBe(xrefKeyword);

    // Every xref "n" entry points at the object it claims.
    const entries = text.slice(xrefKeyword);
    const subsection = /^xref\n0 (\d+)\n/.exec(entries)!;
    const count = Number(subsection[1]);
    expect(count).toBe(6);
    let cursor = subsection[0].length;
    for (let i = 0; i < count; i++) {
      const entry = entries.slice(cursor, cursor + 20);
      const type = entry[17];
      if (type === "n") {
        const offset = Number(entry.slice(0, 10));
        expect(text.slice(offset).startsWith(`${i} 0 obj`)).toBe(true);
      }
      cursor += 20;
    }

    // /Length must equal the real stream byte length, not an estimate.
    const lengthMatch = /\/Length (\d+)/.exec(text)!;
    const declared = Number(lengthMatch[1]);
    const streamStart = text.indexOf("stream\n", lengthMatch.index) + "stream\n".length;
    const streamEnd = text.indexOf("\nendstream", streamStart);
    expect(streamEnd).toBeGreaterThan(streamStart);
    expect(streamEnd - streamStart).toBe(declared);
  });

  it("lays out multiple lines and preserves non-ASCII creator text", () => {
    const text = latin1(buildProposalPdf(makeKit()));
    const lengthMatch = /\/Length (\d+)/.exec(text)!;
    const streamStart = text.indexOf("stream\n", lengthMatch.index) + "stream\n".length;
    const streamEnd = text.indexOf("\nendstream", streamStart);
    const content = text.slice(streamStart, streamEnd);

    // Non-ASCII (WinAnsi) bytes survive escaping intact.
    expect(content).toContain("P\u00e4nda");
    expect(content).toContain("caf\u00e9");
    // Multiline layout: separate Tj operators advanced by T*, not one blob.
    expect(content).toContain(") Tj\nT*\n");
    expect(content).toContain("Second line");
  });
});
