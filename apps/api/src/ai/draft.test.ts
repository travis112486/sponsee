import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateDraft } from "./draft.js";
import type { DraftProvider } from "./provider.js";
import type { CreatorContext } from "./types.js";

const fixedContext: CreatorContext = {
  displayName: "PixelPro",
  pronouns: null,
  category: "variety gaming",
  platforms: [{ platform: "twitch", handle: "pixelpro", ccv: 500, followers: 24000, scheduleLabel: null }],
  dealHistory: { total: 2, paid: 2, brandCategories: ["gaming peripherals"], recentTitles: ["Launch"], typicalValueCents: { min: 40000, max: 120000 } },
  cpvhGuidance: { floor: 30000, mid: 52500, agency: 100000 },
};

const h = vi.hoisted(() => ({ loadCreatorContext: vi.fn() }));
vi.mock("./context.js", () => ({ loadCreatorContext: h.loadCreatorContext }));

const db = {} as never;

function providerReturning(text: string): DraftProvider {
  return {
    complete: vi.fn(async (_system, _user) => ({ text, model: "claude-haiku-4-5" })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.loadCreatorContext.mockResolvedValue(fixedContext);
});

describe("generateDraft", () => {
  it("returns not_configured when no provider is injected", async () => {
    const result = await generateDraft({
      db,
      creatorId: "creator-a",
      section: "bio",
      provider: null,
    });
    expect(result).toEqual({ status: "not_configured" });
  });

  it("returns ok with the provider text and section", async () => {
    const result = await generateDraft({
      db,
      creatorId: "creator-a",
      section: "pitch",
      brand: { name: "Acme" },
      provider: providerReturning("Pitch draft"),
    });
    expect(result).toEqual({
      status: "ok",
      text: "Pitch draft",
      model: "claude-haiku-4-5",
      section: "pitch",
    });
    expect(h.loadCreatorContext).toHaveBeenCalledWith(db, "creator-a");
  });

  it("passes the creator's own data into the prompt (no provider errors here)", async () => {
    const complete = vi.fn(async () => ({ text: "draft", model: "m" }));
    const provider: DraftProvider = { complete };
    await generateDraft({ db, creatorId: "creator-a", section: "bio", provider });

    const [system, user] = complete.mock.calls[0] as [string, string];
    expect(system).toContain("Never invent");
    expect(user).toContain("PixelPro");
    expect(user).toContain("pixelpro");
    expect(user).toContain("avg concurrent viewers: 500");
  });

  it("folds provider failure into a retryable error result (no throw)", async () => {
    const provider: DraftProvider = {
      complete: vi.fn(async () => {
        throw new Error("Anthropic API responded 429");
      }),
    };
    const result = await generateDraft({ db, creatorId: "creator-a", section: "audience", provider });
    expect(result).toEqual({ status: "error", message: "Anthropic API responded 429" });
  });
});
