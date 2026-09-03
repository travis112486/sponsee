import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_ROOT = fileURLToPath(new URL(".", import.meta.url));

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
  it("no shipped source uses a stock Tailwind hue-scale class", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC_ROOT)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const match of line.match(STOCK_SCALE) ?? []) {
          offenders.push(`${file.slice(SRC_ROOT.length)}:${i + 1} ${match}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
