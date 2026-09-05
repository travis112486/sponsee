import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Vercel validates vercel.json against a closed schema and rejects the whole
// deploy — "should NOT have additional property" — on any key it does not know.
// SPO-199 added a "//redirects" key to explain the blog redirects, JSON having
// no comment syntax. Nothing in CI reads this file, so that PR went green and
// merged, and every marketing deploy from that commit on failed schema
// verification before it ever built. The site simply stopped being deployable,
// and nobody found out until the next person tried to ship (SPO-207).
//
// SPO-215 later Git-linked this project, so a bad key now fails loudly as a
// canceled production deployment on the next merge instead of silently. But
// nothing in CI reads vercel.json, so without this test a stray key still
// reaches `main` — and an approved merge now auto-deploys straight to
// sponsee.app instead of waiting for someone to notice on the next manual push
// (SPO-438).

const CONFIG_PATH = fileURLToPath(new URL("./vercel.json", import.meta.url));

// Vercel's documented top-level properties. If you are adding a real one that
// is missing here, add it to this list — do not delete the assertion.
const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "$schema",
  "buildCommand",
  "cleanUrls",
  "crons",
  "devCommand",
  "framework",
  "functions",
  "git",
  "headers",
  "ignoreCommand",
  "images",
  "installCommand",
  "outputDirectory",
  "public",
  "redirects",
  "regions",
  "rewrites",
  "trailingSlash",
]);

describe("apps/marketing/vercel.json", () => {
  const raw = readFileSync(CONFIG_PATH, "utf8");

  it("is valid JSON", () => {
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("has no keys Vercel will reject", () => {
    const config = JSON.parse(raw) as Record<string, unknown>;
    const unknown = Object.keys(config).filter((key) => !ALLOWED_TOP_LEVEL_KEYS.has(key));

    expect(
      unknown,
      `vercel.json has top-level keys Vercel's schema does not allow: ${unknown.join(", ")}. ` +
        `Vercel fails the deploy on unknown properties, so this brings the marketing site down. ` +
        `JSON has no comments — put rationale in the commit message or apps/marketing/README.md, ` +
        `not in a "//"-prefixed key.`
    ).toEqual([]);
  });

  it("keeps the retired SPO-20 blog stubs redirecting with a 301, not a 308", () => {
    const config = JSON.parse(raw) as {
      redirects?: Array<{ source: string; destination: string; statusCode?: number; permanent?: boolean }>;
    };
    const redirects = config.redirects ?? [];

    // `permanent: true` emits 308, which is not what SPO-199 asked for; the
    // statusCode has to be spelled out.
    for (const redirect of redirects) {
      expect(redirect.statusCode, `${redirect.source} must set statusCode explicitly`).toBe(301);
      expect(redirect.permanent, `${redirect.source} must not use permanent (it emits 308)`).toBeUndefined();
    }

    expect(redirects.map((r) => r.source)).toEqual([
      "/blog/how-to-chase-late-payments.html",
      "/blog/pricing-your-first-sponsorship.html",
      "/blog/rate-calculator-for-streamers.html",
    ]);
  });
});
