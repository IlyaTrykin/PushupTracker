import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLeague, leagueWeekRange, parseLeagueWeek, weeklyLeagueMessage, weeklySlotDay, type LeagueEntry } from './league';
import { createWeeklyLeagueJob } from './scheduler/jobs/weekly-league';

test('league: places by points, the gap goes to the nearest row above', () => {
  const league = buildLeague(
    [
      { userId: 'bob', points: 80 },
      { userId: 'me', points: 50.5 },
      { userId: 'ann', points: 120 },
      { userId: 'cid', points: 10 },
    ],
    'me',
  );
  assert.deepEqual(
    league.rows.map((row) => [row.userId, row.place]),
    [['ann', 1], ['bob', 2], ['me', 3], ['cid', 4]],
  );
  assert.equal(league.myPlace, 3);
  assert.equal(league.nextPlace, 2);
  assert.equal(league.gapToNext, 29.5);
});

test('league: equal points share a place and the next place is skipped', () => {
  const league = buildLeague(
    [
      { userId: 'a', points: 100 },
      { userId: 'me', points: 100 },
      { userId: 'c', points: 40 },
    ],
    'me',
  );
  assert.deepEqual(league.rows.map((row) => row.place), [1, 1, 3]);
  assert.equal(league.myPlace, 1);
  assert.equal(league.gapToNext, null);
  assert.equal(league.nextPlace, null);
});

test('league: a user outside the entries has no place; the leader has no gap', () => {
  const solo = buildLeague([{ userId: 'a', points: 5 }], 'me');
  assert.equal(solo.myPlace, null);
  assert.equal(solo.gapToNext, null);
  const leader = buildLeague([{ userId: 'me', points: 9 }, { userId: 'a', points: 5 }], 'me');
  assert.equal(leader.myPlace, 1);
  assert.equal(leader.gapToNext, null);
});

test('league: tenths do not drift (0.1 + 0.2 ties with 0.3)', () => {
  const league = buildLeague([{ userId: 'a', points: 0.1 + 0.2 }, { userId: 'me', points: 0.3 }], 'me');
  assert.deepEqual(league.rows.map((row) => row.place), [1, 1]);
});

test('week range: Monday to Sunday of the zone day, previous week shifted by 7', () => {
  // 2026-10-10 is a Saturday; its week starts on Monday 2026-10-05.
  assert.deepEqual(leagueWeekRange('2026-10-10', 'current'), { start: '2026-10-05', end: '2026-10-11' });
  assert.deepEqual(leagueWeekRange('2026-10-10', 'previous'), { start: '2026-09-28', end: '2026-10-04' });
  assert.equal(parseLeagueWeek('previous'), 'previous');
  assert.equal(parseLeagueWeek('whatever'), 'current');
  assert.equal(parseLeagueWeek(null), 'current');
});

test('slot: Monday 09:00 local opens a window of a few hours, nothing on other days', () => {
  const slot = { weekday: 'monday', time: '09:00' } as const;
  // Monday 2026-10-12 09:30 Moscow = 06:30 UTC.
  assert.equal(weeklySlotDay('Europe/Moscow', new Date('2026-10-12T06:30:00Z'), slot), '2026-10-12');
  // 08:59 Moscow: not yet. 13:00 Moscow: window is over.
  assert.equal(weeklySlotDay('Europe/Moscow', new Date('2026-10-12T05:59:00Z'), slot), null);
  assert.equal(weeklySlotDay('Europe/Moscow', new Date('2026-10-12T10:00:00Z'), slot), null);
  // Same instant is still Sunday evening in New York (UTC-4): no slot there.
  assert.equal(weeklySlotDay('America/New_York', new Date('2026-10-12T06:30:00Z'), slot), null);
  // Tuesday.
  assert.equal(weeklySlotDay('Europe/Moscow', new Date('2026-10-13T06:30:00Z'), slot), null);
});

test('league message: place of total in the recipient language, winner gets the cheer', () => {
  const ru = weeklyLeagueMessage('ru', { place: 2, total: 5, points: 120 });
  assert.equal(ru.body, 'Ты 2-й из 5: 120 баллов за неделю.');
  assert.equal(ru.link, '/friends');
  const win = weeklyLeagueMessage('en', { place: 1, total: 3, points: 41.5 });
  assert.match(win.body ?? '', /You finished 1st of 3: 41\.5 points this week\. You won the league!/);
  assert.match(weeklyLeagueMessage('en', { place: 12, total: 20, points: 1 }).body ?? '', /12th of 20: 1 point /);
});

type Call = { userIds: string[]; event: string; dedupe?: string; ru: string; en: string };
function leagueJobHarness(entriesByUser: Record<string, LeagueEntry[]>, zones: Record<string, string> = {}) {
  const calls: Call[] = [];
  const awarded: Array<[string, string]> = [];
  const loaded: string[] = [];
  const claimed = new Set<string>();
  const job = createWeeklyLeagueJob({
    findUsers: async () => Object.keys(entriesByUser).map((id) => ({ id, timeZone: zones[id] ?? 'Europe/Moscow' })),
    loadEntries: async (userId, start) => {
      loaded.push(`${userId}:${start}`);
      return entriesByUser[userId];
    },
    notifyUsers: async (userIds, event, build, opts) => {
      calls.push({ userIds, event, dedupe: opts?.dedupeKey?.(userIds[0]), ru: build('ru', userIds[0]).body ?? '', en: build('en', userIds[0]).body ?? '' });
    },
    claimDispatch: async (key) => {
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    },
    awardLeagueWinner: async (userId, start) => {
      awarded.push([userId, start]);
      return null;
    },
  });
  return { job, calls, awarded, loaded };
}

test('weekly-league job: last week result with the weekly key; winner gets the badge', async () => {
  const { job, calls, awarded, loaded } = leagueJobHarness({
    a: [{ userId: 'a', points: 90 }, { userId: 'b', points: 50 }, { userId: 'c', points: 10 }],
    b: [{ userId: 'b', points: 50 }, { userId: 'a', points: 90 }],
  });
  // Monday 2026-10-12 09:05 Moscow.
  await job.run(new Date('2026-10-12T06:05:00Z'));

  assert.equal(job.name, 'weekly-league');
  assert.deepEqual(loaded, ['a:2026-10-05', 'b:2026-10-05']); // the week that just ended
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { userIds: ['a'], event: 'weekly_league', dedupe: 'weekly-league:a:2026-10-05', ru: 'Ты 1-й из 3: 90 баллов за неделю — победа в лиге!', en: calls[0].en });
  assert.equal(calls[1].ru, 'Ты 2-й из 2: 50 баллов за неделю.');
  assert.deepEqual(awarded, [['a', '2026-10-05']]);

  // The next tick of the window: the badge is not asked for again.
  await job.run(new Date('2026-10-12T06:10:00Z'));
  assert.deepEqual(awarded, [['a', '2026-10-05']]);
});

test('weekly-league job: alone, an empty week, the wrong day or the wrong zone send nothing', async () => {
  const { job, calls, awarded } = leagueJobHarness({
    solo: [{ userId: 'solo', points: 30 }],
    idle: [{ userId: 'idle', points: 0 }, { userId: 'x', points: 0 }],
    ny: [{ userId: 'ny', points: 5 }, { userId: 'x', points: 1 }],
  }, { ny: 'America/New_York' });
  await job.run(new Date('2026-10-12T06:05:00Z')); // Monday 09:05 Moscow, Sunday 02:05 in New York
  assert.deepEqual(calls, []);
  assert.deepEqual(awarded, []);
});
