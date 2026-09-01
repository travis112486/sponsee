import type { Platform } from "@sponsee/shared";

/**
 * Platform colour and label tokens (SPO-193).
 *
 * Every map is keyed off the shared `Platform` union, so adding a fifth
 * platform to `@sponsee/shared` reds this file rather than rendering an
 * invisible dot. The classes are configured brand tokens from
 * `tailwind.config.js` — never a raw Tailwind palette class.
 *
 * Lives outside the component file so `PlatformDot.tsx` exports components only
 * (react-refresh) and so a screen can tint text or a border without importing a
 * component it does not render.
 */
export const platformBgClasses: Record<Platform, string> = {
  twitch: "bg-twitch",
  youtube: "bg-youtube",
  kick: "bg-kick",
  tiktok: "bg-tiktok",
};

export const platformTextClasses: Record<Platform, string> = {
  twitch: "text-twitch",
  youtube: "text-youtube",
  kick: "text-kick",
  tiktok: "text-tiktok",
};

/** Two-letter code for tight surfaces (deal cards, legend rows). */
export const platformShortLabels: Record<Platform, string> = {
  twitch: "TW",
  youtube: "YT",
  kick: "KK",
  tiktok: "TT",
};
