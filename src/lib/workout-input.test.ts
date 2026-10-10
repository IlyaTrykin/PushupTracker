import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLIENT_REQUEST_ID_MAX_LENGTH,
  WORKOUT_CREATE_LIMIT_PER_DAY,
  parseClientRequestId,
  parseWorkoutDay,
  parseWorkoutExerciseType,
  parseWorkoutLoadFields,
  parseWorkoutTime,
} from './workout-input';

const TODAY = '2026-10-09';
const MSK = 'Europe/Moscow';

test('fractional reps are rejected instead of reaching the Int column', () => {
  const result = parseWorkoutLoadFields('pushups', { reps: 1.5 });
  assert.equal(result.ok, false);
});

test('whole reps pass; numeric strings are accepted as before', () => {
  assert.deepEqual(parseWorkoutLoadFields('pushups', { reps: 20 }), {
    ok: true,
    value: { reps: 20, loadKg: null, repsLeft: null, repsRight: null },
  });
  assert.equal(parseWorkoutLoadFields('pushups', { reps: '15' }).ok, true);
});

test('changing the exercise on edit recomputes load fields for the new exercise', () => {
  const pushupsRow = { reps: 20, loadKg: null, repsLeft: null, repsRight: null };
  // pushups → lunges (one leg at a time): the split is taken from the body.
  assert.deepEqual(parseWorkoutLoadFields('lunges', { repsLeft: 10, repsRight: 12 }, pushupsRow), {
    ok: true,
    value: { reps: 22, loadKg: null, repsLeft: 10, repsRight: 12 },
  });
  // pushups → kettlebell swing: weight becomes required.
  assert.equal(parseWorkoutLoadFields('kettlebell_swing', {}, pushupsRow).ok, false);
  assert.deepEqual(parseWorkoutLoadFields('kettlebell_swing', { loadKg: 16 }, pushupsRow), {
    ok: true,
    value: { reps: 20, loadKg: 16, repsLeft: null, repsRight: null },
  });
  // kettlebell swing → squats: the weight is dropped.
  const swingRow = { reps: 20, loadKg: 16, repsLeft: null, repsRight: null };
  assert.deepEqual(parseWorkoutLoadFields('squats', { reps: 30 }, swingRow), {
    ok: true,
    value: { reps: 30, loadKg: null, repsLeft: null, repsRight: null },
  });
});

test('exercise type: catalog ids only', () => {
  assert.deepEqual(parseWorkoutExerciseType(' plank '), { ok: true, value: 'plank' });
  assert.equal(parseWorkoutExerciseType('yoga').ok, false);
  assert.equal(parseWorkoutExerciseType('').ok, false);
  assert.equal(parseWorkoutExerciseType(undefined).ok, false);
});

test('date: a real calendar day inside [2020-01-01, today+1]', () => {
  assert.deepEqual(parseWorkoutDay('2026-10-09', TODAY), { ok: true, value: '2026-10-09' });
  assert.deepEqual(parseWorkoutDay('2026-10-10', TODAY), { ok: true, value: '2026-10-10' });
  assert.deepEqual(parseWorkoutDay('2020-01-01', TODAY), { ok: true, value: '2020-01-01' });
  assert.equal(parseWorkoutDay('2026-02-31', TODAY).ok, false, '31 February does not roll over to March');
  assert.equal(parseWorkoutDay('2026-10-11', TODAY).ok, false, 'two days ahead');
  assert.equal(parseWorkoutDay('2019-12-31', TODAY).ok, false, 'before 2020');
  assert.equal(parseWorkoutDay('0001-01-01', TODAY).ok, false);
  assert.equal(parseWorkoutDay('9.10.2026', TODAY).ok, false);
  assert.equal(parseWorkoutDay(undefined, TODAY).ok, false);
});

test('time: ISO instant, HH:MM in the user zone, or now; garbage is an error', () => {
  const now = new Date('2026-10-09T09:15:30.000Z'); // 12:15 in Moscow
  assert.deepEqual(parseWorkoutTime('2026-10-09T08:00:00.000Z', TODAY, MSK, now), {
    ok: true,
    value: new Date('2026-10-09T08:00:00.000Z'),
  });
  assert.deepEqual(parseWorkoutTime('07:30', TODAY, MSK, now), {
    ok: true,
    value: new Date('2026-10-09T04:30:00.000Z'),
  });
  // No time: the current wall-clock time on the chosen day.
  assert.deepEqual(parseWorkoutTime(undefined, '2026-10-08', MSK, now), {
    ok: true,
    value: new Date('2026-10-08T09:15:00.000Z'),
  });
  assert.equal(parseWorkoutTime('xT', TODAY, MSK, now).ok, false);
  assert.equal(parseWorkoutTime('25:00', TODAY, MSK, now).ok, false);
  assert.equal(parseWorkoutTime('7:30', TODAY, MSK, now).ok, false);
  assert.equal(parseWorkoutTime(42, TODAY, MSK, now).ok, false);
});

test('clientRequestId: optional, a short token', () => {
  assert.deepEqual(parseClientRequestId(undefined), { ok: true, value: null });
  assert.deepEqual(parseClientRequestId(''), { ok: true, value: null });
  assert.deepEqual(parseClientRequestId('3f1c-9a'), { ok: true, value: '3f1c-9a' });
  assert.equal(parseClientRequestId('x'.repeat(CLIENT_REQUEST_ID_MAX_LENGTH)).ok, true);
  assert.equal(parseClientRequestId('x'.repeat(CLIENT_REQUEST_ID_MAX_LENGTH + 1)).ok, false);
  assert.equal(parseClientRequestId(123).ok, false);
  assert.equal(parseClientRequestId('has space').ok, false);
});

test('creation limit is 300 per day (spec story 17/48)', () => {
  assert.equal(WORKOUT_CREATE_LIMIT_PER_DAY, 300);
});
