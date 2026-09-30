import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateExercisePoints } from './exercise-points';
import { EXERCISE_IDS, EXERCISES, isExerciseType, toExerciseType } from './exercises';

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
