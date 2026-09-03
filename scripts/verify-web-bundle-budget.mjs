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
 *   2. Per-chunk gzip ceilings. Every one of them is set to catch a chunk
 *      absorbing a *library* it should be sharing — not to police ordinary
 *      feature growth. SPO-194 still has six Dashboard modules to land; the
 *      route budget has room for all of them. Raise a ceiling in the same commit
 *      as the change that needs it, with the new number in the message, so the
 *      next person is arguing with a number instead of a vibe.
 *
 *      Each ceiling below states its measured number and how it was chosen,
 *      because "leave comfortable headroom" is not a method — it produces a
 *      number that sits above the thing you were trying to catch. See the
 *      `index` note for a case where that nearly happened.
 *
 *      These ceilings are not a "the shell must not grow" ratchet, and cannot
 *      be turned into one by tightening: a ratchet has to be a tracked number
 *      that a commit updates on purpose, or it just fires on whoever is next.
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
  /**
   * App shell: React, the router, tRPC, the query client, Layout, MotionProvider.
   * 134.74 measured — 11% headroom, the tightest of the three, and chosen on
   * evidence rather than by leaving room.
   *
   * Measured, don't guess: deleting the `manualChunks` entry drops framer into
   * the shell and takes `index` to 161.77. So 150 catches that and 165 does not
   * — a ceiling set for comfortable headroom would have sat above the only
   * library-in-the-shell number we have actually measured. Rule 1 catches this
   * particular case by chunk identity regardless; the ceiling is the backstop
   * for the next library, which rule 1 has never heard of.
   *
   * The cost is real and it is not this file's to hide: ~15 kB of headroom is
   * several providers' worth, but a shell that grows organically past it will
   * fire on someone with no context on SPO-241. That is the trade taken on
   * purpose — a red check with an actionable message beats a silent 27 kB on
   * every cold load. Raise it when a legitimate change needs it.
   */
  index: 150,
  /**
   * framer-motion's `m` + LazyMotion + the `domAnimation` feature bundle.
   * 27.20 measured — 22% headroom. Tight enough that swapping `domAnimation`
   * for `domMax` trips it; loose enough that a framer patch release does not.
   */
  motion: 35,
  /**
   * Pipeline route. 51.66 measured at SPO-195, the deal-card fill-out.
   *
   * This is ordinary feature growth — 554 lines of board + card content, no new
   * dependencies — which is exactly the thing the `*` ceiling is documented not
   * to police. It is not the library-absorption regression this guard exists to
   * catch: framer-motion's engine is still confined to `motion-*` (rule 1 is
   * green; Pipeline.tsx imports neither `framer-motion` nor `@/lib/motion` at
   * this head), and dnd-kit is already route-owned, present before this change.
   *
   * 60 is ~16% headroom, the roomiest of the route ceilings on purpose —
   * Pipeline is the core loop and has more deal-card work queued behind
   * SPO-195. It still sits below the one route regression we have actually
   * measured: deleting `manualChunks` and importing `framer-motion` directly
   * puts the engine in Pipeline at 65.10 gzip, which 60 trips with margin and
   * 65 would not. The `*` ceiling stays at 40 for every other route, so the
   * 49.37 Dashboard regression is still caught there.
   */
  Pipeline: 60,
  /**
   * Every route chunk. The Dashboard regression measured 49.37 gzip, so 40
   * would have caught it. Largest route today is Settings at 32.80.
   */
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
