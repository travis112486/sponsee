// Static blog generator for apps/marketing.
//
// Posts live as markdown in `content/blog/*.md` and are rendered to
// `dist/blog/<slug>/index.html` after `vite build`. Directory-index output is
// what gives us the `/blog/<slug>` URL convention CoS ratified on 2026-08-30
// (SPO-33 comment 913990fe) without a rewrite layer — Vercel serves
// `blog/<slug>/index.html` at `/blog/<slug>` directly.
//
// The pages are deliberately self-contained: inlined CSS, no bundle, no
// framework. They are the SEO surface, so every byte they don't ship is LCP
// they don't spend. That also means Tailwind's purge config never has to know
// about this template.
//
// Everything in this file is pure — `build-blog.mjs` owns the filesystem so
// these functions stay unit-testable.

import { Marked } from "marked";

const SITE_ORIGIN = "https://sponsee.app";
const GA_MEASUREMENT_ID = "G-SMN1L6QB3L";

// Posts are signed by a byline from `content/authors/*.md`. Unset frontmatter
// means the editorial desk, which is every post we have — the field exists so a
// second byline is additive rather than a migration.
const DEFAULT_AUTHOR = "quinn-alvarez";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The `/blog/authors/<slug>` page a byline links to. */
export function authorHref(slug) {
  return `/blog/authors/${slug}`;
}

// `breaks: true` because line structure carries meaning in this content: the
// copy-paste email templates end with a signature on its own line, and the FAQ
// puts each answer under its bolded question. Collapsing those to one line
// changes what the reader is meant to paste.
const marked = new Marked({ gfm: true, breaks: true });

/** Escape a string for interpolation into HTML text or a double-quoted attribute. */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Serialize JSON-LD for embedding in a <script> tag.
 * `<` is escaped so a `</script>` inside any string can't close the block early.
 */
export function toJsonLd(value) {
  return JSON.stringify(value, null, 2).replace(/</g, "\\u003c");
}

/**
 * Minimal frontmatter parser: a leading `---` block of `key: value` lines.
 * Values that start with `"` are parsed as JSON strings so titles and CTA copy
 * can carry colons, apostrophes and em dashes without a YAML dependency.
 */
export function parseFrontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) {
    throw new Error("post is missing a leading --- frontmatter block");
  }

  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const kv = /^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!kv) {
      throw new Error(`unparseable frontmatter line: ${line}`);
    }
    const [, key, rawValue] = kv;
    data[key] = rawValue.startsWith('"') ? JSON.parse(rawValue) : rawValue.trim();
  }

  return { data, body: source.slice(match[0].length) };
}

/**
 * Pull `[^label]: text` definitions and the `### Sources` heading out of the
 * body, and rewrite inline `[^label]` references into numbered superscript
 * links. Footnotes are numbered by definition order.
 */
export function extractFootnotes(markdown) {
  const footnotes = [];
  let body = markdown.replace(/^\[\^([^\]]+)\]:[ \t]*(.+)$/gm, (_match, label, text) => {
    footnotes.push({ label, text: text.trim() });
    return "";
  });

  if (footnotes.length > 0) {
    // The heading is ours to render now that its content has moved out.
    body = body.replace(/^#{2,4}[ \t]+Sources[ \t]*$/gm, "");
  }

  const numberByLabel = new Map(footnotes.map((note, index) => [note.label, index + 1]));
  body = body.replace(/\[\^([^\]]+)\]/g, (match, label) => {
    const number = numberByLabel.get(label);
    if (!number) {
      throw new Error(`footnote reference [^${label}] has no matching definition`);
    }
    return `<sup class="fnref"><a id="fnref-${label}" href="#fn-${label}">${number}</a></sup>`;
  });

  return { markdown: body, footnotes };
}

/**
 * Read Q&A pairs out of the post's `## FAQ` section for FAQPage structured
 * data. Each entry is a paragraph whose first line is entirely bold (the
 * question), with the remaining lines as the answer — the shape every SPO-33
 * draft uses.
 */
export function extractFaq(markdown) {
  const section = /^##[ \t]+FAQ[ \t]*$([\s\S]*?)(?=^##[ \t]|^---[ \t]*$|$(?![\s\S]))/m.exec(markdown);
  if (!section) return [];

  const faq = [];
  for (const block of section[1].split(/\r?\n\s*\r?\n/)) {
    const lines = block.trim().split(/\r?\n/);
    const question = /^\*\*(.+)\*\*$/.exec(lines[0] ?? "");
    if (!question || lines.length < 2) continue;
    faq.push({
      question: question[1].trim(),
      answer: lines.slice(1).join(" ").trim(),
    });
  }
  return faq;
}

/**
 * Drop lines that are production notes to the reviewer rather than published
 * copy — the `(FAQPage schema at publish)` marker and the `[CTA block — ...]`
 * placeholder, whose approved copy is carried in frontmatter instead.
 */
export function stripDraftNotes(markdown) {
  return markdown
    .replace(/^\*\(FAQPage schema at publish\)\*[ \t]*$/gm, "")
    .replace(/^\*\[CTA block[^\n]*$/gm, "");
}

/** Collapse the blank lines and stray `---` rules left behind by the strippers. */
function tidy(markdown) {
  return markdown
    .replace(/^---[ \t]*$(?:\s*^---[ \t]*$)+/gm, "---")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function renderMarkdown(markdown) {
  return marked.parse(markdown).trim();
}

/** Parse one `content/blog/*.md` file into everything the templates need. */
export function parsePost(source, slug) {
  const { data, body } = parseFrontmatter(source);

  for (const required of ["title", "titleTag", "description", "date", "order"]) {
    if (!data[required]) {
      throw new Error(`post "${slug}" is missing required frontmatter: ${required}`);
    }
  }

  if (!ISO_DATE.test(data.date)) {
    throw new Error(`post "${slug}" has a non-ISO date: ${data.date}`);
  }

  // Both optional. `author` selects a byline from content/authors/; the file it
  // names is resolved by the build, which is the only layer that can see disk.
  const author = data.author ?? DEFAULT_AUTHOR;
  if (!SLUG.test(author)) {
    throw new Error(`post "${slug}" has an unusable author slug: ${author}`);
  }

  // `lastReviewed` drives dateModified and the "Last reviewed" stamp in the
  // signature. A date before publication would claim we reviewed a draft that
  // didn't exist yet, so it's an error rather than a silent clamp.
  const lastReviewed = data.lastReviewed ?? data.date;
  if (!ISO_DATE.test(lastReviewed)) {
    throw new Error(`post "${slug}" has a non-ISO lastReviewed: ${lastReviewed}`);
  }
  if (lastReviewed < data.date) {
    throw new Error(`post "${slug}" was reviewed (${lastReviewed}) before it was published (${data.date})`);
  }

  const faq = extractFaq(body);
  const { markdown, footnotes } = extractFootnotes(stripDraftNotes(body));

  return {
    slug,
    title: data.title,
    titleTag: data.titleTag,
    description: data.description,
    date: data.date,
    lastReviewed,
    author,
    order: Number(data.order),
    cta: data.cta ?? "",
    disclaimer: data.disclaimer ?? "",
    faq,
    footnotes,
    html: renderMarkdown(tidy(markdown)),
  };
}

/**
 * Parse one `content/authors/*.md` file. The body is the bio, rendered as
 * markdown so it can carry the emphasis and mailto the persona copy uses.
 */
export function parseAuthor(source, slug) {
  const { data, body } = parseFrontmatter(source);

  for (const required of ["name", "role", "jobTitle", "titleTag", "description"]) {
    if (!data[required]) {
      throw new Error(`author "${slug}" is missing required frontmatter: ${required}`);
    }
  }
  if (!SLUG.test(slug)) {
    throw new Error(`author file name is not a usable slug: ${slug}`);
  }

  return {
    slug,
    name: data.name,
    role: data.role,
    jobTitle: data.jobTitle,
    pronouns: data.pronouns ?? "",
    email: data.email ?? "",
    titleTag: data.titleTag,
    description: data.description,
    href: authorHref(slug),
    url: `${SITE_ORIGIN}${authorHref(slug)}`,
    bioHtml: renderMarkdown(tidy(body)),
  };
}

const PAGE_CSS = `
@font-face{font-family:Inter;font-style:normal;font-weight:400;font-display:swap;src:url(/fonts/inter-latin-400-normal.woff2) format("woff2")}
@font-face{font-family:Inter;font-style:normal;font-weight:500;font-display:swap;src:url(/fonts/inter-latin-500-normal.woff2) format("woff2")}
@font-face{font-family:Inter;font-style:normal;font-weight:600;font-display:swap;src:url(/fonts/inter-latin-600-normal.woff2) format("woff2")}
@font-face{font-family:Inter;font-style:normal;font-weight:700;font-display:swap;src:url(/fonts/inter-latin-700-normal.woff2) format("woff2")}
@font-face{font-family:'Instrument Serif';font-style:normal;font-weight:400;font-display:swap;src:url(/fonts/instrument-serif-latin-400-normal.woff2) format("woff2")}
@font-face{font-family:'Instrument Serif';font-style:italic;font-weight:400;font-display:swap;src:url(/fonts/instrument-serif-latin-400-italic.woff2) format("woff2")}
:root{--paper:#F7F5F1;--surface:#FFF;--ink:#1B1815;--ink-2:#57504A;--ink-3:#8A8178;--hairline:#E8E3DB;--pine:#0E7A5F;--pine-hover:#0B664F;--pine-tint:#E4F1EB}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.6}
a{color:var(--pine)}
.wrap{max-width:1120px;margin:0 auto;padding:0 24px}
.site-header{position:sticky;top:0;z-index:50;background:rgba(247,245,241,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--hairline)}
.site-header .wrap{display:flex;align-items:center;justify-content:space-between;padding-top:16px;padding-bottom:16px}
.wordmark{font-family:'Instrument Serif',Georgia,serif;font-size:22px;color:var(--ink);text-decoration:none}
.wordmark sup{font-size:13px}
.btn{display:inline-block;background:var(--pine);color:#fff;border-radius:10px;padding:8px 16px;font-size:14px;font-weight:500;text-decoration:none;transition:background .15s}
.btn:hover{background:var(--pine-hover)}
main{max-width:720px;margin:0 auto;padding:56px 24px 24px}
.eyebrow{font-size:13px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);margin:0 0 12px}
h1{font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:34px;line-height:1.15;margin:0 0 12px}
.lede{color:var(--ink-3);font-size:14px;margin:0 0 40px}
.byline{color:var(--ink-3);font-size:14px;margin:0 0 40px}
.byline a{color:var(--ink-2);font-weight:500;text-decoration:none}
.byline a:hover{color:var(--pine)}
.signature{margin:48px 0 0;padding-top:24px;border-top:1px solid var(--hairline);font-size:13px;color:var(--ink-3)}
.signature p{margin:0 0 6px}
.signature p:last-child{margin:0}
.signature .signed{color:var(--ink-2);font-size:14px}
.signature .signed a{font-weight:500;text-decoration:none}
.author-posts{margin:56px 0 0;padding-top:32px;border-top:1px solid var(--hairline)}
.author-posts h2{font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:26px;margin:0 0 24px}
.prose h2{font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:28px;line-height:1.25;margin:48px 0 16px}
.prose h3{font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:22px;margin:32px 0 12px}
.prose p{color:var(--ink-2);margin:0 0 20px}
.prose strong{color:var(--ink);font-weight:600}
.prose ul,.prose ol{color:var(--ink-2);padding-left:22px;margin:0 0 20px}
.prose li{margin-bottom:10px}
.prose blockquote{margin:0 0 24px;padding:20px 24px;background:var(--surface);border:1px solid var(--hairline);border-left:3px solid var(--pine);border-radius:0 10px 10px 0}
.prose blockquote p{margin:0 0 12px}
.prose blockquote p:last-child{margin:0}
.prose table{width:100%;border-collapse:collapse;margin:0 0 24px;font-size:15px}
.prose th{text-align:left;font-weight:600;color:var(--ink);border-bottom:1px solid var(--hairline);padding:10px 12px}
.prose td{color:var(--ink-2);border-bottom:1px solid var(--hairline);padding:10px 12px;vertical-align:top}
.prose hr{border:0;border-top:1px solid var(--hairline);margin:40px 0}
.prose em{color:var(--ink-2)}
sup.fnref a{text-decoration:none;font-size:11px;padding-left:1px}
.cta{margin:48px 0 0;padding:24px;background:var(--pine-tint);border-radius:14px;color:#0B4A3A}
.cta p{margin:0}
.sources{margin:48px 0 0;padding-top:24px;border-top:1px solid var(--hairline)}
.sources h2{font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:22px;margin:0 0 12px}
.sources ol{padding-left:20px;margin:0;font-size:13px;color:var(--ink-3)}
.sources li{margin-bottom:8px;overflow-wrap:anywhere}
.disclaimer{margin:32px 0 0;font-size:13px;color:var(--ink-3);font-style:italic}
.post-list{list-style:none;padding:0;margin:0}
.post-list li{padding:24px 0;border-bottom:1px solid var(--hairline)}
.post-list li:first-child{padding-top:0}
.post-list h2{font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:24px;line-height:1.25;margin:0 0 8px}
.post-list h2 a{text-decoration:none;color:var(--ink)}
.post-list h2 a:hover{color:var(--pine)}
.post-list p{color:var(--ink-2);margin:0}
.post-list time{display:block;font-size:13px;color:var(--ink-3);margin-bottom:6px}
.post-list .byline{margin:8px 0 0;font-size:13px}
.site-footer{background:var(--paper);border-top:1px solid var(--hairline);padding:48px 0;margin-top:80px}
.site-footer .row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:24px}
.site-footer .tagline{font-size:14px;color:var(--ink-3);margin:4px 0 0}
.site-footer .brand{font-family:'Instrument Serif',Georgia,serif;font-size:18px;margin:0}
.site-footer nav{display:flex;flex-wrap:wrap;gap:24px;font-size:14px}
.site-footer nav a{color:var(--ink-2);text-decoration:none}
.site-footer nav a:hover{color:var(--ink)}
.legal{margin-top:32px;padding-top:24px;border-top:1px solid var(--hairline);font-size:13px;color:var(--ink-3)}
.legal p{margin:0 0 4px}
@media(min-width:768px){h1{font-size:44px}main{padding-top:80px}.prose h2{font-size:32px}}
`.trim();

// Same self-hosted files the rest of apps/marketing serves (SPO-306): these
// pages inline their CSS instead of loading the bundle, so the @font-face
// rules live in PAGE_CSS and only the two above-the-fold faces get preloaded.
const FONTS_LINK = `<link rel="preload" href="/fonts/inter-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="/fonts/instrument-serif-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin />`;

const ANALYTICS = `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${GA_MEASUREMENT_ID}');
    </script>`;

const HEADER = `<header class="site-header">
      <div class="wrap">
        <a class="wordmark" href="/">Sponsee<sup>™</sup></a>
        <a class="btn" href="/#waitlist">Join the waitlist</a>
      </div>
    </header>`;

const FOOTER = `<footer class="site-footer">
      <div class="wrap">
        <div class="row">
          <div>
            <p class="brand">Sponsee<sup>™</sup></p>
            <p class="tagline">The sponsorship CRM for streamers.</p>
          </div>
          <nav>
            <a href="/blog/">Blog</a>
            <a href="/#pricing">Pricing</a>
            <a href="/privacy.html">Privacy</a>
            <a href="/terms.html">Terms</a>
            <a href="mailto:hello@sponsee.app">Contact</a>
          </nav>
        </div>
        <div class="legal">
          <p>Sponsee is not affiliated with Twitch, YouTube, TikTok, or Kick.</p>
          <p>© 2026 Sponsee.</p>
        </div>
      </div>
    </footer>`;

function shell({ titleTag, description, canonical, ogType = "article", head = "", body }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${ANALYTICS}
    <title>${escapeHtml(titleTag)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta property="og:title" content="${escapeHtml(titleTag)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="${escapeHtml(ogType)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:image" content="${SITE_ORIGIN}/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    ${FONTS_LINK}
    <style>${PAGE_CSS}</style>${head}
  </head>
  <body>
    ${HEADER}
${body}
    ${FOOTER}
  </body>
</html>
`;
}

export function formatDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  const monthName = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ][month - 1];
  return `${monthName} ${day}, ${year}`;
}

/**
 * `Author · Role · date`, under the H1. The name links to the author page,
 * which is what turns the byline into a crawlable E-E-A-T signal rather than
 * decoration.
 */
export function renderByline(post, author) {
  return `<p class="byline"><a href="${author.href}" rel="author">${escapeHtml(author.name)}</a> · ${escapeHtml(author.role)} · <time datetime="${post.date}">${formatDate(post.date)}</time></p>`;
}

/**
 * The signature block at the foot of every post — content-writer-persona §4.
 *
 * The persona doc ends this block with the non-affiliation line; that line is
 * already rendered from each post's `disclaimer` frontmatter immediately below,
 * so repeating it here would print it twice on the same page.
 */
export function renderSignature(post, author) {
  const contact = author.email
    ? `Spotted an error? <a href="mailto:${escapeHtml(author.email)}">${escapeHtml(author.email)}</a> · `
    : "";

  return `<footer class="signature">
        <p class="signed">Written by <a href="${author.href}" rel="author">${escapeHtml(author.name)}</a>, ${escapeHtml(author.jobTitle)} at Sponsee</p>
        <p>Sponsee's editorial byline — researched and fact-checked by the team building Sponsee.</p>
        <p>${contact}Last reviewed <time datetime="${post.lastReviewed}">${formatDate(post.lastReviewed)}</time></p>
        <p><a href="/blog/">→ More from ${escapeHtml(author.name.split(" ")[0])}</a></p>
      </footer>`;
}

export function renderPostPage(post, author) {
  const canonical = `${SITE_ORIGIN}/blog/${post.slug}`;

  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: post.title,
      description: post.description,
      datePublished: post.date,
      dateModified: post.lastReviewed,
      mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
      author: {
        "@type": "Person",
        name: author.name,
        url: author.url,
        jobTitle: author.jobTitle,
      },
      publisher: { "@type": "Organization", name: "Sponsee", url: `${SITE_ORIGIN}/` },
    },
  ];

  if (post.faq.length > 0) {
    structuredData.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: post.faq.map((entry) => ({
        "@type": "Question",
        name: entry.question,
        acceptedAnswer: { "@type": "Answer", text: entry.answer },
      })),
    });
  }

  const cta = post.cta
    ? `\n      <aside class="cta"><p>${escapeHtml(post.cta)}</p></aside>`
    : "";

  const sources = post.footnotes.length
    ? `\n      <section class="sources">
        <h2>Sources</h2>
        <ol>
${post.footnotes
  .map(
    (note) =>
      `          <li id="fn-${note.label}">${marked.parseInline(note.text).trim()} <a href="#fnref-${note.label}" aria-label="Back to reference ${note.label}">↩</a></li>`,
  )
  .join("\n")}
        </ol>
      </section>`
    : "";

  const disclaimer = post.disclaimer
    ? `\n      <p class="disclaimer">${escapeHtml(post.disclaimer)}</p>`
    : "";

  const body = `    <main>
      <article>
        <p class="eyebrow"><a href="/blog/">Blog</a></p>
        <h1>${escapeHtml(post.title)}</h1>
        ${renderByline(post, author)}
        <div class="prose">
${post.html
  .split("\n")
  .map((line) => (line ? `          ${line}` : line))
  .join("\n")}
        </div>
      ${renderSignature(post, author)}${cta}${sources}${disclaimer}
      </article>
    </main>`;

  return shell({
    titleTag: `${post.titleTag} — Sponsee`,
    description: post.description,
    canonical,
    head: `\n    <script type="application/ld+json">\n${toJsonLd(structuredData)}\n    </script>`,
    body,
  });
}

/**
 * One `<li>` per post. `authorsBySlug` is optional so the index and the author
 * page can share this: on the author page every card has the same byline, so
 * repeating it under each one is noise.
 */
function postListItems(posts, authorsBySlug) {
  return posts
    .map((post) => {
      const author = authorsBySlug?.get(post.author);
      const byline = author
        ? `\n            <p class="byline"><a href="${author.href}" rel="author">${escapeHtml(author.name)}</a> · ${escapeHtml(author.role)}</p>`
        : "";
      return `          <li>
            <time datetime="${post.date}">${formatDate(post.date)}</time>
            <h2><a href="/blog/${post.slug}">${escapeHtml(post.title)}</a></h2>
            <p>${escapeHtml(post.description)}</p>${byline}
          </li>`;
    })
    .join("\n");
}

export function renderIndexPage(posts, authorsBySlug) {
  const body = `    <main>
      <p class="eyebrow">Blog</p>
      <h1>Getting paid, priced, and taken seriously.</h1>
      <p class="lede">Practical guides on pricing, invoicing, and chasing brand deals — written for live streamers with 100–5,000 concurrent viewers.</p>
      <ul class="post-list">
${postListItems(posts, authorsBySlug)}
      </ul>
    </main>`;

  return shell({
    titleTag: "Blog — Sponsee",
    description:
      "Practical guides on sponsorship pricing, media kits, invoicing, and chasing late brand-deal payments, written for live streamers.",
    canonical: `${SITE_ORIGIN}/blog/`,
    body,
  });
}

/**
 * The author page. It carries the `ProfilePage`/`Person` structured data that
 * makes the byline verifiable, and — because it lists every post — it is also
 * the internal-linking hub the OpenSEO audit has been asking for since the 8/27
 * baseline flagged the posts as orphaned.
 */
export function renderAuthorPage(author, posts) {
  const canonical = author.url;

  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "ProfilePage",
      mainEntity: {
        "@type": "Person",
        name: author.name,
        url: canonical,
        jobTitle: author.jobTitle,
        description: author.description,
        worksFor: { "@type": "Organization", name: "Sponsee", url: `${SITE_ORIGIN}/` },
      },
    },
  ];

  const subtitle = [author.role, author.pronouns].filter(Boolean).join(" · ");

  const postList = posts.length
    ? `\n      <section class="author-posts">
        <h2>Every post by ${escapeHtml(author.name)}</h2>
        <ul class="post-list">
${postListItems(posts)}
        </ul>
      </section>`
    : "";

  const body = `    <main>
      <p class="eyebrow"><a href="/blog/">Blog</a></p>
      <h1>${escapeHtml(author.name)}</h1>
      <p class="lede">${escapeHtml(subtitle)}</p>
      <div class="prose">
${author.bioHtml
  .split("\n")
  .map((line) => (line ? `        ${line}` : line))
  .join("\n")}
      </div>${postList}
    </main>`;

  return shell({
    titleTag: `${author.titleTag} — Sponsee`,
    description: author.description,
    canonical,
    ogType: "profile",
    head: `\n    <script type="application/ld+json">\n${toJsonLd(structuredData)}\n    </script>`,
    body,
  });
}

export function renderSitemap(posts, authors = []) {
  const urls = [
    { loc: `${SITE_ORIGIN}/`, priority: "1.0" },
    { loc: `${SITE_ORIGIN}/blog/`, priority: "0.8" },
    ...posts.map((post) => ({ loc: `${SITE_ORIGIN}/blog/${post.slug}`, priority: "0.7" })),
    ...authors.map((author) => ({ loc: `${SITE_ORIGIN}${authorHref(author.slug)}`, priority: "0.5" })),
    { loc: `${SITE_ORIGIN}/privacy.html`, priority: "0.3" },
    { loc: `${SITE_ORIGIN}/terms.html`, priority: "0.3" },
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map((url) => `  <url>\n    <loc>${url.loc}</loc>\n    <priority>${url.priority}</priority>\n  </url>`)
  .join("\n")}
</urlset>
`;
}

/**
 * Never publish a link into a `/blog/` URL that nothing serves.
 *
 * The board-approved SPO-33 drafts cross-link SPO-12's rates pillar, which
 * hasn't published yet. Rather than edit approved copy or ship a 404 in our
 * highest-value SEO pages, an anchor whose target isn't published is rendered
 * as plain text — and it becomes a real link on its own the day that post lands
 * in content/blog/, with no content change.
 *
 * Returns the rewritten HTML plus the hrefs that were downgraded, so the build
 * can report them instead of degrading a typo'd slug in silence.
 */
export function resolveInternalLinks(html, publishedSlugs, authorSlugs = []) {
  const downgraded = [];
  const resolved = html.replace(
    /<a href="(\/blog\/[^"]*)">([\s\S]*?)<\/a>/g,
    (match, href, text) => {
      const path = href.split(/[?#]/)[0].replace(/\/$/, "");
      if (path === "/blog") return match;
      if (authorSlugs.some((slug) => path === authorHref(slug))) return match;
      if (publishedSlugs.includes(path.slice("/blog/".length))) return match;
      downgraded.push(href);
      return text;
    },
  );
  return { html: resolved, downgraded };
}

/**
 * The three SPO-20 static pages are retired behind 301s, so any surviving
 * `/blog/*.html` link would be a needless redirect hop. Hard error — unlike an
 * unpublished pillar page, this one can never resolve later.
 */
export function findRetiredBlogLinks(html) {
  return [...html.matchAll(/href="(\/blog\/[^"]*\.html[^"]*)"/g)].map((match) => match[1]);
}
