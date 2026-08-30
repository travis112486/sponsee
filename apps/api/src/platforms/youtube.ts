import type { PlatformStats, PlatformStatsClient } from "./types.js";
import { fetchJson } from "./http.js";

/**
 * YouTube Data API v3 adapter (API key, no OAuth).
 * channels.list with part=statistics,snippet — 1 quota unit per check
 * against the 10,000/day free quota.
 *
 * Public subscriberCount is rounded to 3 significant figures, so we flag
 * it as an estimate. Accepts @handles or raw UC… channel IDs.
 */

interface ChannelsListResponse {
  items?: Array<{
    id: string;
    snippet?: {
      customUrl?: string;
      thumbnails?: Record<string, { url?: string }>;
    };
    statistics?: {
      subscriberCount?: string;
      hiddenSubscriberCount?: boolean;
    };
  }>;
}

const CHANNEL_ID_RE = /^UC[0-9A-Za-z_-]{22}$/;

export class YouTubeClient implements PlatformStatsClient {
  readonly name = "youtube";
  private readonly apiKey: string;

  constructor(apiKey = process.env.YOUTUBE_API_KEY || "") {
    this.apiKey = apiKey;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async fetchStats(handle: string): Promise<PlatformStats> {
    if (!this.isConfigured()) {
      throw new Error("YouTube sync not configured (YOUTUBE_API_KEY missing)");
    }
    const input = handle.trim();
    const bare = input.replace(/^@/, "");
    const params = new URLSearchParams({
      part: "statistics,snippet",
      key: this.apiKey,
    });
    if (CHANNEL_ID_RE.test(bare)) {
      params.set("id", bare);
    } else {
      params.set("forHandle", bare);
    }

    const res = await fetchJson<ChannelsListResponse>(
      `https://www.googleapis.com/youtube/v3/channels?${params.toString()}`
    );

    const channel = res.items?.[0];
    if (!channel) {
      throw new Error(`YouTube channel not found: ${input}`);
    }

    const hidden = channel.statistics?.hiddenSubscriberCount === true;
    const rawCount = channel.statistics?.subscriberCount;
    const subscriberCount = !hidden && rawCount != null ? parseInt(rawCount, 10) : null;

    const thumbs = channel.snippet?.thumbnails;
    const avatarUrl = thumbs?.high?.url || thumbs?.medium?.url || thumbs?.default?.url || null;

    const customUrl = channel.snippet?.customUrl; // e.g. "@somehandle"
    const normalizedHandle = customUrl ? customUrl.replace(/^@/, "") : bare;

    return {
      handle: normalizedHandle,
      channelUrl: customUrl
        ? `https://www.youtube.com/${customUrl}`
        : `https://www.youtube.com/channel/${channel.id}`,
      avatarUrl,
      subscriberCount: Number.isFinite(subscriberCount as number) ? subscriberCount : null,
      subscriberCountIsEstimate: subscriberCount != null, // YouTube rounds public counts
      followers: null,
    };
  }
}
