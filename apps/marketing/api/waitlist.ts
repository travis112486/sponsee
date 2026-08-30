// Vercel Edge Function — temporary waitlist capture
// NOTE: In-memory store resets on cold starts / redeploys.
// Durable storage requires the shared API + Postgres (SPO-18 follow-up).

export const config = { runtime: "edge" };

interface Entry {
  email: string;
  platforms?: string[];
  ccvBand?: string;
  source: string;
  createdAt: string;
}

// In-memory store (ephemeral — see note above)
const store: Entry[] = [];

// Header the admin export reads the token from. A query string ends up in
// Vercel's request logs and in any referrer, so the token never travels there.
export const ADMIN_TOKEN_HEADER = "x-waitlist-admin-token";

/**
 * Constant-time string comparison for the admin token.
 *
 * Both sides are HMAC'd under a freshly generated random key and the fixed-width
 * digests are compared, so neither the timing nor the length of the comparison
 * leaks anything about the expected token. `crypto.subtle` is available in the
 * Vercel Edge runtime; `node:crypto.timingSafeEqual` is not.
 */
export async function constantTimeEquals(a: string, b: string): Promise<boolean> {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const encoder = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.sign("HMAC", key, encoder.encode(a)),
    crypto.subtle.sign("HMAC", key, encoder.encode(b)),
  ]);
  const bytesA = new Uint8Array(digestA);
  const bytesB = new Uint8Array(digestB);
  let diff = 0;
  for (let i = 0; i < bytesA.length; i++) diff |= bytesA[i] ^ bytesB[i];
  return diff === 0;
}

export default async function handler(request: Request) {
  const origin = request.headers.get("origin") || "";
  const allowed = ["http://localhost:5173", "http://localhost:4173", "https://sponsee.app", "https://www.sponsee.app"];
  const corsOrigin = allowed.includes(origin) ? origin : allowed[2];

  const corsHeaders = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Admin export of captured emails. This returns PII, so it is deliberately
  // NOT given CORS headers: no browser origin should ever be able to read it.
  if (request.method === "GET") {
    const adminToken = process.env.WAITLIST_ADMIN_TOKEN ?? "";
    // Fail closed. A default token would mean an unset env var on Vercel
    // silently publishes every captured email address.
    if (adminToken.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, error: "Waitlist export is not configured." }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }
    const presented = request.headers.get(ADMIN_TOKEN_HEADER) ?? "";
    if (!(await constantTimeEquals(presented, adminToken))) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, count: store.length, entries: store }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  try {
    const body = await request.json();
    const email = String(body.email || "").toLowerCase().trim();
    const platforms = Array.isArray(body.platforms) ? body.platforms.filter((p: unknown) => typeof p === "string") : undefined;
    const ccvBand = body.ccvBand ? String(body.ccvBand) : undefined;
    const source = body.source ? String(body.source) : "landing";
    const website = body.website ? String(body.website) : "";

    // Honeypot
    if (website.length > 0) {
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid email address." }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const existing = store.find((e) => e.email === email);
    if (existing) {
      return new Response(JSON.stringify({ ok: true, duplicate: true }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const entry: Entry = { email, platforms, ccvBand, source, createdAt: new Date().toISOString() };
    store.push(entry);

    // Log for exportability (Vercel Function Logs)
    console.log("[WAITLIST]", JSON.stringify(entry));

    return new Response(JSON.stringify({ ok: true, duplicate: false }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Something went wrong. Try again in a minute." }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
}
