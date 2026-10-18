import assert from 'node:assert/strict';
import test from 'node:test';
import { EXERCISE_IDS } from '@/lib/exercises';
import { repCounterModes, toRepCountOutcome, visibleRepCounterModes } from './rep-counter';

// Spec stories 35 and 39: the camera counts push-ups, squats and pull-ups; touch — only push-ups.
test('repCounterModes: camera for pushups, squats, pullups; proximity only for pushups', () => {
  assert.deepEqual(repCounterModes('pushups'), ['camera', 'proximity']);
  assert.deepEqual(repCounterModes('squats'), ['camera']);
  assert.deepEqual(repCounterModes('pullups'), ['camera']);
});

test('repCounterModes: every other exercise of the catalog has no counter', () => {
  for (const id of EXERCISE_IDS) {
    if (id === 'pushups' || id === 'squats' || id === 'pullups') continue;
    assert.deepEqual(repCounterModes(id), [], id);
  }
  assert.deepEqual(repCounterModes('unknown'), []);
});

const ALL_AVAILABLE = { camera: { available: true }, proximity: { available: true } } as const;

test('visibleRepCounterModes: nothing on the site', () => {
  assert.deepEqual(visibleRepCounterModes('pushups', { native: false, availability: ALL_AVAILABLE }), []);
});

test('visibleRepCounterModes: in the app both buttons for pushups when the sensor is there', () => {
  assert.deepEqual(visibleRepCounterModes('pushups', { native: true, availability: ALL_AVAILABLE }), ['camera', 'proximity']);
  assert.deepEqual(visibleRepCounterModes('squats', { native: true, availability: ALL_AVAILABLE }), ['camera']);
  assert.deepEqual(visibleRepCounterModes('plank', { native: true, availability: ALL_AVAILABLE }), []);
});

test('visibleRepCounterModes: no proximity sensor (or not checked yet) — no «touch» button', () => {
  const noSensor = { camera: { available: true }, proximity: { available: false, reason: 'no_sensor' as const } };
  assert.deepEqual(visibleRepCounterModes('pushups', { native: true, availability: noSensor }), ['camera']);
  assert.deepEqual(visibleRepCounterModes('pushups', { native: true, availability: {} }), ['camera']);
});

test('visibleRepCounterModes: a phone without a camera still gets the button — the screen explains why it cannot count', () => {
  const noCamera = { camera: { available: false, reason: 'no_camera' as const } };
  assert.deepEqual(visibleRepCounterModes('squats', { native: true, availability: noCamera }), ['camera']);
  const oldOs = { camera: { available: false, reason: 'unsupported_os' as const } };
  assert.deepEqual(visibleRepCounterModes('squats', { native: true, availability: oldOs }), []);
});

test('toRepCountOutcome: «Готово» gives the count and the duration', () => {
  assert.deepEqual(
    toRepCountOutcome({ ok: true, value: { reps: 23, durationSeconds: 41, cancelled: false } }),
    { kind: 'counted', reps: 23, durationSeconds: 41 },
  );
});

test('toRepCountOutcome: «Отмена» and «Готово» with nothing counted change nothing', () => {
  assert.deepEqual(toRepCountOutcome({ ok: true, value: { reps: 5, durationSeconds: 10, cancelled: true } }), { kind: 'cancelled' });
  assert.deepEqual(toRepCountOutcome({ ok: true, value: { reps: 0, durationSeconds: 10, cancelled: false } }), { kind: 'empty' });
});

test('toRepCountOutcome: odd numbers from the device are kept inside the form limits', () => {
  assert.deepEqual(
    toRepCountOutcome({ ok: true, value: { reps: 12000.6, durationSeconds: 0.2, cancelled: false } }),
    { kind: 'counted', reps: 9999, durationSeconds: 1 },
  );
  assert.deepEqual(toRepCountOutcome({ ok: true, value: { reps: 'x', cancelled: false } }), { kind: 'empty' });
});

test('toRepCountOutcome: refused camera permission is «permission_denied»', () => {
  const error = Object.assign(new Error('Camera access denied'), { code: 'permission_denied' });
  assert.deepEqual(toRepCountOutcome({ ok: false, error }), { kind: 'permission_denied' });
});

test('toRepCountOutcome: no sensor / old system / any other failure', () => {
  const noSensor = Object.assign(new Error('No sensor'), { code: 'no_sensor' });
  assert.deepEqual(toRepCountOutcome({ ok: false, error: noSensor }), { kind: 'unavailable', reason: 'no_sensor' });
  assert.deepEqual(toRepCountOutcome({ ok: false, error: new Error('boom') }), { kind: 'error', message: 'boom' });
});
