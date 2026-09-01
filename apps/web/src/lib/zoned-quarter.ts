/**
 * Calendar-period boundary for the pipeline summary (SPO-195).
 *
 * `collectedThisQuarter` must bucket a paid invoice into the quarter the
 * creator would read on a wall calendar in their own timezone, not the quarter
 * the browser happens to be running in (SPO-239/SPO-246). The zone is read from
 * the creator's profile rather than the browser, so a creator travelling with a
 * laptop set to another zone still gets revenue attributed to the quarter on
 * their account.
 *
 * Implemented on Intl.DateTimeFormat rather than a fixed offset: a fixed offset
 * is wrong for half the year, and Intl carries the full IANA rule set.
 */

function formatParts(date: Date, timeZone: string): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
}

function read(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes
): number {
  const part = parts.find((x) => x.type === type);
  return part ? Number(part.value) : 0;
}

/** Offset of `timeZone` from UTC at `date`, in ms (positive east of Greenwich). */
function zonedOffsetMs(date: Date, timeZone: string): number {
  const parts = formatParts(date, timeZone);
  const asUtc = Date.UTC(
    read(parts, "year"),
    read(parts, "month") - 1,
    read(parts, "day"),
    read(parts, "hour"),
    read(parts, "minute"),
    read(parts, "second")
  );
  return asUtc - date.getTime();
}

/**
 * First instant (ms) of the quarter containing `now`, read in `timeZone`.
 *
 * Resolves the civil `yyyy-MM-01 00:00:00` wall clock back to a UTC instant
 * using the zone's own offset, then re-verifies once so a quarter that opens
 * exactly on a midnight DST transition lands on the right side of the gap.
 *
 * An unparseable zone degrades to UTC — a mislabelled quarter is bad, a thrown
 * `RangeError` that blanks the pipeline is worse, and the server validates the
 * zone before it ever reaches here.
 */
export function startOfZonedQuarterMs(now: Date, timeZone: string): number {
  let year: number;
  let month: number;
  try {
    const parts = formatParts(now, timeZone);
    year = read(parts, "year");
    month = read(parts, "month");
  } catch {
    return Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1);
  }

  const firstMonth = Math.floor((month - 1) / 3) * 3 + 1;
  const civilAsUtc = Date.UTC(year, firstMonth - 1, 1);

  const offset = zonedOffsetMs(new Date(civilAsUtc), timeZone);
  const instant = civilAsUtc - offset;
  const recheck = zonedOffsetMs(new Date(instant), timeZone);
  return recheck === offset ? instant : civilAsUtc - recheck;
}
