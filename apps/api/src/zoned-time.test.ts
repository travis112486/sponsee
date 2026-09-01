import { describe, it, expect } from "vitest";
import {
  addZonedDays,
  addZonedMonths,
  formatMonthKey,
  getZonedParts,
  isValidTimeZone,
  resolveTimeZone,
  startOfZonedDay,
  startOfZonedMonth,
  startOfZonedQuarter,
  startOfZonedWeek,
  startOfZonedYear,
  zonedMonthKey,
  zonedWallClockToUtc,
  type ZonedParts,
} from "./zoned-time.js";

const NY = "America/New_York";
const SYDNEY = "Australia/Sydney";
const KATHMANDU = "Asia/Kathmandu"; // UTC+05:45, no DST — catches offsets assumed whole-hour

// Zones that schedule DST changes at local midnight, so a transition lands on a
// day/month boundary rather than safely inside one. Egypt, Jordan, Lebanon,
// Syria, Palestine and Morocco change these rules by decree and the changes
// ship in Node's bundled tzdata, so this list is a moving target — the sweep
// below is what actually guards the invariant.
const BEIRUT = "Asia/Beirut";
const CAIRO = "Africa/Cairo";
const MIDNIGHT_TRANSITION_ZONES = [
  BEIRUT,
  CAIRO,
  "Asia/Amman",
  "Asia/Damascus",
  "Asia/Gaza",
  "Asia/Hebron",
  "Africa/Casablanca",
  "Africa/El_Aaiun",
  "Asia/Tehran",
  "America/Havana",
  "America/Santiago",
  "Atlantic/Azores",
  "Antarctica/Casey",
  "Antarctica/Davis",
  "Asia/Chita",
  "Asia/Magadan",
];

describe("getZonedParts", () => {
  it("reads the local civil clock, not the UTC one", () => {
    expect(getZonedParts(new Date("2026-03-01T01:30:00Z"), NY)).toEqual({
      year: 2026,
      month: 2,
      day: 28,
      hour: 20,
      minute: 30,
      second: 0,
    });
  });

  it("reports midnight as hour 0, never hour 24", () => {
    expect(getZonedParts(new Date("2026-03-01T05:00:00Z"), NY).hour).toBe(0);
  });

  it("handles a sub-hour offset", () => {
    const p = getZonedParts(new Date("2026-03-01T00:00:00Z"), KATHMANDU);
    expect({ month: p.month, day: p.day, hour: p.hour, minute: p.minute }).toEqual({
      month: 3,
      day: 1,
      hour: 5,
      minute: 45,
    });
  });
});

describe("zonedWallClockToUtc", () => {
  it("round-trips a wall clock through the instant it names", () => {
    for (const [tz, iso] of [
      [NY, "2026-07-04T12:34:56Z"],
      [SYDNEY, "2026-07-04T12:34:56Z"],
      [KATHMANDU, "2026-11-22T03:00:00Z"],
      ["UTC", "2026-01-01T00:00:00Z"],
    ] as const) {
      const parts = getZonedParts(new Date(iso), tz);
      expect(zonedWallClockToUtc(parts, tz)).toEqual(new Date(iso));
    }
  });

  it("shifts a wall clock skipped by spring-forward forward by the width of the gap", () => {
    // 2026-03-08 02:30 does not exist in New York; the clock jumps 02:00 → 03:00.
    // The gap is an hour wide, so 02:30 lands on 03:30 local — NOT on 02:00's
    // successor 07:00Z, which is what "the first instant after the gap" would
    // mean. The two coincide only when the gap starts at the wall clock itself.
    const resolved = zonedWallClockToUtc(
      { year: 2026, month: 3, day: 8, hour: 2, minute: 30 },
      NY
    );
    expect(resolved.toISOString()).toBe("2026-03-08T07:30:00.000Z");
    expect(getZonedParts(resolved, NY).hour).toBe(3);
  });

  it("resolves an ambiguous fall-back wall clock to the earlier instant", () => {
    // 2026-11-01 01:30 happens twice in New York: 05:30Z (EDT) then 06:30Z (EST).
    expect(
      zonedWallClockToUtc({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, NY).toISOString()
    ).toBe("2026-11-01T05:30:00.000Z");
  });

  it("resolves a midnight gap onto the transition instant, not the previous local day", () => {
    // SPO-245. Asia/Beirut springs forward AT midnight: 2026-03-29 00:00 → 01:00.
    // Resolving the offset by iterating reads used to land on 21:00Z — 23:00 on
    // the 28th — because the as-if-UTC guess fell on the pre-transition side.
    const resolved = zonedWallClockToUtc({ year: 2026, month: 3, day: 29 }, BEIRUT);
    expect(resolved.toISOString()).toBe("2026-03-28T22:00:00.000Z");
    expect(getZonedParts(resolved, BEIRUT).day).toBe(29);
  });
});

describe("start-of-period helpers", () => {
  it("anchors the day/month/quarter/year to local midnight", () => {
    const mar18 = new Date("2026-03-18T12:00:00Z");
    expect(startOfZonedDay(mar18, NY).toISOString()).toBe("2026-03-18T04:00:00.000Z");
    expect(startOfZonedMonth(mar18, NY).toISOString()).toBe("2026-03-01T05:00:00.000Z");
    expect(startOfZonedQuarter(mar18, NY).toISOString()).toBe("2026-01-01T05:00:00.000Z");
    expect(startOfZonedYear(mar18, NY).toISOString()).toBe("2026-01-01T05:00:00.000Z");
  });

  it("uses the offset at the boundary, not the offset at the input instant", () => {
    // March 18 is EDT (UTC-4) but March 1 is still EST (UTC-5). Reusing the
    // input's offset would put the month start an hour early.
    expect(startOfZonedMonth(new Date("2026-03-18T12:00:00Z"), NY).toISOString()).toBe(
      "2026-03-01T05:00:00.000Z"
    );
    // Symmetrically, from inside EST looking at a quarter that ends in EDT.
    expect(startOfZonedQuarter(new Date("2026-02-10T12:00:00Z"), NY).toISOString()).toBe(
      "2026-01-01T05:00:00.000Z"
    );
  });

  it("crosses a year boundary correctly for a zone ahead of UTC", () => {
    expect(startOfZonedYear(new Date("2026-03-18T12:00:00Z"), SYDNEY).toISOString()).toBe(
      "2025-12-31T13:00:00.000Z"
    );
  });

  it("uses the local instant even when the local date differs from the UTC date", () => {
    // 2026-03-01T01:30Z is Feb 28 in New York, so its month starts Feb 1.
    expect(startOfZonedMonth(new Date("2026-03-01T01:30:00Z"), NY).toISOString()).toBe(
      "2026-02-01T05:00:00.000Z"
    );
  });
});

describe("period starts across a midnight DST transition (SPO-245)", () => {
  it("starts the local day on the transition instant when the gap opens at midnight", () => {
    // Asia/Beirut 2026-03-29 and Africa/Cairo 2026-04-24 both jump 00:00 → 01:00.
    // The first instant of the local day is the transition itself; the old
    // iterate-the-offset resolution returned 21:00Z, i.e. the *previous* day.
    expect(startOfZonedDay(new Date("2026-03-29T13:30:00Z"), BEIRUT).toISOString()).toBe(
      "2026-03-28T22:00:00.000Z"
    );
    expect(startOfZonedDay(new Date("2026-04-24T13:30:00Z"), CAIRO).toISOString()).toBe(
      "2026-04-23T22:00:00.000Z"
    );
    // Recurs annually — pin a second year so a one-off tzdata edit cannot hide it.
    expect(startOfZonedDay(new Date("2030-03-31T13:30:00Z"), BEIRUT).toISOString()).toBe(
      "2030-03-30T22:00:00.000Z"
    );
  });

  it("starts the local month on the transition instant when the gap opens on the 1st", () => {
    // No zone currently schedules a midnight change on the 1st, but Egypt,
    // Jordan and Syria all have, by decree, within tzdata's live range. These
    // are the dates that made startOfZonedMonth disagree with zonedMonthKey.
    expect(startOfZonedMonth(new Date("2014-08-15T12:00:00Z"), CAIRO).toISOString()).toBe(
      "2014-07-31T22:00:00.000Z"
    );
    expect(startOfZonedMonth(new Date("2016-04-15T12:00:00Z"), "Asia/Amman").toISOString()).toBe(
      "2016-03-31T22:00:00.000Z"
    );
    expect(startOfZonedMonth(new Date("2011-04-15T12:00:00Z"), "Asia/Damascus").toISOString()).toBe(
      "2011-03-31T22:00:00.000Z"
    );
  });

  it("takes the earlier midnight when a fall-back repeats it", () => {
    // Antarctica/Casey fell back 3h at 02:00 on 2010-03-05, so the local clock
    // crossed midnight *backwards*: local Mar 5 00:00 happened at 13:00Z (+11),
    // ran to 02:00, rewound to Mar 4 23:00, and reached Mar 5 00:00 again at
    // 16:00Z (+08). The day starts the first time the zone reaches it.
    // (05:00Z is Mar 5 13:00 local, unambiguously inside the local day.)
    expect(startOfZonedDay(new Date("2010-03-05T05:00:00Z"), "Antarctica/Casey").toISOString()).toBe(
      "2010-03-04T13:00:00.000Z"
    );
  });

  // The pinned dates above are samples. This is the invariant: every start-of-
  // period helper must return the FIRST instant the zone reaches that local
  // period. Two assertions pin that uniquely — the result is inside the period
  // the probe belongs to, and the millisecond before it is not.
  const periodKey = {
    day: (p: ZonedParts) => `${p.year}-${p.month}-${p.day}`,
    week: (p: ZonedParts) => {
      const civil = Date.UTC(p.year, p.month - 1, p.day);
      const sinceMonday = (new Date(civil).getUTCDay() + 6) % 7;
      return new Date(civil - sinceMonday * 86_400_000).toISOString().slice(0, 10);
    },
    month: (p: ZonedParts) => `${p.year}-${p.month}`,
    quarter: (p: ZonedParts) => `${p.year}-Q${Math.floor((p.month - 1) / 3) + 1}`,
    year: (p: ZonedParts) => `${p.year}`,
  };
  const starts = {
    day: startOfZonedDay,
    week: startOfZonedWeek,
    month: startOfZonedMonth,
    quarter: startOfZonedQuarter,
    year: startOfZonedYear,
  };

  it.each(MIDNIGHT_TRANSITION_ZONES)(
    "returns the first instant of every local day/week/month/quarter/year in %s, 2024-2040",
    (tz) => {
      const end = Date.UTC(2041, 0, 1);
      const failures: string[] = [];
      // Each period is asserted once per distinct local period — checking the
      // same month start again from all 30 of its days costs 30x and proves
      // nothing new, since the helpers derive the boundary from the parts.
      const seen: Record<string, string> = {};
      // 12h steps: no local day in range is shorter than that, so every real
      // local day is visited (and days a zone skips entirely are never invented).
      for (let t = Date.UTC(2024, 0, 1); t < end; t += 12 * 60 * 60 * 1000) {
        const probe = new Date(t);
        const parts = getZonedParts(probe, tz);
        for (const name of ["day", "week", "month", "quarter", "year"] as const) {
          const key = periodKey[name];
          const k = key(parts);
          if (seen[name] === k) continue;
          seen[name] = k;

          const start = starts[name](probe, tz);
          if (key(getZonedParts(start, tz)) !== k) {
            failures.push(`${tz} ${name} ${k}: start ${start.toISOString()} is a different ${name}`);
          } else if (key(getZonedParts(new Date(start.getTime() - 1), tz)) === k) {
            failures.push(`${tz} ${name} ${k}: ${start.toISOString()} is not the FIRST instant`);
          }
        }
      }
      expect(failures.slice(0, 10)).toEqual([]);
    },
    30_000
  );
});

describe("startOfZonedWeek", () => {
  it("anchors to Monday 00:00 local", () => {
    // Wed 2026-03-18 08:00 ET → Mon 2026-03-16 00:00 ET.
    expect(startOfZonedWeek(new Date("2026-03-18T12:00:00Z"), NY).toISOString()).toBe(
      "2026-03-16T04:00:00.000Z"
    );
  });

  it("treats a Sunday-evening-local instant as the end of the current week, not the next", () => {
    // 2026-03-23T00:00Z is Sun Mar 22, 8pm ET. UTC would call it Monday.
    expect(startOfZonedWeek(new Date("2026-03-23T00:00:00Z"), NY).toISOString()).toBe(
      "2026-03-16T04:00:00.000Z"
    );
  });

  it("keeps the week 7 calendar days wide across a DST transition", () => {
    const start = startOfZonedWeek(new Date("2026-03-04T12:00:00Z"), NY);
    const end = addZonedDays(start, 7, NY);
    expect(start.toISOString()).toBe("2026-03-02T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-09T04:00:00.000Z");
    // 167 hours, not 168 — the hour the US skipped on Mar 8.
    expect(end.getTime() - start.getTime()).toBe(167 * 60 * 60 * 1000);
  });

  it("gains an hour across a fall-back week", () => {
    const start = startOfZonedWeek(new Date("2026-10-28T12:00:00Z"), NY);
    const end = addZonedDays(start, 7, NY);
    expect(end.getTime() - start.getTime()).toBe(169 * 60 * 60 * 1000);
  });
});

describe("addZonedMonths", () => {
  it("closes a month at the next month's local midnight", () => {
    const marStart = startOfZonedMonth(new Date("2026-03-18T12:00:00Z"), NY);
    expect(addZonedMonths(marStart, 1, NY).toISOString()).toBe("2026-04-01T04:00:00.000Z");
    expect(addZonedMonths(marStart, -11, NY).toISOString()).toBe("2025-04-01T04:00:00.000Z");
  });

  it("crosses the year boundary in both directions", () => {
    const janStart = startOfZonedMonth(new Date("2026-01-15T12:00:00Z"), NY);
    expect(addZonedMonths(janStart, -1, NY).toISOString()).toBe("2025-12-01T05:00:00.000Z");
    expect(addZonedMonths(janStart, 12, NY).toISOString()).toBe("2027-01-01T05:00:00.000Z");
  });
});

describe("month keys", () => {
  it("keys by the local calendar month", () => {
    expect(zonedMonthKey(new Date("2026-03-01T01:30:00Z"), NY)).toBe("2026-02");
    expect(zonedMonthKey(new Date("2026-03-01T01:30:00Z"), "UTC")).toBe("2026-03");
    expect(zonedMonthKey(new Date("2025-12-31T14:30:00Z"), SYDNEY)).toBe("2026-01");
  });

  it("normalizes month overflow and underflow", () => {
    expect(formatMonthKey(2026, 0)).toBe("2025-12");
    expect(formatMonthKey(2026, -10)).toBe("2025-02");
    expect(formatMonthKey(2026, 13)).toBe("2027-01");
  });
});

describe("resolveTimeZone", () => {
  it("passes a valid zone through", () => {
    expect(resolveTimeZone(NY)).toBe(NY);
    expect(isValidTimeZone(NY)).toBe(true);
  });

  it("falls back to UTC for a missing or unusable zone", () => {
    expect(resolveTimeZone(null)).toBe("UTC");
    expect(resolveTimeZone("")).toBe("UTC");
    expect(resolveTimeZone("Not/AZone")).toBe("UTC");
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });
});
