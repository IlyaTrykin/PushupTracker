import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateActiveEnergy } from './energy';
import {
  HEALTH_RECORD_FORMAT,
  healthExternalId,
  healthOwnerTag,
  healthRecordEnergy,
  healthRecordFingerprint,
  planHealthReconcile,
  reconcileSince,
  workoutFingerprint,
  type OwnHealthRecord,
  type ServerWorkoutForHealth,
} from './reconcile';

const SINCE = '2026-09-17T00:00:00.000Z';

function workout(id: string, overrides: Partial<ServerWorkoutForHealth> = {}): ServerWorkoutForHealth {
  return { id, clientRequestId: `req-${id}`, exerciseType: 'pushups', reps: 20, durationSeconds: null, time: '2026-10-16T08:00:00.000Z', ...overrides };
}

function own(w: ServerWorkoutForHealth): OwnHealthRecord {
  return { externalId: healthExternalId(w), fingerprint: workoutFingerprint(w) };
}

/** What the app does with a plan: the records it leaves in Health. */
function apply(records: OwnHealthRecord[], plan: ReturnType<typeof planHealthReconcile>): OwnHealthRecord[] {
  const gone = new Set([...plan.toDelete, ...plan.toRewrite.map(healthExternalId)]);
  return [
    ...records.filter((r) => !gone.has(r.externalId)),
    ...plan.toRewrite.map(own),
    ...plan.toSave.map(own),
  ];
}

test('the Health key is the clientRequestId, and wid:<id> for a workout without one', () => {
  assert.equal(healthExternalId(workout('a')), 'req-a');
  assert.equal(healthExternalId(workout('b', { clientRequestId: null })), 'wid:b');
});

test('the fingerprint is short, stable for the same workout and changes with value, type, duration or time', () => {
  const w = workout('a');
  const fp = workoutFingerprint(w);
  assert.match(fp, /^[0-9a-f]{8}$/);
  assert.equal(workoutFingerprint({ ...w, time: '2026-10-16T08:00:00Z' }), fp);
  assert.notEqual(workoutFingerprint({ ...w, reps: 21 }), fp);
  assert.notEqual(workoutFingerprint({ ...w, exerciseType: 'squats' }), fp);
  assert.notEqual(workoutFingerprint({ ...w, durationSeconds: 90 }), fp);
  assert.notEqual(workoutFingerprint({ ...w, time: '2026-10-16T08:01:00.000Z' }), fp);
});

test('a workout made on the site or in Telegram is written; one already in Health is left alone', () => {
  const fromSite = workout('site', { clientRequestId: null });
  const fromApp = workout('app');
  const plan = planHealthReconcile([fromSite, fromApp], [own(fromApp)], { since: SINCE });
  assert.deepEqual(plan.toSave.map((w) => w.id), ['site']);
  assert.deepEqual(plan.toDelete, []);
  assert.deepEqual(plan.toRewrite, []);
});

test('a workout deleted on the server is deleted from Health', () => {
  const kept = workout('kept');
  const deleted = workout('deleted');
  const plan = planHealthReconcile([kept], [own(kept), own(deleted)], { since: SINCE });
  assert.deepEqual(plan.toDelete, ['req-deleted']);
  assert.deepEqual(plan.toSave, []);
});

test('a workout changed on the server is rewritten', () => {
  const before = workout('a', { reps: 20 });
  const after = { ...before, reps: 35 };
  const plan = planHealthReconcile([after], [own(before)], { since: SINCE });
  assert.deepEqual(plan.toRewrite, [after]);
  assert.deepEqual(plan.toSave, []);
  assert.deepEqual(plan.toDelete, []);
});

test('workouts imported from Health are never written back; a stray record of one is removed', () => {
  const fromWatch = workout('hk', { clientRequestId: 'hk:6F1A2B3C-0000-4000-8000-000000000001', exerciseType: 'run', reps: 5000 });
  const fromConnect = workout('hc', { clientRequestId: 'hc:abc-123', exerciseType: 'bike', reps: 12000 });
  const empty = planHealthReconcile([fromWatch, fromConnect], [], { since: SINCE });
  assert.deepEqual(empty, { toSave: [], toDelete: [], toRewrite: [] });
  const stray = planHealthReconcile([fromWatch], [own(fromWatch)], { since: SINCE });
  assert.deepEqual(stray.toDelete, [fromWatch.clientRequestId]);
});

test('only the window is filled in: older workouts missing from Health are not written by the 30-day pass', () => {
  const old = workout('old', { time: '2026-08-01T08:00:00.000Z' });
  const recent = workout('recent');
  const plan = planHealthReconcile([old, recent], [], { since: SINCE });
  assert.deepEqual(plan.toSave.map((w) => w.id), ['recent']);
  const full = planHealthReconcile([old, recent], [], { since: '1970-01-01T00:00:00.000Z' });
  assert.deepEqual(full.toSave.map((w) => w.id).sort(), ['old', 'recent']);
});

test('a workout moved out of the window keeps its record: rewritten, not deleted', () => {
  const before = workout('moved');
  const after = { ...before, time: '2026-08-01T08:00:00.000Z' };
  const plan = planHealthReconcile([after], [own(before)], { since: SINCE });
  assert.deepEqual(plan.toDelete, []);
  assert.deepEqual(plan.toRewrite, [after]);
});

test('a workout still waiting in the queue on this device keeps its record', () => {
  const queued = { externalId: 'req-offline', fingerprint: 'deadbeef' };
  const plan = planHealthReconcile([], [queued], { since: SINCE, pendingIds: ['req-offline'] });
  assert.deepEqual(plan.toDelete, []);
});

test('two records of one workout (a race) are collapsed into one', () => {
  const w = workout('a');
  const plan = planHealthReconcile([w], [own(w), own(w)], { since: SINCE });
  assert.deepEqual(plan.toRewrite, [w]);
});

test('a second pass after applying the first finds nothing to do — no duplicates', () => {
  const server = [
    workout('a'),
    workout('b', { clientRequestId: null }),
    workout('c', { reps: 50 }),
    workout('run', { exerciseType: 'run', reps: 5000, durationSeconds: 1500 }),
  ];
  const before = [own(workout('c', { reps: 40 })), { externalId: 'req-gone', fingerprint: '00000000' }];
  const first = planHealthReconcile(server, before, { since: SINCE });
  assert.equal(first.toSave.length, 3);
  assert.equal(first.toRewrite.length, 1);
  assert.deepEqual(first.toDelete, ['req-gone']);
  const after = apply(before, first);
  assert.equal(after.length, 4);
  assert.deepEqual(planHealthReconcile(server, after, { since: SINCE }), { toSave: [], toDelete: [], toRewrite: [] });
});

test('the regular pass looks 30 days back', () => {
  assert.equal(reconcileSince(new Date('2026-10-17T12:00:00.000Z')), '2026-09-17T12:00:00.000Z');
});

test('another account on the same phone: its records in Health are never deleted or rewritten', () => {
  const tagA = healthOwnerTag('user-a');
  const tagB = healthOwnerTag('user-b');
  assert.match(tagA, /^[0-9a-f]{8}$/);
  assert.notEqual(tagA, tagB);
  const ofA = workout('a-1');
  const ofB = workout('b-1');
  const recordsOfA = [{ ...own(ofA), owner: tagA }, { ...own(workout('a-2')), owner: tagA }];
  // B signs in on A's phone: B's server has only B's workouts.
  const plan = planHealthReconcile([ofB], recordsOfA, { since: SINCE, owner: tagB });
  assert.deepEqual(plan.toDelete, []);
  assert.deepEqual(plan.toRewrite, []);
  assert.deepEqual(plan.toSave.map((w) => w.id), ['b-1']);
  // A signs in again: A's records are A's.
  const back = planHealthReconcile([ofA], [...recordsOfA, { ...own(ofB), owner: tagB }], { since: SINCE, owner: tagA });
  assert.deepEqual(back.toDelete, ['req-a-2']);
  assert.deepEqual(back.toSave, []);
});

test('records without an owner are taken over by the account of the first pass, then left alone', () => {
  const tag = healthOwnerTag('user-a');
  const kept = workout('kept');
  const legacy = [own(kept), own(workout('gone'))];
  const first = planHealthReconcile([kept], legacy, { since: SINCE, owner: tag, claimLegacy: true });
  assert.deepEqual(first.toRewrite, [kept], 'rewritten with the owner tag');
  assert.deepEqual(first.toDelete, ['req-gone']);
  const later = planHealthReconcile([], legacy, { since: SINCE, owner: healthOwnerTag('user-b') });
  assert.deepEqual(later, { toSave: [], toDelete: [], toRewrite: [] });
});

// --- Формат записи 2: вес гири, стороны и калории (R01, R17i) ---

/** Fingerprint записей версии 1 (до калорий), выписан вручную: `exerciseType|reps|durationSeconds|time`. */
function legacyFingerprint(w: ServerWorkoutForHealth): string {
  const text = [w.exerciseType, w.reps, w.durationSeconds ?? '', new Date(w.time).toISOString()].join('|');
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

test('the record format is version 2: a record of version 1 no longer matches its workout', () => {
  assert.equal(HEALTH_RECORD_FORMAT, 2);
  const w = workout('a');
  assert.notEqual(workoutFingerprint(w), legacyFingerprint(w));
});

test('the fingerprint changes with the kettlebell weight, the sides and the calories', () => {
  const swing = workout('kb', { exerciseType: 'kettlebell_swing', reps: 30, loadKg: 16 });
  assert.notEqual(workoutFingerprint({ ...swing, loadKg: 24 }), workoutFingerprint(swing));
  const lunges = workout('l', { exerciseType: 'lunges', reps: 20, repsLeft: 10, repsRight: 10 });
  assert.notEqual(workoutFingerprint({ ...lunges, repsLeft: 12, repsRight: 8 }), workoutFingerprint(lunges));
  assert.notEqual(workoutFingerprint(swing, 12.3), workoutFingerprint(swing, 0));
  assert.equal(workoutFingerprint(swing, 12.3), workoutFingerprint(swing, 12.3));
});

test('a weight or sides the exercise does not have do not count: the queue and the server agree', () => {
  const pushups = workout('p');
  assert.equal(workoutFingerprint({ ...pushups, loadKg: 16, repsLeft: 3, repsRight: 4 }), workoutFingerprint(pushups));
  assert.equal(workoutFingerprint({ ...pushups, loadKg: undefined }), workoutFingerprint({ ...pushups, loadKg: null }));
});

test('records of version 1 are all rewritten once by the full pass, with calories; another account is left alone', () => {
  const tag = healthOwnerTag('user-a');
  const other = healthOwnerTag('user-b');
  const old = workout('old', { time: '2025-03-01T08:00:00.000Z', activeKcal: 14.4 });
  const recent = workout('recent', { activeKcal: 9.1 });
  const v1 = [old, recent].map((w) => ({ externalId: healthExternalId(w), fingerprint: legacyFingerprint(w), owner: tag }));
  const foreign = { externalId: 'req-foreign', fingerprint: '12345678', owner: other };
  const window = { since: '1970-01-01T00:00:00.000Z', owner: tag, energy: { enabled: true, body: { weightKg: 80 } } };
  const first = planHealthReconcile([old, recent], [...v1, foreign], window);
  assert.deepEqual(first.toRewrite.map((w) => w.id).sort(), ['old', 'recent']);
  assert.deepEqual(first.toDelete, []);
  assert.deepEqual(first.toSave, []);
  const rewritten = [old, recent].map((w) => ({ externalId: healthExternalId(w), fingerprint: healthRecordFingerprint(w, window.energy), owner: tag }));
  assert.deepEqual(planHealthReconcile([old, recent], [...rewritten, foreign], window), { toSave: [], toDelete: [], toRewrite: [] });
});

test('calories of a record: the workout\'s own, else estimated from the profile on its day, 0 when switched off', () => {
  const body = { weightKg: 80 };
  const known = workout('k', { activeKcal: 14.4 });
  assert.equal(healthRecordEnergy(known, { enabled: true, body }), 14.4);
  assert.equal(healthRecordEnergy(known, { enabled: false, body }), 0);
  const unknown = workout('u', { activeKcal: null, date: '2026-10-16' });
  assert.equal(healthRecordEnergy(unknown, { enabled: true, body }), estimateActiveEnergy(unknown, body, '2026-10-16'));
  assert.ok(healthRecordEnergy(unknown, { enabled: true, body }) > 0);
  assert.equal(healthRecordEnergy(unknown, { enabled: true, body: { weightKg: null } }), 0);
  // Переключатель выключен — записи без энергии: другой fingerprint, сверка перепишет их.
  assert.notEqual(healthRecordFingerprint(known, { enabled: false, body }), healthRecordFingerprint(known, { enabled: true, body }));
});
