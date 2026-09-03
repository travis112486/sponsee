// SPO-374: GET /api/brand-icon?domain=<domain>
//
// Moves brand-logo fetching server-side so a creator's brand-domain list —
// their live deal pipeline — never reaches unavatar.io from the browser. See
// the SPO-371 decision doc for why this is (c)-with-a-cache rather than
// dropping unavatar entirely: an origin favicon.ico only resolves for roughly
// half of brands, so unavatar stays as the fallback, just called from here
// instead of from the creator's browser.
//
// Failure semantics are load-bearing: every miss path (invalid domain,
// rate-limited, SSRF-blocked, no icon found anywhere) returns 404 with an
// EMPTY body. Returning an image body on a non-2xx status — the trap BrandMark
// documents against Google's and DuckDuckGo's favicon endpoints — would stop
// the <img> onError handler from firing and break the monogram fallback.

import { Hono, type Context } from "hono";
import { normalizeBrandDomain } from "@sponsee/shared";
import { clientIp } from "../client-ip.js";
import { SlidingWindowLimiter } from "../rate-limit.js";
import { getFreshCachedIcon, putCachedIcon } from "./cache.js";
import { fetchOriginFavicon } from "./origin-favicon.js";
import { fetchUnavatarFallback } from "./unavatar-fallback.js";
import { unavatarDailyCounter } from "./quota.js";

// Generous relative to a real favicon (typically a few KB): bounds a
// misbehaving origin without rejecting a legitimate high-res icon.
export const MAX_ICON_BYTES = 512 * 1024;
export const FAVICON_TIMEOUT_MS = 4_000;
export const UNAVATAR_TIMEOUT_MS = 5_000;

// A full pipeline render can request logos for dozens of distinct brands at
// once; this bounds scripted abuse (burning DB writes / unavatar quota with
// garbage domains) without throttling a real render.
export const BRAND_ICON_MAX_PER_WINDOW = 120;
export const BRAND_ICON_WINDOW_MS = 60 * 1000;

export const brandIconLimiter = new SlidingWindowLimiter(BRAND_ICON_MAX_PER_WINDOW, BRAND_ICON_WINDOW_MS);

const HIT_CACHE_CONTROL = "public, max-age=2592000, immutable"; // 28 days, matches cache.ts HIT_TTL_MS
const MISS_CACHE_CONTROL = "public, max-age=86400"; // 24 hours, matches cache.ts MISS_TTL_MS

const app = new Hono();

function emptyMiss(c: Context, status: 404 | 429 = 404, headers: Record<string, string> = {}) {
  return c.body(null, status, { "Cache-Control": status === 404 ? MISS_CACHE_CONTROL : "no-store", ...headers });
}

// Hono's c.body() wants a plain-ArrayBuffer-backed Uint8Array; Buffer's type
// admits SharedArrayBuffer, which the overload rejects even though nothing
// here ever produces one. Copies into a fresh Uint8Array rather than reusing
// Buffer's underlying storage.
function iconBody(buf: Buffer): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(buf.length);
  out.set(buf);
  return out;
}

app.get("/", async (c) => {
  const ip = clientIp(c.req.raw.headers) ?? "unknown";
  const decision = brandIconLimiter.check(ip);
  if (!decision.allowed) {
    return emptyMiss(c, 429, { "Retry-After": String(decision.retryAfter) });
  }

  const domain = normalizeBrandDomain(c.req.query("domain"));
  if (!domain) return emptyMiss(c);

  const cached = await getFreshCachedIcon(domain);
  if (cached) {
    if (cached.outcome === "miss") return emptyMiss(c);
    return c.body(iconBody(cached.body!), 200, {
      "Content-Type": cached.contentType!,
      "Cache-Control": HIT_CACHE_CONTROL,
    });
  }

  const originResult = await fetchOriginFavicon(domain, {
    timeoutMs: FAVICON_TIMEOUT_MS,
    maxBytes: MAX_ICON_BYTES,
  });

  if (originResult.outcome === "hit") {
    await putCachedIcon(domain, {
      outcome: "hit",
      contentType: originResult.contentType!,
      body: originResult.body!,
      source: "favicon",
    });
    return c.body(iconBody(originResult.body!), 200, {
      "Content-Type": originResult.contentType!,
      "Cache-Control": HIT_CACHE_CONTROL,
    });
  }

  if (unavatarDailyCounter.tryConsume()) {
    const fallbackResult = await fetchUnavatarFallback(domain, {
      timeoutMs: UNAVATAR_TIMEOUT_MS,
      maxBytes: MAX_ICON_BYTES,
      apiKey: process.env.UNAVATAR_API_KEY,
    });

    if (fallbackResult.outcome === "hit") {
      await putCachedIcon(domain, {
        outcome: "hit",
        contentType: fallbackResult.contentType!,
        body: fallbackResult.body!,
        source: "unavatar",
      });
      return c.body(iconBody(fallbackResult.body!), 200, {
        "Content-Type": fallbackResult.contentType!,
        "Cache-Control": HIT_CACHE_CONTROL,
      });
    }
  }

  await putCachedIcon(domain, { outcome: "miss" });
  return emptyMiss(c);
});

export default app;
