/**
 * PlatformStatsClient interface — abstraction over public platform APIs.
 * All adapters implement this so the sync job is platform-agnostic,
 * mirroring the EmailProvider pattern in ../email/.
 *
 * No-OAuth v1 (SPO-107): app tokens / API keys only, public data only.
 * Fields the platform doesn't expose come back null and must never
 * overwrite manually entered values.
 */

export interface PlatformStats {
  /** Normalized handle/slug as resolved by the platform */
  handle: string;
  channelUrl: string | null;
  avatarUrl: string | null;
  /** Paid subscriber count (Kick) or public subscriber count (YouTube); null when the platform gates it */
  subscriberCount: number | null;
  /** True when the platform rounds the public count (YouTube: 3 significant figures) */
  subscriberCountIsEstimate: boolean;
  /** Follower total (Twitch); null when the platform doesn't expose it */
  followers: number | null;
}

export interface PlatformStatsClient {
  readonly name: string;

  /** True when the required env credentials are present. Unconfigured clients are skipped by the sync job. */
  isConfigured(): boolean;

  /** Fetch public stats for a channel handle/slug. Throws on API errors or unknown handles. */
  fetchStats(handle: string): Promise<PlatformStats>;
}
