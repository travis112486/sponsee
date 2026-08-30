import type { PlatformStats, PlatformStatsClient } from "./types.js";
import { fetchJson } from "./http.js";

/**
 * Twitch Helix adapter (no-OAuth v1).
 * https://dev.twitch.tv/docs/api/reference
 *
 * App access token (client credentials) gives public data only:
 * - Get Users → profile_image_url, display_name, broadcaster id
 * - Get Channel Followers → follower total (public since 2023)
 * True subscriber counts require streamer OAuth (channel:read:subscriptions) — Phase B.
 */
export class TwitchClient implements PlatformStatsClient {
  readonly name = "twitch";
  private readonly clientId: string;
  private readonly clientSecret: string;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    clientId = process.env.TWITCH_CLIENT_ID || "",
    clientSecret = process.env.TWITCH_CLIENT_SECRET || ""
  ) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  private async getAppToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) {
      return this.token.value;
    }
    const data = await fetchJson<{ access_token: string; expires_in: number }>(
      "https://id.twitch.tv/oauth2/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: "client_credentials",
        }).toString(),
      }
    );
    this.token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return this.token.value;
  }

  async fetchStats(handle: string): Promise<PlatformStats> {
    if (!this.isConfigured()) {
      throw new Error("Twitch sync not configured (TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET missing)");
    }
    const login = handle.replace(/^@/, "").trim().toLowerCase();
    const token = await this.getAppToken();
    const headers = { "Client-Id": this.clientId, Authorization: `Bearer ${token}` };

    const users = await fetchJson<{
      data: Array<{ id: string; login: string; display_name: string; profile_image_url: string }>;
    }>(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`, { headers });

    const user = users.data[0];
    if (!user) {
      throw new Error(`Twitch channel not found: ${login}`);
    }

    const followersRes = await fetchJson<{ total: number }>(
      `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${user.id}&first=1`,
      { headers }
    );

    return {
      handle: user.login,
      channelUrl: `https://www.twitch.tv/${user.login}`,
      avatarUrl: user.profile_image_url || null,
      // True sub counts need streamer OAuth — Phase B (connectedAccountId)
      subscriberCount: null,
      subscriberCountIsEstimate: false,
      followers: typeof followersRes.total === "number" ? followersRes.total : null,
    };
  }
}
