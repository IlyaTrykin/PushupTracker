import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWeeklySummary, weeklySummaryMessage, type WeeklySummary } from './weekly-summary';
import { createWeeklySummaryJob, type WeeklySummaryJobData } from './scheduler/jobs/weekly-summary';

// A push-up is one point.
const pushups = (date: string, reps: number) => ({ date, reps, exerciseType: 'pushups' });
const WEEK = '2026-10-05'; // Monday

test('summary: sum, percent to last week, best day', () => {
  const summary = buildWeeklySummary({
    weekStart: WEEK,
    workouts: [
      pushups('2026-10-05', 30),
      pushups('2026-10-07', 50),
      pushups('2026-10-07', 20),
      pushups('2026-09-29', 60), // last week
      pushups('2026-09-30', 40), // last week
      pushups('2026-10-12', 999), // next week: ignored
    ],
    league: null,
  });
  assert.equal(summary.totalPoints, 100);
  assert.equal(summary.previousPoints, 100);
  assert.equal(summary.changePercent, 0);
  assert.deepEqual(summary.bestDay, { day: '2026-10-07', points: 70 });
  assert.equal(summary.hasActivity, true);
});

test('summary: growth and decline are rounded percents; no previous week gives null', () => {
  const grew = buildWeeklySummary({ weekStart: WEEK, workouts: [pushups('2026-10-06', 125), pushups('2026-09-30', 100)], league: null });
  assert.equal(grew.changePercent, 25);
  const fell = buildWeeklySummary({ weekStart: WEEK, workouts: [pushups('2026-10-06', 2), pushups('2026-09-30', 3)], league: null });
  assert.equal(fell.changePercent, -33);
  const fresh = buildWeeklySummary({ weekStart: WEEK, workouts: [pushups('2026-10-06', 10)], league: null });
  assert.equal(fresh.changePercent, null);
  assert.equal(fresh.previousPoints, 0);
});

test('summary: no workouts in two weeks means no activity; league place comes from the entries', () => {
  const empty = buildWeeklySummary({ weekStart: WEEK, workouts: [pushups('2026-08-01', 50)], league: null });
  assert.equal(empty.hasActivity, false);
  assert.equal(empty.bestDay, null);

  const ranked = buildWeeklySummary({
    weekStart: WEEK,
    workouts: [pushups('2026-10-06', 50)],
    league: { meId: 'me', entries: [{ userId: 'me', points: 50 }, { userId: 'a', points: 80 }, { userId: 'b', points: 5 }] },
  });
  assert.deepEqual(ranked.league, { place: 2, total: 3 });
  const alone = buildWeeklySummary({ weekStart: WEEK, workouts: [pushups('2026-10-06', 50)], league: { meId: 'me', entries: [{ userId: 'me', points: 50 }] } });
  assert.equal(alone.league, null);
});

test('summary text: all four facts in both languages', () => {
  const summary: WeeklySummary = {
    weekStart: WEEK,
    totalPoints: 120,
    previousPoints: 100,
    changePercent: 20,
    bestDay: { day: '2026-10-07', points: 70.5 },
    league: { place: 2, total: 5 },
    hasActivity: true,
  };
  const ru = weeklySummaryMessage('ru', summary);
  assert.equal(ru.title, 'Итоги недели');
  assert.equal(ru.body, 'За неделю: 120 баллов, на 20% больше, чем на прошлой. Лучший день — среда, 70,5 балла. В лиге друзей — 2-е место из 5.');
  const en = weeklySummaryMessage('en', { ...summary, changePercent: -10, league: null });
  assert.equal(en.body, 'This week: 120 points, 10% less than last week. Best day: Wednesday, 70.5 points.');
  assert.equal(en.link, '/friends');
  assert.match(weeklySummaryMessage('ru', { ...summary, changePercent: null, previousPoints: 0 }).body ?? '', /на прошлой неделе тренировок не было/);
});

function summaryJobHarness(data: Record<string, WeeklySummaryJobData>) {
  const calls: Array<{ userIds: string[]; event: string; dedupe?: string; body: string }> = [];
  const job = createWeeklySummaryJob({
    findUsers: async () => Object.keys(data).map((id) => ({ id, timeZone: 'Europe/Moscow' })),
    loadData: async (userId) => data[userId],
    notifyUsers: async (userIds, event, build, opts) => {
      calls.push({ userIds, event, dedupe: opts?.dedupeKey?.(userIds[0]), body: build('ru', userIds[0]).body ?? '' });
    },
  });
  return { job, calls };
}

test('weekly-summary job: Sunday 20:00 local, only for users with workouts in two weeks, weekly key', async () => {
  const { job, calls } = summaryJobHarness({
    active: { workouts: [pushups('2026-10-06', 40), pushups('2026-09-30', 20)], entries: [{ userId: 'active', points: 40 }, { userId: 'f', points: 10 }] },
    quiet: { workouts: [pushups('2026-07-01', 40)], entries: [{ userId: 'quiet', points: 0 }] },
  });
  // Sunday 2026-10-11 20:10 Moscow = 17:10 UTC.
  await job.run(new Date('2026-10-11T17:10:00Z'));

  assert.equal(job.name, 'weekly-summary');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].event, 'weekly_summary');
  assert.deepEqual(calls[0].userIds, ['active']);
  assert.equal(calls[0].dedupe, 'weekly-summary:active:2026-10-05');
  assert.match(calls[0].body, /За неделю: 40 баллов, на 100% больше/);
  assert.match(calls[0].body, /1-е место из 2/);
});

test('weekly-summary job: nothing before 20:00, on other days or after the window', async () => {
  const { job, calls } = summaryJobHarness({ u: { workouts: [pushups('2026-10-06', 40)], entries: [] } });
  await job.run(new Date('2026-10-11T16:59:00Z')); // 19:59 Moscow
  await job.run(new Date('2026-10-10T17:10:00Z')); // Saturday
  await job.run(new Date('2026-10-11T20:30:00Z')); // 23:30 Moscow, window over
  assert.deepEqual(calls, []);
});
