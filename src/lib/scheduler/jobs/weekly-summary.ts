/**
 * «Итоги недели» (F7): on Sunday 20:00 local time users who trained during the last two weeks
 * get the summary (`weekly_summary`), once — `notifyUsers` claims `weekly-summary:<userId>:<weekStart>`.
 */
import type { SchedulerJob } from '../index';
import { weekStart, addDays, type DayKey } from '@/lib/calendar-day';
import type { DayStatsWorkout } from '@/lib/day-stats';
import { weeklySlotDay, type LeagueEntry, type WeeklySlot } from '@/lib/league';
import type { notifyUsers as notifyUsersFn } from '@/lib/notify';
import { buildWeeklySummary, weeklySummaryKey, weeklySummaryMessage } from '@/lib/weekly-summary';

export const WEEKLY_SUMMARY_SLOT: WeeklySlot = { weekday: 'sunday', time: '20:00' };

export type WeeklySummaryJobData = {
  /** The user's workouts of the week and the one before it. */
  workouts: DayStatsWorkout[];
  /** Me + friends with their points of the week. */
  entries: LeagueEntry[];
};

export type WeeklySummaryJobDeps = {
  findUsers(): Promise<Array<{ id: string; timeZone: string }>>;
  loadData(userId: string, start: DayKey): Promise<WeeklySummaryJobData>;
  notifyUsers: typeof notifyUsersFn;
};

export function createWeeklySummaryJob(deps: WeeklySummaryJobDeps): SchedulerJob {
  return {
    name: 'weekly-summary',
    async run(now) {
      const users = await deps.findUsers();
      for (const user of users) {
        const sunday = weeklySlotDay(user.timeZone, now, WEEKLY_SUMMARY_SLOT);
        if (!sunday) continue;
        const start = weekStart(sunday);

        const data = await deps.loadData(user.id, start);
        const summary = buildWeeklySummary({ weekStart: start, workouts: data.workouts, league: { meId: user.id, entries: data.entries } });
        if (!summary.hasActivity) continue;

        await deps.notifyUsers(
          [user.id],
          'weekly_summary',
          (locale) => weeklySummaryMessage(locale, summary),
          { dedupeKey: () => weeklySummaryKey(user.id, start), tag: 'weekly-summary' },
        );
      }
    },
  };
}

export const weeklySummaryJob = createWeeklySummaryJob({
  findUsers: async () => (await import('@/lib/league')).findWeeklyUsers(),
  loadData: async (userId, start) => {
    const { prisma } = await import('@/lib/prisma');
    const { dayKeyToDbDate } = await import('@/lib/calendar-day');
    const { loadLeagueEntries } = await import('@/lib/league');
    const [workouts, entries] = await Promise.all([
      prisma.workout.findMany({
        where: { userId, date: { gte: dayKeyToDbDate(addDays(start, -7)), lte: dayKeyToDbDate(addDays(start, 6)) } },
        select: { date: true, reps: true, exerciseType: true, loadKg: true },
      }),
      loadLeagueEntries(userId, start),
    ]);
    return { workouts, entries };
  },
  notifyUsers: async (...args) => (await import('@/lib/notify')).notifyUsers(...args),
});
