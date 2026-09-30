import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateExercisePoints } from './exercise-points';
import { parseWorkoutLoadFields } from './workout-input';
import {
  EXERCISE_IDS,
  EXERCISES,
  FAVORITE_EXERCISE_LIMIT,
  isExerciseType,
  normalizeFavoriteExercises,
  resolveFavoriteExercises,
  toExerciseType,
} from './exercises';

test('bodyweight exercises keep their historical point factors', () => {
  assert.equal(calculateExercisePoints(10, 'pushups'), 10);
  assert.equal(calculateExercisePoints(10, 'pullups'), 30);
  assert.equal(calculateExercisePoints(10, 'squats'), 7);
  assert.equal(calculateExercisePoints(10, 'crunches'), 5);
  assert.equal(calculateExercisePoints(60, 'plank'), 6);
});

test('unknown exercise types fall back to push-ups', () => {
  assert.equal(isExerciseType('yoga_flow'), false);
  assert.equal(toExerciseType('yoga_flow'), 'pushups');
  assert.equal(calculateExercisePoints(10, 'yoga_flow'), 10);
});

test('every catalog entry is internally consistent', () => {
  for (const id of EXERCISE_IDS) {
    const exercise = EXERCISES[id];
    assert.equal(exercise.id, id);
    assert.ok(exercise.pointsPerUnit > 0, id);
    if (exercise.load) assert.ok(exercise.load.presetsKg.includes(exercise.load.referenceKg), id);
  }
});

test('favorites keep known unique exercises up to the limit', () => {
  assert.deepEqual(normalizeFavoriteExercises(['plank', 'yoga_flow', 'plank', 'pushups']), ['plank', 'pushups']);
  assert.equal(normalizeFavoriteExercises(EXERCISE_IDS).length, FAVORITE_EXERCISE_LIMIT);
  assert.deepEqual(normalizeFavoriteExercises('pushups'), []);
});

test('empty favorites resolve to the start of the catalog', () => {
  assert.deepEqual(resolveFavoriteExercises([]), EXERCISE_IDS.slice(0, FAVORITE_EXERCISE_LIMIT));
  assert.deepEqual(resolveFavoriteExercises(['plank']), ['plank']);
});

test('kettlebell points scale with the square of the weight', () => {
  assert.equal(calculateExercisePoints(10, 'kettlebell_press', 16), 30);
  assert.equal(calculateExercisePoints(10, 'kettlebell_jerk', 16), 20);
  assert.equal(calculateExercisePoints(1, 'kettlebell_press', 24), 6.8);
  assert.equal(calculateExercisePoints(10, 'kettlebell_press', 8), 7.5);
  assert.equal(calculateExercisePoints(10, 'kettlebell_press', null), 0);
});

test('one-arm sets add up both sides and require a weight', () => {
  assert.deepEqual(
    parseWorkoutLoadFields('kettlebell_press', { repsLeft: 5, repsRight: 6, loadKg: 16 }),
    { ok: true, value: { reps: 11, loadKg: 16, repsLeft: 5, repsRight: 6 } },
  );
  assert.equal(parseWorkoutLoadFields('kettlebell_press', { repsLeft: 5, repsRight: 6 }).ok, false);
  assert.equal(parseWorkoutLoadFields('kettlebell_press', { repsLeft: 0, repsRight: 0, loadKg: 16 }).ok, false);
});

test('bodyweight sets ignore weight and sides', () => {
  assert.deepEqual(
    parseWorkoutLoadFields('pushups', { reps: 20, loadKg: 16, repsLeft: 3 }),
    { ok: true, value: { reps: 20, loadKg: null, repsLeft: null, repsRight: null } },
  );
});

test('editing only the total keeps the arm split when the total is unchanged', () => {
  const existing = { reps: 11, loadKg: 16, repsLeft: 5, repsRight: 6 };
  assert.deepEqual(parseWorkoutLoadFields('kettlebell_press', { reps: 11 }, existing), { ok: true, value: existing });
  assert.deepEqual(
    parseWorkoutLoadFields('kettlebell_press', { reps: 12 }, existing),
    { ok: true, value: { reps: 12, loadKg: 16, repsLeft: null, repsRight: null } },
  );
});

test('one-leg sets work without a weight', () => {
  assert.deepEqual(
    parseWorkoutLoadFields('lunges', { repsLeft: 12, repsRight: 10 }),
    { ok: true, value: { reps: 22, loadKg: null, repsLeft: 12, repsRight: 10 } },
  );
  assert.equal(calculateExercisePoints(22, 'lunges'), 26.4);
});

test('two-hand loaded sets keep a single total', () => {
  assert.deepEqual(
    parseWorkoutLoadFields('kettlebell_swing', { reps: 30, loadKg: 24, repsLeft: 5 }),
    { ok: true, value: { reps: 30, loadKg: 24, repsLeft: null, repsRight: null } },
  );
  assert.equal(calculateExercisePoints(30, 'kettlebell_swing', 24), 30);
  assert.equal(calculateExercisePoints(30, 'kettlebell_swing', 16), 13.3);
});

test('wall sit is timed like the plank', () => {
  assert.equal(EXERCISES.wall_sit.unit, 'seconds');
  assert.equal(calculateExercisePoints(120, 'wall_sit'), 30);
});
