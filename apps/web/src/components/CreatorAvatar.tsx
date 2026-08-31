import { useState } from "react";
import { cn } from "@/lib/utils";
import { avatarInitial } from "@/lib/creator-identity";

/**
 * Profile picture with a generated-initial fallback.
 *
 * Decorative by default: every caller today sits next to the creator's name in
 * text or inside a labelled control, so an `alt` repeating the name would just
 * make screen readers say it twice.
 *
 * A synced platform avatar is a third-party CDN URL that can 404 long after the
 * daily job stored it (Twitch rotates asset paths, a channel gets deleted), so
 * a load failure falls through to the initial instead of leaving a broken image.
 */
export default function CreatorAvatar({
  src,
  name,
  className,
  alt = "",
}: {
  src: string | null;
  name: string | null | undefined;
  className?: string;
  alt?: string;
}) {
  // Records *which* URL failed rather than a boolean, so a later sync supplying
  // a different avatar retries on its own — no reset effect.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (src && src !== failedSrc) {
    return (
      <img
        src={src}
        alt={alt}
        onError={() => setFailedSrc(src)}
        className={cn("rounded-full object-cover", className)}
      />
    );
  }

  return (
    <span
      aria-hidden={alt ? undefined : true}
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      className={cn(
        "flex select-none items-center justify-center rounded-full bg-pine-tint font-semibold text-pine",
        className
      )}
    >
      {avatarInitial(name)}
    </span>
  );
}
