/**
 * Normalize a user-entered website to a bare registrable domain:
 * "https://www.redbull.com/energydrink" → "redbull.com". Returns null when
 * nothing domain-shaped is left, so callers can treat "no domain" and
 * "garbage domain" the same way.
 *
 * Single source of truth (SPO-374, enforced SPO-395): this is the only copy in
 * the repo. `apps/api`'s `/api/brand-icon` proxy calls it as its first SSRF
 * gate — a domain this rejects is never fetched — and `apps/web` reaches it
 * through `BrandMark.tsx`, which imports it from here and re-exports it, to
 * decide whether a domain is worth building a logo URL for. Keeping that one
 * function body is the point: a second copy would let a shape one side accepts
 * and the other rejects either break logos or, worse, become a validation gap
 * one side trusts the other to have already closed. (SPO-374 landed with a
 * duplicate in `BrandMark.tsx` that happened to agree; SPO-395 removed it.)
 *
 * `packages/shared/src/brand-domain.test.ts` is the suite that pins the rule.
 *
 * The trailing `\.[a-z]{2,}$` requirement is what keeps this from ever
 * accepting a bare IPv4/IPv6 literal or an unqualified host like
 * `localhost` — every accepted value has a dotted alphabetic TLD.
 */
export function normalizeBrandDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.trim().toLowerCase();
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^www\./, "");
  d = d.split(/[/?#]/, 1)[0] ?? "";
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(d)) return null;
  return d;
}
