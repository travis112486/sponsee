import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// scripts/, not apps/web/src/, for two reasons. It belongs to no package — it
// checks two apps and both their Tailwind configs — which is the same reason
// the root vercel.json test lives here (SPO-225). And a guard that has to quote
// the class names it forbids cannot sit inside Tailwind's `content` glob:
// Tailwind extracts candidates from comments and string literals alike, so the
// positive-control cases below would compile real `bg-blue-50` rules into the
// shipped stylesheet — the guard would mint the very CSS it exists to remove.
const SRC_ROOT = fileURLToPath(new URL("../apps/web/src/", import.meta.url));
// Marketing shares the palette and its own config drifted from web's before
// (SPO-404), so it is scanned by the same guard rather than left uncovered.
const MARKETING_SRC = fileURLToPath(new URL("../apps/marketing/src/", import.meta.url));
const WEB_CONFIG = fileURLToPath(new URL("../apps/web/tailwind.config.js", import.meta.url));
const MARKETING_CONFIG = fileURLToPath(
  new URL("../apps/marketing/tailwind.config.js", import.meta.url)
);

// Stock Tailwind hue scales. Brand tokens (pine, amber, denim, brick, ink…)
// never carry a numeric step, so any `<utility>-<hue>-<number>` in shipped
// source is a palette escape. `extend` deep-merges our brand objects over the
// stock scales, so bg-amber-400 still compiles — the build won't catch it,
// only this will (SPO-411, SPO-414).
const STOCK_SCALE =
  /\b(?:bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|divide|accent|caret|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+\b/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    if (/\.test\.(ts|tsx)$/.test(entry.name)) return [];
    return [full];
  });
}

describe("warm-paper palette", () => {
  it("scans the source trees it means to scan", () => {
    // Without this, a bad path or a too-narrow extension filter would make the
    // assertion below pass by finding nothing at all.
    const web = sourceFiles(SRC_ROOT);
    expect(web.length).toBeGreaterThan(50);
    expect(web.some((f) => f.endsWith("components/BenchmarkBand.tsx"))).toBe(true);
    expect(sourceFiles(MARKETING_SRC).length).toBeGreaterThan(5);
  });

  it("flags a stock hue-scale class when one is present", () => {
    // Proves the pattern, not just that today's tree is clean. These are the
    // exact strings SPO-414 removed.
    expect('viewed: "bg-blue-50 text-blue-600 border-blue-200"'.match(STOCK_SCALE)).toHaveLength(3);
    expect('rescheduled: "bg-purple-500"'.match(STOCK_SCALE)).toHaveLength(1);
    expect('color: "bg-amber-400"'.match(STOCK_SCALE)).toHaveLength(1);
    // …and does not flag the brand tokens, which carry no numeric step.
    expect('color: "bg-denim"'.match(STOCK_SCALE)).toBeNull();
    expect('"bg-denim-tint text-denim border-denim/20"'.match(STOCK_SCALE)).toBeNull();
    expect('color: "bg-amber"'.match(STOCK_SCALE)).toBeNull();
  });

  it("no shipped source uses a stock Tailwind hue-scale class", () => {
    const offenders: string[] = [];
    for (const root of [SRC_ROOT, MARKETING_SRC]) {
      for (const file of sourceFiles(root)) {
        const lines = readFileSync(file, "utf8").split("\n");
        lines.forEach((line, i) => {
          for (const match of line.match(STOCK_SCALE) ?? []) {
            offenders.push(`${file.slice(root.length)}:${i + 1} ${match}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});

/* ── contrast ────────────────────────────────────────────────────── */

// The half that makes this an accessibility guard rather than a hygiene one.
// SPO-414 was filed as "palette has no blue token" and was really a live WCAG
// AA failure: blue-500 behind 10px semibold white text is 3.68:1. Catching the
// stock class would not have caught that on its own — a hand-picked off-palette
// hex fails the same way and passes the scan above.
//
// Hexes are read out of the Tailwind configs, so this measures what ships
// rather than a copy restated here.
function brandTokens(configPath: string, key: "DEFAULT" | "tint"): Record<string, string> {
  const src = readFileSync(configPath, "utf8");
  const pattern = new RegExp(`(\\w+):\\s*\\{[^}]*?${key}:\\s*"(#[0-9A-Fa-f]{6})"`, "g");
  return Object.fromEntries(
    [...src.matchAll(pattern)].map(([, name, hex]) => [name, hex.toUpperCase()])
  );
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE = "#FFFFFF";

// Tokens used as a solid fill under white text: the BenchmarkBand band chips
// (10px here, 10.5px in Calculator.tsx — neither is WCAG "large text", so the
// 4.5:1 floor applies, not 3:1) and the calendar status dots.
//
// `amber` was carved out of this list on the first round of SPO-414 because it
// was still #B87208 (3.85:1) and would have redded the suite against a defect
// SPO-404 owned. #138 has since landed #945E06 (5.44:1 on white, 4.81:1 on its
// tint), so the carve-out is retired here and the list is complete — which is
// what SPO-429 was opened to do.
const SOLID_FILLS_UNDER_WHITE_TEXT = ["pine", "brick", "denim", "amber"];

describe("warm-paper palette contrast", () => {
  it("reproduces contrast values that do not depend on our config", () => {
    expect(contrast("#000000", WHITE)).toBeCloseTo(21, 2);
    // The fill SPO-414 removed, and the one it removed in SPO-411's wake.
    expect(contrast("#3B82F6", WHITE)).toBeCloseTo(3.68, 2);
    expect(contrast("#A855F7", WHITE)).toBeCloseTo(3.96, 2);
    // The amber SPO-404 replaced, kept as the negative control for the token
    // that just joined SOLID_FILLS_UNDER_WHITE_TEXT: this value would fail the
    // loop below, so passing it is a fact about #945E06 and not about the loop.
    expect(contrast("#B87208", WHITE)).toBeCloseTo(3.85, 2);
  });

  it.each([
    ["apps/web", WEB_CONFIG],
    ["apps/marketing", MARKETING_CONFIG],
  ])("%s: every solid fill clears AA against white", (_label, configPath) => {
    const tokens = brandTokens(configPath, "DEFAULT");
    for (const token of SOLID_FILLS_UNDER_WHITE_TEXT) {
      expect(tokens[token], `${token} missing from ${configPath}`).toBeDefined();
      expect(contrast(tokens[token], WHITE), `${token} (${tokens[token]}) on white`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps each tint readable under its own token as text", () => {
    // The status pills are `bg-<token>-tint text-<token>` — small text on a
    // light fill, same 4.5:1 floor. amber is in the loop now: #945E06 on
    // #FAF0DC is 4.81:1, where the old #B87208 was 3.41:1.
    const defaults = brandTokens(WEB_CONFIG, "DEFAULT");
    const tints = brandTokens(WEB_CONFIG, "tint");
    // Asserted so a new token with a tint cannot quietly skip the loop below.
    expect(Object.keys(tints).sort()).toEqual(["amber", "brick", "denim", "pine"]);
    for (const token of SOLID_FILLS_UNDER_WHITE_TEXT) {
      expect(contrast(defaults[token], tints[token]), `${token} on ${token}-tint`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the two configs on one palette", () => {
    const web = brandTokens(WEB_CONFIG, "DEFAULT");
    const marketing = brandTokens(MARKETING_CONFIG, "DEFAULT");
    for (const token of [...SOLID_FILLS_UNDER_WHITE_TEXT, "amber", "surface", "ink"]) {
      expect(marketing[token], `${token} in marketing`).toBe(web[token]);
    }
    expect(brandTokens(MARKETING_CONFIG, "tint")).toEqual(brandTokens(WEB_CONFIG, "tint"));
  });
});
