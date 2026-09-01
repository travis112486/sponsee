#!/usr/bin/env node
// Renders content/blog/*.md into dist/blog/ after `vite build`.
//
// Emits directory-index pages (dist/blog/<slug>/index.html) so Vercel serves
// them at the ratified /blog/<slug> URLs with no rewrite rule, plus the
// /blog/ index (which is also the 301 target for retired static pages that
// have no successor post), a page per byline in content/authors/, and a
// sitemap covering all three.

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  findRetiredBlogLinks,
  parseAuthor,
  parsePost,
  renderAuthorPage,
  renderIndexPage,
  renderPostPage,
  renderSitemap,
  resolveInternalLinks,
} from "./blog.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contentDir = join(appRoot, "content", "blog");
const authorsDir = join(appRoot, "content", "authors");
const distDir = join(appRoot, "dist");

async function loadMarkdown(dir, parse) {
  const files = (await readdir(dir)).filter((name) => name.endsWith(".md")).sort();
  return Promise.all(
    files.map(async (name) => parse(await readFile(join(dir, name), "utf8"), name.replace(/\.md$/, ""))),
  );
}

async function loadPosts() {
  const posts = await loadMarkdown(contentDir, parsePost);
  return posts.sort((a, b) => a.order - b.order);
}

async function writePage(relativePath, html) {
  const target = join(distDir, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, html, "utf8");
  return target;
}

const posts = await loadPosts();
if (posts.length === 0) {
  throw new Error(`no posts found in ${contentDir}`);
}

const authors = await loadMarkdown(authorsDir, parseAuthor);
const authorsBySlug = new Map(authors.map((author) => [author.slug, author]));

// A post naming a byline we don't have a registry file for would render a dead
// author link and a Person with no page behind it — worse than no byline at all.
for (const post of posts) {
  if (!authorsBySlug.has(post.author)) {
    throw new Error(`post "${post.slug}" names author "${post.author}", which has no file in ${authorsDir}`);
  }
}

const slugs = posts.map((post) => post.slug);
const authorSlugs = authors.map((author) => author.slug);
const duplicateOrder = slugs.length !== new Set(posts.map((post) => post.order)).size;
if (duplicateOrder) {
  throw new Error("two posts share the same `order` — the blog index would be non-deterministic");
}

for (const post of posts) {
  const { html, downgraded } = resolveInternalLinks(post.html, slugs, authorSlugs);
  post.html = html;
  for (const href of downgraded) {
    console.warn(`blog: ${post.slug} references unpublished ${href} — rendered as plain text`);
  }
}

const pages = [
  ...posts.map((post) => [`blog/${post.slug}/index.html`, renderPostPage(post, authorsBySlug.get(post.author))]),
  ["blog/index.html", renderIndexPage(posts, authorsBySlug)],
  ...authors.map((author) => [
    `blog/authors/${author.slug}/index.html`,
    renderAuthorPage(
      author,
      posts.filter((post) => post.author === author.slug),
    ),
  ]),
];

for (const [path, html] of pages) {
  const retired = findRetiredBlogLinks(html);
  if (retired.length > 0) {
    throw new Error(`${path} links to retired static blog pages: ${retired.join(", ")}`);
  }
  await writePage(path, html);
}

await writePage("sitemap.xml", renderSitemap(posts, authors));

console.log(`blog: wrote ${pages.length} pages + sitemap.xml to ${distDir}`);
