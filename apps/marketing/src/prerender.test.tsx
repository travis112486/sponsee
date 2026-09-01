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

const BLOG_LINKS = [
  "/blog/rate-calculator-for-streamers.html",
  "/blog/pricing-your-first-sponsorship.html",
  "/blog/how-to-chase-late-payments.html",
];

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
    for (const href of [...BLOG_LINKS, "/privacy.html", "/terms.html"]) {
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
