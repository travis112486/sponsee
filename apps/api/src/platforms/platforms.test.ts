import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TwitchClient } from "./twitch.js";
import { KickClient } from "./kick.js";
import { YouTubeClient } from "./youtube.js";
import { createPlatformClient } from "./index.js";

function mockFetchSequence(responses: Array<{ status?: number; json: unknown }>) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce(
      new Response(JSON.stringify(r.json), {
        status: r.status ?? 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  }
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createPlatformClient", () => {
  it("returns a client per platform and null for tiktok", () => {
    expect(createPlatformClient("twitch")?.name).toBe("twitch");
    expect(createPlatformClient("kick")?.name).toBe("kick");
    expect(createPlatformClient("youtube")?.name).toBe("youtube");
    expect(createPlatformClient("tiktok")).toBeNull();
  });
});

describe("TwitchClient", () => {
  const client = () => new TwitchClient("test-client-id", "test-secret");

  it("isConfigured reflects credentials", () => {
    expect(client().isConfigured()).toBe(true);
    expect(new TwitchClient("", "").isConfigured()).toBe(false);
  });

  it("fetches app token, user, and follower total", async () => {
    const fetchMock = mockFetchSequence([
      { json: { access_token: "app-token", expires_in: 3600 } },
      {
        json: {
          data: [
            {
              id: "141981764",
              login: "somestreamer",
              display_name: "SomeStreamer",
              profile_image_url: "https://static-cdn.jtvnw.net/avatar.png",
            },
          ],
        },
      },
      { json: { total: 5421, data: [] } },
    ]);

    const stats = await client().fetchStats("@SomeStreamer");

    expect(stats).toEqual({
      handle: "somestreamer",
      channelUrl: "https://www.twitch.tv/somestreamer",
      avatarUrl: "https://static-cdn.jtvnw.net/avatar.png",
      subscriberCount: null,
      subscriberCountIsEstimate: false,
      followers: 5421,
    });

    // handle is normalized (@ stripped, lowercased) in the users call
    expect(fetchMock.mock.calls[1][0]).toContain("login=somestreamer");
    // follower call uses the resolved broadcaster id with an app token
    expect(fetchMock.mock.calls[2][0]).toContain("broadcaster_id=141981764");
  });

  it("throws when the channel does not exist", async () => {
    mockFetchSequence([
      { json: { access_token: "app-token", expires_in: 3600 } },
      { json: { data: [] } },
    ]);
    await expect(client().fetchStats("ghost")).rejects.toThrow("Twitch channel not found");
  });

  it("caches the app token across calls", async () => {
    const fetchMock = mockFetchSequence([
      { json: { access_token: "app-token", expires_in: 3600 } },
      { json: { data: [{ id: "1", login: "a", display_name: "A", profile_image_url: "" }] } },
      { json: { total: 1 } },
      { json: { data: [{ id: "1", login: "a", display_name: "A", profile_image_url: "" }] } },
      { json: { total: 2 } },
    ]);
    const c = client();
    await c.fetchStats("a");
    await c.fetchStats("a");
    const tokenCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("id.twitch.tv/oauth2/token")
    );
    expect(tokenCalls).toHaveLength(1);
  });

  it("throws a clear error when unconfigured", async () => {
    await expect(new TwitchClient("", "").fetchStats("x")).rejects.toThrow(
      "TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET missing"
    );
  });
});

describe("KickClient", () => {
  const client = () => new KickClient("kick-id", "kick-secret");

  it("fetches subscriber count from channels and avatar from users", async () => {
    mockFetchSequence([
      { json: { access_token: "kick-token", expires_in: 3600 } },
      {
        json: {
          data: [{ broadcaster_user_id: 777, slug: "somekicker", active_subscribers_count: 312 }],
        },
      },
      { json: { data: [{ user_id: 777, profile_picture: "https://kick.com/pfp.jpg" }] } },
    ]);

    const stats = await client().fetchStats("SomeKicker");

    expect(stats).toEqual({
      handle: "somekicker",
      channelUrl: "https://kick.com/somekicker",
      avatarUrl: "https://kick.com/pfp.jpg",
      subscriberCount: 312,
      subscriberCountIsEstimate: false,
      followers: null,
    });
  });

  it("returns null subscriberCount when Kick gates the field", async () => {
    mockFetchSequence([
      { json: { access_token: "kick-token", expires_in: 3600 } },
      { json: { data: [{ broadcaster_user_id: 777, slug: "gated" }] } },
      { json: { data: [] } },
    ]);
    const stats = await client().fetchStats("gated");
    expect(stats.subscriberCount).toBeNull();
    expect(stats.avatarUrl).toBeNull();
  });

  it("throws when the channel does not exist", async () => {
    mockFetchSequence([
      { json: { access_token: "kick-token", expires_in: 3600 } },
      { json: { data: [] } },
    ]);
    await expect(client().fetchStats("ghost")).rejects.toThrow("Kick channel not found");
  });
});

describe("YouTubeClient", () => {
  const client = () => new YouTubeClient("yt-api-key");

  it("fetches rounded subscriber count and flags it as an estimate", async () => {
    const fetchMock = mockFetchSequence([
      {
        json: {
          items: [
            {
              id: "UCabcdefghijklmnopqrstuv",
              snippet: {
                customUrl: "@somecreator",
                thumbnails: { high: { url: "https://yt.example/high.jpg" } },
              },
              statistics: { subscriberCount: "12300", hiddenSubscriberCount: false },
            },
          ],
        },
      },
    ]);

    const stats = await client().fetchStats("@SomeCreator");

    expect(stats).toEqual({
      handle: "somecreator",
      channelUrl: "https://www.youtube.com/@somecreator",
      avatarUrl: "https://yt.example/high.jpg",
      subscriberCount: 12300,
      subscriberCountIsEstimate: true,
      followers: null,
    });
    expect(fetchMock.mock.calls[0][0]).toContain("forHandle=SomeCreator");
  });

  it("uses id lookup for raw UC channel ids", async () => {
    const fetchMock = mockFetchSequence([
      {
        json: {
          items: [
            {
              id: "UCabcdefghijklmnopqrstuv",
              snippet: { thumbnails: { default: { url: "https://yt.example/d.jpg" } } },
              statistics: { subscriberCount: "500", hiddenSubscriberCount: false },
            },
          ],
        },
      },
    ]);
    await client().fetchStats("UCabcdefghijklmnopqrstuv");
    expect(fetchMock.mock.calls[0][0]).toContain("id=UCabcdefghijklmnopqrstuv");
    expect(fetchMock.mock.calls[0][0]).not.toContain("forHandle");
  });

  it("returns null count when the channel hides subscribers", async () => {
    mockFetchSequence([
      {
        json: {
          items: [
            {
              id: "UCabcdefghijklmnopqrstuv",
              snippet: {},
              statistics: { hiddenSubscriberCount: true, subscriberCount: "0" },
            },
          ],
        },
      },
    ]);
    const stats = await client().fetchStats("hidden");
    expect(stats.subscriberCount).toBeNull();
    expect(stats.subscriberCountIsEstimate).toBe(false);
  });

  it("throws when the channel does not exist", async () => {
    mockFetchSequence([{ json: { items: [] } }]);
    await expect(client().fetchStats("ghost")).rejects.toThrow("YouTube channel not found");
  });
});
