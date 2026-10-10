import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendToday, type RecommendationWorkout } from './recommendation';

const TODAY = '2026-10-10';

function sets(date: string, values: number[], exerciseType = 'pushups'): RecommendationWorkout[] {
  return values.map((reps) => ({ date: `${date}T00:00:00.000Z`, reps, exerciseType }));
}

test('growth: about +5% over the best recent day, split into that day\'s number of sets', () => {
  // Best day of the last 14 days: 4 × 20 = 80 → today ≈ 84 → 4 × 21.
  const history = [
    ...sets('2026-10-03', [15, 15, 15]),
    ...sets('2026-10-06', [20, 20, 20, 20]),
    ...sets('2026-10-08', [18, 18, 18]),
  ];
  assert.deepEqual(recommendToday(history, 'pushups', TODAY), { sets: 4, perSet: 21, unit: 'reps', kind: 'grow' });
});

test('example from the spec: best day 4 × 21 → 4 × 22', () => {
  const history = [...sets('2026-10-01', [21, 21, 21, 21]), ...sets('2026-10-05', [19, 19, 19])];
  assert.deepEqual(recommendToday(history, 'pushups', TODAY), { sets: 4, perSet: 22, unit: 'reps', kind: 'grow' });
});

test('deload: after a heavy yesterday (near the recent best) the volume goes down', () => {
  // Yesterday 4 × 20 = 80 is the best day → today lighter: fewer sets, below the best day volume.
  const history = [...sets('2026-10-04', [15, 15, 15]), ...sets('2026-10-09', [20, 20, 20, 20])];
  const plan = recommendToday(history, 'pushups', TODAY);
  assert.ok(plan);
  assert.equal(plan.kind, 'deload');
  assert.equal(plan.unit, 'reps');
  assert.equal(plan.sets, 3);
  assert.ok(plan.sets * plan.perSet < 80 * 0.85, `deload volume ${plan.sets * plan.perSet} must be well below 80`);
});

test('deload never asks for bigger sets than the heavy day had', () => {
  const history = [...sets('2026-10-05', [10, 10, 10], 'burpees'), ...sets('2026-10-09', [12, 12, 12], 'burpees')];
  const plan = recommendToday(history, 'burpees', TODAY);
  assert.ok(plan);
  assert.equal(plan.kind, 'deload');
  assert.ok(plan.perSet <= 12, `perSet ${plan.perSet} must not exceed 12`);
  assert.ok(plan.sets * plan.perSet < 36);
});

test('a light yesterday is not a reason to deload', () => {
  const history = [...sets('2026-10-04', [20, 20, 20, 20]), ...sets('2026-10-09', [10])];
  assert.equal(recommendToday(history, 'pushups', TODAY)?.kind, 'grow');
});

test('fewer than 3 workouts of this exercise in the last 14 days → null', () => {
  assert.equal(recommendToday([], 'pushups', TODAY), null);
  assert.equal(recommendToday(sets('2026-10-08', [20, 20]), 'pushups', TODAY), null);
  // Other exercises and old workouts do not count.
  const history = [
    ...sets('2026-10-08', [20, 20]),
    ...sets('2026-10-08', [30, 30, 30], 'squats'),
    ...sets('2026-09-20', [25, 25, 25]),
  ];
  assert.equal(recommendToday(history, 'pushups', TODAY), null);
});

test('today\'s workouts do not move today\'s plan', () => {
  const history = [...sets('2026-10-06', [20, 20, 20, 20]), ...sets('2026-10-08', [18, 18, 18])];
  const before = recommendToday(history, 'pushups', TODAY);
  assert.ok(before);
  const after = recommendToday([...history, ...sets(TODAY, [40, 40, 40, 40])], 'pushups', TODAY);
  assert.deepEqual(after, before);
});

test('timed exercise: seconds, rounded to 5 s', () => {
  const history = sets('2026-10-07', [60, 60, 60], 'plank');
  // 180 s × 1.05 = 189 → 3 × 63 → rounded up to 65 s.
  assert.deepEqual(recommendToday(history, 'plank', TODAY), { sets: 3, perSet: 65, unit: 'seconds', kind: 'grow' });
});

test('cardio: one distance in metres, rounded to 100 m', () => {
  const history = [
    ...sets('2026-10-02', [4000], 'run'),
    ...sets('2026-10-05', [5000], 'run'),
    ...sets('2026-10-07', [4500], 'run'),
  ];
  // Best 5 km × 1.05 = 5.25 km → 5.3 km.
  assert.deepEqual(recommendToday(history, 'run', TODAY), { sets: 1, perSet: 5300, unit: 'distance', kind: 'grow' });
});
