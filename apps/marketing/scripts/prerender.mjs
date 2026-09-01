#!/usr/bin/env node
// Pre-renders the React marketing routes into the HTML that `vite build` emits.
//
// Before this, apps/marketing shipped an empty `<div id="root">` and injected
// every word of copy from JS. Crawlers that don't execute JS saw a blank page —
// the OpenSEO crawl reported the homepage with wordCount 0 and no outgoing
// links, which also starved the blog posts of internal link equity (SPO-209).
//
// The render runs through Vite's SSR module loader rather than a second
// bundle, so vite.config.ts stays as it is and there is one source of truth
// for each page: src/entry-server.tsx renders the same tree the client entry
// hydrates.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIV = /<div id="root"><\/div>/;

/**
 * Puts the rendered markup inside the root div of a built HTML file.
 * Throws rather than writing an unchanged file, so a renamed root element or a
 * page that stopped being pre-rendered fails the build instead of silently
 * regressing to the empty shell.
 */
export function injectRoot(html, markup, label = "page") {
  if (!ROOT_DIV.test(html)) {
    throw new Error(
      `${label}: expected an empty <div id="root"></div> to pre-render into. ` +
        `Found none — did the root element change, or is the file already pre-rendered?`
    );
  }
  return html.replace(ROOT_DIV, `<div id="root">${markup}</div>`);
}

async function main() {
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const distDir = join(appRoot, "dist");

  const { createServer } = await import("vite");
  const { renderToString } = await import("react-dom/server");

  const vite = await createServer({
    root: appRoot,
    appType: "custom",
    logLevel: "warn",
    server: { middlewareMode: true },
  });

  try {
    const { PAGES } = await vite.ssrLoadModule("/src/entry-server.tsx");

    for (const [file, element] of Object.entries(PAGES)) {
      const target = join(distDir, file);
      const html = await readFile(target, "utf8");
      const markup = renderToString(element);
      await writeFile(target, injectRoot(html, markup, file), "utf8");
      console.log(`prerendered ${file} (${markup.length.toLocaleString()} bytes of markup)`);
    }
  } finally {
    await vite.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
