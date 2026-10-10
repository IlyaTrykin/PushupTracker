/**
 * «Осталось N баллов до цели» (F1): every tick, users inside their reminder window
 * whose points of today (their zone) are below the goal get `daily_goal_reminder`
 * once a day — `notifyUsers` claims `daily-goal:<userId>:<DayKey>` first.
 */
import type { SchedulerJob } from '../index';
import { dailyGoalReminderMessage, dueReminderDay, planDailyGoalReminders, type DailyGoalUser } from '@/lib/daily-goal';
import type { DayKey } from '@/lib/calendar-day';
import type { notifyUsers as notifyUsersFn } from '@/lib/notify';

export type DailyGoalJobDeps = {
  /** Active users with a daily goal set. */
  findGoalUsers(): Promise<DailyGoalUser[]>;
  /** Points per `${userId}:${day}` for the given user days. */
  loadDayPoints(entries: Array<{ userId: string; day: DayKey }>): Promise<Map<string, number>>;
  notifyUsers: typeof notifyUsersFn;
};

export function createDailyGoalJob(deps: DailyGoalJobDeps): SchedulerJob {
  return {
    name: 'daily-goal',
    async run(now) {
      const users = await deps.findGoalUsers();
      const due = users.flatMap((user) => {
        const day = dueReminderDay(user, now);
        return day ? [{ user, day }] : [];
      });
      if (!due.length) return;

      const points = await deps.loadDayPoints(due.map(({ user, day }) => ({ userId: user.id, day })));
      const reminders = planDailyGoalReminders(due.map(({ user }) => user), now, (userId, day) => points.get(`${userId}:${day}`) ?? 0);

      for (const reminder of reminders) {
        await deps.notifyUsers(
          [reminder.userId],
          'daily_goal_reminder',
          (locale) => dailyGoalReminderMessage(locale, reminder),
          { dedupeKey: () => reminder.key, tag: 'daily-goal' },
        );
      }
    },
  };
}

export const dailyGoalJob = createDailyGoalJob({
  findGoalUsers: async () => {
    const { prisma } = await import('@/lib/prisma');
    return prisma.user.findMany({
      where: { deletedAt: null, dailyGoalPoints: { not: null } },
      select: { id: true, timeZone: true, dailyGoalPoints: true, dailyReminderTime: true },
    });
  },
  loadDayPoints: async (entries) => {
    const { prisma } = await import('@/lib/prisma');
    const { dayKeyToDbDate } = await import('@/lib/calendar-day');
    const { dayPointsTotal } = await import('@/lib/day-stats');

    const usersByDay = new Map<DayKey, string[]>();
    for (const { userId, day } of entries) usersByDay.set(day, [...(usersByDay.get(day) ?? []), userId]);

    const result = new Map<string, number>();
    for (const [day, userIds] of usersByDay) {
      const workouts = await prisma.workout.findMany({
        where: { userId: { in: userIds }, date: dayKeyToDbDate(day) },
        select: { userId: true, date: true, reps: true, exerciseType: true, loadKg: true },
      });
      for (const userId of userIds) {
        result.set(`${userId}:${day}`, dayPointsTotal(workouts.filter((w) => w.userId === userId)));
      }
    }
    return result;
  },
  notifyUsers: async (...args) => (await import('@/lib/notify')).notifyUsers(...args),
});
