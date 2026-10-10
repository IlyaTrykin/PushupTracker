/**
 * Group goal: marks a goal completed once the group's points reach the target and tells
 * every active member once (`group-goal-done:<goalId>`).
 */
import type { SchedulerJob } from '../index';
import { addDays, dayKeyToDbDate, dayKeyInZone } from '@/lib/calendar-day';
import { groupGoalMessages, fillGroupGoalTemplate } from '@/i18n/messages/features/group-goal';
import type { GroupGoalProgress, GroupGoalRecord } from '@/lib/group-goal';
import type { notifyUsers as notifyUsersFn } from '@/lib/notify';

export type OpenGoal = GroupGoalRecord & { groupName: string };

export type GroupGoalDeps = {
  /** Not completed, not ended goals of live groups whose last day is not long past. */
  findOpenGoals(lastDayNotBefore: Date): Promise<OpenGoal[]>;
  progressOf(goal: GroupGoalRecord): Promise<GroupGoalProgress>;
  /** Sets completedAt if it is still empty; true for the one caller that did it. */
  markCompleted(goalId: string, now: Date): Promise<boolean>;
  activeMemberIds(groupId: string): Promise<string[]>;
  claimDispatch(key: string): Promise<boolean>;
  notifyUsers: typeof notifyUsersFn;
};

export function groupGoalDoneKey(goalId: string): string {
  return `group-goal-done:${goalId}`;
}

export function createGroupGoalJob(deps: GroupGoalDeps): SchedulerJob {
  return {
    name: 'group-goal',
    async run(now) {
      // The goal's last day is a calendar day without a zone; keep a day of slack for late zones.
      const yesterday = addDays(dayKeyInZone(now, 'UTC'), -1);
      const goals = await deps.findOpenGoals(dayKeyToDbDate(yesterday));
      for (const goal of goals) {
        try {
          const progress = await deps.progressOf(goal);
          if (!progress.reached) continue;
          if (!(await deps.markCompleted(goal.id, now))) continue;
          if (!(await deps.claimDispatch(groupGoalDoneKey(goal.id)))) continue;
          const memberIds = await deps.activeMemberIds(goal.groupId);
          await deps.notifyUsers(
            memberIds,
            'group_goal_completed',
            (locale) => {
              const text = groupGoalMessages[locale].notify;
              return {
                title: text.title,
                body: fillGroupGoalTemplate(text.body, {
                  group: goal.groupName,
                  goal: goal.title,
                  target: goal.targetPoints.toLocaleString(locale === 'en' ? 'en-US' : 'ru-RU'),
                }),
                link: `/groups/${goal.groupId}`,
              };
            },
            { tag: `group-goal-${goal.id}` },
          );
        } catch (error) {
          console.error(`Scheduler group-goal ${goal.id}:`, error);
        }
      }
    },
  };
}

export const groupGoalJob = createGroupGoalJob({
  findOpenGoals: async (lastDayNotBefore) => {
    const { prisma } = await import('@/lib/prisma');
    const goals = await prisma.groupGoal.findMany({
      where: { deletedAt: null, completedAt: null, endDate: { gte: lastDayNotBefore }, group: { deletedAt: null } },
      include: { group: { select: { name: true } } },
    });
    return goals.map(({ group, ...goal }) => ({ ...goal, groupName: group.name }));
  },
  progressOf: async (goal) => (await import('@/lib/group-goal')).loadGroupGoalProgress(goal),
  markCompleted: async (goalId, now) => {
    const { prisma } = await import('@/lib/prisma');
    const result = await prisma.groupGoal.updateMany({ where: { id: goalId, completedAt: null, deletedAt: null }, data: { completedAt: now } });
    return result.count === 1;
  },
  activeMemberIds: async (groupId) => {
    const { prisma } = await import('@/lib/prisma');
    const rows = await prisma.groupMembership.findMany({ where: { groupId, status: 'active', user: { deletedAt: null } }, select: { userId: true } });
    return rows.map((row) => row.userId);
  },
  claimDispatch: async (key) => (await import('@/lib/notify')).claimDispatch(key),
  notifyUsers: async (...args) => (await import('@/lib/notify')).notifyUsers(...args),
});
