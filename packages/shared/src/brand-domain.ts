/**
 * Normalize a user-entered website to a bare registrable domain:
 * "https://www.redbull.com/energydrink" → "redbull.com". Returns null when
 * nothing domain-shaped is left, so callers can treat "no domain" and
 * "garbage domain" the same way.
 *
 * Single source of truth (SPO-374): `apps/web`'s New-deal brand form and
 * `BrandMark.tsx` use this to decide whether a domain is worth building a
 * logo URL for; `apps/api`'s `/api/brand-icon` proxy uses the exact same rule
 * as its first SSRF gate — a domain this rejects is never fetched. The two
 * callers must not drift: a shape one side accepts and the other rejects
 * either breaks logos or, worse, becomes a validation gap one side trusts the
 * other to have already closed.
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
