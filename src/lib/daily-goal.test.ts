import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dailyGoalProgress,
  dailyGoalReminderMessage,
  parseDailyGoalPoints,
  parseReminderTime,
  planDailyGoalReminders,
  type DailyGoalUser,
} from './daily-goal';
import { createDailyGoalJob, type DailyGoalJobDeps } from './scheduler/jobs/daily-goal';
import type { LocalizedMessage, NotifyEvent, NotifyLocale, NotifyOptions } from './notify';

const MOSCOW = 'Europe/Moscow'; // UTC+3, no DST
const user = (patch: Partial<DailyGoalUser> = {}): DailyGoalUser => ({
  id: 'u1',
  timeZone: MOSCOW,
  dailyGoalPoints: 100,
  dailyReminderTime: '20:00',
  ...patch,
});
const noPoints = () => 0;

test('profile input: goal 10–2000 or empty, reminder HH:MM or empty', () => {
  assert.deepEqual(parseDailyGoalPoints(150), { ok: true, value: 150 });
  assert.deepEqual(parseDailyGoalPoints('2000'), { ok: true, value: 2000 });
  assert.deepEqual(parseDailyGoalPoints(null), { ok: true, value: null });
  assert.deepEqual(parseDailyGoalPoints(''), { ok: true, value: null });
  assert.equal(parseDailyGoalPoints(9).ok, false);
  assert.equal(parseDailyGoalPoints(2001).ok, false);
  assert.equal(parseDailyGoalPoints(12.5).ok, false);
  assert.equal(parseDailyGoalPoints('abc').ok, false);

  assert.deepEqual(parseReminderTime('07:30'), { ok: true, value: '07:30' });
  assert.deepEqual(parseReminderTime(null), { ok: true, value: null });
  assert.equal(parseReminderTime('24:00').ok, false);
  assert.equal(parseReminderTime('7:30').ok, false);
  assert.equal(parseReminderTime('20:60').ok, false);
});

test('ring progress: X of Y, reached at the goal', () => {
  assert.deepEqual(dailyGoalProgress(65, 100), { done: 65, goal: 100, remaining: 35, percent: 65, reached: false });
  assert.deepEqual(dailyGoalProgress(130, 100), { done: 130, goal: 100, remaining: 0, percent: 100, reached: true });
  assert.equal(dailyGoalProgress(99.9, 100).reached, false);
  assert.equal(dailyGoalProgress(99.9, 100).remaining, 0.1);
});

test('reminder goes out inside [reminder time, +1 h) in the user zone when the goal is not reached', () => {
  // 20:10 Moscow = 17:10 UTC.
  const now = new Date('2026-10-10T17:10:00.000Z');
  const plan = planDailyGoalReminders([user()], now, (id, day) => (id === 'u1' && day === '2026-10-10' ? 65 : 0));
  assert.deepEqual(plan, [{ userId: 'u1', day: '2026-10-10', goal: 100, done: 65, remaining: 35, key: 'daily-goal:u1:2026-10-10' }]);
});

test('goal reached → nothing', () => {
  const now = new Date('2026-10-10T17:10:00.000Z');
  assert.deepEqual(planDailyGoalReminders([user()], now, () => 100), []);
});

test('outside the window → nothing; window end is exclusive', () => {
  assert.deepEqual(planDailyGoalReminders([user()], new Date('2026-10-10T16:59:00.000Z'), noPoints), []); // 19:59
  assert.equal(planDailyGoalReminders([user()], new Date('2026-10-10T17:00:00.000Z'), noPoints).length, 1); // 20:00
  assert.equal(planDailyGoalReminders([user()], new Date('2026-10-10T17:59:00.000Z'), noPoints).length, 1); // 20:59
  assert.deepEqual(planDailyGoalReminders([user()], new Date('2026-10-10T18:00:00.000Z'), noPoints), []); // 21:00
});

test('time zone of the user decides the day and the window; no goal → nothing; default time 20:00', () => {
  const now = new Date('2026-10-10T17:10:00.000Z'); // 20:10 Moscow, 13:10 New York
  const users = [
    user({ id: 'msk', dailyReminderTime: null }),
    user({ id: 'ny', timeZone: 'America/New_York' }),
    user({ id: 'off', dailyGoalPoints: null }),
    user({ id: 'ny-early', timeZone: 'America/New_York', dailyReminderTime: '13:00' }),
  ];
  const plan = planDailyGoalReminders(users, now, noPoints);
  assert.deepEqual(plan.map((r) => r.key), ['daily-goal:msk:2026-10-10', 'daily-goal:ny-early:2026-10-10']);

  // 23:30 reminder in Moscow: the 00:10 tick next day belongs to a new day and does not nag about it.
  const late = user({ id: 'late', dailyReminderTime: '23:30' });
  assert.equal(planDailyGoalReminders([late], new Date('2026-10-10T20:40:00.000Z'), noPoints).length, 1);
  assert.deepEqual(planDailyGoalReminders([late], new Date('2026-10-10T21:10:00.000Z'), noPoints), []);
});

test('message: «Осталось N баллов до цели» in the recipient language', () => {
  const ru = dailyGoalReminderMessage('ru', { goal: 100, done: 65, remaining: 35 });
  assert.match(ru.body ?? '', /Осталось 35 баллов до цели/);
  assert.match(ru.body ?? '', /65 из 100/);
  assert.equal(ru.link, '/dashboard');
  assert.match(dailyGoalReminderMessage('ru', { goal: 100, done: 79, remaining: 21 }).body ?? '', /Осталось 21 балл /);
  assert.match(dailyGoalReminderMessage('ru', { goal: 100, done: 98, remaining: 2 }).body ?? '', /Осталось 2 балла /);
  assert.match(dailyGoalReminderMessage('ru', { goal: 100, done: 99.5, remaining: 0.5 }).body ?? '', /Осталось 0,5 балла /);
  const en = dailyGoalReminderMessage('en', { goal: 100, done: 99, remaining: 1 });
  assert.match(en.body ?? '', /1 point left to your goal/);
});

type NotifyCall = { userIds: string[]; event: NotifyEvent; opts?: NotifyOptions; ru: LocalizedMessage };

function jobDeps(users: DailyGoalUser[], points: Record<string, number>, calls: NotifyCall[]): DailyGoalJobDeps {
  return {
    findGoalUsers: async () => users,
    loadDayPoints: async (entries) => new Map(entries.map(({ userId, day }) => [`${userId}:${day}`, points[`${userId}:${day}`] ?? 0])),
    notifyUsers: async (userIds, event, build, opts) => {
      calls.push({ userIds, event, opts, ru: build('ru' as NotifyLocale, userIds[0]) });
    },
  };
}

test('job: notifies only due users who are short of the goal, with the daily dedupe key', async () => {
  const calls: NotifyCall[] = [];
  const users = [user({ id: 'a' }), user({ id: 'b' }), user({ id: 'c', dailyReminderTime: '08:00' })];
  const job = createDailyGoalJob(jobDeps(users, { 'a:2026-10-10': 40, 'b:2026-10-10': 120 }, calls));

  await job.run(new Date('2026-10-10T17:05:00.000Z'));

  assert.equal(job.name, 'daily-goal');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].userIds, ['a']);
  assert.equal(calls[0].event, 'daily_goal_reminder');
  assert.equal(calls[0].opts?.dedupeKey?.('a'), 'daily-goal:a:2026-10-10');
  assert.match(calls[0].ru.body ?? '', /Осталось 60 баллов/);
});
