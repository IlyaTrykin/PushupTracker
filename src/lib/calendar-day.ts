/**
 * Calendar days in the user's time zone.
 *
 * A `DayKey` ('YYYY-MM-DD') is a calendar day as the user sees it. `Workout.date`
 * stores that day as UTC midnight (the server runs in UTC and its TZ must not
 * change, see spec «Календарная дата»). Day arithmetic is done on UTC dates, so
 * it never depends on the server time zone or on DST.
 */

export type DayKey = string; // 'YYYY-MM-DD'

export const DEFAULT_TIME_ZONE = 'Europe/Moscow';

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts: Record<string, number> = {};
  for (const part of zoneFormatter(normalizeTimeZone(timeZone)).formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour === 24 ? 0 : parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatKey(year: number, month: number, day: number): DayKey {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

function keyToUtcMs(key: DayKey): number {
  const parsed = parseDayKey(key);
  if (!parsed) throw new RangeError(`Invalid day key: ${String(key)}`);
  const [, y, m, d] = DAY_KEY_RE.exec(parsed) as RegExpExecArray;
  return Date.UTC(Number(y), Number(m) - 1, Number(d));
}

function utcMsToKey(ms: number): DayKey {
  const date = new Date(ms);
  return formatKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** A valid IANA zone name, or `DEFAULT_TIME_ZONE`. */
export function normalizeTimeZone(tz: unknown): string {
  if (typeof tz !== 'string') return DEFAULT_TIME_ZONE;
  const trimmed = tz.trim();
  if (!trimmed || trimmed.length > 64) return DEFAULT_TIME_ZONE;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).resolvedOptions().timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/** The calendar day of `instant` as seen in `timeZone`. */
export function dayKeyInZone(instant: Date, timeZone: string): DayKey {
  const p = zonedParts(instant, timeZone);
  return formatKey(p.year, p.month, p.day);
}

/** UTC midnight of the day — the storage format of `Workout.date`. */
export function dayKeyToDbDate(key: DayKey): Date {
  return new Date(keyToUtcMs(key));
}

/** The day stored in a `Workout.date`-style value (read by UTC parts). */
export function dbDateToDayKey(date: Date): DayKey {
  return formatKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** Strict 'YYYY-MM-DD' that names a real date (2026-02-31 → null). */
export function parseDayKey(raw: unknown): DayKey | null {
  if (typeof raw !== 'string') return null;
  const match = DAY_KEY_RE.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return raw;
}

export function addDays(key: DayKey, n: number): DayKey {
  return utcMsToKey(keyToUtcMs(key) + Math.trunc(n) * DAY_MS);
}

/** `a - b` in whole days. */
export function diffDays(a: DayKey, b: DayKey): number {
  return Math.round((keyToUtcMs(a) - keyToUtcMs(b)) / DAY_MS);
}

/** Monday of the day's week (weeks run Monday–Sunday). */
export function weekStart(key: DayKey): DayKey {
  const ms = keyToUtcMs(key);
  const sinceMonday = (new Date(ms).getUTCDay() + 6) % 7;
  return utcMsToKey(ms - sinceMonday * DAY_MS);
}

function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const p = zonedParts(new Date(instantMs), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * The instant when the wall clock in `timeZone` shows `hhmm` on day `key`.
 * A wall time skipped by a DST jump resolves to the instant just after the jump.
 */
export function zonedTimeToInstant(key: DayKey, hhmm: string, timeZone: string): Date {
  const match = HHMM_RE.exec(hhmm);
  if (!match) throw new RangeError(`Invalid time: ${String(hhmm)}`);
  const zone = normalizeTimeZone(timeZone);
  const wallAsUtc = keyToUtcMs(key) + (Number(match[1]) * 60 + Number(match[2])) * 60 * 1000;

  const firstGuess = wallAsUtc - zoneOffsetMs(wallAsUtc, zone);
  const secondOffset = zoneOffsetMs(firstGuess, zone);
  const secondGuess = wallAsUtc - secondOffset;
  if (zoneOffsetMs(secondGuess, zone) === secondOffset) return new Date(secondGuess);
  return new Date(Math.max(firstGuess, secondGuess));
}

/** Wall-clock 'HH:MM' (24h) of `instant` in `timeZone`. */
export function localHHMM(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}
