/* eslint-disable react-refresh/only-export-components */
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Initials for a brand name: first letter of the first two words, or the first
 * two letters of a single word. Exported so a caller can build an `aria-label`
 * or a test assertion without re-deriving the rule.
 */
export function brandInitials(brand: string): string {
  const words = brand.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/**
 * Normalize a user-entered website to a bare registrable domain:
 * "https://www.redbull.com/energydrink" → "redbull.com". Returns null when
 * nothing domain-shaped is left, so callers can treat "no domain" and
 * "garbage domain" the same way. Exported for the New-deal brand form.
 */
export function normalizeBrandDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.trim().toLowerCase();
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^www\./, "");
  d = d.split(/[/?#]/, 1)[0] ?? "";
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(d)) return null;
  return d;
}

/**
 * unavatar.io aggregates favicon/logo sources and, with `fallback=false`,
 * answers 404 with an EMPTY body when it finds nothing — which is what lets
 * the <img> onError path (→ monogram) actually fire. The obvious alternatives
 * fail here: Google's favicon endpoints and DuckDuckGo's ip3 both ship their
 * placeholder as the 404 *body*, and browsers render a 404 image body without
 * raising onError, so unknown brands would show a grey globe instead of our
 * monogram (verified against redbull.com / bangenergy.com / voltaic.energy).
 */
function brandIconUrl(domain: string): string {
  return `https://unavatar.io/${encodeURIComponent(domain)}?fallback=false`;
}

/**
 * Deterministic warm tint for the monogram fallback, keyed on the name so a
 * brand keeps its color across screens. Stays inside the warm-paper set —
 * brick is excluded because red tiles would read as overdue/error states.
 */
const monogramTints = [
  "bg-pine-tint text-pine",
  "bg-amber-tint text-amber",
  "bg-ink/[.06] text-ink-2",
];

function tintFor(brand: string): string {
  let h = 0;
  for (let i = 0; i < brand.length; i++) h = (h * 31 + brand.charCodeAt(i)) | 0;
  return monogramTints[Math.abs(h) % monogramTints.length];
}

/**
 * Brand mark tile. With a resolvable `domain` it shows the brand's real icon
 * (inset on white so odd-shaped favicons still read as a tidy tile); without
 * one — or when the icon 404s — it falls back to the initials monogram from
 * the mockup's `DealCard.tsx`, now on a deterministic warm tint.
 */
export function BrandMark({
  brand,
  domain,
  size = 28,
  className,
}: {
  brand: string;
  domain?: string | null;
  size?: number;
  className?: string;
}) {
  // Failure is remembered per-domain, so editing a brand's website retries the
  // new domain instead of staying stuck on the monogram forever.
  const [failedDomain, setFailedDomain] = useState<string | null>(null);
  const cleanDomain = normalizeBrandDomain(domain);
  const logoFailed = cleanDomain !== null && failedDomain === cleanDomain;

  if (cleanDomain && !logoFailed) {
    const inset = Math.round(size * 0.66);
    return (
      <span
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-white ring-1 ring-inset ring-hairline",
          className
        )}
        style={{ width: size, height: size }}
      >
        <img
          key={cleanDomain}
          src={brandIconUrl(cleanDomain)}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailedDomain(cleanDomain)}
          className="object-contain"
          style={{ width: inset, height: inset }}
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md font-semibold ring-1 ring-inset ring-hairline",
        tintFor(brand),
        className
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {brandInitials(brand)}
    </span>
  );
}

export default BrandMark;
