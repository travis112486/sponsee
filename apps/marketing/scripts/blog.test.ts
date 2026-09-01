import { describe, expect, it } from "vitest";

import {
  extractFaq,
  extractFootnotes,
  findRetiredBlogLinks,
  parseFrontmatter,
  parsePost,
  renderPostPage,
  renderSitemap,
  resolveInternalLinks,
  stripDraftNotes,
  // @ts-expect-error -- plain-JS build script, no type declarations
} from "./blog.mjs";

describe("parseFrontmatter", () => {
  it("JSON-decodes quoted values so copy can carry colons and em dashes", () => {
    const { data, body } = parseFrontmatter(
      '---\ntitle: "Net 30, Net 60: what to sign"\norder: 3\n---\nbody text\n',
    );
    expect(data.title).toBe("Net 30, Net 60: what to sign");
    expect(data.order).toBe("3");
    expect(body).toBe("body text\n");
  });

  it("skips comment lines so a post can carry a note to the next editor", () => {
    const { data } = parseFrontmatter('---\n# a note\ntitle: "x"\n---\n');
    expect(data).toEqual({ title: "x" });
  });

  it("refuses a post with no frontmatter rather than publishing an untitled page", () => {
    expect(() => parseFrontmatter("# Just a heading\n")).toThrow(/frontmatter/);
  });
});

describe("extractFootnotes", () => {
  it("numbers references by definition order and removes the Sources heading", () => {
    const { markdown, footnotes } = extractFootnotes(
      'Claim.[^1][^2]\n\n### Sources\n\n[^1]: First — https://one.example\n[^2]: Second — https://two.example\n',
    );
    expect(footnotes).toEqual([
      { label: "1", text: "First — https://one.example" },
      { label: "2", text: "Second — https://two.example" },
    ]);
    expect(markdown).toContain('href="#fn-1">1</a>');
    expect(markdown).toContain('href="#fn-2">2</a>');
    expect(markdown).not.toContain("Sources");
    expect(markdown).not.toContain("[^1]:");
  });

  it("fails loudly on a reference with no definition instead of shipping a dead anchor", () => {
    expect(() => extractFootnotes("Claim.[^9]\n")).toThrow(/\[\^9\]/);
  });
});

describe("extractFaq", () => {
  const markdown = [
    "## Intro",
    "",
    "**This bold line is not in the FAQ section.**",
    "It should be ignored.",
    "",
    "## FAQ",
    "",
    "**First question?**",
    "First answer.",
    "",
    "**Second question?**",
    "Second answer, line one.",
    "Second answer, line two.",
    "",
  ].join("\n");

  it("reads bold-question paragraphs from the FAQ section only", () => {
    expect(extractFaq(markdown)).toEqual([
      { question: "First question?", answer: "First answer." },
      { question: "Second question?", answer: "Second answer, line one. Second answer, line two." },
    ]);
  });

  it("returns nothing when a post has no FAQ section", () => {
    expect(extractFaq("## Intro\n\nNo FAQ here.\n")).toEqual([]);
  });
});

describe("stripDraftNotes", () => {
  it("removes the reviewer-only markers the approved drafts still carry", () => {
    const stripped = stripDraftNotes(
      '## FAQ\n\n*(FAQPage schema at publish)*\n\n*[CTA block — pending board approval: "copy"]*\n\nReal copy.\n',
    );
    expect(stripped).not.toContain("FAQPage schema at publish");
    expect(stripped).not.toContain("pending board approval");
    expect(stripped).toContain("Real copy.");
  });
});

describe("resolveInternalLinks", () => {
  it("keeps links to published posts and to the blog index", () => {
    const html = '<a href="/blog/sponsor-paying-late">a</a> <a href="/blog/">b</a>';
    const { html: resolved, downgraded } = resolveInternalLinks(html, ["sponsor-paying-late"]);
    expect(resolved).toBe(html);
    expect(downgraded).toEqual([]);
  });

  it("downgrades a link to an unpublished post to plain text and reports it", () => {
    const { html, downgraded } = resolveInternalLinks(
      'see the <a href="/blog/how-much-to-charge-sponsored-stream">rates pillar</a>.',
      ["sponsor-paying-late"],
    );
    expect(html).toBe("see the rates pillar.");
    expect(downgraded).toEqual(["/blog/how-much-to-charge-sponsored-stream"]);
  });

  it("lights the same link up once its target publishes, with no content change", () => {
    const source = '<a href="/blog/how-much-to-charge-sponsored-stream">rates pillar</a>';
    const { html, downgraded } = resolveInternalLinks(source, ["how-much-to-charge-sponsored-stream"]);
    expect(html).toBe(source);
    expect(downgraded).toEqual([]);
  });
});

describe("findRetiredBlogLinks", () => {
  it("flags links to the 301'd SPO-20 static pages", () => {
    expect(findRetiredBlogLinks('<a href="/blog/how-to-chase-late-payments.html">x</a>')).toEqual([
      "/blog/how-to-chase-late-payments.html",
    ]);
  });

  it("passes clean extensionless links", () => {
    expect(findRetiredBlogLinks('<a href="/blog/sponsor-paying-late">x</a>')).toEqual([]);
  });
});

const POST_SOURCE = [
  "---",
  'title: "Sponsor Paying Late? What to Do"',
  'titleTag: "Sponsor Paying Late? What to Do"',
  'description: "What to do when a brand misses the due date."',
  'date: "2026-09-01"',
  'order: "1"',
  'cta: "Sponsee never touches your money."',
  'disclaimer: "Sponsee™ is not affiliated with Twitch, YouTube, or Kick."',
  "---",
  "",
  "Intro claim.[^1]",
  "",
  "## FAQ",
  "",
  "*(FAQPage schema at publish)*",
  "",
  "**A question?**",
  "An answer.",
  "",
  "### Sources",
  "",
  "[^1]: Lumanu — https://www.lumanu.com/blog/x",
  "",
].join("\n");

describe("parsePost", () => {
  it("builds a publishable post from an approved draft", () => {
    const post = parsePost(POST_SOURCE, "sponsor-paying-late");
    expect(post.slug).toBe("sponsor-paying-late");
    expect(post.order).toBe(1);
    expect(post.faq).toEqual([{ question: "A question?", answer: "An answer." }]);
    expect(post.footnotes).toHaveLength(1);
    expect(post.html).toContain("Intro claim.");
    expect(post.html).not.toContain("FAQPage schema at publish");
  });

  it("refuses a post missing frontmatter the SEO tags depend on", () => {
    const noDescription = POST_SOURCE.replace(/^description:.*$/m, "");
    expect(() => parsePost(noDescription, "sponsor-paying-late")).toThrow(/description/);
  });
});

describe("renderPostPage", () => {
  const html = renderPostPage(parsePost(POST_SOURCE, "sponsor-paying-late"));

  it("canonicalises to the extensionless /blog/<slug> URL", () => {
    expect(html).toContain('<link rel="canonical" href="https://sponsee.app/blog/sponsor-paying-late" />');
    expect(html).not.toContain("/blog/sponsor-paying-late.html");
  });

  it("emits Article and FAQPage structured data", () => {
    const jsonLd = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
    const parsed = JSON.parse(jsonLd![1]);
    expect(parsed.map((entry: { "@type": string }) => entry["@type"])).toEqual(["Article", "FAQPage"]);
    expect(parsed[1].mainEntity[0].name).toBe("A question?");
  });

  it("ships the approved CTA copy and the non-affiliation footer", () => {
    expect(html).toContain("Sponsee never touches your money.");
    expect(html).toContain("Sponsee™ is not affiliated with Twitch, YouTube, or Kick.");
  });

  it("renders footnotes as a numbered Sources list linked from the body", () => {
    expect(html).toContain('id="fnref-1"');
    expect(html).toContain('id="fn-1"');
    expect(html).toContain("https://www.lumanu.com/blog/x");
  });
});

describe("renderSitemap", () => {
  it("lists the blog index and every post, and no retired .html page", () => {
    const xml = renderSitemap([{ slug: "sponsor-paying-late" }, { slug: "chase-email-templates" }]);
    expect(xml).toContain("<loc>https://sponsee.app/blog/</loc>");
    expect(xml).toContain("<loc>https://sponsee.app/blog/sponsor-paying-late</loc>");
    expect(xml).toContain("<loc>https://sponsee.app/blog/chase-email-templates</loc>");
    expect(xml).not.toContain("/blog/how-to-chase-late-payments.html");
  });
});
