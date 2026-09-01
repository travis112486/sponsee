// The React landing page and the generated blog are built by two different
// pipelines, so nothing else notices when one renames or retires a post the
// other still links to — which is exactly how SPO-20's three static pages ended
// up linked from the homepage right up until SPO-199 retired them.
//
// These tests read the real sources rather than a fixture, so they fail the
// moment a post is renamed, unpublished, or a redirect points somewhere dead.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const publishedSlugs = readdirSync(join(appRoot, "content", "blog"))
  .filter((name) => name.endsWith(".md"))
  .map((name) => name.replace(/\.md$/, ""));

const authorSlugs = readdirSync(join(appRoot, "content", "authors"))
  .filter((name) => name.endsWith(".md"))
  .map((name) => name.replace(/\.md$/, ""));

const linkSources = ["src/App.tsx", "src/components/Layout.tsx"];

// Matches both the JSX attribute (`href="/blog/x"`) and the data-object form
// the guide cards use (`href: "/blog/x"`).
function blogHrefs(source: string): string[] {
  return [...source.matchAll(/href[:=]\s*"(\/blog\/[^"]*)"/g)].map((match) => match[1]);
}

describe("marketing site links into /blog", () => {
  it("has posts to link to", () => {
    expect(publishedSlugs.length).toBeGreaterThan(0);
  });

  it.each(linkSources)("%s only links to published posts or the blog index", (relativePath) => {
    const hrefs = blogHrefs(readFileSync(join(appRoot, relativePath), "utf8"));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      if (href === "/blog/") continue;
      expect(publishedSlugs).toContain(href.replace("/blog/", ""));
    }
  });

  it.each(linkSources)("%s no longer links to the retired static pages", (relativePath) => {
    const source = readFileSync(join(appRoot, relativePath), "utf8");
    expect(blogHrefs(source).filter((href) => href.endsWith(".html"))).toEqual([]);
  });

  it("names every published post exactly once in the homepage guide cards", () => {
    const app = readFileSync(join(appRoot, "src/App.tsx"), "utf8");
    const cardBlock = /const GUIDE_CARDS = \[([\s\S]*?)\n\];/.exec(app);
    expect(cardBlock).not.toBeNull();
    const carded = blogHrefs(cardBlock![1]).map((href) => href.replace("/blog/", ""));
    expect([...carded].sort()).toEqual([...publishedSlugs].sort());
  });
});

// Same failure mode as the href tests above, one layer down: the byline is set
// in a post's frontmatter and the page it links to comes from a different
// directory, so nothing else notices when one names a byline the other retired.
describe("post bylines", () => {
  const bylineOf = (slug: string) =>
    /^author:\s*(.+)$/m.exec(readFileSync(join(appRoot, "content", "blog", `${slug}.md`), "utf8"))?.[1].trim();

  it("has a byline to sign posts with", () => {
    expect(authorSlugs).toContain("quinn-alvarez");
  });

  it.each(publishedSlugs)("%s is signed by an author with a registry file", (slug) => {
    // Unset means the default byline, which parsePost resolves to quinn-alvarez.
    const author = bylineOf(slug)?.replace(/^"|"$/g, "") ?? "quinn-alvarez";
    expect(authorSlugs).toContain(author);
  });
});

describe("retired static blog pages", () => {
  const vercelConfig = JSON.parse(readFileSync(join(appRoot, "vercel.json"), "utf8"));
  const redirects: { source: string; destination: string; statusCode?: number }[] =
    vercelConfig.redirects ?? [];

  // The three pages shipped by SPO-20 (commit c020060). Retiring one without a
  // redirect drops whatever authority it had and, for the chase page, leaves a
  // keyword-cannibalising URL indexed against its own successor.
  const retired = [
    "/blog/how-to-chase-late-payments.html",
    "/blog/pricing-your-first-sponsorship.html",
    "/blog/rate-calculator-for-streamers.html",
  ];

  // git doesn't track empty directories, so public/blog/ is simply absent once
  // the last static page is deleted — that's the passing case, not an error.
  const staticPages = existsSync(join(appRoot, "public", "blog"))
    ? readdirSync(join(appRoot, "public", "blog")).map((name) => `/blog/${name}`)
    : [];

  it.each(retired)("%s is gone from public/ so a redirect is what serves it", (href) => {
    expect(staticPages).not.toContain(href);
  });

  it.each(retired)("%s 301s somewhere that exists", (href) => {
    const redirect = redirects.find((entry) => entry.source === href);
    expect(redirect, `no redirect configured for ${href}`).toBeDefined();
    // `permanent: true` would emit 308; SPO-199 calls for a literal 301.
    expect(redirect!.statusCode).toBe(301);
    if (redirect!.destination !== "/blog/") {
      expect(publishedSlugs).toContain(redirect!.destination.replace("/blog/", ""));
    }
  });

  it("sends the cannibalising chase page to its successor, not the index", () => {
    const redirect = redirects.find((entry) => entry.source === "/blog/how-to-chase-late-payments.html");
    expect(redirect!.destination).toBe("/blog/sponsor-paying-late");
  });
});
