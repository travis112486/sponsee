import type { ConnectedAuth, PlatformStats, PlatformStatsClient } from "./types.js";
import { fetchJson } from "./http.js";

/**
 * Kick public API adapter (no-OAuth v1).
 * https://docs.kick.com/apis/channels · https://docs.kick.com/apis/users
 *
 * App access token (client credentials via id.kick.com). Channels endpoint
 * exposes active_subscribers_count; if Kick gates it to broadcaster tokens
 * in practice (docs are ambiguous), we return null and Phase B OAuth covers it.
 */
export class KickClient implements PlatformStatsClient {
  readonly name = "kick";
  private readonly clientId: string;
  private readonly clientSecret: string;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    clientId = process.env.KICK_CLIENT_ID || "",
    clientSecret = process.env.KICK_CLIENT_SECRET || ""
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
      "https://id.kick.com/oauth/token",
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
      throw new Error("Kick sync not configured (KICK_CLIENT_ID/KICK_CLIENT_SECRET missing)");
    }
    const slug = handle.replace(/^@/, "").trim().toLowerCase();
    const token = await this.getAppToken();
    const headers = { Authorization: `Bearer ${token}` };

    const channels = await fetchJson<{
      data: Array<{
        broadcaster_user_id: number;
        slug: string;
        active_subscribers_count?: number;
      }>;
    }>(`https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(slug)}`, { headers });

    const channel = channels.data?.[0];
    if (!channel) {
      throw new Error(`Kick channel not found: ${slug}`);
    }

    // Avatar lives on the Users endpoint, keyed by broadcaster_user_id
    let avatarUrl: string | null = null;
    try {
      const users = await fetchJson<{ data: Array<{ user_id: number; profile_picture?: string }> }>(
        `https://api.kick.com/public/v1/users?id=${channel.broadcaster_user_id}`,
        { headers }
      );
      avatarUrl = users.data?.[0]?.profile_picture || null;
    } catch {
      // Avatar is best-effort; subscriber count is the payload that matters
    }

    return {
      handle: channel.slug || slug,
      channelUrl: `https://kick.com/${channel.slug || slug}`,
      avatarUrl,
      subscriberCount:
        typeof channel.active_subscribers_count === "number"
          ? channel.active_subscribers_count
          : null,
      subscriberCountIsEstimate: false,
      followers: null, // not in Kick's official API
    };
  }

  async fetchConnectedStats(auth: ConnectedAuth): Promise<PlatformStats> {
    // With the broadcaster's token (channel:read), the parameterless Channels
    // endpoint returns their own channel — including active_subscribers_count
    // even where the app-token path gates it.
    const headers = { Authorization: `Bearer ${auth.accessToken}` };

    const channels = await fetchJson<{
      data: Array<{
        broadcaster_user_id: number;
        slug: string;
        active_subscribers_count?: number;
      }>;
    }>("https://api.kick.com/public/v1/channels", { headers });

    const channel = channels.data?.[0];
    if (!channel) {
      throw new Error("Kick connection is no longer valid — reconnect in Settings → Platforms");
    }

    // Parameterless Users endpoint is likewise the token's own user
    let avatarUrl: string | null = null;
    try {
      const users = await fetchJson<{ data: Array<{ user_id: number; profile_picture?: string }> }>(
        "https://api.kick.com/public/v1/users",
        { headers }
      );
      avatarUrl = users.data?.[0]?.profile_picture || null;
    } catch {
      // Avatar is best-effort; subscriber count is the payload that matters
    }

    return {
      handle: channel.slug,
      channelUrl: channel.slug ? `https://kick.com/${channel.slug}` : null,
      avatarUrl,
      subscriberCount:
        typeof channel.active_subscribers_count === "number"
          ? channel.active_subscribers_count
          : null,
      subscriberCountIsEstimate: false,
      followers: null, // not in Kick's official API
    };
  }
}
