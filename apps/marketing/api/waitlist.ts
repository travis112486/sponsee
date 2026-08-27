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

  if (request.method === "GET") {
    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    const adminToken = process.env.WAITLIST_ADMIN_TOKEN || "dev-token";
    if (token !== adminToken) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    return new Response(JSON.stringify({ ok: true, count: store.length, entries: store }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
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
