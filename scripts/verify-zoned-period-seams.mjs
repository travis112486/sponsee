#!/usr/bin/env node
// SPO-251 boundary-seam sweep.
//
// Asserts, for every IANA zone and every local month / quarter / ISO week in a
// window, that the period END the dashboard computes is exactly the first
// instant of the FOLLOWING local period -- i.e. the seam `end(P) === start(P+1)`
// holds, so the half-open revenue filter neither overlaps nor gaps.
//
// The expected value comes from an offset-segment-table reference
// (zoned-time.seam-reference.mjs) that shares no code with zoned-time.ts, and
// every period gets its own expected value; there is no single shared `want`.
//
// Too slow for CI (~4 min for both windows over 418 zones); the CI-sized guard
// lives in packages/shared/src/zoned-time.test.ts. Run this by hand after touching
// zoned-time.ts, and whenever Node's bundled tzdata moves:
//
//   node scripts/verify-zoned-period-seams.mjs --mode=civil --from=2024 --to=2040
//   node scripts/verify-zoned-period-seams.mjs --mode=civil --from=2010 --to=2016
//
//   civil   = the shipped shape: end = start of the next civil period.
//   derived = the pre-SPO-251 shape: end = addZonedMonths/addZonedDays(start).
//             Kept as a positive control -- run it and it must FAIL (11 wrong
//             ends across 5 zones in 2010-2016), or the sweep is vacuous and
//             proves nothing about the shipped shape.
//
// Exits non-zero on any mismatch.

import {
  addZonedDays,
  addZonedMonths,
  startOfZonedMonth,
  startOfZonedMonthOffset,
  startOfZonedQuarter,
  startOfZonedQuarterOffset,
  startOfZonedWeek,
  startOfZonedWeekOffset,
} from "../packages/shared/src/zoned-time.ts";
import {
  civilMs,
  firstInstantAtOrAfter,
  normalizeCivil,
  civilWeekday,
  segmentTable,
} from "./zoned-period-seam-reference.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const MODE = args.mode ?? "civil";
const FROM_YEAR = Number(args.from ?? 2024);
const TO_YEAR = Number(args.to ?? 2040);
const ZONES = args.zone ? [args.zone] : Intl.supportedValuesOf("timeZone");

const DAY = 86_400_000;
const HOUR = 3_600_000;

const iso = (t) => (t === null ? "null" : new Date(t).toISOString());

// The three end-derivations under test, in both shapes.
const impl = {
  derived: {
    monthEnd: (probe, tz) => addZonedMonths(startOfZonedMonth(probe, tz), 1, tz),
    quarterEnd: (probe, tz) => addZonedMonths(startOfZonedQuarter(probe, tz), 3, tz),
    weekEnd: (probe, tz) => addZonedDays(startOfZonedWeek(probe, tz), 7, tz),
  },
  civil: {
    monthEnd: (probe, tz) => startOfZonedMonthOffset(probe, 1, tz),
    quarterEnd: (probe, tz) => startOfZonedQuarterOffset(probe, 1, tz),
    weekEnd: (probe, tz) => startOfZonedWeekOffset(probe, 1, tz),
  },
}[MODE];

if (!impl) throw new Error(`unknown --mode=${MODE}`);

let assertions = 0;
let startAssertions = 0;
const failures = [];
const startFailures = [];

function check(kind, zone, label, actualDate, expected) {
  assertions++;
  const actual = actualDate.getTime();
  if (actual !== expected) {
    failures.push({ kind, zone, label, actual, expected });
  }
}

for (const zone of ZONES) {
  // Pad the table a full year past the window on both sides: the last period's
  // expected END lives in the year after TO_YEAR, and a table clamped at the
  // window edge would report a bogus mismatch there.
  const from = Date.UTC(FROM_YEAR - 1, 0, 1);
  const to = Date.UTC(TO_YEAR + 2, 0, 1);
  const segments = segmentTable(zone, from, to);
  const ref = (wall) => firstInstantAtOrAfter(wall, segments);

  // ── months and quarters ──
  for (let year = FROM_YEAR; year <= TO_YEAR; year++) {
    for (let month = 1; month <= 12; month++) {
      const startInstant = ref({ year, month, day: 1 });
      // 36h past the local period start is day 2 or 3 -- safely interior to the
      // period, whatever the zone did at the boundary.
      const probe = new Date(startInstant + 36 * HOUR);

      check(
        "monthEnd",
        zone,
        `${year}-${String(month).padStart(2, "0")}`,
        impl.monthEnd(probe, zone),
        ref(normalizeCivil(year, month + 1, 1))
      );
      startAssertions++;
      if (startOfZonedMonth(probe, zone).getTime() !== startInstant) {
        startFailures.push({ kind: "monthStart", zone, label: `${year}-${month}` });
      }

      if ((month - 1) % 3 === 0) {
        const qStart = ref({ year, month, day: 1 });
        const qProbe = new Date(qStart + 36 * HOUR);
        check(
          "quarterEnd",
          zone,
          `${year}-Q${(month - 1) / 3 + 1}`,
          impl.quarterEnd(qProbe, zone),
          ref(normalizeCivil(year, month + 3, 1))
        );
        startAssertions++;
        if (startOfZonedQuarter(qProbe, zone).getTime() !== qStart) {
          startFailures.push({ kind: "quarterStart", zone, label: `${year}-${month}` });
        }
      }
    }
  }

  // ── ISO weeks: every Monday whose local week starts inside the window ──
  let cursor = normalizeCivil(FROM_YEAR, 1, 1);
  cursor = normalizeCivil(
    cursor.year,
    cursor.month,
    cursor.day - ((civilWeekday(cursor.year, cursor.month, cursor.day) + 6) % 7)
  );
  const lastMs = civilMs({ year: TO_YEAR, month: 12, day: 31 });
  while (civilMs(cursor) <= lastMs) {
    const weekStart = ref(cursor);
    // Mid-week (Wed/Thu local) -- interior to the week under every transition.
    const probe = new Date(weekStart + 3 * DAY + 12 * HOUR);
    const next = normalizeCivil(cursor.year, cursor.month, cursor.day + 7);

    check(
      "weekEnd",
      zone,
      `${cursor.year}-${String(cursor.month).padStart(2, "0")}-${String(cursor.day).padStart(2, "0")}`,
      impl.weekEnd(probe, zone),
      ref(next)
    );
    startAssertions++;
    if (startOfZonedWeek(probe, zone).getTime() !== weekStart) {
      startFailures.push({ kind: "weekStart", zone, label: `${cursor.year}-${cursor.month}-${cursor.day}` });
    }

    cursor = next;
  }
}

const byKind = {};
for (const f of failures) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;

console.log(`mode=${MODE} window=${FROM_YEAR}-${TO_YEAR} zones=${ZONES.length}`);
console.log(`end assertions:   ${assertions.toLocaleString()}  wrong ends:   ${failures.length}`);
console.log(`start assertions: ${startAssertions.toLocaleString()}  wrong starts: ${startFailures.length}`);
if (failures.length) {
  console.log(`by kind: ${JSON.stringify(byKind)}`);
  const zones = [...new Set(failures.map((f) => f.zone))];
  console.log(`zones affected (${zones.length}): ${zones.join(", ")}`);
  for (const f of failures.slice(0, 40)) {
    console.log(
      `  ${f.zone} ${f.kind} ${f.label}\n    got  ${iso(f.actual)}\n    want ${iso(f.expected)}` +
        `  (off by ${(f.actual - f.expected) / 60000} min)`
    );
  }
  if (failures.length > 40) console.log(`  ... ${failures.length - 40} more`);
}
if (startFailures.length) {
  console.log(`start failures: ${JSON.stringify(startFailures.slice(0, 20))}`);
}

process.exitCode = failures.length || startFailures.length ? 1 : 0;
