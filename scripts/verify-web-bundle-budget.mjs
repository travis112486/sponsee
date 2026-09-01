#!/usr/bin/env node
/**
 * SPO-241 guard: keep framer-motion's animation engine in one shared chunk, and
 * keep route chunks under an explicit gzip budget.
 *
 * The regression this exists to prevent: SPO-235 rendered SPO-193's `motion`-based
 * primitives on the Dashboard, and Rollup statically linked the whole framer
 * animation engine into `Dashboard-*.js`. That route chunk went 6.4 kB -> 152 kB
 * (gzip 2.1 -> 49.4) — on the first screen a signed-in creator sees. Nobody
 * noticed until someone happened to read the build output, because a bundle that
 * quietly triples is not a failing test.
 *
 * Two rules, and the first is the sharp one:
 *
 *   1. The engine lives in exactly one chunk, and that chunk is `motion-*`.
 *      A pure "exactly one chunk" check would NOT have caught the original
 *      regression — the engine was in exactly one chunk there too, it was just
 *      the wrong one. Pinning the identity of the chunk is what makes this a
 *      guard rather than a coincidence detector. It fails when someone imports
 *      `motion` instead of `@/lib/motion`'s `m` alias, or removes the
 *      `manualChunks` entry in vite.config.ts.
 *
 *   2. Per-chunk gzip ceilings. Deliberately generous — these are set to catch a
 *      chunk absorbing a *library* it should be sharing, not to police ordinary
 *      feature growth. SPO-194 still has six Dashboard modules to land; the
 *      route budget has room for all of them. Raise a ceiling in the same commit
 *      as the change that needs it, with the new number in the message, so the
 *      next person is arguing with a number instead of a vibe.
 *
 * Run: node scripts/verify-web-bundle-budget.mjs   (exit 0 = clean, exit 1 = over)
 * Requires `pnpm --filter @sponsee/web build` to have run first.
 */
import { gzipSync } from "node:zlib";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = resolve(repoRoot, "apps/web/dist/assets");

/**
 * Minified-surviving identifiers from framer-motion's visual-element/projection
 * engine. Property names, so they survive Rollup's mangling — but they are still
 * framer internals, and a major upgrade could rename them. The positive-control
 * check below fails loudly if none of them are found anywhere, rather than
 * letting the guard silently pass on a bundle it can no longer see into.
 */
const ENGINE_MARKERS = ["latestValues", "visualElement", "animationState"];

/** The chunk framer-motion is pinned to, via `manualChunks` in vite.config.ts. */
const ENGINE_CHUNK = "motion";

/**
 * gzip ceilings in kB, by chunk name (the part before Vite's content hash).
 * `*` is the default applied to every lazily-loaded route chunk.
 */
const BUDGET_KB = {
  /** App shell: React, the router, tRPC, the query client, Layout. */
  index: 150,
  /** framer-motion's `m` + LazyMotion + the `domAnimation` feature bundle. */
  motion: 35,
  /** Every route chunk. The Dashboard regression measured 49.4 kB gzip. */
  "*": 40,
};

/** Chunks that are neither the shell nor a route — icons, tiny shared bits. */
const MIN_INTERESTING_KB = 1;

function gzipKb(buf) {
  return gzipSync(buf, { level: 9 }).length / 1000;
}

/** `Dashboard-0oS3_a0K.js` -> `Dashboard`; `index-DYkPhFxL.js` -> `index`. */
function chunkName(file) {
  return file.replace(/-[A-Za-z0-9_-]{8,}\.js$/, "");
}

if (!existsSync(assetsDir)) {
  console.error(
    `web bundle budget: ${assetsDir} does not exist.\n` +
      "Run `pnpm --filter @sponsee/web build` first.",
  );
  process.exit(1);
}

const files = readdirSync(assetsDir).filter((f) => f.endsWith(".js"));
if (files.length === 0) {
  console.error(`web bundle budget: no .js chunks in ${assetsDir}`);
  process.exit(1);
}

const failures = [];

/* ── Rule 1: the engine lives in `motion-*`, and only there ─────────────── */

const enginePresence = new Map();
for (const file of files) {
  const src = readFileSync(join(assetsDir, file), "utf8");
  const hits = ENGINE_MARKERS.filter((mark) => src.includes(mark));
  if (hits.length > 0) enginePresence.set(file, hits);
}

if (enginePresence.size === 0) {
  // Positive control. An empty result here means the markers stopped matching —
  // most likely a framer-motion upgrade renamed them — not that the engine
  // vanished. Failing is the only safe reading: a guard that cannot see the
  // thing it guards is not passing, it is blind.
  failures.push(
    `no chunk contains any of ${ENGINE_MARKERS.join(", ")}. Either framer-motion ` +
      "is no longer bundled (delete this guard) or an upgrade renamed its " +
      "internals (pick new markers from the built motion chunk).",
  );
} else {
  for (const [file, hits] of enginePresence) {
    if (chunkName(file) !== ENGINE_CHUNK) {
      failures.push(
        `framer-motion's animation engine is linked into '${file}' ` +
          `(matched ${hits.join(", ")}), not the shared '${ENGINE_CHUNK}-*' chunk. ` +
          "Import the `motion` alias from `@/lib/motion` rather than from " +
          "'framer-motion' directly, and keep the `manualChunks` entry in " +
          "apps/web/vite.config.ts.",
      );
    }
  }
}

/* ── Rule 2: gzip ceilings ──────────────────────────────────────────────── */

const rows = [];
for (const file of files) {
  const name = chunkName(file);
  const kb = gzipKb(readFileSync(join(assetsDir, file)));
  const budget = BUDGET_KB[name] ?? BUDGET_KB["*"];
  const over = kb > budget;
  if (over) {
    failures.push(
      `${file} is ${kb.toFixed(2)} kB gzip, over its ${budget} kB budget ` +
        `(chunk '${name}').`,
    );
  }
  if (kb >= MIN_INTERESTING_KB || over) rows.push({ file, name, kb, budget, over });
}

rows.sort((a, b) => b.kb - a.kb);
console.log("web bundle budget (gzip, kB):");
for (const r of rows) {
  console.log(
    `  ${r.over ? "OVER" : "ok  "} ${r.kb.toFixed(2).padStart(7)} / ${String(r.budget).padStart(3)}  ${r.file}`,
  );
}

if (failures.length > 0) {
  console.error("\nweb bundle budget: FAILED");
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    "\nIf the growth is intentional, raise the ceiling in " +
      "scripts/verify-web-bundle-budget.mjs in the same commit, and say why.",
  );
  process.exit(1);
}

console.log(
  `\nweb bundle budget: clean (engine confined to '${ENGINE_CHUNK}-*', ` +
    `${rows.length} chunks within budget)`,
);
