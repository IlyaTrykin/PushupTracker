// Runs in a zone west of UTC with DST: day bucketing must not depend on the browser zone
// (B23) and day arithmetic must survive the clock change (B24).
process.env.TZ = 'America/New_York';

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProgressAnalytics } from './analytics/selectors';
import { computePeriodStats, dayPointsTotal, localTodayKey, workoutDayKey, type DayStatsWorkout } from './day-stats';

function w(day: string, reps: number, exerciseType = 'pushups', extra: Partial<DayStatsWorkout> = {}): DayStatsWorkout {
  return { date: `${day}T00:00:00.000Z`, reps, exerciseType, ...extra };
}

test('B27: day total is in points — 20 push-ups + 60 s plank = 26', () => {
  assert.equal(dayPointsTotal([w('2026-10-09', 20, 'pushups'), w('2026-10-09', 60, 'plank')]), 26);
});

test('B23: a workout belongs to its stored calendar date, not to the local day of its time', () => {
  // Stored for 9 October (UTC midnight); performed late evening in New York (still 8 Oct locally).
  const record = { id: 'a', reps: 10, exerciseType: 'pushups', date: '2026-10-09T00:00:00.000Z', time: '2026-10-09T02:30:00.000Z' };
  assert.equal(workoutDayKey(record), '2026-10-09');

  const analytics = buildProgressAnalytics({
    workouts: [record],
    exercise: 'all',
    period: '7d',
    today: new Date(2026, 9, 10, 12, 0, 0),
  });
  const point = analytics.volumeSeries.find((p) => p.value > 0);
  assert.equal(point?.key, '2026-10-09', 'analytics puts the record on the same day as the dashboard');
});

test('B12: streak is 0 when the last active day is older than yesterday', () => {
  const workouts = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'].map((d) => w(d, 10));
  // Sat 10 Oct: Tue 6 is frozen, Wed 7 breaks the run.
  assert.equal(computePeriodStats(workouts, '2026-10-10').streak, 0);
});

test('B12: streak is alive when the last active day is yesterday', () => {
  const workouts = [w('2026-10-07', 10), w('2026-10-08', 10)];
  const stats = computePeriodStats(workouts, '2026-10-09');
  assert.equal(stats.streak, 2);
  assert.equal(stats.streakFreezeUsed, false);
});

test('F4: one missed day a week is frozen and flagged', () => {
  // Mon 5, (Tue 6 missed), Wed 7, Thu 8; today Fri 9 without a workout yet.
  const workouts = [w('2026-10-05', 10), w('2026-10-07', 10), w('2026-10-08', 10)];
  const stats = computePeriodStats(workouts, '2026-10-09');
  assert.equal(stats.streak, 3);
  assert.equal(stats.streakFreezeUsed, true);
});

test('B24: totals and averages use calendar days across the DST change', () => {
  // US clocks moved forward on Sun 8 March 2026.
  const workouts = [w('2026-03-07', 10), w('2026-03-08', 10), w('2026-03-09', 10), w('2026-03-10', 30)];
  const stats = computePeriodStats(workouts, '2026-03-10');
  assert.equal(stats.streak, 4);
  assert.equal(stats.totalToday, 30);
  assert.equal(stats.totalWeek, 40); // Mon 9 – Tue 10
  assert.equal(stats.totalMonth, 60);
  assert.equal(stats.totalYear, 60);
  assert.equal(stats.totalAll, 60);
  assert.equal(stats.avgPerDayMonth, 6); // 60 / 10 days
  assert.equal(stats.avgPerDayAll, 15); // 60 / 4 days since the first one
  assert.equal(stats.avgPerDayYear, Math.round(60 / 69));
});

test('empty history', () => {
  assert.deepEqual(computePeriodStats([], '2026-10-09'), {
    totalToday: 0,
    totalWeek: 0,
    totalMonth: 0,
    totalYear: 0,
    totalAll: 0,
    avgPerDayMonth: 0,
    avgPerDayYear: 0,
    avgPerDayAll: 0,
    streak: 0,
    streakFreezeUsed: false,
  });
});

test('client «today» is the day in the user\'s saved zone; the browser zone only without one', () => {
  // 03:30 on 10 October in Yekaterinburg, still 9 October in New York (the browser zone of this file).
  const now = new Date('2026-10-09T22:30:00.000Z');
  assert.equal(localTodayKey('Asia/Yekaterinburg', now), '2026-10-10');
  assert.equal(localTodayKey(undefined, now), '2026-10-09');
  assert.equal(localTodayKey(null, now), '2026-10-09');
  assert.equal(localTodayKey('Not/A_Zone', now), '2026-10-09');
});
