import { describe, it, expect, beforeEach, afterEach } from "vitest";
import handler, { ADMIN_TOKEN_HEADER, constantTimeEquals } from "./waitlist.js";

// SPO-88 MEDIUM-1. The admin GET returns every captured waitlist email. Before
// this pass it was gated by `process.env.WAITLIST_ADMIN_TOKEN || "dev-token"`,
// so an unset env var on Vercel turned `?token=dev-token` into a public PII
// dump. These tests pin the three properties of the fix: fail closed, header
// only, and no browser origin can read the response.

const ORIGIN = "https://sponsee.app";
const ENDPOINT = "https://sponsee.app/api/waitlist";

function get(headers: Record<string, string> = {}, url = ENDPOINT) {
  return handler(new Request(url, { method: "GET", headers }));
}

function post(body: unknown) {
  return handler(
    new Request(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: ORIGIN },
      body: JSON.stringify(body),
    })
  );
}

const originalToken = process.env.WAITLIST_ADMIN_TOKEN;

beforeEach(() => {
  delete process.env.WAITLIST_ADMIN_TOKEN;
});

afterEach(() => {
  if (originalToken === undefined) delete process.env.WAITLIST_ADMIN_TOKEN;
  else process.env.WAITLIST_ADMIN_TOKEN = originalToken;
});

describe("waitlist admin export", () => {
  it("fails closed when WAITLIST_ADMIN_TOKEN is unset", async () => {
    const res = await get({ [ADMIN_TOKEN_HEADER]: "anything" });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body).not.toHaveProperty("entries");
  });

  it("no longer accepts the old hardcoded dev-token", async () => {
    const res = await get({ [ADMIN_TOKEN_HEADER]: "dev-token" });

    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("entries");
  });

  it("ignores a token in the query string even when it is the right value", async () => {
    process.env.WAITLIST_ADMIN_TOKEN = "s3cret";

    const res = await get({}, `${ENDPOINT}?token=s3cret`);

    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("entries");
  });

  it("rejects a wrong token presented in the header", async () => {
    process.env.WAITLIST_ADMIN_TOKEN = "s3cret";

    const res = await get({ [ADMIN_TOKEN_HEADER]: "s3crey" });

    expect(res.status).toBe(401);
  });

  it("returns captured entries for the correct header token", async () => {
    process.env.WAITLIST_ADMIN_TOKEN = "s3cret";
    await post({ email: "streamer@example.com", source: "landing" });

    const res = await get({ [ADMIN_TOKEN_HEADER]: "s3cret" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.entries.map((e: { email: string }) => e.email)).toContain(
      "streamer@example.com"
    );
  });

  it("sends no CORS headers on the export, so no browser origin can read it", async () => {
    process.env.WAITLIST_ADMIN_TOKEN = "s3cret";

    const res = await get({ [ADMIN_TOKEN_HEADER]: "s3cret", origin: ORIGIN });

    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("does not allow the token header through CORS preflight", async () => {
    const res = await handler(
      new Request(ENDPOINT, { method: "OPTIONS", headers: { origin: ORIGIN } })
    );

    expect(res.headers.get("Access-Control-Allow-Headers")).not.toContain(
      ADMIN_TOKEN_HEADER
    );
    expect(res.headers.get("Access-Control-Allow-Methods")).not.toContain("GET");
  });
});

describe("constantTimeEquals", () => {
  it("matches equal strings", async () => {
    await expect(constantTimeEquals("abc", "abc")).resolves.toBe(true);
  });

  it("rejects strings differing only in the last character", async () => {
    await expect(constantTimeEquals("abc", "abd")).resolves.toBe(false);
  });

  it("rejects a prefix of the expected value", async () => {
    await expect(constantTimeEquals("abc", "abcdef")).resolves.toBe(false);
  });

  it("rejects the empty string against a real token", async () => {
    await expect(constantTimeEquals("", "s3cret")).resolves.toBe(false);
  });
});

describe("waitlist capture", () => {
  it("still accepts a valid signup", async () => {
    const res = await post({ email: "new@example.com" });

    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("rejects an invalid email", async () => {
    const res = await post({ email: "nope" });

    expect(res.status).toBe(400);
  });
});
