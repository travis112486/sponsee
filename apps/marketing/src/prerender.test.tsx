import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act } from "react";
import { PAGES } from "./entry-server";
import { injectRoot } from "../scripts/prerender.mjs";

// SPO-209: the marketing app used to ship an empty `<div id="root">`, so the
// OpenSEO crawl saw wordCount 0 and no outgoing links on our highest-authority
// page. These tests hold the line on the two things that fix buys us —
// crawlable copy, and internal links pointing at the blog posts.

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Read from content/blog rather than a hardcoded list: SPO-199 retired the
// three SPO-20 static pages this suite was originally written against, and
// every post published since would have had to be added here by hand.
const publishedHrefs = readdirSync(join(appRoot, "content", "blog"))
  .filter((name) => name.endsWith(".md"))
  .map((name) => `/blog/${name.replace(/\.md$/, "")}`);

// Present in the footer of every page, so every pre-rendered entry carries them.
const SITE_WIDE_LINKS = ["/blog/", "/privacy.html", "/terms.html"];

function textOf(markup: string) {
  return markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

describe("pre-rendered marketing pages", () => {
  it("covers every HTML entry vite builds", () => {
    expect(Object.keys(PAGES).sort()).toEqual(
      ["index.html", "privacy.html", "terms.html", "waitlist-confirmed.html"].sort()
    );
  });

  it.each(Object.keys(PAGES))("%s renders exactly one h1 and the footer links", (file) => {
    const markup = renderToString(PAGES[file]);

    expect(markup.match(/<h1[\s>]/g) ?? []).toHaveLength(1);
    for (const href of SITE_WIDE_LINKS) {
      expect(markup).toContain(`href="${href}"`);
    }
  });

  it("passes link equity to every published post from the homepage", () => {
    // The homepage is the internal-link hub; a post the pre-rendered markup
    // never links is a post crawlers reach only through the /blog/ index.
    const markup = renderToString(PAGES["index.html"]);

    expect(publishedHrefs.length).toBeGreaterThan(0);
    for (const href of publishedHrefs) {
      expect(markup).toContain(`href="${href}"`);
    }
  });

  it("renders the homepage copy without executing any client JS", () => {
    const text = textOf(renderToString(PAGES["index.html"]));

    expect(text).toContain("Run your sponsorships");
    expect(text).toContain("Every deal, one board.");
    expect(text).toContain("Flat pricing. No cut. Ever.");
    // The crawl counted zero words before; anything in the hundreds proves the
    // shell is gone. The real page renders ~1,100.
    expect(text.split(" ").length).toBeGreaterThan(500);
  });

  it("privacy page describes the product, not only the waitlist", () => {
    // SPO-375: the waitlist-era page said nothing about pipeline data, chase
    // mail, or subprocessors. A crawler (and a creator reading before they
    // enter a brand list) has to see the product policy in the pre-rendered
    // markup, not after client JS.
    const text = textOf(renderToString(PAGES["privacy.html"]));

    expect(text).toContain("we email the brand contacts you saved, on your behalf");
    expect(text).toContain("Neon");
    expect(text).toContain("unavatar.io");
    expect(text).toContain("There is no delete button in the app yet");
    expect(text).not.toContain(
      "We use your email to send waitlist confirmations and beta launch updates"
    );
  });

  it("keeps scroll-reveal sections visible in the pre-rendered markup", () => {
    // A section that renders at opacity-0 is copy a crawler may discount and a
    // no-JS visitor cannot read at all.
    expect(renderToString(PAGES["index.html"])).not.toContain("opacity-0");
  });

  it.each(Object.keys(PAGES))("%s hydrates the pre-rendered markup cleanly", async (file) => {
    // React 19 reports a mismatch by recovering from it, not by throwing or by
    // logging through console.error — onRecoverableError is the only channel
    // that actually sees it.
    const recoverable: string[] = [];
    const container = document.createElement("div");
    container.innerHTML = renderToString(PAGES[file]);
    document.body.appendChild(container);

    let root: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, PAGES[file], {
        onRecoverableError: (error) => recoverable.push(String(error)),
      });
    });

    // A mismatch makes React throw the server markup away and re-render from
    // scratch, which would put us straight back to a JS-only page.
    expect(recoverable).toEqual([]);

    await act(async () => root!.unmount());
    container.remove();
  });
});

describe("injectRoot", () => {
  it("puts the markup inside the root div", () => {
    const html = `<body><div id="root"></div><script src="/x.js"></script></body>`;

    expect(injectRoot(html, "<h1>Hi</h1>")).toContain(`<div id="root"><h1>Hi</h1></div>`);
  });

  it("fails loudly when there is no empty root div to render into", () => {
    expect(() => injectRoot(`<body><div id="app"></div></body>`, "<h1>Hi</h1>", "index.html")).toThrow(
      /index\.html/
    );
  });
});
