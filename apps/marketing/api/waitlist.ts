// Vercel Edge Function — forwards waitlist signups to the durable API.
//
// This used to keep signups in a module-level array. That array is per-isolate
// and dies on every cold start and redeploy, so leads were acknowledged to the
// visitor and then lost (SPO-207). The only store of record is Postgres, behind
// the shared API; this function exists purely to keep the form same-origin.

export const config = { runtime: "edge" };

export const DEFAULT_UPSTREAM = "https://sponsee.onrender.com/api/waitlist";

export function upstreamUrl(env: Record<string, string | undefined> = process.env): string {
  return env.WAITLIST_UPSTREAM_URL || DEFAULT_UPSTREAM;
}

// Headers the API's rate limiter keys on. Without these every signup arrives
// unattributed and shares one bucket, which would turn the per-network limit
// into a site-wide lockout after a handful of signups.
const FORWARDED_IP_HEADERS = ["x-vercel-forwarded-for", "x-forwarded-for"];

// Front-door secret (SPO-200/SPO-223). This function is a *second* Vercel
// project, so it does not pass through the app's `/api/*` rewrite and nothing
// injects this header for it — it has to send its own.
//
// Two things break without it, and only the first one is loud:
//   1. Under FRONT_DOOR_ENFORCE the origin 403s this call outright, and every
//      waitlist signup on sponsee.app is dropped.
//   2. Even with enforcement off, the API only trusts `x-vercel-forwarded-for`
//      on a front-door-verified request. Unverified, it falls back to the
//      socket address — which is Vercel's egress IP, identical for every
//      visitor. That silently collapses the per-IP limit above into one shared
//      bucket and caps the whole waitlist at WAITLIST_MAX_PER_WINDOW signups
//      per window. Forwarding the IP headers is not enough on its own.
const FRONT_DOOR_HEADER = "x-sponsee-front-door";

export function frontDoorSecret(
  env: Record<string, string | undefined> = process.env
): string {
  return env.FRONT_DOOR_SECRET || "";
}

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:4173",
  "https://sponsee.app",
  "https://www.sponsee.app",
];

export default async function handler(request: Request) {
  const origin = request.headers.get("origin") || "";
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[2];

  const corsHeaders = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  const jsonHeaders = { "Content-Type": "application/json", ...corsHeaders };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // The admin export moved to the API, which reads Postgres rather than one
  // isolate's memory. Answered explicitly so an old bookmark reports the move
  // instead of looking like the endpoint silently broke.
  if (request.method === "GET") {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Moved. Waitlist export is now GET /api/admin/waitlist/export on the API.",
      }),
      { status: 410, headers: { "Content-Type": "application/json" } }
    );
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: jsonHeaders,
    });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid email address." }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const body = (payload ?? {}) as Record<string, unknown>;

  // Honeypot: absorb bots at the edge so they never reach the database.
  if (typeof body.website === "string" && body.website.length > 0) {
    return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
  }

  const forwarded: Record<string, string> = { "Content-Type": "application/json" };
  for (const name of FORWARDED_IP_HEADERS) {
    const value = request.headers.get(name);
    if (value) forwarded[name] = value;
  }

  // Omitted rather than sent empty when unset: an empty header is a *present*
  // header, and the origin treats present-but-wrong as a forgery. Sending
  // nothing keeps the unconfigured case on the fail-open path instead.
  const secret = frontDoorSecret();
  if (secret) forwarded[FRONT_DOOR_HEADER] = secret;

  try {
    const upstream = await fetch(upstreamUrl(), {
      method: "POST",
      headers: forwarded,
      body: JSON.stringify(body),
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      // A lead we could not persist is written to the function log so it can be
      // recovered by hand, rather than disappearing the way the old in-memory
      // store lost them.
      console.error(
        "[WAITLIST_FALLBACK]",
        JSON.stringify({ status: upstream.status, body, at: new Date().toISOString() })
      );
    }

    return new Response(text, {
      status: upstream.status,
      headers: jsonHeaders,
    });
  } catch (err) {
    console.error(
      "[WAITLIST_FALLBACK]",
      JSON.stringify({ error: String(err), body, at: new Date().toISOString() })
    );
    return new Response(
      JSON.stringify({ ok: false, error: "Something went wrong. Try again in a minute." }),
      { status: 502, headers: jsonHeaders }
    );
  }
}
