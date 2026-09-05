import { describe, it, expect } from "vitest";
import { buildDraftPrompt, summarizeCreator } from "./prompt.js";
import type { CreatorContext } from "./types.js";

const ctx: CreatorContext = {
  displayName: "PixelPro",
  pronouns: "they/them",
  category: "variety gaming",
  platforms: [
    { platform: "twitch", handle: "pixelpro", ccv: 500, followers: 24000, scheduleLabel: "Mon/Wed/Fri" },
    { platform: "youtube", handle: "pixelpro-vods", ccv: null, followers: 8000, scheduleLabel: null },
  ],
  dealHistory: {
    total: 6,
    paid: 5,
    brandCategories: ["gaming peripherals", "energy drinks"],
    recentTitles: ["Launch stream", "Charity 24h"],
    typicalValueCents: { min: 40000, max: 120000 },
  },
  cpvhGuidance: { floor: 30000, mid: 52500, agency: 100000 },
};

describe("summarizeCreator", () => {
  it("includes the creator's own data and no invented third-party identifiers", () => {
    const s = summarizeCreator(ctx);
    expect(s).toContain("PixelPro");
    expect(s).toContain("variety gaming");
    expect(s).toContain("pixelpro");
    expect(s).toContain("avg concurrent viewers: 500");
    expect(s).toContain("energy drinks");
    expect(s).toContain("$400–$1,200");
  });

  it("handles an empty account without throwing", () => {
    const empty: CreatorContext = {
      displayName: "NewCreator",
      pronouns: null,
      category: null,
      platforms: [],
      dealHistory: { total: 0, paid: 0, brandCategories: [], recentTitles: [], typicalValueCents: null },
      cpvhGuidance: null,
    };
    const s = summarizeCreator(empty);
    expect(s).toContain("NewCreator");
    expect(s).toContain("No platform stats are connected yet.");
    expect(s).toContain("No past brand deals recorded yet.");
  });
});

describe("buildDraftPrompt", () => {
  it("emits section-specific directives and creator context for a bio", () => {
    const { system, user } = buildDraftPrompt(ctx, "bio");
    expect(system).toContain("bio/about");
    expect(system).toContain("Never invent statistics");
    expect(user).toContain("PixelPro");
    expect(user).toContain("benchmark price guidance");
  });

  it("includes the offering title and price in the offering prompt", () => {
    const { user } = buildDraftPrompt(ctx, "offering", { title: "60s ad-read", priceCents: 52500, currency: "USD" });
    expect(user).toContain("60s ad-read");
    expect(user).toContain("USD 525");
  });

  it("includes the target brand in the pitch prompt", () => {
    const { user } = buildDraftPrompt(ctx, "pitch", undefined, { name: "Acme Energy", category: "beverages" });
    expect(user).toContain("Acme Energy");
    expect(user).toContain("beverages");
  });

  it("returns plain-text output instructions so the field stays editable text", () => {
    const { system } = buildDraftPrompt(ctx, "audience");
    expect(system).toContain("plain text");
    expect(system).toContain("no markdown");
  });
});
