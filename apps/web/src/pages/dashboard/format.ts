/**
 * Dashboard display formatters (SPO-194).
 *
 * Every number on this screen is money, a count or a time. Keeping the three
 * rules here means the KPI row, the chart tooltip, the pipeline bars and the
 * overdue alert can never format the same value two different ways — the exact
 * class of drift the parity audit found on the shipped screens.
 */

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Whole-dollar currency, e.g. `$1,800`. Takes cents. */
export function formatCents(cents: number): string {
  return usd.format(cents / 100);
}

/** Compact axis tick, e.g. `$4K`. Takes cents. */
export function formatAxisCents(cents: number): string {
  if (cents === 0) return "0";
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1000) {
    const k = dollars / 1000;
    return `$${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  }
  return `$${Math.round(dollars)}`;
}

/**
 * `"2026-09"` → `{ short: "Sep", long: "September 2026" }`.
 *
 * Parsed as UTC to match the server's month bucketing: `new Date("2026-09")`
 * is already UTC-midnight, but building it explicitly makes that a decision
 * rather than a coincidence of the string format.
 */
export function monthLabels(key: string): { short: string; long: string } {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  return {
    short: d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
    long: d.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
  };
}

/**
 * `YYYY-MM` for an instant as it reads in `timeZone` — the same key the API
 * builds its revenue buckets from (`zonedMonthKey` in `apps/api/src/zoned-time`).
 *
 * SPO-239 made every period boundary creator-local, so `periodStart` is an
 * instant whose UTC calendar month is *not* the month being reported: the start
 * of September in Tokyo is 2026-08-31T15:00Z. Reading it in UTC names August
 * and keys August's bucket. The zone is read from the payload rather than the
 * browser because a creator on a laptop set to another zone is still billed,
 * bucketed and chased in the zone on their account.
 *
 * An unparseable zone falls back to UTC: a mislabelled month is bad, a
 * `RangeError` that blanks the whole dashboard is worse, and the server
 * validates the zone before it ever reaches here.
 */
export function zonedMonthKey(d: Date, timeZone: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
    }).formatToParts(d);
  } catch {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  return `${year}-${month}`;
}

/**
 * Short month name (`"Sep"`) for an instant as it reads in `timeZone`, with the
 * same UTC fallback as {@link zonedMonthKey} so a bad zone cannot throw a
 * `RangeError` out of a render.
 */
export function zonedMonthShort(d: Date, timeZone: string): string {
  try {
    return d.toLocaleDateString("en-US", { month: "short", timeZone });
  } catch {
    return d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  }
}

/**
 * Shift a `YYYY-MM` key by whole months.
 *
 * Deliberately civil arithmetic on the key itself rather than date math on an
 * instant: months have no fixed length and a DST transition can move a
 * constructed midnight across a boundary. Keys have neither problem.
 */
export function addMonthsToKey(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const index = y * 12 + (m - 1) + n;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Compact relative time for the activity feed: `just now`, `4m`, `3h`, `2d`,
 * then an absolute date past a week.
 *
 * `now` is injected rather than read from the clock so the output is
 * deterministic under test — the shipped feed used `toLocaleDateString()`,
 * which told a creator "9/1/2026" for something that happened four minutes ago.
 */
export function formatRelativeTime(value: Date | string, now: Date): string {
  const then = value instanceof Date ? value : new Date(value);
  const diff = now.getTime() - then.getTime();

  // A clock skew between server and browser must not print "in -3 minutes".
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Full timestamp for `title=` / screen readers, alongside the relative form. */
export function formatExactTime(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Due chip copy for a deliverable, e.g. `Today`, `Tomorrow`, `Thu`, `Overdue`.
 * Falls back to the creator's own `dueLabel` when they wrote one ("Thu 7pm").
 *
 * `dueAt` is nullable because Drizzle cannot narrow the API's `isNotNull` filter
 * back into the row type. Rows without a date should never reach this list, but
 * the chip stays total rather than asserting — a stray null renders honestly
 * instead of printing "Invalid Date".
 */
export function formatDueChip(
  dueAt: Date | string | null,
  dueLabel: string | null,
  now: Date
): string {
  if (dueLabel) return dueLabel;
  if (dueAt === null) return "No date";
  const due = dueAt instanceof Date ? dueAt : new Date(dueAt);
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(due) - startOfDay(now)) / DAY);
  if (days < 0) return "Overdue";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return due.toLocaleDateString("en-US", { weekday: "short" });
}
