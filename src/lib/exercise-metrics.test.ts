import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDistance, formatDuration, formatExerciseValue, formatPace, formatSpeed, formatWorkoutValue, formatWorkoutValueParts } from './exercise-metrics';

test('distance is shown in kilometres with the locale decimal separator', () => {
  assert.equal(formatDistance(5200, 'ru'), '5,2 км');
  assert.equal(formatDistance(5200, 'en'), '5.2 km');
  assert.equal(formatDistance(5000, 'ru'), '5 км');
  assert.equal(formatDistance(10, 'en'), '0.01 km');
  assert.equal(formatDistance(12345, 'ru'), '12,35 км');
});

test('duration is m:ss, or h:mm:ss from an hour', () => {
  assert.equal(formatDuration(1590), '26:30');
  assert.equal(formatDuration(59), '0:59');
  assert.equal(formatDuration(3725), '1:02:05');
});

test('pace is minutes per km, speed is km/h', () => {
  assert.equal(formatPace(5200, 1590, 'ru'), '5:06/км');
  assert.equal(formatPace(5200, 1590, 'en'), '5:06/km');
  assert.equal(formatSpeed(20000, 3600, 'ru'), '20 км/ч');
  assert.equal(formatSpeed(25000, 3600 + 1800, 'en'), '16.7 km/h');
});

test('a cardio workout reads «5,2 км · 26:30 (5:06/км)»; bike shows speed; no time → distance only', () => {
  assert.equal(formatWorkoutValue({ reps: 5200, exerciseType: 'run', durationSeconds: 1590 }, 'ru'), '5,2 км · 26:30 (5:06/км)');
  assert.equal(formatWorkoutValue({ reps: 5200, exerciseType: 'row', durationSeconds: 1590 }, 'en'), '5.2 km · 26:30 (5:06/km)');
  assert.equal(formatWorkoutValue({ reps: 20000, exerciseType: 'bike', durationSeconds: 3600 }, 'ru'), '20 км · 1:00:00 (20 км/ч)');
  assert.equal(formatWorkoutValue({ reps: 5200, exerciseType: 'run' }, 'ru'), '5,2 км');
});

test('totals of cardio are shown in km, other exercises are unchanged', () => {
  assert.equal(formatExerciseValue(15400, 'run', true, 'ru'), '15,4 км');
  assert.equal(formatExerciseValue(15400, 'run', true, 'en'), '15.4 km');
  assert.equal(formatExerciseValue(30, 'pushups', true), '30');
  assert.equal(formatExerciseValue(60, 'plank', true), '60 сек');
});

test('seconds are labelled in the UI language: «60 сек» / «60 sec»; formatWorkoutValue passes the locale on', () => {
  assert.equal(formatExerciseValue(60, 'plank', true, 'en'), '60 sec');
  assert.equal(formatExerciseValue(60, 'plank', true, 'ru'), '60 сек');
  assert.equal(formatWorkoutValue({ reps: 60, exerciseType: 'plank' }, 'en'), '60 sec');
  assert.equal(formatWorkoutValue({ reps: 45, exerciseType: 'wall_sit' }, 'ru'), '45 сек');
});

test('feed rows: cardio shows the distance as the main line, time and pace below; sides go below too', () => {
  assert.deepEqual(formatWorkoutValueParts({ reps: 5200, exerciseType: 'run', durationSeconds: 1590 }, 'ru'), { main: '5,2 км', detail: '26:30 (5:06/км)' });
  assert.deepEqual(formatWorkoutValueParts({ reps: 20000, exerciseType: 'bike', durationSeconds: 3600 }, 'en'), { main: '20 km', detail: '1:00:00 (20 km/h)' });
  assert.deepEqual(formatWorkoutValueParts({ reps: 5200, exerciseType: 'run' }, 'ru'), { main: '5,2 км', detail: '' });
  assert.deepEqual(formatWorkoutValueParts({ reps: 12, exerciseType: 'kettlebell_press', loadKg: 16, repsLeft: 5, repsRight: 7 }, 'en'), { main: '12 × 16 kg', detail: 'L 5 / R 7' });
  assert.deepEqual(formatWorkoutValueParts({ reps: 60, exerciseType: 'plank' }, 'en'), { main: '60 sec', detail: '' });
});
