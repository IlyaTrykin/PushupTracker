import assert from 'node:assert/strict';
import test from 'node:test';
import { EXERCISE_IDS } from '@/lib/exercises';
import { estimateDurationSeconds, toHealthWorkout } from './mapping';
import { workoutFingerprint } from './reconcile';

const END = '2026-10-17T10:00:00.000Z';

// interfaces.md §6: the table «упражнение → тип Health», written out by hand.
const EXPECTED_ACTIVITY: Record<string, { apple: string; android: string }> = {
  pushups: { apple: 'functionalStrengthTraining', android: 'EXERCISE_TYPE_CALISTHENICS' },
  pullups: { apple: 'functionalStrengthTraining', android: 'EXERCISE_TYPE_CALISTHENICS' },
  crunches: { apple: 'functionalStrengthTraining', android: 'EXERCISE_TYPE_CALISTHENICS' },
  squats: { apple: 'functionalStrengthTraining', android: 'EXERCISE_TYPE_CALISTHENICS' },
  plank: { apple: 'coreTraining', android: 'EXERCISE_TYPE_CALISTHENICS' },
  dips: { apple: 'functionalStrengthTraining', android: 'EXERCISE_TYPE_CALISTHENICS' },
  hanging_leg_raises: { apple: 'functionalStrengthTraining', android: 'EXERCISE_TYPE_CALISTHENICS' },
  muscle_ups: { apple: 'functionalStrengthTraining', android: 'EXERCISE_TYPE_CALISTHENICS' },
  lunges: { apple: 'functionalStrengthTraining', android: 'EXERCISE_TYPE_CALISTHENICS' },
  burpees: { apple: 'functionalStrengthTraining', android: 'EXERCISE_TYPE_CALISTHENICS' },
  jump_rope: { apple: 'jumpRope', android: 'EXERCISE_TYPE_OTHER_WORKOUT' },
  wall_sit: { apple: 'coreTraining', android: 'EXERCISE_TYPE_CALISTHENICS' },
  kettlebell_press: { apple: 'traditionalStrengthTraining', android: 'EXERCISE_TYPE_STRENGTH_TRAINING' },
  kettlebell_jerk: { apple: 'traditionalStrengthTraining', android: 'EXERCISE_TYPE_STRENGTH_TRAINING' },
  kettlebell_swing: { apple: 'traditionalStrengthTraining', android: 'EXERCISE_TYPE_STRENGTH_TRAINING' },
  run: { apple: 'running', android: 'EXERCISE_TYPE_RUNNING' },
  bike: { apple: 'cycling', android: 'EXERCISE_TYPE_BIKING' },
  row: { apple: 'rowing', android: 'EXERCISE_TYPE_ROWING_MACHINE' },
};

test('every one of the 18 catalog exercises has its Health type on both platforms', () => {
  assert.equal(EXERCISE_IDS.length, 18);
  for (const exerciseType of EXERCISE_IDS) {
    const expected = EXPECTED_ACTIVITY[exerciseType];
    assert.ok(expected, `no expectation for ${exerciseType}`);
    const w = { clientRequestId: 'r1', exerciseType, reps: 20, time: END };
    assert.equal(toHealthWorkout(w, 'apple_health', 'ru').activity, expected.apple, exerciseType);
    assert.equal(toHealthWorkout(w, 'health_connect', 'ru').activity, expected.android, exerciseType);
  }
});

test('duration: own duration first, else 3 s per rep with a 60 s floor, seconds exercises last their value', () => {
  assert.equal(estimateDurationSeconds('pushups', 30), 90);
  assert.equal(estimateDurationSeconds('pushups', 10), 60);
  assert.equal(estimateDurationSeconds('pushups', 30, 200), 200);
  assert.equal(estimateDurationSeconds('plank', 45), 45);
  assert.equal(estimateDurationSeconds('wall_sit', 120, null), 120);
  assert.equal(estimateDurationSeconds('run', 5000, 1500), 1500);
});

test('distance without a duration gets a plausible pace, not 3 s per metre', () => {
  // 6:00/km running, 25 km/h cycling (2:24/km), 2:30/500 m rowing (5:00/km).
  assert.equal(estimateDurationSeconds('run', 5000), 1800);
  assert.equal(estimateDurationSeconds('bike', 10000), 1440);
  assert.equal(estimateDurationSeconds('row', 2000), 600);
  assert.equal(estimateDurationSeconds('run', 50), 60);
});

test('a strength workout ends at its time, starts duration earlier and keeps reps and a readable title', () => {
  const h = toHealthWorkout({ clientRequestId: 'req-1', exerciseType: 'pushups', reps: 30, time: END }, 'apple_health', 'ru');
  assert.equal(h.externalId, 'req-1');
  assert.equal(h.exerciseType, 'pushups');
  assert.equal(h.end, END);
  assert.equal(h.start, '2026-10-17T09:58:30.000Z');
  assert.equal(h.reps, 30);
  assert.equal(h.distanceMeters, undefined);
  assert.equal(h.title, 'Отжимания · 30 повт.');
  assert.equal(toHealthWorkout({ clientRequestId: 'req-1', exerciseType: 'pushups', reps: 30, time: END }, 'health_connect', 'en').title, 'Push-ups · 30 reps');
});

test('a run carries its distance in metres and its own duration; no reps', () => {
  const h = toHealthWorkout({ clientRequestId: 'req-2', exerciseType: 'run', reps: 5200, durationSeconds: 1590, time: END }, 'health_connect', 'ru');
  assert.equal(h.activity, 'EXERCISE_TYPE_RUNNING');
  assert.equal(h.distanceMeters, 5200);
  assert.equal(h.reps, undefined);
  assert.equal(h.start, '2026-10-17T09:33:30.000Z');
  assert.equal(h.end, END);
  assert.match(h.title, /^Бег · 5,2 км/);
});

test('a plank has no reps (its value is seconds) and lasts its value', () => {
  const h = toHealthWorkout({ clientRequestId: 'req-3', exerciseType: 'plank', reps: 90, time: END }, 'apple_health', 'en');
  assert.equal(h.reps, undefined);
  assert.equal(h.start, '2026-10-17T09:58:30.000Z');
  assert.equal(h.title, 'Plank · 90 sec');
});

test('the record carries the fingerprint of the workout, so a changed workout is found later', () => {
  const w = { clientRequestId: 'req-4', exerciseType: 'squats', reps: 25, durationSeconds: null, time: END };
  const h = toHealthWorkout(w, 'apple_health', 'ru');
  assert.equal(h.fingerprint, workoutFingerprint(w));
  assert.notEqual(toHealthWorkout({ ...w, reps: 26 }, 'apple_health', 'ru').fingerprint, h.fingerprint);
});

test('a time without milliseconds gives the same record as the server form of it', () => {
  const a = toHealthWorkout({ clientRequestId: 'r', exerciseType: 'pushups', reps: 30, time: '2026-10-17T10:00:00Z' }, 'apple_health', 'ru');
  const b = toHealthWorkout({ clientRequestId: 'r', exerciseType: 'pushups', reps: 30, time: END }, 'apple_health', 'ru');
  assert.deepEqual(a, b);
});
