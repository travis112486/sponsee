import { describe, it, expect } from "vitest";
import {
  avatarInitial,
  platformSubtitle,
  rankPlatforms,
  resolveAvatarUrl,
  safeAvatarUrl,
  type IdentityPlatform,
} from "./creator-identity";

function row(overrides: Partial<IdentityPlatform> & { platform: string }): IdentityPlatform {
  return { handle: null, avatarUrl: null, ccv: null, followers: null, subscriberCount: null, ...overrides };
}

describe("safeAvatarUrl", () => {
  it("accepts https URLs", () => {
    expect(safeAvatarUrl("https://static-cdn.jtvnw.net/a.png")).toBe(
      "https://static-cdn.jtvnw.net/a.png"
    );
  });

  it.each(["javascript:alert(1)", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", "http://cdn.example.com/a.png", "/pixelpanda-avatar.png", "not a url", "", "   "])(
    "rejects %s",
    (value) => {
      expect(safeAvatarUrl(value)).toBeNull();
    }
  );

  it("rejects null and undefined", () => {
    expect(safeAvatarUrl(null)).toBeNull();
    expect(safeAvatarUrl(undefined)).toBeNull();
  });
});

describe("rankPlatforms", () => {
  it("ranks by CCV first", () => {
    const ranked = rankPlatforms([
      row({ platform: "kick", ccv: 120 }),
      row({ platform: "twitch", ccv: 900 }),
    ]);
    expect(ranked.map((r) => r.platform)).toEqual(["twitch", "kick"]);
  });

  it("falls back to subscriber/follower count when CCV is missing", () => {
    const ranked = rankPlatforms([
      row({ platform: "twitch", followers: 1_000 }),
      row({ platform: "youtube", subscriberCount: 40_000 }),
    ]);
    expect(ranked.map((r) => r.platform)).toEqual(["youtube", "twitch"]);
  });

  it("puts a platform with any CCV above one with none, however many followers", () => {
    const ranked = rankPlatforms([
      row({ platform: "youtube", subscriberCount: 500_000 }),
      row({ platform: "twitch", ccv: 0 }),
    ]);
    expect(ranked.map((r) => r.platform)).toEqual(["twitch", "youtube"]);
  });

  it("is stable on declared platform order when a creator has no stats yet", () => {
    const ranked = rankPlatforms([
      row({ platform: "tiktok" }),
      row({ platform: "kick" }),
      row({ platform: "twitch" }),
    ]);
    expect(ranked.map((r) => r.platform)).toEqual(["twitch", "kick", "tiktok"]);
  });

  it("does not mutate its input", () => {
    const rows = [row({ platform: "kick", ccv: 1 }), row({ platform: "twitch", ccv: 2 })];
    rankPlatforms(rows);
    expect(rows.map((r) => r.platform)).toEqual(["kick", "twitch"]);
  });

  it("tolerates null/undefined", () => {
    expect(rankPlatforms(null)).toEqual([]);
    expect(rankPlatforms(undefined)).toEqual([]);
  });
});

describe("resolveAvatarUrl", () => {
  const synced = row({
    platform: "twitch",
    ccv: 800,
    avatarUrl: "https://static-cdn.jtvnw.net/synced.png",
  });

  it("prefers the creator's own profile avatar", () => {
    expect(
      resolveAvatarUrl({
        profileAvatarUrl: "https://cdn.example.com/mine.png",
        platformRows: [synced],
        userImage: "https://auth.example.com/oauth.png",
      })
    ).toBe("https://cdn.example.com/mine.png");
  });

  it("falls back to the synced platform avatar (the SPO-154 gap)", () => {
    expect(
      resolveAvatarUrl({
        profileAvatarUrl: null,
        platformRows: [synced],
        userImage: "https://auth.example.com/oauth.png",
      })
    ).toBe("https://static-cdn.jtvnw.net/synced.png");
  });

  it("takes the synced avatar from the biggest platform", () => {
    expect(
      resolveAvatarUrl({
        platformRows: [
          row({ platform: "kick", ccv: 50, avatarUrl: "https://kick.com/small.jpg" }),
          row({ platform: "twitch", ccv: 900, avatarUrl: "https://static-cdn.jtvnw.net/big.png" }),
        ],
      })
    ).toBe("https://static-cdn.jtvnw.net/big.png");
  });

  it("skips ranked platforms that have not synced an avatar", () => {
    expect(
      resolveAvatarUrl({
        platformRows: [
          row({ platform: "twitch", ccv: 900, avatarUrl: null }),
          row({ platform: "kick", ccv: 50, avatarUrl: "https://kick.com/pfp.jpg" }),
        ],
      })
    ).toBe("https://kick.com/pfp.jpg");
  });

  it("falls back to the auth provider image last", () => {
    expect(
      resolveAvatarUrl({
        platformRows: [row({ platform: "twitch", ccv: 900 })],
        userImage: "https://auth.example.com/oauth.png",
      })
    ).toBe("https://auth.example.com/oauth.png");
  });

  it("returns null rather than the PixelPanda mockup asset when nothing resolves", () => {
    expect(resolveAvatarUrl({ profileAvatarUrl: null, platformRows: [], userImage: null })).toBeNull();
  });

  it("does not let an unsafe stored profile URL shadow a good synced one", () => {
    expect(
      resolveAvatarUrl({
        profileAvatarUrl: "javascript:alert(1)",
        platformRows: [synced],
      })
    ).toBe("https://static-cdn.jtvnw.net/synced.png");
  });
});

describe("avatarInitial", () => {
  it.each([
    ["PixelPanda", "P"],
    ["ada lovelace", "A"],
    ["  spaced", "S"],
    ["_underscore", "U"],
    ["7Sins", "7"],
    ["Ünter", "Ü"],
    ["日本", "日"],
    ["!!!", "?"],
    ["", "?"],
  ])("maps %s to %s", (name, expected) => {
    expect(avatarInitial(name)).toBe(expected);
  });

  it("handles a missing name", () => {
    expect(avatarInitial(null)).toBe("?");
    expect(avatarInitial(undefined)).toBe("?");
  });
});

describe("platformSubtitle", () => {
  it("names the primary platform and handle", () => {
    expect(
      platformSubtitle([
        row({ platform: "kick", ccv: 40, handle: "sidekick" }),
        row({ platform: "twitch", ccv: 900, handle: "pixelpanda" }),
      ])
    ).toBe("Twitch · @pixelpanda");
  });

  it("skips ranked platforms with no handle yet", () => {
    expect(
      platformSubtitle([
        row({ platform: "twitch", ccv: 900 }),
        row({ platform: "youtube", ccv: 10, handle: "pixelpanda" }),
      ])
    ).toBe("YouTube · @pixelpanda");
  });

  it("does not double the @ when the creator typed one", () => {
    expect(platformSubtitle([row({ platform: "kick", handle: "@pixelpanda" })])).toBe(
      "Kick · @pixelpanda"
    );
  });

  it("returns null when no platform has a handle, so the chip drops the line", () => {
    expect(platformSubtitle([row({ platform: "twitch", handle: "   " })])).toBeNull();
    expect(platformSubtitle([])).toBeNull();
    expect(platformSubtitle(undefined)).toBeNull();
  });
});
