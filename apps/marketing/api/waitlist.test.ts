import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import handler, { DEFAULT_UPSTREAM, upstreamUrl } from "./waitlist.js";

// SPO-207. This function used to keep signups in a module-level array, so a
// visitor was told they were on the list and the row died with the isolate.
// These tests pin the replacement: every accepted signup reaches the durable
// API, and one that cannot is written to the log rather than dropped.
//
// The admin export that used to live here moved to the API (Postgres-backed);
// its SPO-88 security properties are pinned in apps/api/src/routers/waitlist.test.ts.

const ORIGIN = "https://sponsee.app";
const ENDPOINT = "https://sponsee.app/api/waitlist";

function post(body: unknown, headers: Record<string, string> = {}) {
  return handler(
    new Request(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: ORIGIN, ...headers },
      body: JSON.stringify(body),
    })
  );
}

function upstreamReturns(status: number, body: unknown) {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(body), { status })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("waitlist proxy", () => {
  it("forwards a signup to the durable API and returns its response", async () => {
    const fetchMock = upstreamReturns(200, { ok: true, duplicate: false, confirmed: false });

    const res = await post({ email: "streamer@example.com", streamerName: "pokimane" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, duplicate: false, confirmed: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(DEFAULT_UPSTREAM);
    expect(JSON.parse(init.body as string)).toMatchObject({
      email: "streamer@example.com",
      streamerName: "pokimane",
    });
  });

  it("keeps no local state — the same email is forwarded every time", async () => {
    const fetchMock = upstreamReturns(200, { ok: true, duplicate: false });

    await post({ email: "streamer@example.com" });
    await post({ email: "streamer@example.com" });

    // The old in-memory store answered the second call itself, which is exactly
    // how signups went missing. Duplicate detection belongs to the database.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("forwards the client IP headers the API rate-limits on", async () => {
    const fetchMock = upstreamReturns(200, { ok: true });

    await post(
      { email: "streamer@example.com" },
      { "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "203.0.113.7, 10.0.0.1" }
    );

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(headers["x-vercel-forwarded-for"]).toBe("203.0.113.7");
    expect(headers["x-forwarded-for"]).toBe("203.0.113.7, 10.0.0.1");
  });

  // SPO-223. Forwarding the IP headers above is necessary but not sufficient:
  // this is a separate Vercel project, so nothing injects the front-door header
  // for it. Without the secret the origin 403s the call under enforcement, and
  // even with enforcement off it distrusts `x-vercel-forwarded-for` and buckets
  // every visitor under Vercel's egress IP — capping the whole waitlist at one
  // window's worth of signups. Caught in production, not in review.
  it("sends the front-door secret so the origin trusts the forwarded IP", async () => {
    const fetchMock = upstreamReturns(200, { ok: true });
    vi.stubEnv("FRONT_DOOR_SECRET", "s3cr3t");

    await post({ email: "streamer@example.com" }, { "x-vercel-forwarded-for": "203.0.113.7" });

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(headers["x-sponsee-front-door"]).toBe("s3cr3t");
  });

  it("omits the front-door header entirely when no secret is configured", async () => {
    const fetchMock = upstreamReturns(200, { ok: true });
    vi.stubEnv("FRONT_DOOR_SECRET", "");

    await post({ email: "streamer@example.com" });

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    // Present-but-empty reads as a forgery at the origin and is rejected under
    // enforcement; absent keeps the unconfigured case on the fail-open path.
    expect("x-sponsee-front-door" in headers).toBe(false);
  });

  it("absorbs honeypot submissions without touching the database", async () => {
    const fetchMock = upstreamReturns(200, { ok: true });

    const res = await post({ email: "bot@example.com", website: "http://spam.example" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs a recoverable record when the upstream rejects the signup", async () => {
    upstreamReturns(500, { ok: false, error: "boom" });

    const res = await post({ email: "streamer@example.com" });

    expect(res.status).toBe(500);
    const logged = (console.error as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(logged[0]).toBe("[WAITLIST_FALLBACK]");
    expect(logged[1]).toContain("streamer@example.com");
  });

  it("logs a recoverable record and returns 502 when the upstream is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));

    const res = await post({ email: "streamer@example.com" });

    expect(res.status).toBe(502);
    expect((await res.json()).ok).toBe(false);
    const logged = (console.error as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(logged[0]).toBe("[WAITLIST_FALLBACK]");
    expect(logged[1]).toContain("streamer@example.com");
  });

  it("rejects a malformed body without calling the upstream", async () => {
    const fetchMock = upstreamReturns(200, { ok: true });

    const res = await handler(
      new Request(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: ORIGIN },
        body: "not json",
      })
    );

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("waitlist proxy configuration", () => {
  it("defaults to the deployed API", () => {
    expect(upstreamUrl({})).toBe(DEFAULT_UPSTREAM);
  });

  it("honours WAITLIST_UPSTREAM_URL", () => {
    expect(upstreamUrl({ WAITLIST_UPSTREAM_URL: "http://localhost:3001/api/waitlist" })).toBe(
      "http://localhost:3001/api/waitlist"
    );
  });
});

describe("retired admin export", () => {
  it("reports that the export moved instead of serving stale in-memory data", async () => {
    const res = await handler(new Request(ENDPOINT, { method: "GET" }));

    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body).not.toHaveProperty("entries");
    expect(body.error).toContain("/api/admin/waitlist/export");
  });

  it("sends no CORS headers on the retired export", async () => {
    const res = await handler(
      new Request(ENDPOINT, { method: "GET", headers: { origin: ORIGIN } })
    );

    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("does not allow GET or the admin token header through CORS preflight", async () => {
    const res = await handler(
      new Request(ENDPOINT, { method: "OPTIONS", headers: { origin: ORIGIN } })
    );

    expect(res.headers.get("Access-Control-Allow-Methods")).not.toContain("GET");
    expect(res.headers.get("Access-Control-Allow-Headers")).not.toContain(
      "x-waitlist-admin-token"
    );
  });
});
