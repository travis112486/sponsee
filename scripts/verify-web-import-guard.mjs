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
 * SPO-170 extends the same invariant to the transitive case: `packages/shared`
 * is on the watch list, but as a leaf. If it ever declares a `@sponsee/*`
 * dependency (say `@sponsee/db`), then a commit touching only `packages/db`
 * could change shared's build output while the ignore predicate skips the
 * build — the commit touches none of the watched paths. So `packages/shared`
 * must stay self-contained: no `@sponsee/*` entry in any of its dependency
 * fields.
 *
 * Rule enforced:
 *   - `@sponsee/db` may not be referenced from `apps/web/src` in any form.
 *   - `@sponsee/api` may be referenced only via type-only imports/reexports
 *     (`import type`, `export type`). A value import, side-effect import,
 *     dynamic `import()`, or multi-line import is a violation.
 *   - `packages/shared/package.json` declares no `@sponsee/*` entry in
 *     `dependencies`, `devDependencies`, `peerDependencies`, or
 *     `optionalDependencies`.
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

// SPO-170: keep `packages/shared` a leaf on the watch list. A `@sponsee/*`
// dependency here would let a commit that only touches that dependency change
// shared's build output while the ignoreCommand skips the build.
const sharedPkgPath = resolve(repoRoot, "packages/shared/package.json");
const sharedPkg = JSON.parse(readFileSync(sharedPkgPath, "utf8"));
const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
for (const field of DEP_FIELDS) {
  const deps = sharedPkg[field];
  if (!deps || typeof deps !== "object") continue;
  for (const name of Object.keys(deps)) {
    if (name.startsWith("@sponsee/")) {
      violations.push(
        `packages/shared/package.json: ${field}['${name}'] — packages/shared must stay self-contained (no @sponsee/* dependency)`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error(
    "web import guard: watch-list invariant broken (apps/web runtime dependency or packages/shared @sponsee/* dependency)",
  );
  for (const v of violations) console.error(`  - ${v}`);
  console.error(
    "\nWiden the ignoreCommand watch list in vercel.json, or move the dependency out of the web runtime / packages/shared.",
  );
  process.exit(1);
}

console.log(
  "web import guard: clean (no runtime @sponsee/api or @sponsee/db dependency in apps/web/src; packages/shared has no @sponsee/* dependency)",
);
