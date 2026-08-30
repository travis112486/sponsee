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

/**
 * Broadcaster OAuth credentials for a connected account (Phase B).
 * Resolved by the caller (see connected.ts) so clients stay auth-agnostic.
 */
export interface ConnectedAuth {
  /** Fresh user access token — refreshed by the caller before each sync */
  accessToken: string;
  /** Provider-side user id of the connected account (Better Auth account.accountId) */
  providerAccountId: string;
}

export interface PlatformStatsClient {
  readonly name: string;

  /** True when the required env credentials are present. Unconfigured clients are skipped by the sync job. */
  isConfigured(): boolean;

  /** Fetch public stats for a channel handle/slug. Throws on API errors or unknown handles. */
  fetchStats(handle: string): Promise<PlatformStats>;

  /**
   * Fetch stats with the broadcaster's own OAuth token, unlocking fields the
   * public API gates (true Twitch subscriber counts). Absent on platforms
   * whose public API already returns everything (YouTube).
   */
  fetchConnectedStats?(auth: ConnectedAuth): Promise<PlatformStats>;
}
