/**
 * IANA time-zone validation, shared by the settings router and the settings
 * form so the two can never drift.
 *
 * `creators.timezone` decides which calendar month a paid invoice lands in, so
 * an unusable value is not cosmetic — it silently reassigns revenue to the
 * wrong month. Two classes of input have to be rejected on write:
 *
 *  1. Strings `Intl` cannot parse at all ("Eastern", "GMT-5", "America/New
 *     York"). These reach the dashboard and degrade to UTC.
 *  2. Legacy fixed-offset aliases `Intl` *does* accept ("EST", "MST", "HST",
 *     "EST5EDT", "Etc/GMT+5", "GMT"). These are worse, because they validate
 *     and then quietly never observe daylight time: a New York creator who
 *     saves "EST" gets a month boundary that is an hour early for the eight
 *     months of the year the US is on EDT.
 *
 * The rule is therefore "must be a region/city zone", expressed as membership
 * in `Intl.supportedValuesOf("timeZone")` — the canonical IANA set, which
 * excludes every abbreviation and every `Etc/` fixed offset.
 */

/** Canonical region/city zones known to this engine's ICU build. */
function canonicalZones(): Set<string> {
  const supported =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return new Set(supported);
}

let cachedCanonical: Set<string> | null = null;

function canonical(): Set<string> {
  if (cachedCanonical === null) cachedCanonical = canonicalZones();
  return cachedCanonical;
}

/**
 * `Intl.supportedValuesOf("timeZone")` omits "UTC" (it is not a region/city
 * zone) but UTC is a legitimate, DST-free-on-purpose choice and is what
 * `resolveTimeZone` falls back to, so it is allowed explicitly.
 */
export const UTC_TIME_ZONE = "UTC";

export const TIME_ZONE_ERROR_MESSAGE =
  'Pick a region/city timezone such as "America/New_York". Abbreviations like "EST" and fixed offsets like "GMT-5" do not follow daylight saving time.';

function isParseableByIntl(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * ICU canonicalises in whichever direction its tzdata snapshot prefers, so the
 * pair (`Asia/Kolkata`, `Asia/Calcutta`) can land on either side of
 * `supportedValuesOf` depending on the engine — the browser building the picker
 * and the server validating the write are not the same engine. Accept a link
 * name whose canonical form is in the set, but only in region/city form, so
 * this escape hatch can never readmit "EST" (which resolves to the DST-free
 * `America/Panama` on some ICU builds).
 */
function isAcceptableLink(value: string): boolean {
  if (!value.includes("/") || value.startsWith("Etc/")) return false;
  try {
    const resolved = new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions()
      .timeZone;
    return canonical().has(resolved);
  } catch {
    return false;
  }
}

/**
 * Returns the value to persist, or `null` if it is not a usable IANA zone.
 * Surrounding whitespace is stripped — a trailing space is otherwise enough to
 * make `Europe/London ` unparseable and send the creator to UTC.
 */
export function normalizeTimeZone(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed === UTC_TIME_ZONE) return UTC_TIME_ZONE;
  if (!isParseableByIntl(trimmed)) return null;
  if (canonical().has(trimmed)) return trimmed;
  if (isAcceptableLink(trimmed)) return trimmed;
  return null;
}

export function isValidTimeZone(value: string): boolean {
  return normalizeTimeZone(value) !== null;
}

/** Every zone a creator may pick, UTC first, then canonical zones A→Z. */
export function listTimeZones(): string[] {
  return [UTC_TIME_ZONE, ...[...canonical()].sort()];
}
