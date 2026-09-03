// SPO-374 step 2: try the brand's own `/favicon.ico` before ever touching
// unavatar. Free when it works, and discloses nothing to a third party.
//
// Uses Node's core `https.request` rather than `fetch`, specifically so the
// `lookup` option can pin the TCP connection to an address `ssrf-guard.ts`
// already verified is public — `fetch` (via undici) has no equivalent knob
// without pulling in the `undici` package directly. `servername` is set to the
// real hostname so TLS SNI and certificate hostname verification still check
// against the domain, not the IP literal we're actually connecting to.

import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import type { IncomingMessage } from "node:http";
import { resolvePublicAddress, type ResolvedAddress, type LookupFn } from "./ssrf-guard.js";
import { isAllowedIconContentType } from "./icon-content-type.js";

export interface OriginFaviconResult {
  outcome: "hit" | "miss";
  contentType?: string;
  body?: Buffer;
}

export interface OriginFaviconOptions {
  timeoutMs: number;
  maxBytes: number;
  lookupFn?: LookupFn;
}

const MISS: OriginFaviconResult = { outcome: "miss" };

/**
 * Real network I/O against a pinned address. Split out from
 * `fetchOriginFavicon` so tests can exercise the byte-handling rules (size cap,
 * zero-byte trap, non-image content-type trap) against a local HTTP server
 * without going through DNS resolution or the SSRF guard at all.
 */
export function fetchFromPinnedAddress(
  domain: string,
  pinned: ResolvedAddress,
  opts: { timeoutMs: number; maxBytes: number; port?: number; tls?: boolean }
): Promise<OriginFaviconResult> {
  return new Promise((resolve) => {
    const tls = opts.tls ?? true;
    const requestFn = tls ? httpsRequest : httpRequest;

    const req = requestFn(
      {
        host: pinned.address,
        port: opts.port ?? (tls ? 443 : 80),
        path: "/favicon.ico",
        method: "GET",
        servername: tls ? domain : undefined,
        headers: { Host: domain, "User-Agent": "SponseeBrandIconProxy/1.0" },
        timeout: opts.timeoutMs,
        // Do not let Node re-resolve the hostname if something upstream ever
        // passes one in — the whole point is that only the pinned address is
        // ever dialed.
        lookup: (_hostname, _options, callback) => {
          callback(null, pinned.address, pinned.family);
        },
      },
      (res: IncomingMessage) => {
        void handleResponse(res, opts.maxBytes).then(resolve, () => resolve(MISS));
      }
    );

    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => resolve(MISS));
    req.end();
  });
}

async function handleResponse(res: IncomingMessage, maxBytes: number): Promise<OriginFaviconResult> {
  // No redirects, ever — the ticket's "no redirects to private ranges"
  // requirement is satisfied by never following one rather than by validating
  // each hop. `https.request` doesn't auto-follow, so this is just "don't add
  // code to do it," but the check is explicit so this stays true on purpose.
  if (res.statusCode !== 200) {
    res.resume();
    return MISS;
  }

  const contentType = res.headers["content-type"];
  // A misconfigured server answering 200 with an HTML error page is the same
  // trap as the documented zero-byte 200 (raycon.com): a present, non-raster
  // Content-Type is treated as a miss rather than cached as if it were an
  // icon. This also excludes image/svg+xml — see icon-content-type.ts.
  if (!isAllowedIconContentType(contentType)) {
    res.resume();
    return MISS;
  }

  const chunks: Buffer[] = [];
  let total = 0;

  return new Promise((resolve) => {
    res.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        res.destroy();
        resolve(MISS);
        return;
      }
      chunks.push(chunk);
    });

    res.on("end", () => {
      const body = Buffer.concat(chunks);
      // The raycon.com trap: a 200 with an empty body is not a usable icon —
      // caching it would mean an empty tile forever, since a "hit" outcome
      // short-circuits every future request for the domain.
      if (body.length === 0) {
        resolve(MISS);
        return;
      }
      resolve({ outcome: "hit", contentType: contentType || "image/x-icon", body });
    });

    res.on("error", () => resolve(MISS));
  });
}

/**
 * Full pipeline: resolve `domain` to a verified-public address, then fetch
 * `/favicon.ico` from exactly that address. Any SSRF-guard rejection or
 * network failure resolves to a miss — this never throws, so callers can
 * always fall through to the unavatar fallback.
 */
export async function fetchOriginFavicon(
  domain: string,
  opts: OriginFaviconOptions
): Promise<OriginFaviconResult> {
  let pinned: ResolvedAddress;
  try {
    pinned = await resolvePublicAddress(domain, opts.lookupFn);
  } catch {
    return MISS;
  }

  return fetchFromPinnedAddress(domain, pinned, { timeoutMs: opts.timeoutMs, maxBytes: opts.maxBytes });
}
