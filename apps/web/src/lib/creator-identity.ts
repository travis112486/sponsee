import { platforms, platformLabels, type Platform } from "@sponsee/shared";

/**
 * The subset of a `creator_platforms` row this module reasons about. Kept
 * structural rather than importing the Drizzle row type so tests (and any
 * future public-profile surface) can pass plain objects.
 */
export type IdentityPlatform = {
  platform: string;
  handle?: string | null;
  avatarUrl?: string | null;
  ccv?: number | null;
  followers?: number | null;
  subscriberCount?: number | null;
};

const platformOrder = new Map<string, number>(platforms.map((p, i) => [p, i]));

/**
 * Avatar URLs reach this app from three places with three trust levels: the
 * creator types one into Settings, the daily sync copies one out of a platform
 * API, and Better Auth stores one from the OAuth provider. Only the first is
 * validated at the write boundary (`httpsUrl` in routers/settings.ts), so the
 * render boundary re-checks all three rather than trusting provenance.
 *
 * https only — a `javascript:`/`data:` value must never reach an `img src`, and
 * plain http would be blocked as mixed content in production anyway.
 */
export function safeAvatarUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

function audienceOf(row: IdentityPlatform): number {
  return row.subscriberCount ?? row.followers ?? 0;
}

/**
 * Orders a creator's platforms "biggest first" so the rest of the app has one
 * answer to "which platform is this creator?".
 *
 * CCV leads because it is the number Sponsee prices deals on; subscriber /
 * follower count breaks ties between platforms that have not synced a CCV yet,
 * and the declared platform order is the final tiebreak so the result is stable
 * for a creator whose rows carry no stats at all.
 */
export function rankPlatforms(rows: readonly IdentityPlatform[] | null | undefined): IdentityPlatform[] {
  return [...(rows ?? [])].sort((a, b) => {
    const ccv = (b.ccv ?? -1) - (a.ccv ?? -1);
    if (ccv !== 0) return ccv;
    const audience = audienceOf(b) - audienceOf(a);
    if (audience !== 0) return audience;
    return (
      (platformOrder.get(a.platform) ?? platforms.length) -
      (platformOrder.get(b.platform) ?? platforms.length)
    );
  });
}

/**
 * Resolution order per SPO-154: the creator's own Settings avatar wins, then
 * the avatar the daily job synced from their biggest platform, then whatever
 * the auth provider had. A miss returns null so the caller renders a generated
 * initial — never the /pixelpanda-avatar.png mockup asset, which made real
 * creators look like the demo account.
 */
export function resolveAvatarUrl(input: {
  profileAvatarUrl?: string | null;
  platformRows?: readonly IdentityPlatform[] | null;
  userImage?: string | null;
}): string | null {
  const fromProfile = safeAvatarUrl(input.profileAvatarUrl);
  if (fromProfile) return fromProfile;

  for (const row of rankPlatforms(input.platformRows)) {
    const synced = safeAvatarUrl(row.avatarUrl);
    if (synced) return synced;
  }

  return safeAvatarUrl(input.userImage);
}

/** Single character for the generated fallback avatar. */
export function avatarInitial(name: string | null | undefined): string {
  const match = name?.match(/\p{L}|\p{N}/u);
  return match ? match[0].toUpperCase() : "?";
}

/**
 * "Twitch · @pixelpanda" for the sidebar identity chip. Returns null when no
 * platform has a handle yet — the chip drops the line rather than falling back
 * to the hardcoded "Creator" subtitle it used to show everyone.
 */
export function platformSubtitle(rows: readonly IdentityPlatform[] | null | undefined): string | null {
  const primary = rankPlatforms(rows).find((row) => row.handle?.trim());
  if (!primary) return null;
  const label = platformLabels[primary.platform as Platform] ?? primary.platform;
  return `${label} · @${primary.handle!.trim().replace(/^@/, "")}`;
}
