import { describe, expect, it } from "vitest";

import {
  extractFaq,
  extractFootnotes,
  findRetiredBlogLinks,
  parseAuthor,
  parseFrontmatter,
  parsePost,
  renderAuthorPage,
  renderIndexPage,
  renderPostPage,
  renderSitemap,
  resolveInternalLinks,
  stripDraftNotes,
  // @ts-expect-error -- plain-JS build script, no type declarations
} from "./blog.mjs";

const AUTHOR_SOURCE = [
  "---",
  'name: "Quinn Alvarez"',
  'role: "Editor, Sponsee"',
  'jobTitle: "Editor"',
  'pronouns: "they/them"',
  'email: "hello@sponsee.app"',
  'titleTag: "Quinn Alvarez — Editor at Sponsee"',
  'description: "Sponsee\'s editorial byline."',
  "---",
  "",
  "Quinn is the editorial desk at Sponsee.",
  "",
].join("\n");

const QUINN = parseAuthor(AUTHOR_SOURCE, "quinn-alvarez");

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

  it("keeps a link to a registered author page, which is not a post slug", () => {
    const html = '<a href="/blog/authors/quinn-alvarez">Quinn</a>';
    const { html: resolved, downgraded } = resolveInternalLinks(html, [], ["quinn-alvarez"]);
    expect(resolved).toBe(html);
    expect(downgraded).toEqual([]);
  });

  it("downgrades a link to an author with no registry file", () => {
    const { html, downgraded } = resolveInternalLinks(
      '<a href="/blog/authors/sam-okafor">Sam</a>',
      [],
      ["quinn-alvarez"],
    );
    expect(html).toBe("Sam");
    expect(downgraded).toEqual(["/blog/authors/sam-okafor"]);
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

  it("signs an unattributed post with the editorial desk and reviews it on its publish date", () => {
    const post = parsePost(POST_SOURCE, "sponsor-paying-late");
    expect(post.author).toBe("quinn-alvarez");
    expect(post.lastReviewed).toBe("2026-09-01");
  });

  it("carries an explicit byline and review date when the post sets them", () => {
    const source = POST_SOURCE.replace(
      /^order: "1"$/m,
      'order: "1"\nauthor: sam-okafor\nlastReviewed: "2026-11-30"',
    );
    const post = parsePost(source, "sponsor-paying-late");
    expect(post.author).toBe("sam-okafor");
    expect(post.lastReviewed).toBe("2026-11-30");
  });

  it("refuses a review date that predates publication rather than back-dating dateModified", () => {
    const source = POST_SOURCE.replace(/^order: "1"$/m, 'order: "1"\nlastReviewed: "2026-08-01"');
    expect(() => parsePost(source, "sponsor-paying-late")).toThrow(/reviewed/);
  });

  it("refuses a non-ISO review date, which would render as an unparseable stamp", () => {
    const source = POST_SOURCE.replace(/^order: "1"$/m, 'order: "1"\nlastReviewed: "Sept 2026"');
    expect(() => parsePost(source, "sponsor-paying-late")).toThrow(/lastReviewed/);
  });
});

describe("parseAuthor", () => {
  it("reads the byline registry entry and renders the bio as markdown", () => {
    expect(QUINN.name).toBe("Quinn Alvarez");
    expect(QUINN.jobTitle).toBe("Editor");
    expect(QUINN.href).toBe("/blog/authors/quinn-alvarez");
    expect(QUINN.url).toBe("https://sponsee.app/blog/authors/quinn-alvarez");
    expect(QUINN.bioHtml).toContain("<p>Quinn is the editorial desk at Sponsee.</p>");
  });

  it("refuses an author with no jobTitle, which the Person schema requires", () => {
    const noJobTitle = AUTHOR_SOURCE.replace(/^jobTitle:.*$/m, "");
    expect(() => parseAuthor(noJobTitle, "quinn-alvarez")).toThrow(/jobTitle/);
  });
});

describe("renderPostPage", () => {
  const html = renderPostPage(parsePost(POST_SOURCE, "sponsor-paying-late"), QUINN);

  it("canonicalises to the extensionless /blog/<slug> URL", () => {
    expect(html).toContain('<link rel="canonical" href="https://sponsee.app/blog/sponsor-paying-late" />');
    expect(html).not.toContain("/blog/sponsor-paying-late.html");
  });

  // SPO-306 self-hosted the blog fonts after PR #100 fixed every other page
  // and blog.mjs drifted unnoticed. The preload pair is the positive control:
  // without it, the not.toContain half would pass vacuously on an empty head.
  it("preloads the self-hosted fonts and never calls out to Google Fonts", () => {
    expect(html).toContain('<link rel="preload" href="/fonts/inter-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin />');
    expect(html).toContain('<link rel="preload" href="/fonts/instrument-serif-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin />');
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).not.toContain("fonts.gstatic.com");
  });

  it("emits Article and FAQPage structured data", () => {
    const jsonLd = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
    const parsed = JSON.parse(jsonLd![1]);
    expect(parsed.map((entry: { "@type": string }) => entry["@type"])).toEqual(["Article", "FAQPage"]);
    expect(parsed[1].mainEntity[0].name).toBe("A question?");
  });

  it("attributes the Article to a Person with a page behind it, and Sponsee as publisher", () => {
    const jsonLd = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
    const article = JSON.parse(jsonLd![1])[0];
    expect(article.author).toEqual({
      "@type": "Person",
      name: "Quinn Alvarez",
      url: "https://sponsee.app/blog/authors/quinn-alvarez",
      jobTitle: "Editor",
    });
    expect(article.publisher["@type"]).toBe("Organization");
    expect(article.dateModified).toBe("2026-09-01");
  });

  it("renders a byline under the H1 that links to the author page", () => {
    expect(html).toMatch(
      /<h1>[^<]*<\/h1>\s*<p class="byline"><a href="\/blog\/authors\/quinn-alvarez" rel="author">Quinn Alvarez<\/a> · Editor, Sponsee · <time datetime="2026-09-01">September 1, 2026<\/time><\/p>/,
    );
  });

  it("signs off with the persona signature block above the CTA", () => {
    expect(html).toContain("Written by <a href=\"/blog/authors/quinn-alvarez\" rel=\"author\">Quinn Alvarez</a>, Editor at Sponsee");
    expect(html).toContain("researched and fact-checked by the team building Sponsee");
    expect(html).toContain("Spotted an error?");
    expect(html).toContain("Last reviewed <time datetime=\"2026-09-01\">September 1, 2026</time>");
    expect(html.indexOf('class="signature"')).toBeLessThan(html.indexOf('class="cta"'));
  });

  // The signature's closing line in the persona doc is the non-affiliation
  // notice, which already ships from each post's `disclaimer` frontmatter.
  it("states the non-affiliation notice once, not once per block that mentions it", () => {
    const occurrences = html.split("Sponsee™ is not affiliated with Twitch, YouTube, or Kick.").length - 1;
    expect(occurrences).toBe(1);
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

describe("renderIndexPage", () => {
  it("shows the byline on each card so the author signal starts at the index", () => {
    const post = parsePost(POST_SOURCE, "sponsor-paying-late");
    const html = renderIndexPage([post], new Map([["quinn-alvarez", QUINN]]));
    expect(html).toContain('<a href="/blog/authors/quinn-alvarez" rel="author">Quinn Alvarez</a> · Editor, Sponsee');
  });
});

describe("renderAuthorPage", () => {
  const post = parsePost(POST_SOURCE, "sponsor-paying-late");
  const html = renderAuthorPage(QUINN, [post]);

  it("emits ProfilePage structured data wrapping the Person", () => {
    const jsonLd = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
    const parsed = JSON.parse(jsonLd![1]);
    expect(parsed[0]["@type"]).toBe("ProfilePage");
    expect(parsed[0].mainEntity["@type"]).toBe("Person");
    expect(parsed[0].mainEntity.url).toBe("https://sponsee.app/blog/authors/quinn-alvarez");
    expect(parsed[0].mainEntity.jobTitle).toBe("Editor");
    expect(parsed[0].mainEntity.worksFor.name).toBe("Sponsee");
  });

  it("canonicalises to its own URL and carries the bio", () => {
    expect(html).toContain('<link rel="canonical" href="https://sponsee.app/blog/authors/quinn-alvarez" />');
    expect(html).toContain("Quinn is the editorial desk at Sponsee.");
    expect(html).toContain("Editor, Sponsee · they/them");
  });

  // The reason this page earns its keep beyond the byline: it links every post,
  // which is what the OpenSEO audit flags the posts as missing.
  it("links every post by the author, making it the internal-linking hub", () => {
    expect(html).toContain('<a href="/blog/sponsor-paying-late">');
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

  it("lists the author page, so the hub is discoverable without a crawl of the posts", () => {
    const xml = renderSitemap([{ slug: "sponsor-paying-late" }], [{ slug: "quinn-alvarez" }]);
    expect(xml).toContain("<loc>https://sponsee.app/blog/authors/quinn-alvarez</loc>");
  });
});
