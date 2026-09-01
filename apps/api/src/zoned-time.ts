// Calendar arithmetic in an IANA time zone.
//
// Everything the product reports to a creator — "revenue this month", "due this
// week" — is a *civil calendar* question asked in the creator's own timezone,
// not in UTC. A US creator paid at 2026-03-01T01:30:00Z was paid on the evening
// of Feb 28, and their bank statement says February. Doing this math in UTC
// misfiles every boundary transaction by one period.
//
// Implemented on Intl.DateTimeFormat rather than a fixed offset, because a
// fixed offset is wrong for half the year: America/New_York is UTC-5 on
// 2026-03-01 and UTC-4 on 2026-03-09, and any shortcut that caches one offset
// gets the DST week wrong. Intl carries the full IANA rule set, so it is the
// only dependency-free source of truth available to us.

export type ZonedParts = {
  year: number;
  /** 1-12, not the 0-11 that Date uses. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

type WallClock = {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
};

const DEFAULT_TIME_ZONE = "UTC";

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      // h23 rather than hour12:false — the latter reports midnight as hour 24
      // in some ICU versions, which would silently shift a day boundary.
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * `creators.timezone` is NOT NULL with a sane default, but it is free text at
 * the DB level. A creator row carrying a typo must not 500 the dashboard, so an
 * unusable zone degrades to UTC (the pre-existing behaviour) instead of throwing.
 */
export function resolveTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return DEFAULT_TIME_ZONE;
  return isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
}

/** Milliseconds for a civil date-time read as if it were UTC. */
function civilMs(wall: WallClock): number {
  const ms = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour ?? 0,
    wall.minute ?? 0,
    wall.second ?? 0
  );
  // Date.UTC maps years 0-99 onto 1900-1999. Unreachable for our data, but a
  // silent century shift is not the failure mode you want to debug later.
  if (wall.year >= 0 && wall.year < 100) {
    const d = new Date(ms);
    d.setUTCFullYear(wall.year);
    return d.getTime();
  }
  return ms;
}

/** Normalize out-of-range civil fields (month 13, day 0, day 32, ...). */
function normalizeCivil(year: number, month: number, day: number): {
  year: number;
  month: number;
  day: number;
} {
  const d = new Date(civilMs({ year, month, day }));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

/** Offset of `timeZone` from UTC at `date`, in ms (positive east of Greenwich). */
function zoneOffsetMs(date: Date, timeZone: string): number {
  return civilMs(getZonedParts(date, timeZone)) - date.getTime();
}

/**
 * The instant at which the given wall clock reads in `timeZone`.
 *
 * Ambiguous (fall-back) wall clocks resolve to the earlier instant; wall clocks
 * skipped by a spring-forward resolve to the first instant after the gap. Both
 * are the right answer for a period boundary: the period starts as soon as the
 * zone reaches it.
 */
export function zonedWallClockToUtc(wall: WallClock, timeZone: string): Date {
  const target = civilMs(wall);
  const guessOffset = zoneOffsetMs(new Date(target), timeZone);
  let ts = target - guessOffset;

  const corrected = zoneOffsetMs(new Date(ts), timeZone);
  if (corrected !== guessOffset) {
    ts = target - corrected;
    // A gap can bounce the estimate between the two offsets; one more read
    // settles it on the post-transition side.
    const settled = zoneOffsetMs(new Date(ts), timeZone);
    if (settled !== corrected) ts = target - settled;
  }
  return new Date(ts);
}

export function startOfZonedDay(date: Date, timeZone: string): Date {
  const p = getZonedParts(date, timeZone);
  return zonedWallClockToUtc({ year: p.year, month: p.month, day: p.day }, timeZone);
}

export function addZonedDays(date: Date, days: number, timeZone: string): Date {
  const p = getZonedParts(date, timeZone);
  const civil = normalizeCivil(p.year, p.month, p.day + days);
  return zonedWallClockToUtc(
    { ...civil, hour: p.hour, minute: p.minute, second: p.second },
    timeZone
  );
}

/** ISO-8601 week: Monday 00:00 creator-local. */
export function startOfZonedWeek(date: Date, timeZone: string): Date {
  const p = getZonedParts(date, timeZone);
  // getUTCDay on the civil date gives the weekday of the *local* calendar day.
  const weekday = new Date(civilMs({ year: p.year, month: p.month, day: p.day })).getUTCDay();
  const sinceMonday = (weekday + 6) % 7;
  const civil = normalizeCivil(p.year, p.month, p.day - sinceMonday);
  return zonedWallClockToUtc(civil, timeZone);
}

export function startOfZonedMonth(date: Date, timeZone: string): Date {
  const p = getZonedParts(date, timeZone);
  return zonedWallClockToUtc({ year: p.year, month: p.month, day: 1 }, timeZone);
}

export function startOfZonedQuarter(date: Date, timeZone: string): Date {
  const p = getZonedParts(date, timeZone);
  const month = Math.floor((p.month - 1) / 3) * 3 + 1;
  return zonedWallClockToUtc({ year: p.year, month, day: 1 }, timeZone);
}

export function startOfZonedYear(date: Date, timeZone: string): Date {
  const p = getZonedParts(date, timeZone);
  return zonedWallClockToUtc({ year: p.year, month: 1, day: 1 }, timeZone);
}

/**
 * Shift by whole calendar months in the zone, preserving the local time of day.
 * Day-of-month overflow rolls forward the way `Date` does (Jan 31 + 1 → Mar 3);
 * callers in this codebase only ever shift month *starts*, where that cannot fire.
 */
export function addZonedMonths(date: Date, months: number, timeZone: string): Date {
  const p = getZonedParts(date, timeZone);
  const civil = normalizeCivil(p.year, p.month + months, p.day);
  return zonedWallClockToUtc(
    { ...civil, hour: p.hour, minute: p.minute, second: p.second },
    timeZone
  );
}

/** `YYYY-MM` for the creator-local calendar month containing `date`. */
export function zonedMonthKey(date: Date, timeZone: string): string {
  const p = getZonedParts(date, timeZone);
  return formatMonthKey(p.year, p.month);
}

/** `YYYY-MM` from civil fields, normalizing month overflow/underflow. */
export function formatMonthKey(year: number, month: number): string {
  const civil = normalizeCivil(year, month, 1);
  return `${String(civil.year).padStart(4, "0")}-${String(civil.month).padStart(2, "0")}`;
}
