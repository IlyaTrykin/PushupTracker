import assert from 'node:assert/strict';
import test from 'node:test';
import { computeGroupGoalProgress, parseGroupGoalInput, type GroupGoalMember, type GroupGoalWorkout } from './group-goal';

const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
const goal = { targetPoints: 1000, exerciseType: null, startDate: day('2026-10-01'), endDate: day('2026-10-31') };
const members: GroupGoalMember[] = [
  { userId: 'a', username: 'anna', includeInStats: true, status: 'active' },
  { userId: 'b', username: 'boris', includeInStats: true, status: 'active' },
  { userId: 'c', username: 'carl', includeInStats: false, status: 'active' },
  { userId: 'd', username: 'dina', includeInStats: true, status: 'left' },
];
const w = (userId: string, date: string, exerciseType: string, reps: number, loadKg: number | null = null): GroupGoalWorkout => ({
  userId, date: day(date), exerciseType, reps, loadKg,
});

test('sums points of counted members inside the goal days, biggest contribution first', () => {
  const result = computeGroupGoalProgress(goal, [
    w('a', '2026-10-01', 'pushups', 100), // first day counts
    w('b', '2026-10-31', 'pushups', 300), // last day counts
    w('b', '2026-10-15', 'squats', 100), // 100 squats = 100 * 0.7 = 70 pts
    w('a', '2026-09-30', 'pushups', 999), // before start
    w('a', '2026-11-01', 'pushups', 999), // after end
    w('c', '2026-10-10', 'pushups', 500), // excluded from stats
    w('d', '2026-10-10', 'pushups', 500), // left the group
    w('x', '2026-10-10', 'pushups', 500), // not a member
  ], members);
  assert.equal(result.totalPoints, 470);
  assert.deepEqual(result.contributions, [
    { userId: 'b', username: 'boris', points: 370 },
    { userId: 'a', username: 'anna', points: 100 },
  ]);
  assert.equal(result.percent, 47);
  assert.equal(result.reached, false);
});

test('a single-exercise goal counts only that exercise', () => {
  const result = computeGroupGoalProgress({ ...goal, targetPoints: 100, exerciseType: 'pushups' }, [
    w('a', '2026-10-05', 'pushups', 100),
    w('a', '2026-10-05', 'squats', 1000),
  ], members);
  assert.equal(result.totalPoints, 100);
  assert.equal(result.percent, 100);
  assert.equal(result.reached, true);
});

test('percent is capped at 100 and never rounds up before the target is reached', () => {
  const near = computeGroupGoalProgress(goal, [w('a', '2026-10-05', 'pushups', 999)], members);
  assert.equal(near.percent, 99);
  assert.equal(near.reached, false);
  const over = computeGroupGoalProgress(goal, [w('a', '2026-10-05', 'pushups', 2500)], members);
  assert.equal(over.percent, 100);
  assert.equal(over.reached, true);
});

test('goal input: valid, trimmed, with day keys', () => {
  const result = parseGroupGoalInput({ title: '  Вместе  ', targetPoints: 10000, exerciseType: 'all', startDate: '2026-10-01', endDate: '2026-10-31' });
  assert.deepEqual(result, { ok: true, value: { title: 'Вместе', targetPoints: 10000, exerciseType: null, startDay: '2026-10-01', endDay: '2026-10-31' } });
  const single = parseGroupGoalInput({ title: 'x', targetPoints: 100, exerciseType: 'pullups', startDate: '2026-10-01', endDate: '2026-10-01' });
  assert.equal(single.ok && single.value.exerciseType, 'pullups');
});

test('goal input: rejects bad fields with a code', () => {
  const base = { title: 'x', targetPoints: 500, exerciseType: 'all', startDate: '2026-10-01', endDate: '2026-10-31' };
  const code = (patch: Record<string, unknown>) => {
    const r = parseGroupGoalInput({ ...base, ...patch });
    return r.ok ? 'ok' : r.code;
  };
  assert.equal(code({ title: '   ' }), 'GOAL_TITLE_INVALID');
  assert.equal(code({ title: 'я'.repeat(81) }), 'GOAL_TITLE_INVALID');
  assert.equal(code({ targetPoints: 99 }), 'GOAL_POINTS_INVALID');
  assert.equal(code({ targetPoints: 10_000_001 }), 'GOAL_POINTS_INVALID');
  assert.equal(code({ targetPoints: 100.5 }), 'GOAL_POINTS_INVALID');
  assert.equal(code({ exerciseType: 'flying' }), 'GOAL_EXERCISE_INVALID');
  assert.equal(code({ startDate: '2026-02-31' }), 'GOAL_DATE_INVALID');
  assert.equal(code({ endDate: '2026-09-30' }), 'GOAL_DATE_INVALID');
  assert.equal(parseGroupGoalInput(null).ok, false);
});
