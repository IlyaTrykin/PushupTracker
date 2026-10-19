import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WorkoutCreateError,
  createWorkoutCreator,
  friendWorkoutText,
  rankChallengeParticipants,
  type WorkoutCreateDeps,
} from './workout-create';
import { createAchievementHook, type CreatedWorkout } from './workout-hooks';
import type { NotifyEvent } from './notify';
import { programSetWorkoutInput } from './program-plan';
import { importHealthWorkouts } from './health-import';

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

test('B26: a participant who left the group does not take a place in the rank-change push', () => {
  const ranks = rankChallengeParticipants({
    mode: 'most',
    exerciseType: 'pushups',
    targetReps: null,
    totalDays: 7,
    participants: [
      { userId: 'gone', username: 'anna', status: 'accepted' },
      { userId: 'b', username: 'boris', status: 'accepted' },
      { userId: 'c', username: 'clara', status: 'accepted' },
      { userId: 'p', username: 'petr', status: 'pending' },
    ],
    activeMemberIds: ['b', 'c', 'p'],
    workouts: [
      { userId: 'gone', date: day('2026-10-05'), reps: 50 },
      { userId: 'b', date: day('2026-10-05'), reps: 30 },
      { userId: 'c', date: day('2026-10-06'), reps: 10 },
      { userId: 'p', date: day('2026-10-06'), reps: 99 },
    ],
  });

  assert.deepEqual([...ranks.entries()], [['b', 1], ['c', 2]]);
});

test('ranks follow the challenge table: loaded exercises in points, ties by username', () => {
  const ranks = rankChallengeParticipants({
    mode: 'most',
    exerciseType: 'kettlebell_swing',
    targetReps: null,
    totalDays: 7,
    participants: [
      { userId: 'z', username: 'zoe', status: 'accepted' },
      { userId: 'a', username: 'adam', status: 'accepted' },
      { userId: 'h', username: 'heavy', status: 'accepted' },
    ],
    activeMemberIds: null,
    workouts: [
      { userId: 'z', date: day('2026-10-05'), reps: 20, loadKg: 16 },
      { userId: 'a', date: day('2026-10-05'), reps: 20, loadKg: 16 },
      // Fewer reps with a heavier kettlebell are more points.
      { userId: 'h', date: day('2026-10-05'), reps: 15, loadKg: 32 },
    ],
  });

  assert.deepEqual([...ranks.entries()], [['h', 1], ['a', 2], ['z', 3]]);
});

test('friend notification: catalog name in the recipient language, cardio in km, others unchanged', () => {
  const run = { exerciseType: 'run', reps: 5200, loadKg: null, durationSeconds: 1590 };
  assert.deepEqual(friendWorkoutText('ru', 'bob', run).body, 'bob: Бег — 5,2 км · 26:30 (5:06/км)');
  assert.equal(friendWorkoutText('en', 'bob', run).body, 'bob: Running — 5.2 km · 26:30 (5:06/km)');
  assert.equal(friendWorkoutText('en', 'bob', { exerciseType: 'plank', reps: 60, loadKg: null }).body, 'bob: Plank — 60 s');
});

/** An in-memory workout table with the (userId, clientRequestId) unique index, a counting limiter and recorders. */
function fakeDeps(overrides: Partial<WorkoutCreateDeps> = {}) {
  const rows: Array<CreatedWorkout & { userId: string; clientRequestId: string | null; activeKcal: number | null }> = [];
  const body: { weightKg: number | null; heightCm: number | null; birthDate: Date | null; gender: string | null } = {
    weightKg: null,
    heightCm: null,
    birthDate: null,
    gender: null,
  };
  const notified: string[][] = [];
  const hooked: string[] = [];
  const buckets = new Map<string, number>();
  const deps: WorkoutCreateDeps = {
    findWorkoutByRequestId: async (userId, requestId) => rows.find((r) => r.userId === userId && r.clientRequestId === requestId) ?? null,
    hitRateLimit: async (key, limit) => {
      const count = (buckets.get(key) ?? 0) + 1;
      buckets.set(key, count);
      return { ok: count <= limit, retryAfterSeconds: 3600 };
    },
    insertWorkout: async (data) => {
      if (data.clientRequestId && rows.some((r) => r.userId === data.userId && r.clientRequestId === data.clientRequestId)) {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      }
      const row = {
        id: `w${rows.length + 1}`,
        userId: data.userId,
        clientRequestId: data.clientRequestId,
        reps: data.reps,
        loadKg: data.loadKg,
        repsLeft: data.repsLeft,
        repsRight: data.repsRight,
        date: data.date,
        time: data.time,
        exerciseType: data.exerciseType,
        trainingSessionId: data.trainingSessionId,
        activeKcal: data.activeKcal,
      };
      rows.push(row);
      return row;
    },
    findActiveChallenges: async () => [],
    challengeRanks: async () => new Map(),
    findFollowerIds: async () => ['friend'],
    findReward: async () => null,
    findBodyMetrics: async () => ({ ...body }),
    notifyUsers: async (userIds) => {
      notified.push(userIds);
    },
    onWorkoutCreated: async (workout) => {
      hooked.push(workout.id);
      return { records: [], achievements: [] };
    },
    ...overrides,
  };
  return { deps, rows, notified, hooked, body };
}

const ann = { id: 'u1', username: 'ann', timeZone: 'Europe/Moscow' };
const now = new Date('2026-10-10T12:00:00.000Z');

test('B04: a repeated clientRequestId returns the stored workout — replayed, no notifications, no onWorkoutCreated', async () => {
  const { deps, rows, notified, hooked } = fakeDeps();
  const create = createWorkoutCreator(deps);
  const input = { exerciseType: 'pushups', reps: 20, clientRequestId: 'req-1' };

  const first = await create(ann, input, { source: 'web', now });
  const again = await create(ann, input, { source: 'web', now });

  assert.equal(first.replayed, false);
  assert.equal(again.replayed, true);
  assert.equal(again.workout.id, first.workout.id);
  assert.equal(rows.length, 1);
  assert.deepEqual(notified, [['friend']]);
  assert.deepEqual(hooked, [first.workout.id]);
});

test('B04: two copies racing past the lookup — the loser gets the winner\'s record (P2002), nothing sent twice', async () => {
  const { deps, rows, notified, hooked } = fakeDeps();
  // Both copies look the id up before either has inserted.
  let lookups = 0;
  const realFind = deps.findWorkoutByRequestId;
  deps.findWorkoutByRequestId = async (userId, requestId) => (++lookups <= 2 ? null : realFind(userId, requestId));
  const create = createWorkoutCreator(deps);
  const input = { exerciseType: 'pushups', reps: 20, clientRequestId: 'req-2' };

  const [a, b] = await Promise.all([create(ann, input, { source: 'web', now }), create(ann, input, { source: 'web', now })]);

  assert.equal(rows.length, 1);
  assert.deepEqual([a.replayed, b.replayed].sort(), [false, true]);
  assert.equal(a.workout.id, b.workout.id);
  assert.equal(notified.length, 1);
  assert.equal(hooked.length, 1);
});

test('S12: the 301st workout of a day is 429 RATE_LIMITED and is not stored; the limit belongs to the actor', async () => {
  const { deps, rows } = fakeDeps();
  const create = createWorkoutCreator(deps);
  for (let i = 0; i < 300; i += 1) {
    await create(ann, { exerciseType: 'pushups', reps: 1 }, { source: 'web', now, actorId: 'owner' });
  }

  await assert.rejects(
    create(ann, { exerciseType: 'pushups', reps: 1 }, { source: 'web', now, actorId: 'owner' }),
    (e: unknown) => e instanceof WorkoutCreateError && e.status === 429 && e.code === 'RATE_LIMITED' && e.retryAfterSeconds === 3600,
  );
  assert.equal(rows.length, 300);
  // Ann herself still has her own limit.
  await create(ann, { exerciseType: 'pushups', reps: 1 }, { source: 'web', now });
  assert.equal(rows.length, 301);
});

test('a program set is recorded through the common path: linked to its session, hooks and friends as for any workout, once per set', async () => {
  const { deps, rows, notified, hooked } = fakeDeps();
  const create = createWorkoutCreator(deps);
  // 00:30 Moscow on 2026-10-10 — the set belongs to that local day.
  const doneAt = new Date('2026-10-09T21:30:00.000Z');
  const input = programSetWorkoutInput({ setId: 'set-3', setNumber: 3, exerciseType: 'pushups', actualReps: 17, doneAt, timeZone: 'Europe/Moscow' });

  const first = await create(ann, input, { source: 'program', trainingSessionId: 'session-1', now });
  const repeat = await create(ann, input, { source: 'program', trainingSessionId: 'session-1', now });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].trainingSessionId, 'session-1');
  assert.equal(rows[0].reps, 17);
  assert.equal(rows[0].date.toISOString(), '2026-10-10T00:00:00.000Z');
  assert.equal(rows[0].time.toISOString(), '2026-10-09T21:30:03.000Z');
  assert.deepEqual(hooked, [first.workout.id]);
  assert.deepEqual(notified, [['friend']]);
  assert.equal(repeat.replayed, true);
});

test('health import: one POST /api/health/import sends followers and challenge rivals no notification per imported run', async () => {
  const notifiedEvents: string[] = [];
  let rankCalls = 0;
  const { deps, rows } = fakeDeps({
    findActiveChallenges: async () => [{ challengeId: 'c1', challenge: { name: 'Run club' } }],
    // Every new run overtakes the rival: ranks flip on every call.
    challengeRanks: async () => {
      rankCalls += 1;
      return rankCalls % 2 ? new Map([['rival', 1], ['u1', 2]]) : new Map([['u1', 1], ['rival', 2]]);
    },
    notifyUsers: async (_userIds, event) => {
      notifiedEvents.push(event);
    },
  });
  const create = createWorkoutCreator(deps);
  const items = [1, 2, 3].map((n) => ({
    clientRequestId: `hk:${n}`,
    exerciseType: 'run' as const,
    reps: 5000 + n,
    durationSeconds: 1800,
    date: '2026-10-0' + n,
    time: `2026-10-0${n}T07:00:00.000Z`,
  }));

  const { results } = await importHealthWorkouts(ann, items, { createWorkout: (user, input, options) => create(user, input, { ...options, now }) });

  assert.deepEqual(results.map((r) => r.status), ['created', 'created', 'created']);
  assert.equal(rows.length, 3);
  assert.equal(notifiedEvents.filter((e) => e === 'friend_workout').length, 0);
  assert.equal(notifiedEvents.filter((e) => e === 'challenge_rank_change').length, 0);
});

test('a workout from the app or the site still tells followers and challenge rivals', async () => {
  const notifiedEvents: string[] = [];
  let rankCalls = 0;
  const { deps } = fakeDeps({
    findActiveChallenges: async () => [{ challengeId: 'c1', challenge: { name: 'Run club' } }],
    challengeRanks: async () => {
      rankCalls += 1;
      return rankCalls % 2 ? new Map([['rival', 1], ['u1', 2]]) : new Map([['u1', 1], ['rival', 2]]);
    },
    notifyUsers: async (_userIds, event) => {
      notifiedEvents.push(event);
    },
  });
  await createWorkoutCreator(deps)(ann, { exerciseType: 'run', reps: 5000, durationSeconds: 1800 }, { source: 'web', now });
  assert.deepEqual(notifiedEvents, ['friend_workout', 'challenge_rank_change']);
});

/**
 * A real achievement hook over the created rows: every imported run beats the previous best, so each
 * one is a record; the user already has achievements, so records are news for friends.
 */
function importWithAchievements(source: 'health' | 'web') {
  const notifications: Array<{ ids: string[]; event: NotifyEvent }> = [];
  const pending: Array<() => Promise<void>> = [];
  const saved: string[] = [];
  const history = { id: 'old', date: day('2026-09-01'), reps: 1000, exerciseType: 'run', loadKg: null };
  let created: ReturnType<typeof fakeDeps>['rows'] = [];
  const hook = createAchievementHook({
    loadContext: async () => ({ workouts: [history, ...created], dailyGoalPoints: null, ownedBadges: ['first_exercise'], hasAchievements: true }),
    saveAchievement: async (row) => {
      saved.push(row.code);
      return { id: `a${saved.length}`, achievedAt: now };
    },
    friendIds: async () => ['f1', 'f2'],
    usernameOf: async () => 'ann',
    notify: async (ids, event) => {
      notifications.push({ ids, event });
    },
    defer: (task) => {
      pending.push(task);
    },
    now: () => now,
  });
  const world = fakeDeps({ findFollowerIds: async () => [], onWorkoutCreated: (workout, user, opts) => hook.onWorkoutCreated(workout, user, opts) });
  created = world.rows;
  const create = createWorkoutCreator(world.deps);
  const items = [1, 2, 3].map((n) => ({
    clientRequestId: `hk:${n}`,
    exerciseType: 'run' as const,
    reps: 5000 + n * 1000,
    durationSeconds: 1800 + n * 300,
    date: '2026-10-0' + n,
    time: `2026-10-0${n}T07:00:00.000Z`,
  }));
  const run = async () => {
    const outcomes =
      source === 'health'
        ? (await importHealthWorkouts(ann, items, { createWorkout: (user, input, options) => create(user, input, { ...options, now }) })).results
        : await Promise.all(items.map(async (item) => create(ann, item, { source: 'web', now })));
    for (const task of pending.splice(0)) await task();
    const perFriend = (id: string) => notifications.filter((n) => n.event === 'friend_achievement' && n.ids.includes(id)).length;
    return { outcomes, perFriend, saved };
  };
  return { run };
}

test('health import: one request gives each friend at most one friend_achievement, records are still saved and returned', async () => {
  const { outcomes, perFriend, saved } = await importWithAchievements('health').run();
  assert.equal(outcomes.length, 3);
  assert.ok(saved.filter((code) => code === 'best_set').length >= 3, `records saved: ${saved.join(',')}`);
  assert.ok(perFriend('f1') <= 1, `f1 got ${perFriend('f1')}`);
  assert.ok(perFriend('f2') <= 1, `f2 got ${perFriend('f2')}`);
});

test('records from the site or the app still tell friends (the health rule does not leak)', async () => {
  const { perFriend } = await importWithAchievements('web').run();
  assert.ok(perFriend('f1') >= 1, 'a web record is news for friends');
});

test('R01.5: a new workout stores active calories by the owner\'s body at that moment; a later weight change leaves it as is', async () => {
  const { deps, rows, body } = fakeDeps();
  const create = createWorkoutCreator(deps);

  // Без веса калорий нет.
  await create(ann, { exerciseType: 'pushups', reps: 60 }, { source: 'web', now });
  assert.equal(rows[0].activeKcal, null);

  // 60 отжиманий = 120 с, MET 7.5: (7.5 − 1) × 80 × 120/3600 = 17.3.
  body.weightKg = 80;
  const second = await create(ann, { exerciseType: 'pushups', reps: 60 }, { source: 'web', now });
  assert.equal(rows[1].activeKcal, 17.3);
  assert.equal((second.workout as { activeKcal?: number | null }).activeKcal, 17.3);

  // Вес сменился — новая тренировка по новому весу, прежняя не меняется.
  body.weightKg = 90;
  await create(ann, { exerciseType: 'pushups', reps: 60 }, { source: 'web', now });
  assert.equal(rows[1].activeKcal, 17.3);
  assert.equal(rows[2].activeKcal, 19.5);
});

test('R01.5: calories of a set count its kettlebell, both sides and the run time', async () => {
  const { deps, rows, body } = fakeDeps();
  body.weightKg = 80;
  const create = createWorkoutCreator(deps);
  await create(ann, { exerciseType: 'kettlebell_press', repsLeft: 10, repsRight: 10, loadKg: 24 }, { source: 'web', now });
  await create(ann, { exerciseType: 'run', reps: 5000, durationSeconds: 1800 }, { source: 'web', now });
  // Жим 20 повторов × 3 с = 60 с, гиря ×1.5: (9 − 1) × 80 / 60 = 10.7.
  assert.equal(rows[0].activeKcal, 10.7);
  assert.ok(rows[1].activeKcal !== null && rows[1].activeKcal >= 350 && rows[1].activeKcal <= 450);
});
