import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProgressAnalytics } from './selectors';
import type { WorkoutRecord } from './types';

function workout(params: {
  id: string;
  date: string;
  time: string;
  reps: number;
  exerciseType: WorkoutRecord['exerciseType'];
  trainingSessionId?: string | null;
}): WorkoutRecord {
  return {
    id: params.id,
    date: `${params.date}T00:00:00.000Z`,
    time: `${params.date}T${params.time}:00.000Z`,
    reps: params.reps,
    exerciseType: params.exerciseType,
    trainingSessionId: params.trainingSessionId ?? null,
  };
}

test('builds exercise analytics with quality metrics and fallback workout grouping', () => {
  const workouts: WorkoutRecord[] = [
    workout({ id: 'a', date: '2026-03-16', time: '09:00', reps: 20, exerciseType: 'pushups' }),
    workout({ id: 'b', date: '2026-03-16', time: '09:03', reps: 18, exerciseType: 'pushups' }),
    workout({ id: 'c', date: '2026-03-17', time: '08:00', reps: 22, exerciseType: 'pushups' }),
    workout({ id: 'd', date: '2026-03-17', time: '08:04', reps: 20, exerciseType: 'pushups' }),
    workout({ id: 'e', date: '2026-02-01', time: '08:00', reps: 12, exerciseType: 'pushups' }),
  ];

  const analytics = buildProgressAnalytics({
    workouts,
    exercise: 'pushups',
    period: '30d',
    today: new Date('2026-03-18T12:00:00.000Z'),
  });

  assert.equal(analytics.trainingDays, 2);
  assert.equal(analytics.totalSets, 4);
  assert.equal(analytics.totalValue.value, 80);
  assert.equal(analytics.kpis.find((card) => card.id === 'bestSet')?.metric.value, 22);
  assert.equal(Math.round(analytics.kpis.find((card) => card.id === 'averageSet')?.metric.value ?? 0), 20);

  const fatigue = analytics.qualityMetrics.find((metric) => metric.id === 'fatigueDrop');
  assert.equal(fatigue?.state, 'ok');
  assert.equal(Math.round(fatigue?.metric.value ?? 0), 10);

  const heavy = analytics.qualityMetrics.find((metric) => metric.id === 'heavyShare');
  assert.equal(Math.round(heavy?.metric.value ?? 0), 100);

  assert.equal(analytics.workouts.length, 2);
  assert.equal(analytics.workouts[0]?.source, 'day');
  assert.equal(analytics.workouts[0]?.sets.length, 2);
});

test('calculates mixed load, distribution, and insights for all exercises', () => {
  const workouts: WorkoutRecord[] = [
    workout({ id: 'a', date: '2026-03-18', time: '08:00', reps: 20, exerciseType: 'pushups' }),
    workout({ id: 'b', date: '2026-03-17', time: '08:00', reps: 10, exerciseType: 'pullups' }),
    workout({ id: 'c', date: '2026-03-17', time: '08:08', reps: 60, exerciseType: 'plank' }),
    workout({ id: 'd', date: '2026-03-12', time: '08:00', reps: 8, exerciseType: 'squats' }),
    workout({ id: 'e', date: '2026-03-11', time: '08:00', reps: 5, exerciseType: 'pullups' }),
    workout({ id: 'f', date: '2026-03-10', time: '08:00', reps: 10, exerciseType: 'pushups' }),
  ];

  const analytics = buildProgressAnalytics({
    workouts,
    exercise: 'all',
    period: '7d',
    today: new Date('2026-03-18T12:00:00.000Z'),
  });

  assert.equal(Math.round(analytics.totalValue.value ?? 0), 62);
  assert.equal(analytics.kpis.find((card) => card.id === 'bestSet')?.metric.value, 30);
  assert.equal(analytics.distribution[0]?.exercise, 'pullups');
  assert.equal(Math.round((analytics.distribution[0]?.share ?? 0) * 100), 49);
  assert.ok(analytics.insights.some((item) => item.id === 'dominant-exercise'));
});

test('does not invent percentage growth when previous period has no data', () => {
  const workouts: WorkoutRecord[] = [
    workout({ id: 'a', date: '2026-03-18', time: '08:00', reps: 25, exerciseType: 'pushups' }),
  ];

  const analytics = buildProgressAnalytics({
    workouts,
    exercise: 'pushups',
    period: '7d',
    today: new Date('2026-03-18T12:00:00.000Z'),
  });

  const progress = analytics.kpis.find((card) => card.id === 'periodProgress');
  assert.equal(progress?.metric.value, null);
  assert.equal(progress?.comparison?.available, false);
});
