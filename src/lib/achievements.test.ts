import test from 'node:test';
import assert from 'node:assert/strict';
import { detectRecords, evaluateBadges, friendAchievementMessage, personalBests, type AchievementWorkout, type BadgeContext } from './achievements';
import { createAchievementHook, type AchievementHookDeps, type AchievementRow, type CreatedWorkout } from './workout-hooks';
import type { LocalizedMessage, NotifyEvent, NotifyLocale, NotifyOptions } from './notify';

let seq = 0;
const w = (date: string, exerciseType: string, reps: number, loadKg: number | null = null): AchievementWorkout => ({
  id: `w${++seq}`,
  date: new Date(`${date}T00:00:00.000Z`),
  exerciseType,
  reps,
  loadKg,
});

test('records: a set above the previous best set of this exercise is a best-set record', () => {
  const history = [w('2026-10-01', 'pushups', 30), w('2026-10-02', 'pushups', 25), w('2026-10-02', 'squats', 80)];
  const hits = detectRecords(history, w('2026-10-05', 'pushups', 31));
  assert.deepEqual(
    hits.find((h) => h.kind === 'best_set'),
    { kind: 'best_set', exerciseType: 'pushups', value: 31, previous: 30 },
  );
  // Equal to the best — not a record; other exercises do not count.
  assert.equal(detectRecords(history, w('2026-10-05', 'pushups', 30)).some((h) => h.kind === 'best_set'), false);
  assert.equal(detectRecords(history, w('2026-10-05', 'pushups', 50)).some((h) => h.exerciseType !== 'pushups'), false);
});

test('records: the day total crossing the best other day is a best-day record, once per day', () => {
  const history = [w('2026-10-01', 'pushups', 40), w('2026-10-01', 'pushups', 40), w('2026-10-03', 'pushups', 50), w('2026-10-05', 'pushups', 45)];
  // 45 + 36 = 81 > 80 (Oct 1): crossed with this set.
  assert.deepEqual(
    detectRecords(history, w('2026-10-05', 'pushups', 36)).find((h) => h.kind === 'best_day'),
    { kind: 'best_day', exerciseType: 'pushups', value: 81, previous: 80 },
  );
  // 45 + 35 = 80 — equal, not a record.
  assert.equal(detectRecords(history, w('2026-10-05', 'pushups', 35)).some((h) => h.kind === 'best_day'), false);
  // The day is already above the best other day: the next set does not repeat «Рекорд дня».
  const after = [...history, w('2026-10-05', 'pushups', 36)];
  assert.equal(detectRecords(after, w('2026-10-05', 'pushups', 10)).some((h) => h.kind === 'best_day'), false);
  // Only one day of this exercise so far — nothing to beat.
  assert.equal(detectRecords([w('2026-10-05', 'squats', 20)], w('2026-10-05', 'squats', 30)).some((h) => h.kind === 'best_day'), false);
});

test('records: loaded exercises compare points, cardio compares metres, the first set is not a record', () => {
  // Swing points = reps × (kg / 24)²: 30 × 24 kg = 30, 20 × 32 kg ≈ 35.6, 40 × 16 kg ≈ 17.8.
  const swings = [w('2026-10-01', 'kettlebell_swing', 30, 24)];
  assert.deepEqual(
    detectRecords(swings, w('2026-10-02', 'kettlebell_swing', 20, 32)).find((h) => h.kind === 'best_set'),
    { kind: 'best_set', exerciseType: 'kettlebell_swing', value: 35.6, previous: 30 },
  );
  assert.equal(detectRecords(swings, w('2026-10-02', 'kettlebell_swing', 40, 16)).length, 0);

  const runs = [w('2026-10-01', 'run', 5000)];
  assert.deepEqual(
    detectRecords(runs, w('2026-10-02', 'run', 5200)).find((h) => h.kind === 'best_set'),
    { kind: 'best_set', exerciseType: 'run', value: 5200, previous: 5000 },
  );

  assert.deepEqual(detectRecords([], w('2026-10-02', 'pushups', 100)), []);
  assert.deepEqual(detectRecords([w('2026-10-01', 'squats', 50)], w('2026-10-02', 'pushups', 100)), []);
});

const ctx = (workouts: AchievementWorkout[], patch: Partial<BadgeContext> = {}): BadgeContext => ({
  workouts,
  newWorkout: workouts[workouts.length - 1],
  today: '2026-10-07',
  dailyGoalPoints: null,
  owned: [],
  ...patch,
});
const days = (from: number, count: number, exerciseType = 'squats', reps = 10) =>
  Array.from({ length: count }, (_, i) => w(`2026-10-${String(from + i).padStart(2, '0')}`, exerciseType, reps));

test('badges: streaks of 7 / 30 / 100 days — reached now or earlier', () => {
  const seven = [w('2026-09-30', 'pushups', 5), ...days(1, 7)];
  assert.ok(evaluateBadges(ctx(seven, { owned: ['first_exercise'] })).includes('streak_7'));
  assert.equal(evaluateBadges(ctx(seven.slice(2), { owned: ['first_exercise'] })).includes('streak_7'), false); // 6 days
  assert.equal(evaluateBadges(ctx(seven, { owned: ['first_exercise'] })).includes('streak_30'), false);

  // A 7-day run in September, broken since: the badge still comes with the next workout (no backfill job).
  const past = [...Array.from({ length: 7 }, (_, i) => w(`2026-09-${String(10 + i).padStart(2, '0')}`, 'squats', 10)), w('2026-10-07', 'squats', 10)];
  assert.ok(evaluateBadges(ctx(past, { owned: ['first_exercise'] })).includes('streak_7'));

  const hundred = Array.from({ length: 100 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 5, 30 + i));
    return w(d.toISOString().slice(0, 10), 'squats', 10);
  });
  // 2026-06-30 … 2026-10-07 (today): 100 days.
  const got = evaluateBadges(ctx(hundred, { owned: ['first_exercise'] }));
  assert.deepEqual(got.filter((code) => code.startsWith('streak_')), ['streak_7', 'streak_30', 'streak_100']);
});

test('badges: 1 000 / 10 000 / 100 000 points in total and 1 000 / 10 000 push-ups', () => {
  // 300 pull-ups × 3 = 900, + 50 + 50 push-ups = 1 000 points; 100 push-ups only.
  const points = [w('2026-10-01', 'pullups', 300), w('2026-10-02', 'pushups', 50), w('2026-10-03', 'pushups', 50)];
  const got = evaluateBadges(ctx(points, { owned: ['first_exercise'] }));
  assert.ok(got.includes('points_1000'));
  assert.equal(got.includes('points_10000'), false);
  assert.equal(got.includes('pushups_1000'), false);
  assert.equal(evaluateBadges(ctx(points.slice(0, 2), { owned: ['first_exercise'] })).includes('points_1000'), false); // 950

  const pushups = [w('2026-10-01', 'pushups', 9000), w('2026-10-02', 'pushups', 999), w('2026-10-03', 'pushups', 1)];
  const many = evaluateBadges(ctx(pushups, { owned: ['first_exercise'] }));
  assert.ok(many.includes('pushups_1000') && many.includes('pushups_10000') && many.includes('points_10000'));
  assert.equal(many.includes('points_100000'), false);
  // Seconds of plank are not push-ups.
  assert.equal(evaluateBadges(ctx([w('2026-10-01', 'plank', 5000)], { owned: ['first_exercise'] })).includes('pushups_1000'), false);
});

test('badges: first set of an exercise not done before, and the first reached daily goal', () => {
  const first = [w('2026-10-01', 'pushups', 20), w('2026-10-02', 'squats', 20)];
  assert.ok(evaluateBadges(ctx(first)).includes('first_exercise'));
  assert.ok(evaluateBadges(ctx(first.slice(0, 1))).includes('first_exercise')); // the very first workout too
  const again = [...first, w('2026-10-03', 'squats', 25)];
  assert.equal(evaluateBadges(ctx(again)).includes('first_exercise'), false);

  // Goal 50 points: 30 + 20 push-ups on the new workout's day reach it; another day's points do not count.
  const goal = [w('2026-10-06', 'pushups', 40), w('2026-10-07', 'pushups', 30), w('2026-10-07', 'pushups', 20)];
  assert.ok(evaluateBadges(ctx(goal, { dailyGoalPoints: 50 })).includes('daily_goal_first'));
  assert.equal(evaluateBadges(ctx(goal.slice(0, 2), { dailyGoalPoints: 50 })).includes('daily_goal_first'), false);
  assert.equal(evaluateBadges(ctx(goal, { dailyGoalPoints: null })).includes('daily_goal_first'), false);
});

test('badges: an owned badge is never returned again; the league badge is not earned by workouts', () => {
  const all = [w('2026-10-01', 'pushups', 10000)];
  const owned = ['points_1000', 'points_10000', 'pushups_1000', 'pushups_10000', 'first_exercise', 'daily_goal_first'];
  assert.deepEqual(evaluateBadges(ctx(all, { owned, dailyGoalPoints: 100 })), []);
  assert.equal(evaluateBadges(ctx(all, { dailyGoalPoints: 100 })).includes('league_winner'), false);
});

test('friend notification: records and badges in the recipient language', () => {
  const args = {
    username: 'bob',
    records: [
      { kind: 'best_set' as const, exerciseType: 'pushups' as const, value: 31, previous: 30 },
      { kind: 'best_day' as const, exerciseType: 'plank' as const, value: 240, previous: 200 },
    ],
    badges: ['streak_7' as const],
  };
  assert.deepEqual(friendAchievementMessage('ru', args), {
    title: 'Достижение друга',
    body: 'bob: новый рекорд подхода — Отжимания: 31; рекорд дня — Планка: 240 сек; значок «Неделя подряд»',
    link: '/friends',
  });
  assert.equal(
    friendAchievementMessage('en', { username: 'bob', records: [{ kind: 'best_set', exerciseType: 'kettlebell_swing', value: 35.6, previous: 30 }], badges: [] }).body,
    'bob: new best set — Kettlebell swing: 35.6 points',
  );
});

type Notified = { ids: string[]; event: NotifyEvent; ru: LocalizedMessage; opts?: NotifyOptions };

// `existing` — UserAchievement rows the user had before (records included); owned badges count too.
function hookWorld(input: { workouts: AchievementWorkout[]; owned?: string[]; existing?: number; dailyGoalPoints?: number | null; friends?: string[] }) {
  const rows: AchievementRow[] = [];
  const taken = new Set<string>(input.owned?.map((code) => `badge:${code}:u1`) ?? []);
  const notified: Notified[] = [];
  const pending: Array<() => Promise<void>> = [];
  const deps: AchievementHookDeps = {
    loadContext: async () => ({
      workouts: input.workouts,
      dailyGoalPoints: input.dailyGoalPoints ?? null,
      ownedBadges: input.owned ?? [],
      hasAchievements: (input.existing ?? 0) + (input.owned?.length ?? 0) + rows.length > 0,
    }),
    saveAchievement: async (row) => {
      if (row.uniqueKey && taken.has(row.uniqueKey)) return null;
      if (row.uniqueKey) taken.add(row.uniqueKey);
      rows.push(row);
      return { id: `a${rows.length}`, achievedAt: new Date('2026-10-07T10:00:00.000Z') };
    },
    friendIds: async () => input.friends ?? ['f1', 'f2'],
    usernameOf: async () => 'bob',
    notify: async (ids: string[], event: NotifyEvent, build: (locale: NotifyLocale, userId: string) => LocalizedMessage, opts?: NotifyOptions) => {
      notified.push({ ids, event, ru: build('ru', ids[0]), opts });
    },
    defer: (task) => {
      pending.push(task);
    },
    now: () => new Date('2026-10-07T10:00:00.000Z'),
  };
  return { deps, rows, notified, flush: async () => { for (const task of pending.splice(0)) await task(); } };
}

const user = { id: 'u1', username: 'bob', timeZone: 'Europe/Moscow' };
const created = (date: string, exerciseType: string, reps: number): CreatedWorkout => {
  const base = w(date, exerciseType, reps);
  return { ...base, date: base.date as Date, loadKg: null, repsLeft: null, repsRight: null, time: new Date(`${date}T10:00:00.000Z`), trainingSessionId: null };
};

test('hook: saves records and new badges, notifies friends in the background', async () => {
  const history = [w('2026-10-06', 'pushups', 30), w('2026-10-06', 'pushups', 30)];
  const workout = created('2026-10-07', 'pushups', 31);
  const world = hookWorld({ workouts: [...history, workout], owned: ['first_exercise'] });
  const { onWorkoutCreated } = createAchievementHook(world.deps);

  const result = await onWorkoutCreated(workout, user);
  assert.deepEqual(result.records, [{ kind: 'best_set', exerciseType: 'pushups', value: 31, previous: 30 }]);
  assert.deepEqual(result.achievements, []);
  assert.deepEqual(world.rows.map((r) => [r.kind, r.code, r.workoutId]), [['record', 'best_set', workout.id]]);
  assert.equal(world.notified.length, 0, 'notification does not hold the response');
  await world.flush();
  assert.equal(world.notified.length, 1);
  assert.deepEqual(world.notified[0].ids, ['f1', 'f2']);
  assert.equal(world.notified[0].event, 'friend_achievement');
  assert.match(world.notified[0].ru.body ?? '', /новый рекорд подхода — Отжимания: 31/);
});

test('hook: a badge is saved once by its uniqueKey; nothing new — no notification', async () => {
  const workout = created('2026-10-07', 'squats', 10);
  const world = hookWorld({ workouts: [workout], existing: 1 });
  const { onWorkoutCreated } = createAchievementHook(world.deps);

  const first = await onWorkoutCreated(workout, user);
  assert.deepEqual(first.achievements.map((a) => [a.code, a.exerciseType, a.workoutId]), [['first_exercise', 'squats', workout.id]]);
  assert.equal(world.rows[0].uniqueKey, 'badge:first_exercise:u1');

  // The owned list is stale (a parallel request): the unique key still refuses the second copy.
  const again = await onWorkoutCreated(workout, user);
  assert.deepEqual(again.achievements, []);
  assert.equal(world.rows.length, 1);
  await world.flush();
  assert.equal(world.notified.length, 1);
});

test('hook: the first award to a user with no achievements yet (badges earned before the feature) does not notify friends', async () => {
  const history = [w('2026-10-01', 'pushups', 9000), w('2026-10-02', 'pushups', 999)];
  const workout = created('2026-10-07', 'pushups', 31);
  const workouts: AchievementWorkout[] = [...history, workout];
  const world = hookWorld({ workouts });
  const { onWorkoutCreated } = createAchievementHook(world.deps);

  const result = await onWorkoutCreated(workout, user);
  const codes = result.achievements.map((a) => a.code);
  assert.ok(['points_1000', 'points_10000', 'pushups_1000', 'pushups_10000'].every((code) => codes.includes(code as never)), 'badges and the toast as usual');
  assert.equal(world.rows.length, result.achievements.length + result.records.length);
  await world.flush();
  assert.equal(world.notified.length, 0, 'no friend_achievement for the backlog');

  // From now on the user has achievements: a new badge is news again.
  const squats = created('2026-10-07', 'squats', 10);
  workouts.push(squats);
  const next = await onWorkoutCreated(squats, user);
  assert.deepEqual(next.achievements.map((a) => a.code), ['first_exercise']);
  await world.flush();
  assert.equal(world.notified.length, 1);
  assert.equal(world.notified[0].event, 'friend_achievement');
});

test('league winner badge: given once per user, friends are told', async () => {
  const world = hookWorld({ workouts: [] });
  const { awardLeagueWinner } = createAchievementHook(world.deps);
  const first = await awardLeagueWinner('u1', '2026-09-28');
  assert.equal(first?.code, 'league_winner');
  assert.equal(world.rows[0].uniqueKey, 'badge:league_winner:u1');
  assert.equal(await awardLeagueWinner('u1', '2026-10-05'), null);
  await world.flush();
  assert.equal(world.notified.length, 1);
});

test('personal bests per exercise: best set and best day, in catalog order; loaded ones in points', () => {
  const list = [
    w('2026-10-01', 'squats', 50), w('2026-10-01', 'squats', 40), w('2026-10-02', 'squats', 60),
    w('2026-10-01', 'pushups', 20), w('2026-10-03', 'pushups', 25),
    w('2026-10-04', 'kettlebell_swing', 20, 32), w('2026-10-05', 'kettlebell_swing', 30, 24),
  ];
  assert.deepEqual(personalBests(list), [
    { exerciseType: 'pushups', bestSet: { value: 25, day: '2026-10-03' }, bestDay: { value: 25, day: '2026-10-03' } },
    { exerciseType: 'squats', bestSet: { value: 60, day: '2026-10-02' }, bestDay: { value: 90, day: '2026-10-01' } },
    { exerciseType: 'kettlebell_swing', bestSet: { value: 35.6, day: '2026-10-04' }, bestDay: { value: 35.6, day: '2026-10-04' } },
  ]);
});
