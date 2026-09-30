import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateExercisePoints } from './exercise-points';
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
  assert.equal(isExerciseType('burpees'), false);
  assert.equal(toExerciseType('burpees'), 'pushups');
  assert.equal(calculateExercisePoints(10, 'burpees'), 10);
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
  assert.deepEqual(normalizeFavoriteExercises(['plank', 'burpees', 'plank', 'pushups']), ['plank', 'pushups']);
  assert.equal(normalizeFavoriteExercises(EXERCISE_IDS).length, FAVORITE_EXERCISE_LIMIT);
  assert.deepEqual(normalizeFavoriteExercises('pushups'), []);
});

test('empty favorites resolve to the start of the catalog', () => {
  assert.deepEqual(resolveFavoriteExercises([]), EXERCISE_IDS.slice(0, FAVORITE_EXERCISE_LIMIT));
  assert.deepEqual(resolveFavoriteExercises(['plank']), ['plank']);
});
