/* eslint-disable react-refresh/only-export-components */
import { useState } from "react";
import { normalizeBrandDomain } from "@sponsee/shared";
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
 * `normalizeBrandDomain` lives in `@sponsee/shared` (SPO-395) because
 * `/api/brand-icon` uses the same function as its first SSRF gate — a second
 * copy here would let the client's "is this domain worth rendering" check and
 * the server's "may we fetch this" check drift apart. Re-exported, not just
 * imported, so `@/components/shared/BrandMark` stays a valid import site for it
 * — `Pipeline.tsx`'s New-deal brand form gets it from here. Edit the rule in
 * `packages/shared/src/brand-domain.ts`, not here.
 */
export { normalizeBrandDomain };

/**
 * SPO-374/377: the browser never talks to unavatar.io directly. This hits our
 * own `/api/brand-icon` proxy — same-origin via the `/api/*` Vercel rewrite,
 * so a relative URL, not the Render host — which does the favicon-first-then-
 * unavatar lookup server-side and, on every miss, answers 404 with an EMPTY
 * body. That empty body is what lets the <img> onError path (→ monogram)
 * actually fire, the same contract that ruled out Google's and DuckDuckGo's
 * favicon endpoints, which ship their placeholder as the 404 *body* and never
 * raise onError.
 */
function brandIconUrl(domain: string): string {
  return `/api/brand-icon?domain=${encodeURIComponent(domain)}`;
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
          // Remount on domain change. The per-domain `failedDomain` state above
          // is what the jsdom regression pins, but the key guarantees a real
          // browser tears down the old <img> (and any in-flight load / stale
          // frame) instead of mutating `src` on a retained node — behaviour a
          // jsdom `fireEvent.error` cannot observe. Kept deliberately; if it is
          // ever removed, re-check real-browser retry, not just the test.
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
