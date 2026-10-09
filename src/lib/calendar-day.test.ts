import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TIME_ZONE,
  addDays,
  dayKeyInZone,
  dayKeyToDbDate,
  dbDateToDayKey,
  diffDays,
  localHHMM,
  normalizeTimeZone,
  parseDayKey,
  weekStart,
  zonedTimeToInstant,
} from './calendar-day';

test('parseDayKey accepts real dates only', () => {
  assert.equal(parseDayKey('2026-10-09'), '2026-10-09');
  assert.equal(parseDayKey('2028-02-29'), '2028-02-29');
  assert.equal(parseDayKey('2026-02-31'), null);
  assert.equal(parseDayKey('2026-02-29'), null);
  assert.equal(parseDayKey('2026-13-01'), null);
  assert.equal(parseDayKey('2026-1-9'), null);
  assert.equal(parseDayKey('2026-10-09T00:00:00Z'), null);
  assert.equal(parseDayKey(''), null);
  assert.equal(parseDayKey(null), null);
  assert.equal(parseDayKey(20261009), null);
});

test('dayKeyInZone uses the user calendar, not UTC', () => {
  // 21:30Z is 00:30 next day in Moscow (UTC+3).
  assert.equal(dayKeyInZone(new Date('2026-10-09T21:30:00Z'), 'Europe/Moscow'), '2026-10-10');
  assert.equal(dayKeyInZone(new Date('2026-10-09T20:59:00Z'), 'Europe/Moscow'), '2026-10-09');
  assert.equal(dayKeyInZone(new Date('2026-10-09T21:30:00Z'), 'UTC'), '2026-10-09');
  // 03:00Z is still the previous evening in New York (UTC-4 in October).
  assert.equal(dayKeyInZone(new Date('2026-10-10T03:00:00Z'), 'America/New_York'), '2026-10-09');
});

test('normalizeTimeZone falls back to Moscow for garbage', () => {
  assert.equal(DEFAULT_TIME_ZONE, 'Europe/Moscow');
  assert.equal(normalizeTimeZone('Asia/Yekaterinburg'), 'Asia/Yekaterinburg');
  assert.equal(normalizeTimeZone('America/New_York'), 'America/New_York');
  assert.equal(normalizeTimeZone('Mars/Olympus'), 'Europe/Moscow');
  assert.equal(normalizeTimeZone(''), 'Europe/Moscow');
  assert.equal(normalizeTimeZone(undefined), 'Europe/Moscow');
  assert.equal(normalizeTimeZone(42), 'Europe/Moscow');
  assert.equal(dayKeyInZone(new Date('2026-10-09T21:30:00Z'), 'Mars/Olympus'), '2026-10-10');
});

test('db dates are UTC midnights of the day key', () => {
  const date = dayKeyToDbDate('2026-10-09');
  assert.equal(date.toISOString(), '2026-10-09T00:00:00.000Z');
  assert.equal(dbDateToDayKey(new Date('2026-10-09T00:00:00.000Z')), '2026-10-09');
  assert.equal(dbDateToDayKey(new Date('2026-10-09T23:59:59.999Z')), '2026-10-09');
  assert.throws(() => dayKeyToDbDate('2026-02-31'));
});

test('addDays, diffDays and weekStart work across months, years and DST', () => {
  assert.equal(addDays('2026-10-09', 1), '2026-10-10');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(addDays('2026-03-07', 2), '2026-03-09');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(diffDays('2026-10-10', '2026-10-09'), 1);
  assert.equal(diffDays('2026-10-09', '2026-10-10'), -1);
  assert.equal(diffDays('2027-01-01', '2026-12-31'), 1);
  assert.equal(diffDays('2026-11-02', '2026-10-25'), 8);
  // 2026-10-09 is a Friday; 2026-10-05 is Monday.
  assert.equal(weekStart('2026-10-09'), '2026-10-05');
  assert.equal(weekStart('2026-10-05'), '2026-10-05');
  assert.equal(weekStart('2026-10-11'), '2026-10-05');
  assert.equal(weekStart('2027-01-01'), '2026-12-28');
});

test('zonedTimeToInstant converts local wall time to an instant', () => {
  assert.equal(
    zonedTimeToInstant('2026-10-09', '20:00', 'Asia/Yekaterinburg').toISOString(),
    '2026-10-09T15:00:00.000Z',
  );
  assert.equal(
    zonedTimeToInstant('2026-10-09', '00:30', 'Europe/Moscow').toISOString(),
    '2026-10-08T21:30:00.000Z',
  );
  // New York: EST (UTC-5) before 2026-03-08, EDT (UTC-4) after.
  assert.equal(
    zonedTimeToInstant('2026-03-07', '20:00', 'America/New_York').toISOString(),
    '2026-03-08T01:00:00.000Z',
  );
  assert.equal(
    zonedTimeToInstant('2026-03-09', '20:00', 'America/New_York').toISOString(),
    '2026-03-10T00:00:00.000Z',
  );
});

test('localHHMM formats wall time in the zone with a 24h clock', () => {
  assert.equal(localHHMM(new Date('2026-10-09T15:00:00Z'), 'Asia/Yekaterinburg'), '20:00');
  assert.equal(localHHMM(new Date('2026-10-09T21:05:00Z'), 'Europe/Moscow'), '00:05');
  assert.equal(localHHMM(new Date('2026-10-09T00:00:00Z'), 'UTC'), '00:00');
});
