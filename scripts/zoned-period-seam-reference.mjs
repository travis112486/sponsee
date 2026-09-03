// Independent reference for "first instant of a local calendar period".
//
// Deliberately shares no code with zoned-time.ts: it builds an explicit
// offset-segment table per zone by scanning + bisecting Intl offset reads, then
// answers boundary questions by scanning that table. zoned-time.ts instead
// resolves a wall clock by candidate validation. Two different mechanisms, so
// agreement is evidence rather than a tautology.
//
// Definition used throughout:
//
//   firstInstantAtOrAfter(W, tz) = min { t : localWallClock(t, tz) >= W }
//
// which is exactly the semantics a half-open `paidAt >= start && paidAt < end`
// filter needs. It is well defined in every case:
//   - normal      -> the single instant reading W
//   - fall-back   -> the EARLIER of the two instants reading W
//   - spring-gap  -> the transition instant (W never reads, the first instant
//                    past it is where the clock jumped over W)
//
// Note the predicate is NOT monotone in t (a fall-back rewinds the wall clock),
// so a naive bisect over instants is unsound. Within one offset segment it IS
// monotone, hence the segment table.

const fmtCache = new Map();

function fmt(timeZone) {
  let f = fmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      era: "narrow",
    });
    fmtCache.set(timeZone, f);
  }
  return f;
}

/** Civil ms for a wall clock read as if UTC. Handles years 0-99 without the 1900 shift. */
export function civilMs(w) {
  const ms = Date.UTC(w.year, w.month - 1, w.day, w.hour ?? 0, w.minute ?? 0, w.second ?? 0);
  if (w.year >= 0 && w.year < 100) {
    const d = new Date(ms);
    d.setUTCFullYear(w.year);
    return d.getTime();
  }
  return ms;
}

export function localWallMs(t, timeZone) {
  const parts = fmt(timeZone).formatToParts(new Date(t));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const era = get("era");
  const year = Number(get("year")) * (era === "B" ? -1 : 1);
  return civilMs({
    year,
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
  });
}

/** UTC offset of `timeZone` at instant `t`, in ms. */
export function offsetAt(t, timeZone) {
  return localWallMs(t, timeZone) - t;
}

const SEC = 1000;
const DAY = 86_400_000;

/**
 * Offset segments covering [from, to), as `{ start, end, offset }` in instant
 * space. Scans at `step` and bisects each offset change down to the second
 * (IANA transitions land on whole seconds; sub-second bisecting reports
 * spurious boundaries because Intl truncates).
 */
export function segmentTable(timeZone, from, to, step = DAY) {
  const segments = [];
  let segStart = from;
  let prevT = from;
  let prevOff = offsetAt(from, timeZone);

  const push = (end, offset) => segments.push({ start: segStart, end, offset });

  for (let t = from + step; ; t = Math.min(t + step, to)) {
    const off = offsetAt(t, timeZone);
    if (off !== prevOff) {
      // Bisect (prevT, t] for the first instant carrying the new offset.
      let lo = Math.floor(prevT / SEC) * SEC;
      let hi = Math.ceil(t / SEC) * SEC;
      while (hi - lo > SEC) {
        const mid = lo + Math.floor((hi - lo) / 2 / SEC) * SEC;
        if (mid === lo) break;
        if (offsetAt(mid, timeZone) === prevOff) lo = mid;
        else hi = mid;
      }
      push(hi, prevOff);
      segStart = hi;
      prevOff = offsetAt(hi, timeZone);
    }
    prevT = t;
    if (t >= to) break;
  }
  push(to, prevOff);
  return segments;
}

/**
 * min { t in [table window) : localWallClock(t) >= W }, or null if the window
 * does not reach W. `W` is a wall clock; `segments` must span far enough past
 * it that the answer is interior to the window, never clamped at its edge --
 * a clamped answer would manufacture a mismatch at the last period swept.
 */
export function firstInstantAtOrAfter(wall, segments) {
  const want = civilMs(wall);
  let best = null;
  for (const seg of segments) {
    // Within a segment the wall clock is t + offset, strictly increasing.
    const t = Math.max(seg.start, want - seg.offset);
    if (t < seg.end && (best === null || t < best)) best = t;
  }
  return best;
}

/** Weekday (0=Sun) of a civil date. */
export function civilWeekday(year, month, day) {
  return new Date(civilMs({ year, month, day })).getUTCDay();
}

/** Normalize out-of-range civil fields. */
export function normalizeCivil(year, month, day) {
  const d = new Date(civilMs({ year, month, day }));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
