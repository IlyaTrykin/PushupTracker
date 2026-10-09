import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStreak } from './streak';
import { dayKeyInZone } from './calendar-day';

// 2026-10-09 is a Friday; its week is Mon 2026-10-05 … Sun 2026-10-11.
const TODAY = '2026-10-09';

test('no activity → empty streak', () => {
  assert.deepEqual(computeStreak([], TODAY), { current: 0, best: 0, freezeUsedThisWeek: false, frozenDays: [] });
});

test('streak is alive when the last active day is today or yesterday', () => {
  const withToday = computeStreak(['2026-10-07', '2026-10-08', '2026-10-09'], TODAY);
  assert.equal(withToday.current, 3);
  assert.equal(withToday.best, 3);
  assert.deepEqual(withToday.frozenDays, []);

  const untilYesterday = computeStreak(['2026-10-06', '2026-10-07', '2026-10-08'], TODAY);
  assert.equal(untilYesterday.current, 3);
  assert.equal(untilYesterday.freezeUsedThisWeek, false);
});

test('last active day before yesterday → zero without a freeze', () => {
  const result = computeStreak(['2026-10-06', '2026-10-07'], TODAY, { freezePerWeek: 0 });
  assert.equal(result.current, 0);
  assert.equal(result.best, 2);
  assert.deepEqual(result.frozenDays, []);
});

test('one missed day per week is covered by a freeze', () => {
  // Missed yesterday (Thu) → frozen, the streak lives.
  const recent = computeStreak(['2026-10-06', '2026-10-07'], TODAY);
  assert.equal(recent.current, 2);
  assert.deepEqual(recent.frozenDays, ['2026-10-08']);
  assert.equal(recent.freezeUsedThisWeek, true);

  // Missed Wednesday inside the run: the frozen day does not count as an active day.
  const inside = computeStreak(['2026-10-05', '2026-10-06', '2026-10-08', '2026-10-09'], TODAY);
  assert.equal(inside.current, 4);
  assert.deepEqual(inside.frozenDays, ['2026-10-07']);
  assert.equal(inside.freezeUsedThisWeek, true);
});

test('each calendar week has its own freeze', () => {
  // Missed Wed of the previous week and Tue of this week.
  const days = ['2026-09-28', '2026-09-29', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-07', '2026-10-08'];
  const result = computeStreak(days, TODAY);
  assert.equal(result.current, 9);
  assert.deepEqual(result.frozenDays, ['2026-09-30', '2026-10-06']);
  assert.equal(result.freezeUsedThisWeek, true);
});

test('two missed days in one week break the streak', () => {
  // Missed Tue and Wed of this week.
  const consecutive = computeStreak(['2026-10-04', '2026-10-05', '2026-10-08', '2026-10-09'], TODAY);
  assert.equal(consecutive.current, 2);
  assert.equal(consecutive.best, 2);
  assert.deepEqual(consecutive.frozenDays, []);
  assert.equal(consecutive.freezeUsedThisWeek, false);

  // Missed Mon and Wed of this week (not adjacent).
  const apart = computeStreak(['2026-10-04', '2026-10-06', '2026-10-08', '2026-10-09'], TODAY);
  assert.equal(apart.current, 2);
  assert.deepEqual(apart.frozenDays, []);
});

test('a freeze is not spent on a gap before the first active day', () => {
  const result = computeStreak(['2026-10-01'], TODAY);
  assert.equal(result.current, 0);
  assert.equal(result.best, 1);
  assert.deepEqual(result.frozenDays, []);
  assert.equal(result.freezeUsedThisWeek, false);
});

test('today without activity is not a miss', () => {
  // Active through Wed, frozen Thu, today (Fri) still open.
  const result = computeStreak(['2026-10-05', '2026-10-06', '2026-10-07'], TODAY);
  assert.equal(result.current, 3);
  assert.deepEqual(result.frozenDays, ['2026-10-08']);
});

test('best keeps the longest run from history, duplicates and future days are ignored', () => {
  const days = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-04', '2026-10-09', '2026-10-20'];
  const result = computeStreak(days, TODAY);
  assert.equal(result.current, 1);
  assert.equal(result.best, 4);
});

test('DST change in America/New_York does not break the streak', () => {
  // Late-evening sets every day around the 2026-03-08 spring-forward and 2026-11-01 fall-back.
  const spring = ['2026-03-07T23:30:00-05:00', '2026-03-08T23:30:00-04:00', '2026-03-09T23:30:00-04:00'];
  const springDays = spring.map((iso) => dayKeyInZone(new Date(iso), 'America/New_York'));
  assert.deepEqual(springDays, ['2026-03-07', '2026-03-08', '2026-03-09']);
  assert.equal(computeStreak(springDays, '2026-03-09', { freezePerWeek: 0 }).current, 3);

  const fall = ['2026-10-31T00:30:00-04:00', '2026-11-01T00:30:00-04:00', '2026-11-02T00:30:00-05:00'];
  const fallDays = fall.map((iso) => dayKeyInZone(new Date(iso), 'America/New_York'));
  assert.deepEqual(fallDays, ['2026-10-31', '2026-11-01', '2026-11-02']);
  assert.equal(computeStreak(fallDays, '2026-11-02', { freezePerWeek: 0 }).current, 3);
});
