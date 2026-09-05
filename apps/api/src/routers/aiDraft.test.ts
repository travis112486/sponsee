import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  generateDraft: vi.fn(),
  createDraftProvider: vi.fn(),
}));

vi.mock("../ai/draft.js", () => ({ generateDraft: h.generateDraft }));
vi.mock("../ai/provider.js", () => ({ createDraftProvider: h.createDraftProvider }));

import { aiDraftRouter } from "./aiDraft.js";

function mockCtx(overrides?: { session?: unknown; creatorId?: string | null }) {
  const hasSession = overrides !== undefined && "session" in overrides;
  const hasCreatorId = overrides !== undefined && "creatorId" in overrides;
  return {
    session: hasSession ? overrides!.session : { user: { id: "user-1", email: "a@b.com", name: "A" } },
    creatorId: hasCreatorId ? overrides!.creatorId : "creator-a",
    db: {},
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("aiDraftRouter.status", () => {
  it("reports configured=true when a provider can be built", async () => {
    h.createDraftProvider.mockReturnValue({ complete: vi.fn() });
    const caller = aiDraftRouter.createCaller(mockCtx());
    expect(await caller.status()).toEqual({ configured: true });
  });

  it("reports configured=false when the key is absent", async () => {
    h.createDraftProvider.mockReturnValue(null);
    const caller = aiDraftRouter.createCaller(mockCtx());
    expect(await caller.status()).toEqual({ configured: false });
  });
});

describe("aiDraftRouter.draft", () => {
  it("forwards section/offering/brand to the draft engine and returns its result", async () => {
    h.generateDraft.mockResolvedValue({
      status: "ok",
      text: "draft text",
      model: "claude-haiku-4-5",
      section: "offering",
    });
    const caller = aiDraftRouter.createCaller(mockCtx());

    const result = await caller.draft({
      section: "offering",
      offering: { title: "60s ad-read", priceCents: 52500, currency: "USD" },
    });

    expect(result.status).toBe("ok");
    expect(h.generateDraft).toHaveBeenCalledWith({
      db: {},
      creatorId: "creator-a",
      section: "offering",
      offering: { title: "60s ad-read", priceCents: 52500, currency: "USD" },
      brand: undefined,
    });
  });

  it("rejects an unknown section", async () => {
    const caller = aiDraftRouter.createCaller(mockCtx());
    await expect(caller.draft({ section: "nope" as never })).rejects.toBeTruthy();
  });

  it("requires an authenticated creator", async () => {
    const anon = aiDraftRouter.createCaller(
      mockCtx({ session: null, creatorId: null }),
    );
    await expect(anon.draft({ section: "bio" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const authedNoCreator = aiDraftRouter.createCaller(mockCtx({ creatorId: null }));
    await expect(authedNoCreator.draft({ section: "bio" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
