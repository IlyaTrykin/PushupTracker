import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HEALTH_IMPORT_MAX_IDS,
  HEALTH_IMPORT_MAX_ITEMS,
  HealthImportError,
  findImportedIds,
  importHealthWorkouts,
  type HealthImportItem,
} from './health-import';
import { WorkoutCreateError, type CreateWorkout } from './workout-create';

const user = { id: 'u1', username: 'anna', timeZone: 'Europe/Moscow' };

const item = (patch: Partial<HealthImportItem> = {}): HealthImportItem => ({
  clientRequestId: 'hk:AAA',
  exerciseType: 'run',
  reps: 5000,
  durationSeconds: 1500,
  date: '2026-10-17',
  time: '2026-10-17T07:00:00.000Z',
  ...patch,
});

type Call = { input: Record<string, unknown>; options: Record<string, unknown> };

/** A fake creator: remembers calls, answers per request id. */
function fakeCreator(answer: (id: string) => 'new' | 'replay' | WorkoutCreateError | Error) {
  const calls: Call[] = [];
  const create: CreateWorkout = async (_user, input, options) => {
    calls.push({ input: input as Record<string, unknown>, options: options as unknown as Record<string, unknown> });
    const id = String(input.clientRequestId);
    const out = answer(id);
    if (out instanceof Error) throw out;
    return { workout: { id: `w-${id}` }, replayed: out === 'replay', reward: null, records: [], achievements: [] } as never;
  };
  return { create, calls };
}

test('creates a workout per item as source health, charged to the user, and reports created with its id', async () => {
  const { create, calls } = fakeCreator(() => 'new');
  const { results } = await importHealthWorkouts(user, [item()], { createWorkout: create });
  assert.deepEqual(results, [{ clientRequestId: 'hk:AAA', status: 'created', workoutId: 'w-hk:AAA' }]);
  assert.deepEqual(calls[0].options, { source: 'health', actorId: 'u1' });
  assert.deepEqual(calls[0].input, {
    exerciseType: 'run',
    reps: 5000,
    durationSeconds: 1500,
    date: '2026-10-17',
    time: '2026-10-17T07:00:00.000Z',
    clientRequestId: 'hk:AAA',
  });
});

test('a session that is already in the tracker comes back as duplicate with the existing id', async () => {
  const { create } = fakeCreator(() => 'replay');
  const { results } = await importHealthWorkouts(user, [item({ clientRequestId: 'hc:Z1' })], { createWorkout: create });
  assert.deepEqual(results, [{ clientRequestId: 'hc:Z1', status: 'duplicate', workoutId: 'w-hc:Z1' }]);
});

test('only hk: and hc: keys and only run, bike, row are accepted; the rest is rejected without touching the database', async () => {
  const { create, calls } = fakeCreator(() => 'new');
  const { results } = await importHealthWorkouts(
    user,
    [
      item({ clientRequestId: 'web-1' }),
      item({ clientRequestId: 'hk:B', exerciseType: 'pushups' as never }),
      item({ clientRequestId: 'hc:C', exerciseType: 'bike' }),
    ],
    { createWorkout: create },
  );
  assert.deepEqual(results.map((r) => [r.clientRequestId, r.status]), [['web-1', 'rejected'], ['hk:B', 'rejected'], ['hc:C', 'created']]);
  assert.ok(results[0].error && results[1].error);
  assert.equal(calls.length, 1);
});

test('a value the workout rules refuse is rejected with the reason, the other items still go through', async () => {
  const { create } = fakeCreator((id) => (id === 'hk:SHORT' ? new WorkoutCreateError('Дистанция должна быть от 0,01 до 300 км', 400, 'WORKOUT_VALUE_INVALID') : 'new'));
  const { results } = await importHealthWorkouts(user, [item({ clientRequestId: 'hk:SHORT', reps: 3 }), item({ clientRequestId: 'hk:OK' })], { createWorkout: create });
  assert.deepEqual(results[0], { clientRequestId: 'hk:SHORT', status: 'rejected', error: 'Дистанция должна быть от 0,01 до 300 км' });
  assert.equal(results[1].status, 'created');
});

test('the daily limit stops the batch: the rest is rejected with the limit code and nothing more is created', async () => {
  const { create, calls } = fakeCreator((id) => (id === 'hk:2' ? new WorkoutCreateError('Слишком много записей за сутки', 429, 'RATE_LIMITED', 60) : 'new'));
  const { results } = await importHealthWorkouts(
    user,
    ['hk:1', 'hk:2', 'hk:3'].map((clientRequestId) => item({ clientRequestId })),
    { createWorkout: create },
  );
  assert.deepEqual(results.map((r) => r.status), ['created', 'rejected', 'rejected']);
  assert.equal(results[1].error, 'RATE_LIMITED');
  assert.equal(results[2].error, 'RATE_LIMITED');
  assert.equal(calls.length, 2);
});

test('an unexpected failure of one item is rejected, not thrown, and does not block the others', async () => {
  const quiet = console.error;
  console.error = () => undefined;
  try {
    const { create } = fakeCreator((id) => (id === 'hk:BOOM' ? new Error('db down') : 'new'));
    const { results } = await importHealthWorkouts(user, [item({ clientRequestId: 'hk:BOOM' }), item({ clientRequestId: 'hk:OK' })], { createWorkout: create });
    assert.deepEqual(results.map((r) => r.status), ['rejected', 'created']);
    assert.ok(!results[0].error?.includes('db down'));
  } finally {
    console.error = quiet;
  }
});

test('at most 50 items per request: 50 pass, 51 is refused whole', async () => {
  const { create, calls } = fakeCreator(() => 'new');
  const make = (n: number) => Array.from({ length: n }, (_, i) => item({ clientRequestId: `hk:${i}` }));
  assert.equal(HEALTH_IMPORT_MAX_ITEMS, 50);
  assert.equal((await importHealthWorkouts(user, make(50), { createWorkout: create })).results.length, 50);
  const before = calls.length;
  await assert.rejects(importHealthWorkouts(user, make(51), { createWorkout: create }), (e: unknown) => e instanceof HealthImportError && e.status === 400);
  assert.equal(calls.length, before);
  await assert.rejects(importHealthWorkouts(user, 'nope' as never, { createWorkout: create }), HealthImportError);
});

test('imported: answers which of the asked ids are in the tracker, at most 500 ids', async () => {
  const asked: string[][] = [];
  const deps = {
    findExistingRequestIds: async (_userId: string, ids: string[]) => {
      asked.push(ids);
      return ids.filter((id) => id.endsWith('1'));
    },
  };
  assert.deepEqual(await findImportedIds('u1', ['hk:1', 'hk:2', 'hc:11', 'other:1'], deps), ['hk:1', 'hc:11']);
  assert.deepEqual(asked[0], ['hk:1', 'hk:2', 'hc:11']);
  assert.equal(HEALTH_IMPORT_MAX_IDS, 500);
  await assert.rejects(findImportedIds('u1', Array.from({ length: 501 }, (_, i) => `hk:${i}`), deps), HealthImportError);
});
