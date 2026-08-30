import { TwitchClient } from "./twitch.js";
import { KickClient } from "./kick.js";
import { YouTubeClient } from "./youtube.js";
import type { PlatformStatsClient } from "./types.js";

export * from "./types.js";
export { TwitchClient, KickClient, YouTubeClient };

/**
 * Factory: returns the stats client for a platform, or null when the
 * platform has no usable public API (TikTok Live stays manual entry).
 */
export function createPlatformClient(platform: string): PlatformStatsClient | null {
  switch (platform) {
    case "twitch":
      return new TwitchClient();
    case "kick":
      return new KickClient();
    case "youtube":
      return new YouTubeClient();
    default:
      return null;
  }
}
