import assert from 'node:assert/strict';
import test from 'node:test';
import { EXERCISE_IDS } from '@/lib/exercises';
import { createHash } from 'node:crypto';
import { programSetWorkoutInput } from '@/lib/program-plan';
import { estimateDurationSeconds, healthClientRequestId, programSetHealthSource, toHealthWorkout, toImportCandidate, type HealthSession } from './mapping';
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
  australian_pullups: { apple: 'functionalStrengthTraining', android: 'EXERCISE_TYPE_CALISTHENICS' },
  glute_bridge: { apple: 'functionalStrengthTraining', android: 'EXERCISE_TYPE_CALISTHENICS' },
  superman: { apple: 'coreTraining', android: 'EXERCISE_TYPE_CALISTHENICS' },
  side_plank: { apple: 'coreTraining', android: 'EXERCISE_TYPE_CALISTHENICS' },
  mountain_climbers: { apple: 'functionalStrengthTraining', android: 'EXERCISE_TYPE_CALISTHENICS' },
  kettlebell_row: { apple: 'traditionalStrengthTraining', android: 'EXERCISE_TYPE_STRENGTH_TRAINING' },
};

test('every one of the 24 catalog exercises has its Health type on both platforms', () => {
  assert.equal(EXERCISE_IDS.length, 24);
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
  // Боковая планка: значение — сумма секунд обеих сторон.
  assert.equal(estimateDurationSeconds('side_plank', 85), 85);
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

// --- Import from Health (interfaces.md §6) ---

const session = (patch: Partial<HealthSession> = {}): HealthSession => ({
  id: '8F2C1A34-0B7E-4C11-9D3A-5E6F7A8B9C0D',
  platform: 'apple_health',
  activity: 'run',
  start: '2026-10-17T06:00:00.000Z',
  end: '2026-10-17T06:30:00.000Z',
  distanceMeters: 5200.4,
  sourceName: 'Watch',
  fromThisApp: false,
  ...patch,
});

test('import key: hk: for Apple Health, hc: for Health Connect, the id as is when it fits in 64', () => {
  assert.equal(healthClientRequestId(session()), 'hk:8F2C1A34-0B7E-4C11-9D3A-5E6F7A8B9C0D');
  assert.equal(healthClientRequestId(session({ platform: 'health_connect', id: 'abc123' })), 'hc:abc123');
});

test('import key: an id too long for the 64-char key becomes a sha-256 prefix, still 64 chars', () => {
  const id = 'x'.repeat(80);
  const key = healthClientRequestId(session({ platform: 'health_connect', id }));
  assert.equal(key.length, 64);
  assert.equal(key, `hc:${createHash('sha256').update(id).digest('hex').slice(0, 61)}`);
  assert.equal(healthClientRequestId(session({ platform: 'health_connect', id })), key);
});

test('import key: an id with characters the server key forbids is hashed too', () => {
  const key = healthClientRequestId(session({ platform: 'health_connect', id: 'a b/c' }));
  assert.match(key, /^hc:[0-9a-f]{61}$/);
});

test('a run becomes a candidate: metres rounded, duration from start/end, day of the end in the user zone', () => {
  const c = toImportCandidate(session({ end: '2026-10-17T21:30:00.000Z', start: '2026-10-17T21:00:00.000Z' }), 'Asia/Vladivostok');
  assert.equal(c.reason, null);
  assert.deepEqual(c.workout, {
    exerciseType: 'run',
    reps: 5200,
    durationSeconds: 1800,
    date: '2026-10-18',
    time: '2026-10-17T21:30:00.000Z',
    clientRequestId: 'hk:8F2C1A34-0B7E-4C11-9D3A-5E6F7A8B9C0D',
  });
});

test('bike and row map to their exercises', () => {
  assert.equal(toImportCandidate(session({ activity: 'bike' }), 'UTC').workout?.exerciseType, 'bike');
  assert.equal(toImportCandidate(session({ activity: 'row' }), 'UTC').workout?.exerciseType, 'row');
});

test('under 10 m, over 300 km, no distance or an unknown activity: no workout and a reason', () => {
  assert.equal(toImportCandidate(session({ distanceMeters: 9 }), 'UTC').workout, null);
  assert.equal(toImportCandidate(session({ distanceMeters: 9 }), 'UTC').reason, 'too_short');
  assert.equal(toImportCandidate(session({ distanceMeters: 300_001 }), 'UTC').reason, 'too_long');
  assert.equal(toImportCandidate(session({ distanceMeters: null }), 'UTC').reason, 'no_distance');
  assert.equal(toImportCandidate(session({ activity: 'swim' }), 'UTC').reason, 'unsupported');
  assert.equal(toImportCandidate(session({ distanceMeters: 10 }), 'UTC').reason, null);
  assert.equal(toImportCandidate(session({ distanceMeters: 300_000 }), 'UTC').reason, null);
});

test('a session of zero length is not importable (the server needs a duration of at least a second)', () => {
  const c = toImportCandidate(session({ end: '2026-10-17T06:00:00.000Z' }), 'UTC');
  assert.equal(c.workout, null);
  assert.equal(c.reason, 'no_duration');
});

test('a program set written to Health at once is the very record the server made (same key and fingerprint)', () => {
  const completedAt = '2026-10-17T07:12:40.123Z';
  const server = programSetWorkoutInput({ setId: 'set-3', setNumber: 3, exerciseType: 'squats', actualReps: 18, doneAt: new Date(completedAt), timeZone: 'Europe/Moscow' });
  const source = programSetHealthSource({ id: 'set-3', setNumber: 3, actualReps: 18, completedAt }, 'squats');
  assert.ok(source);
  assert.equal(source.clientRequestId, server.clientRequestId);
  assert.equal(
    workoutFingerprint(source),
    workoutFingerprint({ exerciseType: server.exerciseType, reps: server.reps, durationSeconds: null, time: server.time }),
  );
  assert.equal(programSetHealthSource({ id: 'set-4', setNumber: 4, actualReps: null, completedAt: null }, 'squats'), null);
});
