/**
 * «Ты 2-й из 5» (F2): on Monday 09:00 local time every user with at least one friend gets the
 * result of the week that just ended (`weekly_league`), once — `notifyUsers` claims
 * `weekly-league:<userId>:<weekStart>`. The winner of their own league gets the badge.
 */
import type { SchedulerJob } from '../index';
import { addDays, type DayKey } from '@/lib/calendar-day';
import {
  buildLeague,
  weeklyLeagueKey,
  weeklyLeagueMessage,
  weeklySlotDay,
  WEEKLY_LEAGUE_SLOT,
  type LeagueEntry,
} from '@/lib/league';
import type { claimDispatch as claimDispatchFn, notifyUsers as notifyUsersFn } from '@/lib/notify';
import type { awardLeagueWinner as awardLeagueWinnerFn } from '@/lib/workout-hooks';

export type WeeklyLeagueJobDeps = {
  findUsers(): Promise<Array<{ id: string; timeZone: string }>>;
  /** Me + friends with their points of the week that starts on `start`. */
  loadEntries(userId: string, start: DayKey): Promise<LeagueEntry[]>;
  notifyUsers: typeof notifyUsersFn;
  /** Gives the winner badge once per user and week, not on every tick of the window. */
  claimDispatch: typeof claimDispatchFn;
  awardLeagueWinner: typeof awardLeagueWinnerFn;
};

export function createWeeklyLeagueJob(deps: WeeklyLeagueJobDeps): SchedulerJob {
  return {
    name: 'weekly-league',
    async run(now) {
      const users = await deps.findUsers();
      for (const user of users) {
        const monday = weeklySlotDay(user.timeZone, now, WEEKLY_LEAGUE_SLOT);
        if (!monday) continue;
        const start = addDays(monday, -7); // the week that ended yesterday

        const entries = await deps.loadEntries(user.id, start);
        // A league needs company and some activity; otherwise «1-й из 3» with zeros is noise.
        if (entries.length < 2 || !entries.some((entry) => entry.points > 0)) continue;
        const league = buildLeague(entries, user.id);
        const mine = league.rows.find((row) => row.userId === user.id);
        if (!mine || league.myPlace === null) continue;

        await deps.notifyUsers(
          [user.id],
          'weekly_league',
          (locale) => weeklyLeagueMessage(locale, { place: mine.place, total: league.rows.length, points: mine.points }),
          { dedupeKey: () => weeklyLeagueKey(user.id, start), tag: 'weekly-league' },
        );
        if (mine.place === 1 && mine.points > 0) {
          try {
            if (await deps.claimDispatch(`weekly-league-winner:${user.id}:${start}`)) await deps.awardLeagueWinner(user.id, start);
          } catch (error) {
            console.error('weekly-league: award failed', error);
          }
        }
      }
    },
  };
}

export const weeklyLeagueJob = createWeeklyLeagueJob({
  findUsers: async () => (await import('@/lib/league')).findWeeklyUsers(),
  loadEntries: async (userId, start) => (await import('@/lib/league')).loadLeagueEntries(userId, start),
  notifyUsers: async (...args) => (await import('@/lib/notify')).notifyUsers(...args),
  claimDispatch: async (key) => (await import('@/lib/notify')).claimDispatch(key),
  awardLeagueWinner: async (...args) => (await import('@/lib/workout-hooks')).awardLeagueWinner(...args),
});
