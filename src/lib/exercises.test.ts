import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateExercisePoints } from './exercise-points';
import { parseWorkoutLoadFields } from './workout-input';
import {
  EXERCISE_IDS,
  EXERCISES,
  FAVORITE_EXERCISE_LIMIT,
  isExerciseType,
  isLoadedExercise,
  isUnilateralExercise,
  normalizeFavoriteExercises,
  programKind,
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

test('cardio is priced per metre: run and row 15 per km, bike 5 per km', () => {
  assert.equal(calculateExercisePoints(5200, 'run'), 78);
  assert.equal(calculateExercisePoints(20000, 'bike'), 100);
  assert.equal(calculateExercisePoints(1000, 'row'), 15);
});

test('cardio exercises are distance-based, outside programs and not default favourites', () => {
  for (const id of ['run', 'bike', 'row'] as const) {
    assert.equal(EXERCISES[id].unit, 'distance', id);
    assert.equal(EXERCISES[id].programSupported, false, id);
    assert.ok(!resolveFavoriteExercises([]).includes(id), id);
  }
});

test('six new exercises close the catalog with the agreed points; default favourites stay the same', () => {
  assert.equal(EXERCISE_IDS.length, 24);
  assert.deepEqual(EXERCISE_IDS.slice(18), [
    'australian_pullups',
    'glute_bridge',
    'superman',
    'side_plank',
    'mountain_climbers',
    'kettlebell_row',
  ]);
  assert.deepEqual(resolveFavoriteExercises([]), ['pushups', 'pullups', 'crunches', 'squats']);
  assert.equal(calculateExercisePoints(10, 'australian_pullups'), 15);
  assert.equal(calculateExercisePoints(10, 'glute_bridge'), 5);
  assert.equal(calculateExercisePoints(10, 'superman'), 7.5);
  assert.equal(calculateExercisePoints(60, 'side_plank'), 9);
  assert.equal(calculateExercisePoints(10, 'mountain_climbers'), 4);
  assert.equal(calculateExercisePoints(10, 'kettlebell_row', 24), 20);
  assert.equal(calculateExercisePoints(10, 'kettlebell_row', 12), 5);
});

test('side plank is timed per side, the kettlebell row is one-arm with a weight', () => {
  assert.equal(EXERCISES.side_plank.unit, 'seconds');
  assert.equal(isUnilateralExercise('side_plank'), true);
  assert.equal(isLoadedExercise('side_plank'), false);
  assert.equal(EXERCISES.kettlebell_row.unit, 'reps');
  assert.equal(isUnilateralExercise('kettlebell_row'), true);
  assert.deepEqual(EXERCISES.kettlebell_row.load, { referenceKg: 24, presetsKg: [12, 16, 20, 24, 28, 32] });
  assert.deepEqual(
    parseWorkoutLoadFields('side_plank', { repsLeft: 45, repsRight: 40 }),
    { ok: true, value: { reps: 85, loadKg: null, repsLeft: 45, repsRight: 40 } },
  );
});

// spec «Основная группа упражнения»; выходы силой и толчок гири там не названы (исключены из круговых).
const EXPECTED_PRIMARY_GROUP: Record<string, string> = {
  pushups: 'push', dips: 'push', kettlebell_press: 'push', kettlebell_jerk: 'push',
  pullups: 'pull', australian_pullups: 'pull', kettlebell_row: 'pull', muscle_ups: 'pull',
  squats: 'legs', lunges: 'legs', wall_sit: 'legs',
  glute_bridge: 'hinge', kettlebell_swing: 'hinge',
  crunches: 'core_flexion', hanging_leg_raises: 'core_flexion', plank: 'core_flexion',
  superman: 'core_extension',
  side_plank: 'core_lateral',
  burpees: 'cardio', jump_rope: 'cardio', mountain_climbers: 'cardio', run: 'cardio', bike: 'cardio', row: 'cardio',
};

const EXPECTED_TAGS: Record<string, string[]> = {
  grip: ['pullups', 'australian_pullups', 'hanging_leg_raises', 'kettlebell_swing', 'kettlebell_row'],
  jump: ['burpees', 'jump_rope'],
  static: ['plank', 'side_plank', 'wall_sit'],
  technical: ['muscle_ups', 'kettlebell_jerk'],
  press: ['pushups', 'dips', 'kettlebell_press', 'burpees'],
};

test('every exercise has its primary group and tags from the spec', () => {
  for (const id of EXERCISE_IDS) {
    assert.equal(EXERCISES[id].primaryGroup, EXPECTED_PRIMARY_GROUP[id], id);
    const expectedTags = Object.keys(EXPECTED_TAGS).filter((tag) => EXPECTED_TAGS[tag].includes(id)).sort();
    assert.deepEqual([...EXERCISES[id].tags].sort(), expectedTags, id);
  }
});

test('every exercise has a MET, reps exercises a pace, and every exercise a program kind', () => {
  for (const id of EXERCISE_IDS) {
    const exercise = EXERCISES[id];
    assert.ok(Number.isFinite(exercise.met) && exercise.met >= 1, id);
    if (exercise.unit === 'reps') assert.ok(exercise.secondsPerRep != null && exercise.secondsPerRep > 0, id);
    else assert.equal(exercise.secondsPerRep, undefined, id);
    assert.notEqual(programKind(id), null, id);
  }
});

test('program kind follows the exercise: timed, loaded, distance, otherwise reps', () => {
  assert.equal(programKind('pushups'), 'reps');
  assert.equal(programKind('muscle_ups'), 'reps');
  assert.equal(programKind('lunges'), 'reps');
  assert.equal(programKind('plank'), 'timed');
  assert.equal(programKind('side_plank'), 'timed');
  assert.equal(programKind('kettlebell_press'), 'loaded');
  assert.equal(programKind('kettlebell_jerk'), 'loaded');
  assert.equal(programKind('kettlebell_row'), 'loaded');
  assert.equal(programKind('run'), 'distance');
  assert.equal(programKind('yoga_flow'), null);
});

test('MET and pace put 50 push-ups at 80 kg at 10–20 active kcal', () => {
  // Активные ккал = (MET − 1) × вес × часы (spec «Калории», без поправки на RMR).
  const { met, secondsPerRep } = EXERCISES.pushups;
  const kcal = (met - 1) * 80 * ((50 * (secondsPerRep ?? 0)) / 3600);
  assert.ok(kcal >= 10 && kcal <= 20, String(kcal));
});
