#!/usr/bin/env node
/**
 * SPO-165 guard: keep the Vercel ignoreCommand watch list honest.
 *
 * vercel.json skips the Vercel build for any commit touching none of
 * `apps/web`, `packages/shared`, or the root config/lockfile files. That list
 * is only correct because `apps/web` has no *runtime* dependency on
 * `@sponsee/api` — its only api reference is the tRPC `AppRouter` via a
 * type-only import (`import type { AppRouter } from "@sponsee/api/routers"`),
 * which is erased at build — and no dependency on `@sponsee/db` at all.
 *
 * The day someone adds a VALUE import from `@sponsee/api`, or ANY import from
 * `@sponsee/db`, into `apps/web/src`, the ignore predicate would silently ship
 * a stale bundle with no red check anywhere. This script fails CI when that
 * happens, forcing the author to either widen the watch list in `vercel.json`
 * or move the import out of the web runtime.
 *
 * Rule enforced:
 *   - `@sponsee/db` may not be referenced from `apps/web/src` in any form.
 *   - `@sponsee/api` may be referenced only via type-only imports/reexports
 *     (`import type`, `export type`). A value import, side-effect import,
 *     dynamic `import()`, or multi-line import is a violation.
 *
 * Run: node scripts/verify-web-import-guard.mjs   (exit 0 = clean, exit 1 = violation)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webSrc = resolve(repoRoot, "apps/web/src");

const SRC_EXT = new Set([".ts", ".tsx"]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
    } else if (SRC_EXT.has(extname(entry))) {
      yield full;
    }
  }
}

// `import ... from "@sponsee/..."` / `export ... from "@sponsee/..."` where the
// whole statement is on one line. group1 = import|export, group2 = optional
// `type `, group3 = module specifier. `[^;\n]*?` stops at `;` or a newline so
// the match can't bleed across an earlier import statement.
const SINGLE_LINE_FROM_RE =
  /\b(import|export)\s+(type\s+)?[^;\n]*?\bfrom\s*["'](@sponsee\/(?:api|db)[^"']*)["']/g;

// Any `from "@sponsee/..."` (multi-line and unusual forms) — used as a
// conservative catch-all below.
const ANY_FROM_RE = /\bfrom\s*["'](@sponsee\/(?:api|db)[^"']*)["']/g;

// Dynamic import(): always a value import.
const DYNAMIC_RE = /\bimport\s*\(\s*["'](@sponsee\/(?:api|db)[^"']*)["']\s*\)/g;

// Bare side-effect import: `import "@sponsee/..."`.
const SIDE_EFFECT_RE = /^\s*import\s+["'](@sponsee\/(?:api|db)[^"']*)["']/gm;

const violations = [];

for (const file of walk(webSrc)) {
  const src = readFileSync(file, "utf8");
  const rel = relative(repoRoot, file);

  const covered = [];
  for (const match of src.matchAll(SINGLE_LINE_FROM_RE)) {
    const [, , typeMarker, moduleSpec] = match;
    covered.push([match.index, match.index + match[0].length]);

    if (moduleSpec.startsWith("@sponsee/db")) {
      violations.push(`${rel}: import of '${moduleSpec}' (@sponsee/db is forbidden from the web runtime)`);
    } else if (!typeMarker) {
      violations.push(
        `${rel}: value import of '${moduleSpec}' (only 'import type' / 'export type' may reach @sponsee/api)`,
      );
    }
  }

  for (const match of src.matchAll(ANY_FROM_RE)) {
    if (covered.some(([s, e]) => match.index >= s && match.index < e)) continue;
    violations.push(
      `${rel}: unrecognized import/export of '${match[1]}' (multi-line or non-'import'/'export' form — not allowed from the web runtime)`,
    );
  }

  for (const match of src.matchAll(DYNAMIC_RE)) {
    violations.push(`${rel}: dynamic import() of '${match[1]}'`);
  }

  for (const match of src.matchAll(SIDE_EFFECT_RE)) {
    violations.push(`${rel}: side-effect import of '${match[1]}'`);
  }
}

if (violations.length > 0) {
  console.error(
    "web import guard: apps/web has a runtime @sponsee/api/@sponsee/db dependency",
  );
  for (const v of violations) console.error(`  - ${v}`);
  console.error(
    "\nWiden the ignoreCommand watch list in vercel.json, or move the import out of the web runtime.",
  );
  process.exit(1);
}

console.log(
  "web import guard: clean (no runtime @sponsee/api or @sponsee/db dependency in apps/web/src)",
);
