// SPO-374 step 3: fall back to unavatar.io when the brand's own favicon.ico
// didn't resolve. `unavatar.io` is a fixed, vendor-operated hostname — not
// user input — so this does not need the SSRF pinning in ssrf-guard.ts /
// origin-favicon.ts; a hard timeout and a size cap are still worth keeping,
// since unavatar itself proxies other origins and could inherit a slow or
// oversized response from whatever it's aggregating.
//
// `fallback=false` is load-bearing: it's what makes unavatar answer an unknown
// domain with a 404 and an EMPTY body instead of a placeholder image, which is
// the only thing that lets the <img> onError path (-> monogram) fire. See the
// history in BrandMark.tsx (SPO-369) for why the "obvious" alternatives
// (Google, DuckDuckGo favicon endpoints) don't have this property.

import { isAllowedIconContentType } from "./icon-content-type.js";

export interface UnavatarResult {
  outcome: "hit" | "miss";
  contentType?: string;
  body?: Buffer;
}

export interface UnavatarOptions {
  timeoutMs: number;
  maxBytes: number;
  apiKey?: string;
}

const MISS: UnavatarResult = { outcome: "miss" };

export function unavatarUrl(domain: string): string {
  return `https://unavatar.io/${encodeURIComponent(domain)}?fallback=false`;
}

export async function fetchUnavatarFallback(domain: string, opts: UnavatarOptions): Promise<UnavatarResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    const headers: Record<string, string> = {};
    // No key today — SPO-371 decided to stay on the anonymous free tier until
    // metered spend crosses $20/month. Threaded through anyway so a future
    // PRO key is a config change, not a code change.
    if (opts.apiKey) headers["x-api-key"] = opts.apiKey;

    let res: Response;
    try {
      res = await fetch(unavatarUrl(domain), { signal: controller.signal, headers });
    } catch {
      return MISS;
    }

    if (res.status !== 200) return MISS;

    const contentType = res.headers.get("content-type");
    // Raster-only, image/svg+xml included — see icon-content-type.ts. unavatar
    // proxies arbitrary origins, so this is exactly as attacker-influenced as
    // the direct favicon.ico fetch.
    if (!isAllowedIconContentType(contentType)) return MISS;

    const body = await readBounded(res, opts.maxBytes);
    if (body === null || body.length === 0) return MISS;

    return { outcome: "hit", contentType: contentType || "image/x-icon", body };
  } finally {
    clearTimeout(timer);
  }
}

/** Reads a Response body up to `maxBytes`, returning null if it overflows. */
async function readBounded(res: Response, maxBytes: number): Promise<Buffer | null> {
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > maxBytes ? null : buf;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  }

  return Buffer.concat(chunks);
}
