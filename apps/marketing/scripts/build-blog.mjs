#!/usr/bin/env node
// Renders content/blog/*.md into dist/blog/ after `vite build`.
//
// Emits directory-index pages (dist/blog/<slug>/index.html) so Vercel serves
// them at the ratified /blog/<slug> URLs with no rewrite rule, plus the
// /blog/ index (which is also the 301 target for retired static pages that
// have no successor post) and a sitemap covering both.

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  findRetiredBlogLinks,
  parsePost,
  renderIndexPage,
  renderPostPage,
  renderSitemap,
  resolveInternalLinks,
} from "./blog.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contentDir = join(appRoot, "content", "blog");
const distDir = join(appRoot, "dist");

async function loadPosts() {
  const files = (await readdir(contentDir)).filter((name) => name.endsWith(".md")).sort();
  const posts = await Promise.all(
    files.map(async (name) => parsePost(await readFile(join(contentDir, name), "utf8"), name.replace(/\.md$/, ""))),
  );
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

const slugs = posts.map((post) => post.slug);
const duplicateOrder = slugs.length !== new Set(posts.map((post) => post.order)).size;
if (duplicateOrder) {
  throw new Error("two posts share the same `order` — the blog index would be non-deterministic");
}

for (const post of posts) {
  const { html, downgraded } = resolveInternalLinks(post.html, slugs);
  post.html = html;
  for (const href of downgraded) {
    console.warn(`blog: ${post.slug} references unpublished ${href} — rendered as plain text`);
  }
}

const pages = [
  ...posts.map((post) => [`blog/${post.slug}/index.html`, renderPostPage(post)]),
  ["blog/index.html", renderIndexPage(posts)],
];

for (const [path, html] of pages) {
  const retired = findRetiredBlogLinks(html);
  if (retired.length > 0) {
    throw new Error(`${path} links to retired static blog pages: ${retired.join(", ")}`);
  }
  await writePage(path, html);
}

await writePage("sitemap.xml", renderSitemap(posts));

console.log(`blog: wrote ${pages.length} pages + sitemap.xml to ${distDir}`);
