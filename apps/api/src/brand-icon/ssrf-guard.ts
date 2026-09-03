// SPO-374: `/api/brand-icon` fetches `https://<domain>/favicon.ico` for a
// `domain` that is entirely user-controlled (it comes off the request, not out
// of a trusted table). Domain shape validation (normalizeBrandDomain) already
// rejects literal IPs and non-http(s) schemes, but a domain's *DNS* is under
// the same control as the domain string itself — nothing stops
// `evil.example.com` from having an A record pointing at 169.254.169.254 or
// 127.0.0.1. This module is the guard against that: resolve first, verify
// every returned address is public, and hand the caller back one address to
// pin the actual connection to.
//
// Pinning matters as much as the check. Resolving here and then handing the
// hostname (not the resolved address) to the HTTP client would let DNS answer
// differently the second time — a private-if-you-ask-twice record defeats a
// check that only ever asks once. `origin-favicon.ts` connects to exactly the
// address this module returns; it never re-resolves the hostname itself.

import { BlockList } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

export class UnsafeHostError extends Error {
  constructor(hostname: string) {
    super(`Refusing to fetch "${hostname}": it does not resolve to a public address`);
    this.name = "UnsafeHostError";
  }
}

/**
 * Private, loopback, link-local (including the 169.254.169.254 cloud-metadata
 * address), CGNAT, documentation/benchmarking, and multicast/reserved ranges.
 * `node:net`'s `BlockList` does real CIDR matching rather than hand-rolled bit
 * math, so a mistake here is a missing subnet, not an arithmetic bug.
 */
function buildBlockList(): BlockList {
  const list = new BlockList();

  const ipv4Ranges: Array<[string, number]> = [
    ["0.0.0.0", 8], // "this network"
    ["10.0.0.0", 8], // RFC1918
    ["100.64.0.0", 10], // CGNAT (RFC6598)
    ["127.0.0.0", 8], // loopback
    ["169.254.0.0", 16], // link-local, incl. cloud metadata (169.254.169.254)
    ["172.16.0.0", 12], // RFC1918
    ["192.0.0.0", 24], // IETF protocol assignments
    ["192.0.2.0", 24], // TEST-NET-1
    ["192.168.0.0", 16], // RFC1918
    ["198.18.0.0", 15], // benchmarking
    ["198.51.100.0", 24], // TEST-NET-2
    ["203.0.113.0", 24], // TEST-NET-3
    ["224.0.0.0", 4], // multicast
    ["240.0.0.0", 4], // reserved (incl. 255.255.255.255)
  ];
  for (const [address, prefix] of ipv4Ranges) list.addSubnet(address, prefix, "ipv4");

  const ipv6Ranges: Array<[string, number]> = [
    ["::1", 128], // loopback
    ["::", 128], // unspecified
    ["fc00::", 7], // unique local
    ["fe80::", 10], // link-local
    ["ff00::", 8], // multicast
    // No explicit ::ffff:0:0/96 (IPv4-mapped) entry: BlockList already maps a
    // v6 check for an IPv4-mapped address onto the v4 subnets above (verified
    // — `check("::ffff:127.0.0.1", "ipv6")` is `true` from the 127.0.0.0/8
    // rule alone). Adding an explicit /96 rule here does NOT layer on top of
    // that — it corrupts it: with the rule present, `check("<any public
    // IPv4>", "ipv4")` also comes back `true`, i.e. it blocks every IPv4
    // address, not just mapped ones. That is a BlockList quirk, not a
    // hypothetical; a public-address unit test caught it before this comment
    // did.
  ];
  for (const [address, prefix] of ipv6Ranges) list.addSubnet(address, prefix, "ipv6");

  return list;
}

const blockedRanges = buildBlockList();

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type LookupFn = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: LookupFn = (hostname) => dnsLookup(hostname, { all: true });

/**
 * Resolves `hostname` and returns one address to pin the connection to, having
 * verified every address DNS returned — not just the first — is public.
 * Verifying only "at least one is public" would let a multi-answer response mix
 * in a public decoy and rely on the caller picking whichever one it likes;
 * requiring all of them closes that.
 */
export async function resolvePublicAddress(
  hostname: string,
  lookupFn: LookupFn = defaultLookup
): Promise<ResolvedAddress> {
  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookupFn(hostname);
  } catch {
    throw new UnsafeHostError(hostname);
  }

  if (records.length === 0) throw new UnsafeHostError(hostname);

  for (const { address, family } of records) {
    if (family !== 4 && family !== 6) throw new UnsafeHostError(hostname);
    if (blockedRanges.check(address, family === 4 ? "ipv4" : "ipv6")) {
      throw new UnsafeHostError(hostname);
    }
  }

  const [first] = records;
  return { address: first.address, family: first.family as 4 | 6 };
}
