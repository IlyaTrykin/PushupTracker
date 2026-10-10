/**
 * Training-program reminders («скоро тренировка») and «пропущена тренировка» notices,
 * sent by the scheduler instead of on page load (B06). Every notice first claims its
 * dedupe key, so parallel ticks send it once (B33).
 */
import type { SchedulerJob } from '../index';
import {
  programMissedMessage,
  programReminderMessage,
  type MissedSessionKind,
  type notifyUsers as notifyUsersFn,
} from '@/lib/notify';
import { diffDays } from '@/lib/calendar-day';
import { programDayOf } from '@/lib/program-plan';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const REMINDER_LOOKBACK_MS = 15 * MINUTE_MS;
export const REMINDER_LOOKAHEAD_MS = 30 * MINUTE_MS;

export type DueSession = { id: string; userId: string; exerciseType: string; scheduledAt: Date };
export type OverdueSession = {
  id: string;
  userId: string;
  programId: string;
  exerciseType: string;
  scheduledAt: Date;
  shiftedCount: number;
  timeZone: string;
};

export type MissedNotice = { kind: MissedSessionKind; key: string; type: string };

export type ProgramRemindersDeps = {
  /** Not completed, not yet reminded sessions of active programs scheduled within [from, to]. */
  findDueSessions(from: Date, to: Date): Promise<DueSession[]>;
  /** Not completed sessions of active programs scheduled before `before`, earliest first. */
  findOverdueSessions(before: Date): Promise<OverdueSession[]>;
  /** A notice of `type` for `link` was already written at or after `since` (by the old page-load code). */
  hasLegacyNotice(userId: string, type: string, link: string, since: Date): Promise<boolean>;
  markReminderSent(sessionIds: string[], now: Date): Promise<void>;
  claimDispatch(key: string): Promise<boolean>;
  notifyUsers: typeof notifyUsersFn;
};

export function reminderWindow(now: Date): { from: Date; to: Date } {
  return {
    from: new Date(now.getTime() - REMINDER_LOOKBACK_MS),
    to: new Date(now.getTime() + REMINDER_LOOKAHEAD_MS),
  };
}

export function programReminderKey(sessionId: string): string {
  return `program-reminder:${sessionId}`;
}

/**
 * Which «missed» notices are due for the earliest overdue session of a program.
 * 1 h notice — while 1–24 h overdue; 24 h notice — while 24–48 h overdue (a stale session
 * never gets a late «an hour ago»); stop warning — once per session at 7–13 carried miss days.
 */
export function planMissedSessionNotices(
  session: { id: string; scheduledAt: Date; shiftedCount: number; timeZone: string },
  now: Date,
): MissedNotice[] {
  const overdueMs = now.getTime() - session.scheduledAt.getTime();
  if (overdueMs < HOUR_MS) return [];
  const iso = session.scheduledAt.toISOString();
  const notices: MissedNotice[] = [];

  if (overdueMs < DAY_MS) {
    notices.push({ kind: 'missed_1h', key: `program-missed-1h:${session.id}:${iso}`, type: 'program_missed_1h' });
  } else if (overdueMs < 2 * DAY_MS) {
    notices.push({ kind: 'missed_24h', key: `program-missed-24h:${session.id}:${iso}`, type: 'program_missed_24h' });
  }

  const carriedMissDays = Math.max(0, session.shiftedCount)
    + Math.max(0, diffDays(programDayOf(now, session.timeZone), programDayOf(session.scheduledAt, session.timeZone)));
  if (carriedMissDays >= 7 && carriedMissDays < 14) {
    notices.push({ kind: 'stop_warning', key: `program-stop-warning:${session.id}`, type: 'program_stop_warning' });
  }
  return notices;
}

export function createProgramRemindersJob(deps: ProgramRemindersDeps): SchedulerJob {
  async function sendReminders(now: Date) {
    const { from, to } = reminderWindow(now);
    const due = await deps.findDueSessions(from, to);
    const byUser = new Map<string, DueSession[]>();
    for (const session of due) {
      const list = byUser.get(session.userId) ?? [];
      list.push(session);
      byUser.set(session.userId, list);
    }

    for (const [userId, sessions] of byUser) {
      const claimed: DueSession[] = [];
      for (const session of sessions) {
        if (await deps.claimDispatch(programReminderKey(session.id))) claimed.push(session);
      }
      if (!claimed.length) continue;
      claimed.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
      await deps.notifyUsers([userId], 'program_reminder', (locale) => programReminderMessage(locale, claimed, now), {
        tag: 'program-reminder',
      });
      await deps.markReminderSent(claimed.map((s) => s.id), now);
    }
  }

  async function sendMissedNotices(now: Date) {
    const overdue = await deps.findOverdueSessions(new Date(now.getTime() - HOUR_MS));
    const firstByProgram = new Map<string, OverdueSession>();
    for (const session of overdue) {
      if (!firstByProgram.has(session.programId)) firstByProgram.set(session.programId, session);
    }

    for (const session of firstByProgram.values()) {
      const link = `/program/session/${session.id}`;
      for (const notice of planMissedSessionNotices(session, now)) {
        if (await deps.hasLegacyNotice(session.userId, notice.type, link, session.scheduledAt)) continue;
        if (!(await deps.claimDispatch(notice.key))) continue;
        await deps.notifyUsers(
          [session.userId],
          'program_reminder',
          (locale) => programMissedMessage(locale, notice.kind, { sessionId: session.id, exerciseType: session.exerciseType }),
          { type: notice.type, tag: `program-${notice.kind}-${session.id}` },
        );
      }
    }
  }

  return {
    name: 'program-reminders',
    async run(now) {
      await sendReminders(now);
      await sendMissedNotices(now);
    },
  };
}

export const programRemindersJob = createProgramRemindersJob({
  findDueSessions: async (from, to) => {
    const { prisma } = await import('@/lib/prisma');
    const rows = await prisma.trainingSession.findMany({
      where: {
        completed: false,
        reminderSentAt: null,
        scheduledAt: { gte: from, lte: to },
        program: { isActive: true, needsRetest: false, user: { deletedAt: null } },
      },
      orderBy: { scheduledAt: 'asc' },
      select: { id: true, scheduledAt: true, program: { select: { userId: true, exerciseType: true } } },
    });
    return rows.map((r) => ({ id: r.id, scheduledAt: r.scheduledAt, userId: r.program.userId, exerciseType: r.program.exerciseType }));
  },
  findOverdueSessions: async (before) => {
    const { prisma } = await import('@/lib/prisma');
    const rows = await prisma.trainingSession.findMany({
      where: {
        completed: false,
        scheduledAt: { lt: before },
        program: { isActive: true, user: { deletedAt: null } },
      },
      orderBy: [{ programId: 'asc' }, { scheduledAt: 'asc' }],
      select: {
        id: true,
        programId: true,
        scheduledAt: true,
        shiftedCount: true,
        program: { select: { userId: true, exerciseType: true, user: { select: { timeZone: true } } } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      programId: r.programId,
      scheduledAt: r.scheduledAt,
      shiftedCount: r.shiftedCount,
      userId: r.program.userId,
      exerciseType: r.program.exerciseType,
      timeZone: r.program.user.timeZone,
    }));
  },
  hasLegacyNotice: async (userId, type, link, since) => {
    const { prisma } = await import('@/lib/prisma');
    const row = await prisma.notification.findFirst({
      where: { userId, type, link, createdAt: { gte: since } },
      select: { id: true },
    });
    return Boolean(row);
  },
  markReminderSent: async (sessionIds, now) => {
    const { prisma } = await import('@/lib/prisma');
    await prisma.trainingSession.updateMany({ where: { id: { in: sessionIds } }, data: { reminderSentAt: now } });
  },
  claimDispatch: async (key) => (await import('@/lib/notify')).claimDispatch(key),
  notifyUsers: async (...args) => (await import('@/lib/notify')).notifyUsers(...args),
});
